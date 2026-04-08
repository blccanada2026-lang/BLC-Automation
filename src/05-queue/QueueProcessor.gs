// ============================================================
// QueueProcessor.gs — BLC Nexus T5 Queue
// src/05-queue/QueueProcessor.gs
//
// LOAD ORDER: First file in T5. Loads after all T0–T4 files.
// DEPENDENCIES: Config (T0), Constants (T0), Identifiers (T0),
//               DAL (T1), RBAC (T2), ErrorHandler (T3),
//               Logger (T3), HealthMonitor (T3),
//               ValidationEngine (T4)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Central queue processor. All form submissions and       ║
// ║  async jobs flow through STG_PROCESSING_QUEUE here.     ║
// ║  One trigger → one processQueue() call.                 ║
// ╚══════════════════════════════════════════════════════════╝
//
// Responsibilities:
//   1. Pick PENDING items from STG_PROCESSING_QUEUE in batches
//   2. Resolve actor and validate queue item structure
//   3. Dispatch to the registered handler for each form_type
//   4. Mark items COMPLETED or FAILED after execution
//   5. Retry failed items up to MAX_ATTEMPTS; dead-letter the rest
//   6. Acquire a script lock to prevent concurrent processing
//   7. Integrate HealthMonitor for quota/time safety
//
// QUEUE ITEM LIFECYCLE:
//
//   PENDING → PROCESSING → COMPLETED
//                       ↘ FAILED (attempt < max) → PENDING (retry)
//                                                ↘ DEAD_LETTER (max reached)
//
// STG_PROCESSING_QUEUE COLUMNS REQUIRED:
//   queue_id         — unique identifier for this queue item
//   form_type        — routing key (matches HANDLER_REGISTRY)
//   submitter_email  — used to resolve RBAC actor
//   status           — PENDING | PROCESSING | COMPLETED | FAILED | DEAD_LETTER
//   attempt_count    — number of execution attempts so far
//   payload_json     — JSON string of the original form submission
//   error_message    — last failure message (populated on FAILED)
//   created_at       — ISO timestamp when item was enqueued
//   updated_at       — ISO timestamp of last status change
//
// CONCURRENCY SAFETY:
//   GAS time-based triggers can fire while a previous run is still
//   executing. processQueue() acquires LockService.getScriptLock()
//   before touching the queue. If the lock is unavailable (another
//   instance is running), this invocation logs a WARN and exits.
//   The mark-to-PROCESSING step before handler execution provides
//   a second layer of idempotency for any row already being handled.
//
// HANDLER REGISTRATION (call from T6+ handler files at load time):
//
//   QueueProcessor.registerHandler(Config.FORM_TYPES.JOB_CREATE,
//     function(queueItem, actor) {
//       // handler body
//     }
//   );
//
// ENTRY POINT (called by Apps Script time-based trigger):
//
//   function runQueueProcessor() {
//     QueueProcessor.processQueue();
//   }
//
// DO NOT:
//   - Call SpreadsheetApp directly
//   - Add business logic here (that belongs in T6+ handlers)
//   - Call processQueue() from within a handler (no recursion)
// ============================================================

