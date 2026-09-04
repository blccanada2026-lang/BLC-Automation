/**
 * work-log-correction-handler-admin-grant.test.js
 *
 * Tests for the WORK_LOG_CORRECTION_ADMIN carve-out in
 * src/06-handlers/WorkLogCorrectionHandler.gs's handleAmend/handleVoid.
 *
 * Context (2026-09-04): HR_ACCOUNTING needs a way to correct duplicate/
 * erroneous work-log hours (root-caused a payroll/billing discrepancy
 * investigation), without gaining the general WORK_LOG_AMEND/VOID
 * self-service actions DESIGNER/TEAM_LEAD use for their own hours (see
 * tests/rbac.test.js — HR_ACCOUNTING stays denied on those). RBAC.gs
 * now grants HR_ACCOUNTING a new WORK_LOG_CORRECTION_ADMIN action —
 * CEO/ADMIN also get it, redundantly with their existing WORK_LOG_AMEND/
 * VOID grant; SYSTEM does NOT (it has its own pre-existing, deliberate
 * CTO-spec exclusion from all work-log correction authority, which this
 * new action must not reverse — see rbac.test.js). This file proves the
 * HANDLER actually honours the new door — Step 1 of handleAmend/handleVoid
 * must accept either the original action or WORK_LOG_CORRECTION_ADMIN.
 *
 * Loads the real RBAC.gs (matrix) and Constants.gs (event types) so the
 * permission check under test runs against real, not stubbed, logic.
 * Everything else (DAL, ValidationEngine, IdempotencyEngine, StateMachine,
 * QueueProcessor) is a minimal hand-rolled stub — their own behaviour is
 * already covered by src/setup/WorkLogCorrectionHandlerTest.gs; this file
 * only needs them to pass a correction through to prove the gate opened.
 */

const fs   = require('fs');
const path = require('path');

