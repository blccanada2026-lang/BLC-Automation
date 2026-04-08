// ============================================================
// ClientFeedback.gs — BLC Nexus T9 Client Feedback
// src/09-feedback/ClientFeedback.gs
//
// LOAD ORDER: T9. Loads after all T0–T8 files.
// DEPENDENCIES: Config (T0), Identifiers (T0), DAL (T1),
//               RBAC (T2), Logger (T3)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Client feedback collection for the quarterly bonus.    ║
// ║                                                         ║
// ║  sendFeedbackRequests(actorEmail, options)              ║
// ║    → One form per client per quarter (grid layout).     ║
// ║      Each client gets ONE email with ONE link.          ║
// ║      They rate all their designers on a single page.    ║
// ║                                                         ║
// ║  processFeedbackResponse(queueItem, actor)             ║
// ║    → QueueProcessor handler. One queue item per         ║
// ║      designer score extracted from the grid response.  ║
// ║      Writes to FACT_CLIENT_FEEDBACK.                    ║
// ║                                                         ║
// ║  getFeedbackSummary(periodId)                           ║
// ║    → Per-designer avg normalized score for quarterly    ║
// ║      bonus engine.                                      ║
// ║                                                         ║
// ║  getFeedbackStatus(actorEmail, periodId)                ║
// ║    → Response counts + scores for portal display.       ║
// ╚══════════════════════════════════════════════════════════╝
//
// FORM DESIGN (one form per client per quarter):
//
//   Title:  "BLC Performance Feedback — {ClientName} — {Quarter}"
//
//   Q1 (text, pre-filled): "Period ID"      → e.g. 2026-06
//   Q2 (text, pre-filled): "Client Code"    → e.g. MATIX
//   Q3 (grid, required):   "Please rate each designer's performance
//                            this quarter (1 = Poor, 5 = Excellent)"
//                           Rows:    ["DS1 — Alice Smith", "DS3 — Bob Jones"]
//                           Columns: ["1", "2", "3", "4", "5"]
//   Q4 (paragraph, opt):   "Any other comments?"
//
//   ONE URL per client — pre-fills Period ID and Client Code.
//   Client rates ALL their designers on a single page.
//
// GRID RESPONSE PARSING:
//   namedValues key format: "Question title [Row label]"
//   e.g. "Please rate each designer's... [DS3 — Bob Jones]" → "4"
//   Designer code extracted: rowLabel.split(' — ')[0].trim()
//
// SCORE NORMALISATION:
//   raw_score (1–5) → normalized_score (0–100)
//   formula: (raw - 1) / 4 * 100
//   1→0  2→25  3→50  4→75  5→100
//
// SCRIPT PROPERTIES KEYS:
//   FEEDBACK_FORM_{periodId}_{clientCode}
//     → Google Form ID (string)
//   FEEDBACK_ENTRY_IDS_{periodId}_{clientCode}
//     → JSON { periodId: <entryId>, clientCode: <entryId> }
//
// QUARTERLY BONUS WEIGHT: 30% of total score.
// ============================================================