var QueueProcessor = (function () {

  // ============================================================
  // SECTION 1: CONSTANTS
  // ============================================================

  /** Maximum handler attempts before an item is dead-lettered. */
  var MAX_ATTEMPTS = Config.LIMITS.deadLetterAfterAttempts || 3;

  /**
   * Required fields on every queue item.
   * Validated before handler dispatch — missing any of these
   * sends the item directly to dead letter (unrecoverable).
   */
  var REQUIRED_QUEUE_FIELDS = [
    'queue_id',
    'form_type',
    'submitter_email',
    'status',
    'payload_json'
  ];

  // ============================================================
  // SECTION 2: HANDLER REGISTRY
  //
  // Maps form_type strings → handler functions.
  // Populated by T6+ handler files calling registerHandler()
  // at module load time (before any trigger fires).
  //
  // Registry is module-scoped — persists for the lifetime of
  // one GAS execution (all trigger runs in the same VM share it).
  // ============================================================

  /** @type {Object.<string, function(Object, Object): *>} */
  var _handlers = {};

  /**
   * Registers a handler function for a given form_type.
   * Overwrites any previously registered handler for that type.
   *
   * Handler signature: fn(queueItem, actor) → any
   *   queueItem: full queue item row object from STG_PROCESSING_QUEUE
   *   actor:     resolved RBAC actor ({ personCode, role, email, ... })
   *
   * Call this from T6+ handler files at load time:
   *   QueueProcessor.registerHandler('JOB_CREATE', JobCreateHandler.handle);
   *
   * @param {string}   formType   Config.FORM_TYPES value
   * @param {function} handlerFn
   */
  function registerHandler(formType, handlerFn) {
    if (!formType || typeof formType !== 'string') {
      throw new Error('QueueProcessor.registerHandler: formType must be a non-empty string.');
    }
    if (typeof handlerFn !== 'function') {
      throw new Error('QueueProcessor.registerHandler: handlerFn must be a function.');
    }
    _handlers[formType] = handlerFn;
  }

  // ============================================================
  // SECTION 3: SAFE JSON PARSE
  // ============================================================

  /**
   * Parses a JSON string safely. Returns null on parse failure
   * rather than throwing, so a malformed payload_json doesn't
   * crash the queue processor — it produces a structured FAILED item.
   *
   * @param {string} jsonString
   * @returns {Object|null}
   */
  function safeParse_(jsonString) {
    if (!jsonString || typeof jsonString !== 'string') return null;
    try {
      return JSON.parse(jsonString);
    } catch (e) {
      return null;
    }
  }

  // ============================================================
  // SECTION 4: STATUS UPDATE HELPERS
  //
  // All queue item status transitions go through these helpers.
  // Each helper builds the minimal update object and delegates
  // to DAL.updateWhere — never touching the sheet directly.
  // ============================================================

  /** Returns current ISO timestamp string. */
  function now_() {
    return new Date().toISOString();
  }

  /**
   * Marks a queue item as PROCESSING and increments attempt_count.
   * Called immediately before handler dispatch.
   *
   * @param {string} queueId
   * @param {number} currentAttemptCount  Existing attempt_count value
   */
  function markProcessing_(queueId, currentAttemptCount) {
    DAL.updateWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: queueId },
      {
        status:        Constants.QUEUE_STATUSES.PROCESSING,
        attempt_count: (currentAttemptCount || 0) + 1,
        updated_at:    now_()
      },
      { callerModule: 'QueueProcessor' }
    );
  }

  /**
   * Marks a queue item as COMPLETED.
   * @param {string} queueId
   */
  function markCompleted_(queueId) {
    DAL.updateWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: queueId },
      {
        status:        Constants.QUEUE_STATUSES.COMPLETED,
        error_message: '',
        updated_at:    now_()
      },
      { callerModule: 'QueueProcessor' }
    );
  }

  /**
   * Marks a queue item as FAILED with an error message.
   * The item remains in the queue for retry on the next run.
   *
   * @param {string} queueId
   * @param {string} errorMessage
   */
  function markFailed_(queueId, errorMessage) {
    DAL.updateWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: queueId },
      {
        status:        Constants.QUEUE_STATUSES.FAILED,
        error_message: String(errorMessage || 'Unknown error').substring(0, 500),
        updated_at:    now_()
      },
      { callerModule: 'QueueProcessor' }
    );
  }

  /**
   * Marks a queue item as DEAD_LETTER (terminal — no more retries).
   * The item remains in STG_PROCESSING_QUEUE for audit; a copy is
   * written to DEAD_LETTER_QUEUE for dedicated review.
   *
   * @param {string} queueId
   * @param {string} errorMessage
   */
  function markDeadLetter_(queueId, errorMessage) {
    DAL.updateWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: queueId },
      {
        status:        Constants.QUEUE_STATUSES.DEAD_LETTER,
        error_message: String(errorMessage || 'Max attempts reached').substring(0, 500),
        updated_at:    now_()
      },
      { callerModule: 'QueueProcessor' }
    );
  }

  /**
   * Writes a copy of the failed item to DEAD_LETTER_QUEUE for
   * admin review and potential manual reprocessing.
   *
   * @param {Object} queueItem    Full queue item row object
   * @param {string} errorMessage Final error message
   */
  function writeDeadLetter_(queueItem, errorMessage) {
    try {
      DAL.appendRow(
        Config.TABLES.DEAD_LETTER_QUEUE,
        {
          dead_letter_id:  Identifiers.generateId(),
          queue_id:        queueItem.queue_id        || '',
          form_type:       queueItem.form_type       || '',
          submitter_email: queueItem.submitter_email || '',
          attempt_count:   queueItem.attempt_count   || MAX_ATTEMPTS,
          payload_json:    queueItem.payload_json     || '',
          error_message:   String(errorMessage || 'Max attempts reached').substring(0, 500),
          original_created_at: queueItem.created_at  || '',
          dead_lettered_at:    now_()
        },
        { callerModule: 'QueueProcessor' }
      );
    } catch (e) {
      // Dead letter write failure is critical — record it but don't re-throw
      ErrorHandler.record(
        'DEAD_LETTER_WRITE_FAILED',
        'Could not write to DEAD_LETTER_QUEUE for queue_id: ' + queueItem.queue_id,
        {
          module:    'QueueProcessor',
          severity:  Constants.SEVERITIES.CRITICAL,
          queue_id:  queueItem.queue_id,
          dal_error: e.message
        }
      );
    }
  }

  // ============================================================
  // SECTION 5: SINGLE ITEM PROCESSOR
  //
  // Handles the complete lifecycle of one queue item:
  //   1. Validate structure
  //   2. Resolve actor
  //   3. Mark PROCESSING (increment attempt_count)
  //   4. Dispatch to handler
  //   5. Mark COMPLETED or handle failure
  //
  // Returns a result object:
  //   { ok: boolean, status: 'COMPLETED'|'FAILED'|'DEAD_LETTER'|'SKIPPED' }
  // ============================================================

  /**
   * Processes a single queue item through its full lifecycle.
   * Never throws — all errors produce a structured failure result.
   *
   * @param {Object} item  Row object from STG_PROCESSING_QUEUE
   * @returns {{ ok: boolean, status: string, queueId: string }}
   */
  function processItem_(item) {
    var queueId = item.queue_id || '(unknown)';

    // ── Guard: skip items already being processed (concurrency safety) ─
    // This check is a secondary guard after the script lock.
    // An item in PROCESSING was already picked by another run —
    // skip it rather than executing the handler twice.
    if (item.status === Constants.QUEUE_STATUSES.PROCESSING) {
      Logger.warn('QUEUE_ITEM_SKIPPED_IN_PROGRESS', {
        module:   'QueueProcessor',
        message:  'Item already PROCESSING — skipping (concurrent execution guard)',
        queue_id: queueId,
        form_type: item.form_type
      });
      return { ok: true, status: 'SKIPPED', queueId: queueId };
    }

    // ── Step 1: Validate required queue item structure ──────────────────
    var structureValid = ErrorHandler.wrap(function () {
      ValidationEngine.validateRequired(item, REQUIRED_QUEUE_FIELDS, {
        module: 'QueueProcessor'
      });
    }, {
      module:    'QueueProcessor',
      errorCode: 'QUEUE_ITEM_INVALID_STRUCTURE',
      severity:  Constants.SEVERITIES.WARNING
    });

    if (!structureValid.ok) {
      // Malformed item — cannot retry meaningfully; dead-letter immediately
      Logger.error('QUEUE_ITEM_INVALID', {
        module:    'QueueProcessor',
        message:   'Queue item missing required fields — dead-lettering immediately',
        queue_id:  queueId
      });
      try {
        markDeadLetter_(queueId, 'Invalid queue item structure — missing required fields');
        writeDeadLetter_(item, 'Invalid queue item structure');
      } catch (e) { /* fail-safe */ }
      return { ok: false, status: Constants.QUEUE_STATUSES.DEAD_LETTER, queueId: queueId };
    }

    // ── Step 2: Resolve actor from submitter_email ──────────────────────
    var actor = null;
    try {
      actor = RBAC.resolveActor(item.submitter_email);
    } catch (e) {
      // Unknown actor — log and dead-letter (cannot authorise handler)
      ErrorHandler.handle(e, {
        module:    'QueueProcessor',
        errorCode: 'QUEUE_ACTOR_RESOLVE_FAILED',
        severity:  Constants.SEVERITIES.ERROR,
        queue_id:  queueId,
        email:     item.submitter_email
      });
      try {
        var actorErr = 'Could not resolve actor for: ' + item.submitter_email;
        markDeadLetter_(queueId, actorErr);
        writeDeadLetter_(item, actorErr);
      } catch (ignored) {}
      return { ok: false, status: Constants.QUEUE_STATUSES.DEAD_LETTER, queueId: queueId };
    }

    // ── Step 3: Look up handler ─────────────────────────────────────────
    var formType = item.form_type;
    var handler  = _handlers[formType];

    if (!handler) {
      var noHandlerMsg = 'No handler registered for form_type: "' + formType + '"';
      Logger.error('QUEUE_NO_HANDLER', {
        module:    'QueueProcessor',
        message:   noHandlerMsg,
        queue_id:  queueId,
        form_type: formType
      });
      try {
        markDeadLetter_(queueId, noHandlerMsg);
        writeDeadLetter_(item, noHandlerMsg);
      } catch (ignored) {}
      return { ok: false, status: Constants.QUEUE_STATUSES.DEAD_LETTER, queueId: queueId };
    }

    // ── Step 4: Mark PROCESSING (increment attempt_count before dispatch) ─
    // Incrementing BEFORE execution ensures a hard crash still counts.
    var attemptCount = parseInt(item.attempt_count, 10) || 0;
    try {
      markProcessing_(queueId, attemptCount);
      attemptCount = attemptCount + 1;  // mirror what was written to the sheet
    } catch (e) {
      ErrorHandler.handle(e, {
        module:    'QueueProcessor',
        errorCode: 'QUEUE_MARK_PROCESSING_FAILED',
        severity:  Constants.SEVERITIES.ERROR,
        queue_id:  queueId
      });
      // Cannot safely proceed if we can't mark the item — skip
      return { ok: false, status: 'SKIPPED', queueId: queueId };
    }

    // ── Step 5: Set Logger thread actor for this handler invocation ─────
    Logger.setActor(actor);

    Logger.info('QUEUE_ITEM_PROCESSING', {
      module:        'QueueProcessor',
      message:       'Dispatching to handler',
      queue_id:      queueId,
      form_type:     formType,
      attempt_count: attemptCount,
      actor_code:    actor.personCode || ''
    });

    // ── Step 6: Execute handler via ErrorHandler.wrap ───────────────────
    var outcome = ErrorHandler.wrap(
      function () { return handler(item, actor); },
      {
        module:    'QueueProcessor',
        errorCode: formType + '_HANDLER_FAILED',
        severity:  Constants.SEVERITIES.ERROR,
        queue_id:  queueId,
        form_type: formType,
        attempt:   attemptCount
      }
    );

    // ── Step 7: Handle result ───────────────────────────────────────────
    Logger.clearActor();

    if (outcome.ok) {
      try { markCompleted_(queueId); } catch (e) { /* fail-safe */ }
      Logger.info('QUEUE_ITEM_COMPLETED', {
        module:    'QueueProcessor',
        message:   'Handler completed successfully',
        queue_id:  queueId,
        form_type: formType
      });
      return { ok: true, status: Constants.QUEUE_STATUSES.COMPLETED, queueId: queueId };
    }

    // ── Handler failed ──────────────────────────────────────────────────
    var failMsg = 'Handler failed (attempt ' + attemptCount + '/' + MAX_ATTEMPTS + ')' +
                  (outcome.exceptionId ? ' — exception: ' + outcome.exceptionId : '');

    if (attemptCount >= MAX_ATTEMPTS) {
      // Max attempts reached — dead letter
      try {
        markDeadLetter_(queueId, failMsg);
        writeDeadLetter_(item, failMsg);
      } catch (e) { /* fail-safe */ }

      Logger.error('QUEUE_ITEM_DEAD_LETTERED', {
        module:       'QueueProcessor',
        message:      'Max attempts reached — moved to dead letter queue',
        queue_id:     queueId,
        form_type:    formType,
        attempt_count: attemptCount,
        exception_id: outcome.exceptionId || ''
      });
      return { ok: false, status: Constants.QUEUE_STATUSES.DEAD_LETTER, queueId: queueId };
    }

    // Retry — mark FAILED but leave eligible for next run (status = PENDING)
    // QueueProcessor picks up PENDING items; FAILED items get re-queued here
    // by resetting to PENDING so the next trigger run re-picks them.
    try {
      // Reset to PENDING so next trigger invocation picks it up again
      DAL.updateWhere(
        Config.TABLES.STG_PROCESSING_QUEUE,
        { queue_id: queueId },
        {
          status:        Constants.QUEUE_STATUSES.PENDING,
          error_message: failMsg.substring(0, 500),
          updated_at:    now_()
        },
        { callerModule: 'QueueProcessor' }
      );
    } catch (e) { /* fail-safe */ }

    Logger.warn('QUEUE_ITEM_FAILED_RETRY', {
      module:        'QueueProcessor',
      message:       'Handler failed — item re-queued for retry',
      queue_id:      queueId,
      form_type:     formType,
      attempt_count: attemptCount,
      remaining:     MAX_ATTEMPTS - attemptCount,
      exception_id:  outcome.exceptionId || ''
    });
    return { ok: false, status: Constants.QUEUE_STATUSES.FAILED, queueId: queueId };
  }

  // ============================================================
  // SECTION 6: processQueue — MAIN ENTRY POINT
  //
  // Called by the Apps Script time-based trigger function.
  // Acquires a script lock, reads a batch of PENDING items,
  // processes each one, then releases the lock.
  //
  // Safe to call from a trigger wrapper function:
  //   function runQueueProcessor() {
  //     QueueProcessor.processQueue();
  //   }
  // ============================================================

  /**
   * Processes one batch of PENDING items from STG_PROCESSING_QUEUE.
   * Acquires a script lock to prevent concurrent execution.
   * Respects HealthMonitor limits — stops the batch early if
   * quota or time thresholds are approaching.
   */
  function processQueue() {
    HealthMonitor.startExecution('QueueProcessor');

    // ── Acquire script lock ────────────────────────────────
    var lock = LockService.getScriptLock();
    var lockAcquired = false;
    try {
      lock.waitLock(Config.get('lockTimeoutMs', 10000));
      lockAcquired = true;
    } catch (e) {
      // Another instance is running — skip this invocation
      Logger.warn('QUEUE_LOCK_UNAVAILABLE', {
        module:  'QueueProcessor',
        message: 'Could not acquire script lock — another instance may be running. Skipping.'
      });
      HealthMonitor.endExecution();
      return;
    }

    // ── Main processing block ──────────────────────────────
    var stats = { picked: 0, completed: 0, failed: 0, deadLettered: 0, skipped: 0 };

    try {
      Logger.info('QUEUE_RUN_START', {
        module:  'QueueProcessor',
        message: 'Queue processing run started'
      });

      // Read PENDING items — also pick up FAILED items eligible for retry
      // (retry-eligible items were reset to PENDING in processItem_)
      var pendingItems = [];
      try {
        pendingItems = DAL.readWhere(
          Config.TABLES.STG_PROCESSING_QUEUE,
          { status: Constants.QUEUE_STATUSES.PENDING }
        );
      } catch (e) {
        ErrorHandler.handle(e, {
          module:    'QueueProcessor',
          errorCode: 'QUEUE_READ_FAILED',
          severity:  Constants.SEVERITIES.CRITICAL
        });
        return; // Cannot process without reading the queue
      }

      if (pendingItems.length === 0) {
        Logger.info('QUEUE_EMPTY', {
          module:  'QueueProcessor',
          message: 'No PENDING items in queue — nothing to process'
        });
        return;
      }

      // Respect batch size limit from Config
      var batchSize = Config.getBatchSize('queueProcessor');
      var batch     = pendingItems.slice(0, batchSize);

      Logger.info('QUEUE_BATCH_PICKED', {
        module:     'QueueProcessor',
        message:    'Processing batch',
        batch_size: batch.length,
        total_pending: pendingItems.length
      });

      stats.picked = batch.length;

      // ── Process each item ────────────────────────────────
      for (var i = 0; i < batch.length; i++) {

        // Check health before each item — stop early if approaching limit
        if (HealthMonitor.isApproachingLimit()) {
          HealthMonitor.checkLimits();  // emit the threshold log
          Logger.warn('QUEUE_RUN_PARTIAL', {
            module:     'QueueProcessor',
            message:    'Stopping batch early — quota or time limit approaching',
            processed:  i,
            remaining:  batch.length - i
          });
          break;
        }

        var result = processItem_(batch[i]);

        switch (result.status) {
          case Constants.QUEUE_STATUSES.COMPLETED:   stats.completed++;   break;
          case Constants.QUEUE_STATUSES.FAILED:      stats.failed++;      break;
          case Constants.QUEUE_STATUSES.DEAD_LETTER: stats.deadLettered++; break;
          case 'SKIPPED':                            stats.skipped++;     break;
        }

        HealthMonitor.checkLimits();
      }

    } finally {
      // ── Always: log summary, release lock, end monitor ────
      Logger.info('QUEUE_RUN_COMPLETE', {
        module:        'QueueProcessor',
        message:       'Queue run finished',
        picked:        stats.picked,
        completed:     stats.completed,
        failed:        stats.failed,
        dead_lettered: stats.deadLettered,
        skipped:       stats.skipped
      });

      if (lockAcquired) {
        try { lock.releaseLock(); } catch (ignored) {}
      }

      HealthMonitor.endExecution();
    }
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {

    // ── Entry point (called by trigger) ──────────────────────
    /**
     * Processes one batch of PENDING queue items.
     * Bind to a GAS time-based trigger.
     * @type {function(): void}
     */
    processQueue: processQueue,

    // ── Handler registration (called by T6+ handler files) ───
    /**
     * Registers a handler for a form_type.
     * Call at load time from T6+ handler files.
     * @type {function(string, function(Object, Object): *): void}
     */
    registerHandler: registerHandler,

    // ── Inspection ───────────────────────────────────────────
    /**
     * Returns the set of registered form_type keys.
     * Useful for debugging and health checks.
     * @returns {string[]}
     */
    getRegisteredFormTypes: function () {
      return Object.keys(_handlers);
    },

    /** Maximum handler attempts before dead-lettering. */
    MAX_ATTEMPTS: MAX_ATTEMPTS

  };

}());