function loadSrc(relPath) {
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

var store;

function installMocks() {
  store = {}; // 'TABLE|periodId' -> array of row objects

  global.Config = {
    TABLES: {
      FACT_WORK_LOGS:      'FACT_WORK_LOGS',
      FACT_PAYROLL_LEDGER: 'FACT_PAYROLL_LEDGER'
    },
    FORM_TYPES: {
      WORK_LOG_AMEND:    'WORK_LOG_AMEND',
      WORK_LOG_VOID:     'WORK_LOG_VOID',
      WORK_LOG_REASSIGN: 'WORK_LOG_REASSIGN'
    }
  };

  global.Logger = { info: function () {}, warn: function () {}, error: function () {}, log: function () {} };

  global.Identifiers = {
    generateId:              function () { return 'EVT-' + Math.random().toString(36).slice(2); },
    generateCurrentPeriodId: function () { return '2026-08'; }
  };

  global.DAL = {
    readAll: function (table, opts) {
      var key = table + '|' + (opts && opts.periodId);
      return (store[key] || []).slice();
    },
    readWhere: function (table, conditions, opts) {
      var key  = table + '|' + (opts && opts.periodId);
      var rows = store[key] || [];
      return rows.filter(function (r) {
        return Object.keys(conditions).every(function (k) { return r[k] === conditions[k]; });
      });
    },
    appendRow: function (table, row, opts) {
      var key = table + '|' + (opts && opts.periodId);
      if (!store[key]) store[key] = [];
      store[key].push(Object.assign({}, row));
    },
    ensurePartition: function () {}
  };

  global.ValidationEngine = {
    validate: function (schema, data) { return data; } // pass-through — schema behaviour not under test here
  };

  global.IdempotencyEngine = {
    checkAndMark: function () { return true; },
    clear:        function () {}
  };

  global.StateMachine = {
    getJobView: function () { return { current_state: 'IN_PROGRESS' }; },
    isTerminal: function () { return false; }
  };

  global.QueueProcessor = { registerHandler: function () {} };

  loadSrc('../src/00-foundation/Constants.gs');
  loadSrc('../src/02-security/RBAC.gs');
  loadSrc('../src/06-handlers/WorkLogCorrectionHandler.gs');
}

function seedOriginalEntry(overrides) {
  var row = Object.assign({
    event_id:   'EVT-ORIGINAL',
    job_number: 'BLC-TEST01',
    actor_code: 'TST1',
    actor_role: 'DESIGNER',
    hours:      4,
    work_date:  '2026-08-18',
    event_type: 'WORK_LOG_SUBMITTED',
    notes:      ''
  }, overrides || {});
  var key = 'FACT_WORK_LOGS|2026-08';
  store[key] = (store[key] || []).concat([row]);
  return row;
}

function actor(role, personCode) {
  // _rbacResolved: true — RBAC.enforcePermission's assertActorExists_ rejects
  // any actor object not produced by RBAC.resolveActor(); a hand-built test
  // actor must set this explicitly to pass that guard.
  return {
    email: 'test-' + role.toLowerCase() + '@test.blc.internal',
    role: role,
    personCode: personCode || 'OPX',
    displayName: 'Test ' + role,
    _rbacResolved: true
  };
}

beforeEach(() => {
  installMocks();
});

describe('WorkLogCorrectionHandler.handleVoid — WORK_LOG_CORRECTION_ADMIN carve-out', () => {
  test('HR_ACCOUNTING can void another person\'s entry via the new action', () => {
    seedOriginalEntry({ actor_code: 'TST1', job_number: 'BLC-TEST01', work_date: '2026-08-18', hours: 4.5 });

    var queueItem = {
      queue_id: 'Q-1',
      payload_json: JSON.stringify({
        actor_code: 'TST1', job_number: 'BLC-TEST01', work_date: '2026-08-18', hours: 4.5,
        reason: 'Duplicate entry — HR confirmed only one line on the client timesheet.'
      })
    };

    var eventId = WorkLogCorrectionHandler.handleVoid(queueItem, actor('HR_ACCOUNTING'));

    expect(eventId).not.toBe('DUPLICATE');
    var written = store['FACT_WORK_LOGS|2026-08'].find(function (r) { return r.event_type === 'WORK_LOG_VOIDED'; });
    expect(written).toBeTruthy();
    expect(written.hours).toBe(-4.5);
  });

  test('CLIENT (neither WORK_LOG_VOID nor WORK_LOG_CORRECTION_ADMIN) is still denied', () => {
    seedOriginalEntry({ actor_code: 'TST1', job_number: 'BLC-TEST01', work_date: '2026-08-18', hours: 4.5 });
    var queueItem = {
      queue_id: 'Q-2',
      payload_json: JSON.stringify({
        actor_code: 'TST1', job_number: 'BLC-TEST01', work_date: '2026-08-18', hours: 4.5, reason: 'n/a'
      })
    };
    expect(function () {
      WorkLogCorrectionHandler.handleVoid(queueItem, actor('CLIENT'));
    }).toThrow();
  });

  test('DESIGNER voiding their own entry via the original WORK_LOG_VOID grant is unaffected', () => {
    seedOriginalEntry({ actor_code: 'OPX', job_number: 'BLC-TEST01', work_date: '2026-08-18', hours: 4.5 });
    var queueItem = {
      queue_id: 'Q-3',
      payload_json: JSON.stringify({
        actor_code: 'OPX', job_number: 'BLC-TEST01', work_date: '2026-08-18', hours: 4.5,
        reason: 'Logged the wrong hours, self-correcting.'
      })
    };
    var eventId = WorkLogCorrectionHandler.handleVoid(queueItem, actor('DESIGNER', 'OPX'));
    expect(eventId).not.toBe('DUPLICATE');
  });

  test('a manually-constructed actor (no _rbacResolved) is rejected even for a role that holds WORK_LOG_VOID — enforceCorrectionPermission_ must not bypass assertActorExists_', () => {
    // Code-review finding: RBAC.hasPermission() (unlike RBAC.enforcePermission())
    // does NOT call assertActorExists_ — it only checks actor.role. The
    // fast-path `if (RBAC.hasPermission(actor, primaryAction)) return;`
    // returned without ever calling RBAC.enforcePermission for any role
    // that already holds the primary action (DESIGNER/TEAM_LEAD/QC/PM/
    // CEO/ADMIN), silently skipping the "actor must come from
    // RBAC.resolveActor()" guard documented in RBAC.gs's assertActorExists_.
    seedOriginalEntry({ actor_code: 'TST1', job_number: 'BLC-TEST01', work_date: '2026-08-18', hours: 4.5 });
    var queueItem = {
      queue_id: 'Q-UNRESOLVED',
      payload_json: JSON.stringify({
        actor_code: 'TST1', job_number: 'BLC-TEST01', work_date: '2026-08-18', hours: 4.5, reason: 'n/a'
      })
    };
    var unresolvedActor = { email: 'ceo@test.blc.internal', role: 'CEO', personCode: 'TCEO' }; // no _rbacResolved
    expect(function () {
      WorkLogCorrectionHandler.handleVoid(queueItem, unresolvedActor);
    }).toThrow();
  });
});

describe('WorkLogCorrectionHandler.handleVoid — event_id disambiguation for byte-identical duplicates', () => {
  // Real incident (2026-09-04): Abhisek Rit had two WORK_LOG_SUBMITTED
  // rows for the same job/date/hours — a genuine double-submit, not a
  // multi-day job. findOriginalEntry_ matches on actor_code+job_number+
  // work_date+hours only, so voiding either copy via the normal VOID
  // payload throws "ambiguous — 2 matching entries found" and the
  // correction can never be applied. An optional event_id in the payload
  // disambiguates without changing behavior for the normal single-match case.
  test('voiding without event_id still throws ambiguous when two rows are byte-identical (unchanged pre-existing behavior)', () => {
    seedOriginalEntry({ event_id: 'EVT-DUP-A', actor_code: 'TST1', job_number: 'BLC-TEST02', work_date: '2026-08-24', hours: 4 });
    seedOriginalEntry({ event_id: 'EVT-DUP-B', actor_code: 'TST1', job_number: 'BLC-TEST02', work_date: '2026-08-24', hours: 4 });
    var queueItem = {
      queue_id: 'Q-AMBIG-1',
      payload_json: JSON.stringify({
        actor_code: 'TST1', job_number: 'BLC-TEST02', work_date: '2026-08-24', hours: 4, reason: 'Duplicate submission.'
      })
    };
    expect(function () {
      WorkLogCorrectionHandler.handleVoid(queueItem, actor('HR_ACCOUNTING'));
    }).toThrow(/ambiguous/);
  });

  test('voiding with event_id resolves the ambiguity and voids exactly the targeted row', () => {
    seedOriginalEntry({ event_id: 'EVT-DUP-A', actor_code: 'TST1', job_number: 'BLC-TEST02', work_date: '2026-08-24', hours: 4 });
    seedOriginalEntry({ event_id: 'EVT-DUP-B', actor_code: 'TST1', job_number: 'BLC-TEST02', work_date: '2026-08-24', hours: 4 });
    var queueItem = {
      queue_id: 'Q-AMBIG-2',
      payload_json: JSON.stringify({
        actor_code: 'TST1', job_number: 'BLC-TEST02', work_date: '2026-08-24', hours: 4,
        event_id: 'EVT-DUP-B', reason: 'Duplicate submission — voiding the second copy.'
      })
    };
    var eventId = WorkLogCorrectionHandler.handleVoid(queueItem, actor('HR_ACCOUNTING'));
    expect(eventId).not.toBe('DUPLICATE');
    var written = store['FACT_WORK_LOGS|2026-08'].find(function (r) { return r.event_type === 'WORK_LOG_VOIDED'; });
    expect(written.notes).toMatch(/EVT-DUP-B/);
  });

  test('an event_id that does not match either row is treated as not found', () => {
    seedOriginalEntry({ event_id: 'EVT-DUP-A', actor_code: 'TST1', job_number: 'BLC-TEST02', work_date: '2026-08-24', hours: 4 });
    seedOriginalEntry({ event_id: 'EVT-DUP-B', actor_code: 'TST1', job_number: 'BLC-TEST02', work_date: '2026-08-24', hours: 4 });
    var queueItem = {
      queue_id: 'Q-AMBIG-3',
      payload_json: JSON.stringify({
        actor_code: 'TST1', job_number: 'BLC-TEST02', work_date: '2026-08-24', hours: 4,
        event_id: 'EVT-DOES-NOT-EXIST', reason: 'n/a'
      })
    };
    expect(function () {
      WorkLogCorrectionHandler.handleVoid(queueItem, actor('HR_ACCOUNTING'));
    }).toThrow(/no matching correctable entry/);
  });
});

describe('WorkLogCorrectionHandler.handleVoid — cannot double-void the same original entry', () => {
  // Code-review finding (2026-09-04): idempotency is keyed on queue_id,
  // which is fresh on every submission — a retried/double-submitted void
  // request for the SAME original entry is not caught by IdempotencyEngine,
  // and the negative-hours guard alone doesn't catch it either when a
  // sibling duplicate's "spare" hours mask the double-void (exactly the
  // scenario this feature exists for: two 4h rows, net=8h — voiding one
  // 4h row twice still leaves net=0, which looks non-negative but has
  // wiped out the SURVIVING row's legitimate hours too). Server-side
  // guard: refuse to void/amend an original event_id that already has a
  // correction recorded against it, mirroring the client-side
  // corrected_status check PortalData.gs already relies on for the UI
  // (buttons disabled) but which a stalled-UI retry can bypass entirely.
  test('a second void request targeting the same already-voided event_id is rejected, not silently double-applied', () => {
    seedOriginalEntry({ event_id: 'EVT-DUP-A', actor_code: 'TST1', job_number: 'BLC-TEST03', work_date: '2026-08-24', hours: 4 });
    seedOriginalEntry({ event_id: 'EVT-DUP-B', actor_code: 'TST1', job_number: 'BLC-TEST03', work_date: '2026-08-24', hours: 4 });

    var firstPayload = {
      actor_code: 'TST1', job_number: 'BLC-TEST03', work_date: '2026-08-24', hours: 4,
      event_id: 'EVT-DUP-B', reason: 'Duplicate submission — voiding the second copy.'
    };
    WorkLogCorrectionHandler.handleVoid({ queue_id: 'Q-FIRST', payload_json: JSON.stringify(firstPayload) }, actor('HR_ACCOUNTING'));

    // Simulate a retry: same target, brand-new queue_id (as a real UI
    // double-submit would generate) — IdempotencyEngine sees this as new.
    var retryPayload = firstPayload;
    expect(function () {
      WorkLogCorrectionHandler.handleVoid({ queue_id: 'Q-RETRY', payload_json: JSON.stringify(retryPayload) }, actor('HR_ACCOUNTING'));
    }).toThrow(/already/i);

    var voidedRows = store['FACT_WORK_LOGS|2026-08'].filter(function (r) { return r.event_type === 'WORK_LOG_VOIDED'; });
    expect(voidedRows.length).toBe(1); // not 2 — the retry must not have written a second void
  });
});

describe('WorkLogCorrectionHandler.handleAmend — WORK_LOG_CORRECTION_ADMIN carve-out', () => {
  test('HR_ACCOUNTING can amend another person\'s entry via the new action', () => {
    seedOriginalEntry({ actor_code: 'TST1', job_number: 'BLC-TEST01', work_date: '2026-08-18', hours: 4.5 });
    var queueItem = {
      queue_id: 'Q-4',
      payload_json: JSON.stringify({
        actor_code: 'TST1', job_number: 'BLC-TEST01', work_date: '2026-08-18',
        original_hours: 4.5, new_hours: 4, reason: 'HR corrected the logged hours to match the client timesheet.'
      })
    };
    var eventId = WorkLogCorrectionHandler.handleAmend(queueItem, actor('HR_ACCOUNTING'));
    expect(eventId).not.toBe('DUPLICATE');
    var written = store['FACT_WORK_LOGS|2026-08'].find(function (r) { return r.event_type === 'WORK_LOG_AMENDED'; });
    expect(written).toBeTruthy();
    expect(written.hours).toBe(-0.5);
  });

  test('CLIENT is still denied for amend', () => {
    seedOriginalEntry({ actor_code: 'TST1', job_number: 'BLC-TEST01', work_date: '2026-08-18', hours: 4.5 });
    var queueItem = {
      queue_id: 'Q-5',
      payload_json: JSON.stringify({
        actor_code: 'TST1', job_number: 'BLC-TEST01', work_date: '2026-08-18',
        original_hours: 4.5, new_hours: 4, reason: 'n/a'
      })
    };
    expect(function () {
      WorkLogCorrectionHandler.handleAmend(queueItem, actor('CLIENT'));
    }).toThrow();
  });
});

describe('WorkLogCorrectionHandler.VOID_SCHEMA — event_id survives real ValidationEngine schema stripping', () => {
  // Code-review finding (2026-09-04): ValidationEngine.validate() returns
  // a "clean" object containing ONLY schema-defined keys (see
  // src/04-validation/ValidationEngine.gs — fields not in the schema are
  // silently dropped). This file's own ValidationEngine mock is a bare
  // pass-through (`return data`), so it would pass identically even if
  // VOID_SCHEMA's event_id field were deleted entirely — this test loads
  // the REAL ValidationEngine.gs to close that gap.
  beforeEach(() => {
    global.ErrorHandler = { record: function () {} }; // only invoked on validation failure — not exercised here
    loadSrc('../src/04-validation/ValidationEngine.gs');
  });

  test('event_id is present in the clean output when supplied', () => {
    var payload = { actor_code: 'TST1', job_number: 'BLC-TEST01', work_date: '2026-08-18', hours: 4, event_id: 'EVT-DUP-B', reason: 'Duplicate submission.' };
    var clean = ValidationEngine.validate(WorkLogCorrectionHandler.VOID_SCHEMA, payload);
    expect(clean.event_id).toBe('EVT-DUP-B');
  });

  test('event_id is absent from the clean output when omitted, and validation still succeeds', () => {
    var payload = { actor_code: 'TST1', job_number: 'BLC-TEST01', work_date: '2026-08-18', hours: 4, reason: 'Not a duplicate.' };
    var clean = ValidationEngine.validate(WorkLogCorrectionHandler.VOID_SCHEMA, payload);
    expect(clean.hasOwnProperty('event_id')).toBe(false);
  });
});
