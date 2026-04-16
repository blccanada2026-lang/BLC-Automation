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

  // Qualitative question titles — exported for trigger parser.
  // Changing any of these breaks the trigger's named-value lookup
  // until the trigger is also updated and the form is recreated.
  var Q_STRENGTHS   = "What has the designer/team done particularly well this quarter?";
  var Q_IMPROVEMENT = "What is the ONE thing we should improve immediately?";
  var Q_ERRORS      = "Have any errors caused production or site issues? If yes, please describe.";
  var Q_EASE        = "How easy is it to work with our team? (clarity, responsiveness, communication)";
  var Q_RECOMMEND   = "Would you confidently recommend our team for more work? (Yes/No + Why)";
  var Q_SUGGESTIONS = "Any suggestions to improve our service further?";

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

    var periodId  = options.periodId  || Identifiers.generateCurrentPeriodId();
    var testEmail = options.testEmail || null;   // if set, all emails go here instead of client
    var quarter   = buildQuarterLabel_(periodId);

    // ── 1. Build { clientCode → [designerCodes] } map ────────
    // options.pairs allows manual override for testing / early production
    // before FACT_WORK_LOGS is populated by real work logging.
    var pairs = options.pairs || buildDesignerClientPairs_(periodId);

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
    var clientMap     = buildClientMap_();
    var designerNames = buildDesignerNameMap_();

    // ── 3. Per client: create form + send email ───────────────
    var emailsSent  = 0;
    var clientCodes = Object.keys(byClient);

    for (var c = 0; c < clientCodes.length; c++) {
      var clientCode = clientCodes[c];
      var client     = clientMap[clientCode];

      if (!client) {
        if (!testEmail) {
          Logger.warn('FEEDBACK_CLIENT_NOT_FOUND', {
            module: MODULE, message: 'Client not in DIM_CLIENT_MASTER — skipping', client_code: clientCode
          });
          continue;
        }
        // testEmail mode — use client code as display name, real email not needed
        client = { client_name: clientCode, contact_email: '' };
      }
      if (!client.contact_email && !testEmail) {
        Logger.warn('FEEDBACK_NO_CLIENT_EMAIL', {
          module: MODULE, message: 'No contact email — skipping', client_code: clientCode
        });
        continue;
      }

      var designers    = byClient[clientCode];
      var designerRows = buildDesignerRows_(designers, designerNames);

      // Create (or reuse) the form for this client+period
      var formMeta = getOrCreateClientForm_(periodId, quarter, clientCode, client.client_name, designerRows);

      // Build ONE pre-filled URL for this client
      var formUrl = buildFormUrl_(formMeta.formId);

      // Send the email (testEmail overrides recipient for pre-launch testing)
      sendClientEmail_(client, designerNames, designers, formUrl, quarter, testEmail);
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

    // Qualitative open-text fields (all optional)
    var strengthsText     = String(payload.strengths_text      || '').trim();
    var improvementText   = String(payload.improvement_text    || '').trim();
    var errorFeedbackText = String(payload.error_feedback_text || '').trim();
    var easeText          = String(payload.ease_of_working_text || '').trim();
    var recommendRaw      = String(payload.recommendation_flag  || '').trim();
    var recommendFlag     = recommendRaw.toLowerCase().indexOf('yes') === 0 ? 'YES' : (recommendRaw ? 'NO' : '');
    var recommendReason   = String(payload.recommendation_reason || '').trim();
    var suggestionsText   = String(payload.suggestions_text    || '').trim();

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
      event_id:              eventId,
      period_id:             periodId,
      quarter:               buildQuarterLabel_(periodId),
      client_code:           clientCode,
      designer_code:         designerCode,
      submitted_at:          new Date().toISOString(),
      raw_score:             rawScore,
      normalized_score:      normalizedScore,
      comments:              comments,
      form_response_id:      responseId,
      idempotency_key:       iKey,
      status:                'RECEIVED',
      strengths_text:        strengthsText,
      improvement_text:      improvementText,
      error_feedback_text:   errorFeedbackText,
      ease_of_working_text:  easeText,
      recommendation_flag:   recommendFlag,
      recommendation_reason: recommendReason,
      suggestions_text:      suggestionsText
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
        var formStillValid = false;
        try {
          var existingForm = FormApp.openById(existingId);
          var items = existingForm.getItems(FormApp.ItemType.GRID);
          if (items.length > 0) items[0].asGridItem().setRows(designerRows);
          formStillValid = true;
        } catch (e) {
          // Form was deleted or is inaccessible — clear cache and fall through to recreate
          props.deleteProperty(formKey);
          props.deleteProperty(entryIdsKey);
          Logger.warn('FEEDBACK_FORM_STALE', {
            module: MODULE, message: 'Cached form inaccessible — recreating', client_code: clientCode
          });
        }
        if (formStillValid) return { formId: existingId, entryIds: meta };
      } catch (e) { /* corrupt meta — recreate */ }
    }

    // ── Create new form ───────────────────────────────────────
    // Period + client context are NOT form fields — they are identified
    // by the response sheet name (FBRESP_{periodId}_{clientCode}).
    // This avoids pre-fill URL fragility and hides internal codes from clients.
    var title = 'BLC Performance Feedback \u2014 ' + clientName + ' \u2014 ' + quarter;
    var form  = FormApp.create(title);
    Utilities.sleep(2000); // wait for Google to fully provision the new form

    form.setDescription(
      'Blue Lotus Consulting \u2014 quarterly designer performance feedback.\n' +
      'Please rate each designer below. This takes less than 2 minutes.\n' +
      'Your feedback is confidential and used for internal compensation purposes only.'
    );
    form.setCollectEmail(false);
    form.setLimitOneResponsePerUser(false);
    form.setShowLinkToRespondAgain(false);
    form.setConfirmationMessage('Thank you! Your feedback has been received.');

    // Q1: Rating grid — one row per designer (full names)
    var qGrid = form.addGridItem();
    qGrid.setTitle(GRID_QUESTION_TITLE);
    qGrid.setHelpText('Rate 1 (Poor) to 5 (Excellent). Leave blank if a designer did not work on your projects.');
    qGrid.setRows(designerRows);
    qGrid.setColumns(['1', '2', '3', '4', '5']);
    qGrid.setRequired(false);

    // Q2: Comments (optional)
    var qComments = form.addParagraphTextItem();
    qComments.setTitle('Any other comments? (optional)');
    qComments.setHelpText('Quality, turnaround time, communication — anything you would like to share.');
    qComments.setRequired(false);

    // ── Section: Open Feedback ────────────────────────────────
    var qSection = form.addSectionHeaderItem();
    qSection.setTitle('Open Feedback \u2014 Your Insights Matter');
    qSection.setHelpText('Your honest input helps us improve. All responses are confidential.');

    // Q3–Q8: qualitative paragraph-text questions
    var qStrengths = form.addParagraphTextItem();
    qStrengths.setTitle(Q_STRENGTHS);
    qStrengths.setRequired(false);

    var qImprovement = form.addParagraphTextItem();
    qImprovement.setTitle(Q_IMPROVEMENT);
    qImprovement.setRequired(false);

    var qErrors = form.addParagraphTextItem();
    qErrors.setTitle(Q_ERRORS);
    qErrors.setRequired(false);

    var qEase = form.addParagraphTextItem();
    qEase.setTitle(Q_EASE);
    qEase.setRequired(false);

    var qRecommend = form.addParagraphTextItem();
    qRecommend.setTitle(Q_RECOMMEND);
    qRecommend.setHelpText('e.g. "Yes — the team is reliable and detail-oriented." or "Not yet — turnaround needs to improve."');
    qRecommend.setRequired(false);

    var qSuggestions = form.addParagraphTextItem();
    qSuggestions.setTitle(Q_SUGGESTIONS);
    qSuggestions.setRequired(false);

    // ── Link form to spreadsheet and name the response sheet ─
    // Response sheet named FBRESP_{periodId}_{clientCode} so the
    // onFeedbackFormSubmit trigger can identify client + period
    // without relying on pre-filled form fields.
    // NOTE: SpreadsheetApp used here as a known A2 exception — FormApp's
    // setDestination() requires the active spreadsheet reference, and the
    // response sheet discovery (before/after diff) has no DAL equivalent.
    try {
      var ss           = SpreadsheetApp.getActiveSpreadsheet();
      var sheetsBefore = ss.getSheets().map(function(s) { return s.getName(); });
      form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
      Utilities.sleep(2000); // wait for response sheet to be created
      var sheetsAfter = SpreadsheetApp.openById(ss.getId()).getSheets();
      for (var si = 0; si < sheetsAfter.length; si++) {
        if (sheetsBefore.indexOf(sheetsAfter[si].getName()) === -1) {
          sheetsAfter[si].setName('FBRESP_' + periodId + '_' + clientCode);
          break;
        }
      }
    } catch (e) {
      Logger.warn('FEEDBACK_FORM_LINK_FAILED', {
        module: MODULE, message: 'Could not link form to spreadsheet', error: e.message
      });
    }

    props.setProperty(formKey, form.getId());
    // Clear stale entryIds key if present from older form version
    props.deleteProperty(entryIdsKey);

    Logger.info('FEEDBACK_FORM_CREATED', {
      module: MODULE, form_id: form.getId(),
      client_code: clientCode, period_id: periodId, quarter: quarter,
      designer_count: designerRows.length
    });

    return { formId: form.getId() };
  }

  /**
   * Builds the pre-filled URL for a client (period + client pre-filled only).
   */
  function buildFormUrl_(formId) {
    return 'https://docs.google.com/forms/d/' + formId + '/viewform';
  }

  /**
   * Sends one email to a client with their single feedback form link.
   */
  function sendClientEmail_(client, designerNames, designerCodes, formUrl, quarter, testEmail) {
    var designerList = designerCodes.map(function(c) {
      return designerNames[c] || c;
    }).join(', ');

    var subject = 'BLC \u2014 ' + quarter + ' Designer Performance Feedback';

    var greeting = client.contact_name || client.client_name;
    var plain = [
      'Dear ' + greeting + ',',
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
      '<p>Dear ' + greeting + ',</p>',
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

    var recipient = testEmail || client.contact_email;
    MailApp.sendEmail({ to: recipient, cc: 'hr@bluelotuscanada.ca', subject: subject, body: plain, htmlBody: html });
  }

  /**
   * Returns the three YYYY-MM period IDs that make up the quarter containing periodId.
   * e.g. '2026-03' → ['2026-01', '2026-02', '2026-03']
   */
  function getQuarterMonths_(periodId) {
    var parts      = String(periodId).split('-');
    var year       = parts[0];
    var month      = parseInt(parts[1], 10);
    var qStart     = (Math.ceil(month / 3) - 1) * 3 + 1;  // 1, 4, 7, or 10
    var months     = [];
    for (var m = qStart; m < qStart + 3; m++) {
      months.push(year + '-' + (m < 10 ? '0' : '') + m);
    }
    return months;
  }

  /**
   * Normalises a date value (Date object or any string variant) to YYYY-MM-DD.
   * Google Sheets auto-converts date strings to Date objects on write, so DAL
   * returns them as JS Date objects or locale-formatted strings — neither of
   * which compares correctly against ISO strings.
   * Returns '' if the value is blank/null/undefined.
   *
   * @param {Date|string|null} val
   * @returns {string}  YYYY-MM-DD or ''
   */
  function toIsoDate_(val) {
    if (val === null || val === undefined || val === '') return '';
    if (val instanceof Date) {
      var y = val.getFullYear();
      var m = String(val.getMonth() + 1);
      var d = String(val.getDate());
      if (m.length < 2) m = '0' + m;
      if (d.length < 2) d = '0' + d;
      return y + '-' + m + '-' + d;
    }
    // String — could be ISO 8601 with time component or locale string.
    // Safest: parse as Date and re-format.
    var s = String(val).trim();
    if (!s) return '';
    // If it already looks like YYYY-MM-DD take it directly (fast path)
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // Otherwise parse via Date constructor
    var parsed = new Date(s);
    if (isNaN(parsed.getTime())) return s.substring(0, 10); // best-effort fallback
    var py = parsed.getFullYear();
    var pm = String(parsed.getMonth() + 1);
    var pd = String(parsed.getDate());
    if (pm.length < 2) pm = '0' + pm;
    if (pd.length < 2) pd = '0' + pd;
    return py + '-' + pm + '-' + pd;
  }

  /**
   * Derives unique (client_code, designer_code) pairs for the quarter.
   *
   * Source of truth: FACT_WORK_LOGS
   *   actor_code = the designer who actually logged hours (accurate, not just allocated)
   *   hours > 0  = they actually worked on it
   *
   * Source of truth: REF_ACCOUNT_DESIGNER_MAP.
   *   Returns designers who are officially assigned to each client account
   *   during the quarter — NOT derived from work logs or job allocations.
   *
   *   An assignment overlaps the quarter if:
   *     assigned_from_date ≤ quarter_end
   *     AND (assigned_to_date IS NULL OR assigned_to_date ≥ quarter_start)
   *
   *   DIM_STAFF_ROSTER cross-check: warns if a designer is terminated before
   *   the quarter starts but does NOT exclude them (the map needs updating).
   *
   *   FACT_WORK_LOGS cross-check: warns if a designer logged zero hours for
   *   this client this quarter but does NOT exclude them (leave = no hours).
   *
   * @param {string} periodId  Last month of the quarter (e.g. '2026-03' for Q1)
   * @returns {{ client_code: string, designer_code: string }[]}
   */
  function buildDesignerClientPairs_(periodId) {
    var quarterMonths = getQuarterMonths_(periodId);

    // ── Compute quarter date boundaries ──────────────────────────────────────
    // quarter_start = first day of first quarter month
    // quarter_end   = last day of periodId month (last month of quarter)
    var firstMonth    = quarterMonths[0];                          // e.g. '2026-01'
    var quarterStart  = firstMonth + '-01';                        // e.g. '2026-01-01'
    var periodParts   = periodId.split('-');
    var periodYear    = parseInt(periodParts[0], 10);
    var periodMonth   = parseInt(periodParts[1], 10);
    var lastDayDate   = new Date(periodYear, periodMonth, 0);      // 0th = last day of prev month
    var lastDay       = String(lastDayDate.getDate());
    if (lastDay.length < 2) lastDay = '0' + lastDay;
    var quarterEnd    = periodId + '-' + lastDay;                  // e.g. '2026-03-31'

    // ── Step 1: Read REF_ACCOUNT_DESIGNER_MAP ────────────────────────────────
    var mapRows;
    try {
      mapRows = DAL.readAll(Config.TABLES.REF_ACCOUNT_DESIGNER_MAP, { callerModule: MODULE });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') {
        Logger.warn('FEEDBACK_NO_ACCOUNT_MAP', {
          module:    MODULE,
          message:   'REF_ACCOUNT_DESIGNER_MAP sheet not found — run runSetupSchemas(). ' +
                     'Pass options.pairs[] to override for testing.',
          period_id: periodId
        });
        return [];
      }
      throw e;
    }

    if (!mapRows || mapRows.length === 0) {
      Logger.warn('FEEDBACK_ACCOUNT_MAP_EMPTY', {
        module:    MODULE,
        message:   'REF_ACCOUNT_DESIGNER_MAP has no rows — add account assignments before sending feedback. ' +
                   'Pass options.pairs[] to override for testing.',
        period_id: periodId
      });
      return [];
    }

    // ── Step 2: Filter to assignments overlapping this quarter ───────────────
    // assigned_from_date ≤ quarter_end AND (assigned_to_date blank OR ≥ quarter_start)
    //
    // Google Sheets auto-converts date strings to Date objects on write.
    // toIsoDate_() normalises both Date objects and string variants to YYYY-MM-DD
    // so string comparison is safe.
    var activePairs = [];
    var seen        = {};

    for (var i = 0; i < mapRows.length; i++) {
      var r              = mapRows[i];
      var clientCode     = String(r.client_code    || '').trim().toUpperCase();
      var designerCode   = String(r.designer_code  || '').trim().toUpperCase();
      var role           = String(r.role           || '').trim().toUpperCase();
      var assignedFrom   = toIsoDate_(r.assigned_from_date);
      var assignedTo     = toIsoDate_(r.assigned_to_date);

      if (!clientCode || !designerCode) continue;
      if (role !== 'DESIGNER') continue;  // only DESIGNER rows drive feedback forms

      // Date overlap check — string comparison is safe for ISO YYYY-MM-DD
      if (assignedFrom > quarterEnd) continue;               // assignment starts after quarter ends
      if (assignedTo !== '' && assignedTo < quarterStart) continue; // assignment ended before quarter started

      var key = clientCode + '|' + designerCode;
      if (seen[key]) continue;  // deduplicate overlapping assignment rows
      seen[key] = true;

      activePairs.push({ client_code: clientCode, designer_code: designerCode });
    }

    if (activePairs.length === 0) {
      Logger.warn('FEEDBACK_NO_ACTIVE_ASSIGNMENTS', {
        module:         MODULE,
        message:        'No active DESIGNER assignments found in REF_ACCOUNT_DESIGNER_MAP for this quarter. ' +
                        'Pass options.pairs[] to override for testing.',
        period_id:      periodId,
        quarter_start:  quarterStart,
        quarter_end:    quarterEnd
      });
      return [];
    }

    // ── Step 3: DIM_STAFF_ROSTER cross-check (warning only) ─────────────────
    // Warn if a designer's record is terminated before the quarter starts.
    // Still include them — the map entry may need closing, not the form.
    var staffMap = {};
    try {
      var staffRows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: MODULE });
      for (var s = 0; s < staffRows.length; s++) {
        var code = String(staffRows[s].person_code || '').trim().toUpperCase();
        if (code) staffMap[code] = staffRows[s];
      }
    } catch (e) {
      if (e.code !== 'SHEET_NOT_FOUND') throw e;
    }

    for (var a = 0; a < activePairs.length; a++) {
      var dCode  = activePairs[a].designer_code;
      var staff  = staffMap[dCode];
      if (!staff) {
        Logger.warn('FEEDBACK_DESIGNER_NOT_IN_ROSTER', {
          module:        MODULE,
          message:       'Designer in REF_ACCOUNT_DESIGNER_MAP not found in DIM_STAFF_ROSTER — included anyway',
          designer_code: dCode,
          client_code:   activePairs[a].client_code,
          period_id:     periodId
        });
        continue;
      }
      var effectiveTo = String(staff.effective_to || '').trim();
      if (effectiveTo !== '' && effectiveTo < quarterStart) {
        Logger.warn('FEEDBACK_DESIGNER_TERMINATED', {
          module:        MODULE,
          message:       'Designer terminated before quarter — included in form but map entry should be closed',
          designer_code: dCode,
          client_code:   activePairs[a].client_code,
          effective_to:  effectiveTo,
          quarter_start: quarterStart
        });
      }
    }

    // ── Step 4: FACT_WORK_LOGS cross-check (warning only) ───────────────────
    // Warn if a designer logged zero hours for this client's jobs this quarter.
    // Medical leave, bench time, etc. are valid reasons for zero hours —
    // account membership always overrides activity.
    var designerClientHours = {};  // 'DS1|MATIX' → total hours
    var jobClientMap        = {};  // job_number → client_code (from VW)

    try {
      var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
      for (var v = 0; v < vwRows.length; v++) {
        var jn = String(vwRows[v].job_number  || '').trim();
        var cc = String(vwRows[v].client_code || '').trim().toUpperCase();
        if (jn && cc) jobClientMap[jn] = cc;
      }
    } catch (e) {
      if (e.code !== 'SHEET_NOT_FOUND') throw e;
    }

    for (var m = 0; m < quarterMonths.length; m++) {
      try {
        var wl = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
          callerModule: MODULE,
          periodId:     quarterMonths[m]
        });
        for (var w = 0; w < wl.length; w++) {
          var wrow   = wl[w];
          var wJob   = String(wrow.job_number || '').trim();
          var wDes   = String(wrow.actor_code || '').trim().toUpperCase();
          var wHrs   = parseFloat(wrow.hours) || 0;
          var wCli   = jobClientMap[wJob];
          if (!wJob || !wDes || wHrs <= 0 || !wCli) continue;
          var hKey = wDes + '|' + wCli;
          designerClientHours[hKey] = (designerClientHours[hKey] || 0) + wHrs;
        }
      } catch (e) {
        if (e.code !== 'SHEET_NOT_FOUND') throw e;
      }
    }

    for (var p = 0; p < activePairs.length; p++) {
      var hKey2 = activePairs[p].designer_code + '|' + activePairs[p].client_code;
      if (!designerClientHours[hKey2]) {
        Logger.warn('FEEDBACK_DESIGNER_NO_HOURS', {
          module:        MODULE,
          message:       'Designer has zero hours for this client this quarter — included in form anyway',
          designer_code: activePairs[p].designer_code,
          client_code:   activePairs[p].client_code,
          period_id:     periodId
        });
      }
    }

    // ── Step 5: Log and return ───────────────────────────────────────────────
    var clientSet   = {};
    var designerSet = {};
    for (var f = 0; f < activePairs.length; f++) {
      clientSet[activePairs[f].client_code]    = true;
      designerSet[activePairs[f].designer_code] = true;
    }

    Logger.info('FEEDBACK_PAIRS_BUILT', {
      module:         MODULE,
      message:        'Designer-client pairs built from REF_ACCOUNT_DESIGNER_MAP',
      period_id:      periodId,
      quarter_start:  quarterStart,
      quarter_end:    quarterEnd,
      client_count:   Object.keys(clientSet).length,
      designer_count: Object.keys(designerSet).length,
      pair_count:     activePairs.length
    });

    return activePairs;
  }

  function buildClientMap_() {
    var map = {};
    try {
      DAL.readAll(Config.TABLES.DIM_CLIENT_MASTER, { callerModule: MODULE }).forEach(function(row) {
        var cc = String(row.client_code || '').trim();
        if (cc && (row.active === true || String(row.active).toUpperCase() === 'TRUE')) {
          var contactName = String(row.contact_name || '').trim();
          map[cc] = {
            client_name:   String(row.client_name || cc),
            contact_name:  contactName,
            contact_email: String(row.contact_email || '')
          };
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
    // Question title constants — trigger parser uses these for namedValues lookups.
    // Changing any constant here requires recreating active forms and updating the trigger.
    GRID_QUESTION_TITLE: GRID_QUESTION_TITLE,
    Q_STRENGTHS:         Q_STRENGTHS,
    Q_IMPROVEMENT:       Q_IMPROVEMENT,
    Q_ERRORS:            Q_ERRORS,
    Q_EASE:              Q_EASE,
    Q_RECOMMEND:         Q_RECOMMEND,
    Q_SUGGESTIONS:       Q_SUGGESTIONS
  };

}());
