// ============================================================
// ClientFeedbackTrigger.gs — BLC Nexus T9 Client Feedback
// src/09-feedback/ClientFeedbackTrigger.gs
//
// LOAD ORDER: T9.
// DEPENDENCIES: Config (T0), PortalData (T7), ClientFeedback (T9)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  onFormSubmit trigger for the grid-based feedback form. ║
// ║                                                         ║
// ║  Each form submission contains one client's scores for  ║
// ║  ALL their designers (grid response). The trigger       ║
// ║  extracts one score per grid row and enqueues each as   ║
// ║  a separate CLIENT_FEEDBACK queue item.                 ║
// ║                                                         ║
// ║  SETUP (once after first form is created):              ║
// ║    Run installFeedbackTrigger() from Apps Script editor ║
// ╚══════════════════════════════════════════════════════════╝
//
// GRID ROW FORMAT: "DS1 — Alice Smith"
//   Split on ' — ' (em-dash with spaces) → first part = designer code.
//
// NAMED VALUES KEY FORMAT FOR GRID ROWS:
//   "Please rate each designer's performance this quarter [DS1 — Alice Smith]"
//   → contains row label in square brackets at end of string.
// ============================================================

/**
 * Spreadsheet onFormSubmit trigger.
 * Parses the grid feedback form response and enqueues one
 * CLIENT_FEEDBACK item per designer who received a rating.
 *
 * @param {Object} e  GAS form submit event
 */