var ClientFeedback = (function () {

  var MODULE = 'ClientFeedback';

  // Grid question title — must match exactly in the trigger parser
  var GRID_QUESTION_TITLE = "Please rate each designer's performance this quarter";

  // ============================================================
  // SECTION 1: sendFeedbackRequests
  // ============================================================

  /**
   * Creates one Google Form per client for the quarter and emails each
   * client a single pre-filled link. Client rates all their designers
   * on one page with a rating grid.
   *
   * @param {string} actorEmail  CEO only (PAYROLL_RUN permission)
   * @param {Object} [options]
   * @param {string} [options.periodId]  Default: current period
   * @returns {{ period_id, quarter, emails_sent, designer_client_pairs }}
   */
  function sendFeedbackRequests(actorEmail, options) {
    options = options || {};

    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);

    var periodId = options.periodId || Identifiers.generateCurrentPeriodId();
    var quarter  = buildQuarterLabel_(periodId);

    // ── 1. Build { clientCode → [designerCodes] } map ────────
    var pairs    = buildDesignerClientPairs_(periodId);
    if (pairs.length === 0) {
      Logger.warn('FEEDBACK_NO_PAIRS', {
        module: MODULE, message: 'No designer-client pairs found — no emails sent',
        period_id: periodId
      });
      return { period_id: periodId, quarter: quarter, emails_sent: 0, designer_client_pairs: 0 };
    }

    var byClient = {};
    for (var p = 0; p < pairs.length; p++) {
      var pair = pairs[p];
      if (!byClient[pair.client_code]) byClient[pair.client_code] = [];
      byClient[pair.client_code].push(pair.designer_code);
    }

    // ── 2. Support maps ───────────────────────────────────────
    var clientMap    = buildClientMap_();
    var designerNames = buildDesignerNameMap_();

    // ── 3. Per client: create form + send email ───────────────
    var emailsSent = 0;
    var clientCodes = Object.keys(byClient);

    for (var c = 0; c < clientCodes.length; c++) {
      var clientCode = clientCodes[c];
      var client     = clientMap[clientCode];

      if (!client || !client.contact_email) {
        Logger.warn('FEEDBACK_NO_CLIENT_EMAIL', {
          module: MODULE, message: 'No contact email — skipping', client_code: clientCode
        });
        continue;
      }

      var designers     = byClient[clientCode];
      var designerRows  = buildDesignerRows_(designers, designerNames);

      // Create (or reuse) the form for this client+period
      var formMeta = getOrCreateClientForm_(periodId, quarter, clientCode, client.client_name, designerRows);

      // Build ONE pre-filled URL for this client
      var formUrl = buildPrefilledUrl_(formMeta.formId, formMeta.entryIds, periodId, clientCode);

      // Send the email
      sendClientEmail_(client, designerNames, designers, formUrl, quarter);
      emailsSent++;
    }

    Logger.info('FEEDBACK_REQUESTS_SENT', {
      module: MODULE, message: 'Feedback emails sent',
      period_id: periodId, quarter: quarter,
      emails_sent: emailsSent, pairs: pairs.length, actor: actorEmail
    });

    return {
      period_id:             periodId,
      quarter:               quarter,
      emails_sent:           emailsSent,
      designer_client_pairs: pairs.length
    };
  }

  // ============================================================
  // SECTION 2: processFeedbackResponse
  //
  // Called by QueueProcessor for CLIENT_FEEDBACK items.
  // payload_json contains one designer score extracted by the trigger.
  // ============================================================

  /**
   * @param {Object} queueItem
   * @param {Object} actor
   */
  function processFeedbackResponse(queueItem, actor) {
    var payload;
    try {
      payload = JSON.parse(queueItem.payload_json);
    } catch (e) {
      throw new Error('ClientFeedback: invalid payload JSON — ' + e.message);
    }

    var periodId     = String(payload.period_id     || '').trim();
    var clientCode   = String(payload.client_code   || '').trim().toUpperCase();
    var designerCode = String(payload.designer_code || '').trim().toUpperCase();
    var rawScore     = parseInt(payload.score, 10);
    var comments     = String(payload.comments      || '').trim();
    var responseId   = String(payload.form_response_id || '').trim();

    if (!periodId || !clientCode || !designerCode) {
      throw new Error('ClientFeedback: missing period_id, client_code, or designer_code');
    }
    if (isNaN(rawScore) || rawScore < 1 || rawScore > 5) {
      throw new Error('ClientFeedback: invalid score "' + payload.score + '" — must be 1–5');
    }

    // One response per (client, designer, period)
    var iKey = 'FEEDBACK|' + clientCode + '|' + designerCode + '|' + periodId;

    var existing;
    try {
      existing = DAL.readWhere(
        Config.TABLES.FACT_CLIENT_FEEDBACK,
        { idempotency_key: iKey },
        { callerModule: MODULE }
      );
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') existing = [];
      else throw e;
    }

    if (existing && existing.length > 0) {
      Logger.info('FEEDBACK_DUPLICATE', { module: MODULE, message: 'Duplicate skipped', ikey: iKey });
      return;
    }

    var normalizedScore = Math.round((rawScore - 1) / 4 * 100 * 100) / 100;
    var eventId         = Identifiers.generateId(Config.ID_PREFIXES.FEEDBACK);

    DAL.appendRow(Config.TABLES.FACT_CLIENT_FEEDBACK, {
      event_id:         eventId,
      period_id:        periodId,
      quarter:          buildQuarterLabel_(periodId),
      client_code:      clientCode,
      designer_code:    designerCode,
      submitted_at:     new Date().toISOString(),
      raw_score:        rawScore,
      normalized_score: normalizedScore,
      comments:         comments,
      form_response_id: responseId,
      idempotency_key:  iKey,
      status:           'RECEIVED'
    }, { callerModule: MODULE });

    Logger.info('FEEDBACK_RECORDED', {
      module: MODULE, event_id: eventId,
      client_code: clientCode, designer_code: designerCode,
      period_id: periodId, raw_score: rawScore, normalized_score: normalizedScore
    });
  }

  // ============================================================
  // SECTION 3: getFeedbackSummary
  // ============================================================

  /**
   * @param {string} periodId
   * @returns {{ [designer_code]: { avg_normalized, response_count, client_codes[] } }}
   */
  function getFeedbackSummary(periodId) {
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_CLIENT_FEEDBACK, { callerModule: MODULE });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return {};
      throw e;
    }

    var agg = {};
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (String(row.period_id || '') !== periodId) continue;
      var code = String(row.designer_code || '').trim();
      if (!code) continue;
      if (!agg[code]) agg[code] = { total: 0, count: 0, clients: [] };
      agg[code].total += parseFloat(row.normalized_score) || 0;
      agg[code].count++;
      var cc = String(row.client_code || '');
      if (cc && agg[code].clients.indexOf(cc) === -1) agg[code].clients.push(cc);
    }

    var result = {};
    Object.keys(agg).forEach(function(code) {
      var s = agg[code];
      result[code] = {
        avg_normalized: s.count > 0 ? Math.round(s.total / s.count * 100) / 100 : 0,
        response_count: s.count,
        client_codes:   s.clients
      };
    });
    return result;
  }

  // ============================================================
  // SECTION 4: getFeedbackStatus
  // ============================================================

  /**
   * @param {string} actorEmail
   * @param {string} periodId
   * @returns {{ period_id, quarter, responses_received, per_designer[] }}
   */
  function getFeedbackStatus(actorEmail, periodId) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);

    var summary     = getFeedbackSummary(periodId);
    var perDesigner = Object.keys(summary).map(function(code) {
      return {
        designer_code:  code,
        response_count: summary[code].response_count,
        avg_score:      summary[code].avg_normalized,
        clients:        summary[code].client_codes.join(', ')
      };
    });
    perDesigner.sort(function(a, b) { return a.designer_code.localeCompare(b.designer_code); });

    return {
      period_id:          periodId,
      quarter:            buildQuarterLabel_(periodId),
      responses_received: perDesigner.length,
      per_designer:       perDesigner
    };
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  /**
   * "2026-04" → "Q2 2026"
   */
  function buildQuarterLabel_(periodId) {
    var parts = String(periodId).split('-');
    var year  = parts[0] || '????';
    var month = parseInt(parts[1], 10) || 1;
    var q = month <= 3 ? 1 : month <= 6 ? 2 : month <= 9 ? 3 : 4;
    return 'Q' + q + ' ' + year;
  }

  /**
   * Builds grid row labels: ["DS1 — Alice Smith", "DS3 — Bob Jones"]
   * The designer code prefix is used by the trigger to extract the code.
   */
  function buildDesignerRows_(designerCodes, nameMap) {
    return designerCodes.map(function(code) {
      var name = nameMap[code] || code;
      return code + ' \u2014 ' + name;   // em-dash separator — easy to split on
    });
  }

  /**
   * Creates a per-client Google Form with a grid question.
   * Stores form ID and entry IDs in Script Properties.
   * Returns existing form if already created for this period+client.
   */
  function getOrCreateClientForm_(periodId, quarter, clientCode, clientName, designerRows) {
    var props       = PropertiesService.getScriptProperties();
    var formKey     = 'FEEDBACK_FORM_'       + periodId + '_' + clientCode;
    var entryIdsKey = 'FEEDBACK_ENTRY_IDS_'  + periodId + '_' + clientCode;

    var existingId   = props.getProperty(formKey);
    var existingMeta = props.getProperty(entryIdsKey);

    if (existingId && existingMeta) {
      try {
        var meta = JSON.parse(existingMeta);
        // Update grid rows in case designers changed since last call
        try {
          var existingForm = FormApp.openById(existingId);
          var items = existingForm.getItems(FormApp.ItemType.GRID);
          if (items.length > 0) items[0].asGridItem().setRows(designerRows);
        } catch (e) { /* form may have been deleted — fall through to recreate */ }
        return { formId: existingId, entryIds: meta };
      } catch (e) { /* corrupt meta — recreate */ }
    }

    // ── Create new form ───────────────────────────────────────
    var title = 'BLC Performance Feedback \u2014 ' + clientName + ' \u2014 ' + quarter;
    var form  = FormApp.create(title);

    form.setDescription(
      'Blue Lotus Consulting \u2014 quarterly designer performance feedback.\n' +
      'Please rate each designer below. This takes less than 2 minutes.\n' +
      'Your feedback is confidential and used for internal compensation purposes only.'
    );
    form.setCollectEmail(false);
    form.setLimitOneResponsePerUser(false);
    form.setShowLinkToRespondAgain(false);
    form.setConfirmationMessage('Thank you! Your feedback has been received.');

    // Q1: Period ID (hidden, pre-filled)
    var qPeriod = form.addTextItem();
    qPeriod.setTitle('Period ID');
    qPeriod.setHelpText('Auto-filled. Please do not change.');
    qPeriod.setRequired(true);

    // Q2: Client Code (hidden, pre-filled)
    var qClient = form.addTextItem();
    qClient.setTitle('Client Code');
    qClient.setHelpText('Auto-filled. Please do not change.');
    qClient.setRequired(true);

    // Q3: Rating grid — one row per designer
    var qGrid = form.addGridItem();
    qGrid.setTitle(GRID_QUESTION_TITLE);
    qGrid.setHelpText('Rate 1 (Poor) to 5 (Excellent). Leave blank if a designer did not work on your projects.');
    qGrid.setRows(designerRows);
    qGrid.setColumns(['1', '2', '3', '4', '5']);
    qGrid.setRequired(false);

    // Q4: Comments (optional)
    var qComments = form.addParagraphTextItem();
    qComments.setTitle('Any other comments? (optional)');
    qComments.setHelpText('Quality, turnaround time, communication — anything you would like to share.');
    qComments.setRequired(false);

    // Link to BLC spreadsheet for response capture
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
    } catch (e) {
      Logger.warn('FEEDBACK_FORM_LINK_FAILED', {
        module: MODULE, message: 'Could not link form to spreadsheet', error: e.message
      });
    }

    var entryIds = {
      periodId:   qPeriod.getId(),
      clientCode: qClient.getId()
      // Grid and comments don't need pre-filling
    };

    props.setProperty(formKey,     form.getId());
    props.setProperty(entryIdsKey, JSON.stringify(entryIds));

    Logger.info('FEEDBACK_FORM_CREATED', {
      module: MODULE, form_id: form.getId(),
      client_code: clientCode, period_id: periodId, quarter: quarter,
      designer_count: designerRows.length
    });

    return { formId: form.getId(), entryIds: entryIds };
  }

  /**
   * Builds the pre-filled URL for a client (period + client pre-filled only).
   */
  function buildPrefilledUrl_(formId, entryIds, periodId, clientCode) {
    return 'https://docs.google.com/forms/d/' + formId + '/viewform' +
      '?entry.' + entryIds.periodId   + '=' + encodeURIComponent(periodId) +
      '&entry.' + entryIds.clientCode + '=' + encodeURIComponent(clientCode);
  }

  /**
   * Sends one email to a client with their single feedback form link.
   */
  function sendClientEmail_(client, designerNames, designerCodes, formUrl, quarter) {
    var designerList = designerCodes.map(function(c) {
      return designerNames[c] || c;
    }).join(', ');

    var subject = 'BLC \u2014 ' + quarter + ' Designer Performance Feedback';

    var plain = [
      'Dear ' + client.client_name + ',',
      '',
      'Blue Lotus Consulting is collecting quarterly performance feedback for our designers.',
      'You are receiving this because the following designer(s) worked on your projects this quarter:',
      '',
      '  ' + designerList,
      '',
      'The form takes less than 2 minutes and lets you rate each designer on a single page:',
      '',
      '  ' + formUrl,
      '',
      'Please complete by the end of this month. Your feedback is confidential.',
      '',
      'Thank you,',
      'Blue Lotus Consulting Corporation'
    ].join('\n');

    var html = [
      '<p>Dear ' + client.client_name + ',</p>',
      '<p>Blue Lotus Consulting is collecting quarterly performance feedback for our designers. ' +
      'The following designer(s) worked on your projects this quarter: <strong>' + designerList + '</strong>.</p>',
      '<p>The form takes less than 2 minutes and lets you rate everyone on a single page:</p>',
      '<p style="margin:20px 0">',
      '  <a href="' + formUrl + '" style="background:#4f46e5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">',
      '    Rate My Designers &rarr;',
      '  </a>',
      '</p>',
      '<p style="font-size:12px;color:#64748b">Your feedback is confidential and used solely for internal compensation purposes. ' +
      'Please complete by the end of this month.</p>',
      '<p>Thank you,<br><strong>Blue Lotus Consulting Corporation</strong></p>'
    ].join('\n');

    MailApp.sendEmail({ to: client.contact_email, subject: subject, body: plain, htmlBody: html });
  }

  /**
   * Reads FACT_WORK_LOGS + FACT_JOB_EVENTS to get unique (client, designer) pairs.
   */
  function buildDesignerClientPairs_(periodId) {
    var workLogs;
    try {
      workLogs = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: MODULE, periodId: periodId });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return [];
      throw e;
    }
    if (!workLogs || workLogs.length === 0) return [];

    var jobDesignerMap = {};
    for (var w = 0; w < workLogs.length; w++) {
      var wrow = workLogs[w];
      var job  = String(wrow.job_number || '').trim();
      var code = String(wrow.actor_code || '').trim();
      if (!job || !code) continue;
      if (!jobDesignerMap[job]) jobDesignerMap[job] = {};
      jobDesignerMap[job][code] = true;
    }

    var jobEvents;
    try {
      jobEvents = DAL.readAll(Config.TABLES.FACT_JOB_EVENTS, { callerModule: MODULE, periodId: periodId });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') jobEvents = [];
      else throw e;
    }

    var jobClientMap = {};
    for (var j = 0; j < jobEvents.length; j++) {
      var jev = jobEvents[j];
      var jn  = String(jev.job_number  || '').trim();
      var cc  = String(jev.client_code || '').trim();
      if (jn && cc && !jobClientMap[jn]) jobClientMap[jn] = cc;
    }

    var seen = {}, pairs = [];
    Object.keys(jobDesignerMap).forEach(function(jn) {
      var client = jobClientMap[jn];
      if (!client) return;
      Object.keys(jobDesignerMap[jn]).forEach(function(designer) {
        var key = client + '|' + designer;
        if (!seen[key]) { seen[key] = true; pairs.push({ client_code: client, designer_code: designer }); }
      });
    });
    return pairs;
  }

  function buildClientMap_() {
    var map = {};
    try {
      DAL.readAll(Config.TABLES.DIM_CLIENT_MASTER, { callerModule: MODULE }).forEach(function(row) {
        var cc = String(row.client_code || '').trim();
        if (cc && String(row.active || '').toUpperCase() === 'TRUE') {
          map[cc] = { client_name: String(row.client_name || cc), contact_email: String(row.contact_email || '') };
        }
      });
    } catch (e) {}
    return map;
  }

  function buildDesignerNameMap_() {
    var map = {};
    try {
      DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: MODULE }).forEach(function(row) {
        var code = String(row.person_code || '').trim();
        if (code) map[code] = String(row.name || code);
      });
    } catch (e) {}
    return map;
  }

  // ── Handler registration ─────────────────────────────────────
  QueueProcessor.registerHandler(
    Config.FORM_TYPES.CLIENT_FEEDBACK,
    function(queueItem, actor) { processFeedbackResponse(queueItem, actor); }
  );

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {
    sendFeedbackRequests:    sendFeedbackRequests,
    processFeedbackResponse: processFeedbackResponse,
    getFeedbackSummary:      getFeedbackSummary,
    getFeedbackStatus:       getFeedbackStatus,
    buildQuarterLabel:       buildQuarterLabel_,
    GRID_QUESTION_TITLE:     GRID_QUESTION_TITLE   // exported for trigger parser
  };

}());