function onFeedbackFormSubmit(e) {
  try {
    var nv         = e.namedValues || {};
    var responseId = e.response ? e.response.getId() : '';

    // ── Identify client + period from the response sheet name ─
    // Form is linked to a sheet named FBRESP_{YYYY-MM}_{clientCode}.
    // This avoids relying on pre-filled hidden form fields, which are
    // fragile when URLs pass through email clients.
    var sheetName  = (e.range && e.range.getSheet()) ? e.range.getSheet().getSheetName() : '';
    var periodId   = '';
    var clientCode = '';

    if (sheetName.indexOf('FBRESP_') === 0) {
      // Format: FBRESP_YYYY-MM_CLIENTCODE (period is always 7 chars: YYYY-MM)
      var rest   = sheetName.substring(7);   // strip 'FBRESP_'
      periodId   = rest.substring(0, 7);     // 'YYYY-MM'
      clientCode = rest.substring(8).toUpperCase(); // skip underscore, rest is client code
    }

    if (!periodId || !clientCode) {
      Logger.warn('FEEDBACK_TRIGGER_MISSING_FIELDS', {
        module:  'ClientFeedbackTrigger',
        message: 'Could not identify period/client from response sheet name — skipped',
        sheet:   sheetName,
        period:  periodId,
        client:  clientCode
      });
      return;
    }

    // ── Extract comments (optional overall field) ─────────────
    var comments = '';
    var commentKeys = ['Any other comments? (optional)', 'Additional comments (optional)', 'Comments'];
    for (var ck = 0; ck < commentKeys.length; ck++) {
      if (nv[commentKeys[ck]]) {
        comments = String((nv[commentKeys[ck]] || [''])[0]).trim();
        break;
      }
    }

    // ── Extract qualitative open-text fields (shared across all designers in this submission) ──
    var strengthsText     = String((nv[ClientFeedback.Q_STRENGTHS]   || [''])[0]).trim();
    var improvementText   = String((nv[ClientFeedback.Q_IMPROVEMENT] || [''])[0]).trim();
    var errorFeedbackText = String((nv[ClientFeedback.Q_ERRORS]      || [''])[0]).trim();
    var easeText          = String((nv[ClientFeedback.Q_EASE]        || [''])[0]).trim();
    var recommendRaw      = String((nv[ClientFeedback.Q_RECOMMEND]   || [''])[0]).trim();
    var recommendFlag     = recommendRaw.toLowerCase().indexOf('yes') === 0 ? 'YES' : (recommendRaw ? 'NO' : '');
    var recommendReason   = recommendRaw;   // store full text; processFeedbackResponse splits flag/reason
    var suggestionsText   = String((nv[ClientFeedback.Q_SUGGESTIONS] || [''])[0]).trim();

    // ── Parse grid rows ───────────────────────────────────────
    // Grid named value keys look like:
    //   "Please rate each designer's performance this quarter [DS3 — Bob Jones]"
    // We match all keys that start with the grid question title and have [Row] at the end.

    var gridPrefix = ClientFeedback.GRID_QUESTION_TITLE;
    var rowPattern = /\[(.+)\]$/;
    var queued     = 0;
    var systemEmail = 'system@blc-nexus.internal';

    var keys = Object.keys(nv);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];

      // Match grid row keys
      if (key.indexOf(gridPrefix) !== 0) continue;
      var rowMatch = key.match(rowPattern);
      if (!rowMatch) continue;

      var rowLabel     = rowMatch[1];                      // "DS3 — Bob Jones"
      var designerCode = rowLabel.split(' \u2014 ')[0].trim().toUpperCase();  // "DS3"
      if (!designerCode) continue;

      var scoreRaw = String((nv[key] || [''])[0]).trim();
      var score    = parseInt(scoreRaw, 10);

      // Skip blank ratings (client left a row empty — allowed, not required)
      if (!scoreRaw || isNaN(score) || score < 1 || score > 5) continue;

      // Enqueue one item per designer.
      // Qualitative fields are shared across all designers from this submission
      // (the client writes open feedback about the team, not per-individual).
      var payload = {
        period_id:             periodId,
        client_code:           clientCode,
        designer_code:         designerCode,
        score:                 score,
        comments:              comments,
        form_response_id:      responseId,
        strengths_text:        strengthsText,
        improvement_text:      improvementText,
        error_feedback_text:   errorFeedbackText,
        ease_of_working_text:  easeText,
        recommendation_flag:   recommendFlag,
        recommendation_reason: recommendReason,
        suggestions_text:      suggestionsText
      };

      PortalData.writeQueueItem(
        Config.FORM_TYPES.CLIENT_FEEDBACK,
        JSON.stringify(payload),
        systemEmail
      );
      queued++;
    }

    if (queued === 0) {
      Logger.warn('FEEDBACK_TRIGGER_NO_SCORES', {
        module:  'ClientFeedbackTrigger',
        message: 'Form response received but no valid scores found',
        client:  clientCode,
        period:  periodId
      });
      return;
    }

    // ── Drain the queue immediately ───────────────────────────
    try {
      QueueProcessor.processQueue();
    } catch (qe) {
      Logger.warn('FEEDBACK_TRIGGER_DRAIN_FAILED', {
        module: 'ClientFeedbackTrigger',
        message: 'processQueue() failed — items remain queued for next trigger run',
        error: qe.message
      });
    }

    Logger.info('FEEDBACK_TRIGGER_PROCESSED', {
      module:     'ClientFeedbackTrigger',
      message:    'Feedback form response processed',
      client:     clientCode,
      period:     periodId,
      scores_queued: queued
    });

  } catch (err) {
    Logger.warn('FEEDBACK_TRIGGER_ERROR', {
      module:  'ClientFeedbackTrigger',
      message: 'Unhandled error in onFeedbackFormSubmit',
      error:   err.message
    });
  }
}

/**
 * One-time setup: installs the onFeedbackFormSubmit trigger on the spreadsheet.
 * Safe to re-run — checks for existing trigger first.
 */
function installFeedbackTrigger() {
  var ss       = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getUserTriggers(ss);

  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'onFeedbackFormSubmit') {
      return 'Trigger already installed — no action taken.';
    }
  }

  ScriptApp.newTrigger('onFeedbackFormSubmit')
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();

  Logger.info('FEEDBACK_TRIGGER_INSTALLED', {
    module: 'ClientFeedbackTrigger', message: 'onFeedbackFormSubmit trigger installed'
  });

  return 'Trigger installed successfully.';
}
