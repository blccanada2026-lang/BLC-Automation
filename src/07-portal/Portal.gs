// ============================================================
// Portal.gs — BLC Nexus T7 Portal
// src/07-portal/Portal.gs
//
// LOAD ORDER: T7. Loads after all T0–T6 files.
// DEPENDENCIES: Config (T0), Identifiers (T0), DAL (T1),
//               RBAC (T2), Logger (T3), QueueProcessor (T5),
//               PortalData (T7 — loads before this)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  GAS Web App entry point.                               ║
// ║                                                         ║
// ║  doGet(e)              → serves PortalView.html         ║
// ║  portal_getViewData()  → called by google.script.run    ║
// ║  portal_submitAction() → submits to STG_PROCESSING_QUEUE║
// ║  portal_processQueue() → manual queue drain (dev only)  ║
// ╚══════════════════════════════════════════════════════════╝
//
// DEPLOY INSTRUCTIONS:
//   Extensions → Deploy → New Deployment → Web App
//   Execute as: Me (service account)
//   Who has access: Anyone within your Google Workspace domain
//
// ALL FUNCTIONS exposed to google.script.run must be top-level
// global functions — GAS does not expose IIFE module methods.
//
// ============================================================

// ============================================================
// doGet — Web App entry point
// ============================================================

/**
 * Entry point for the GAS Web App.
 * Serves PortalView.html with title and sandboxing set.
 * Does not pass data at render time — client JS calls
 * portal_getViewData() via google.script.run after load.
 *
 * @param {Object} e  GAS event object (unused but required by platform)
 * @returns {HtmlOutput}
 */
function doGet(e) {
  var page   = e && e.parameter && e.parameter.page   ? e.parameter.page   : '';
  var period = e && e.parameter && e.parameter.period ? e.parameter.period : '';

  if (page === 'rate-staff') {
    var preview = e && e.parameter && e.parameter.preview ? e.parameter.preview : '';
    var html    = HtmlService.createHtmlOutputFromFile('07-portal/QuarterlyRating');
    var content = '<script>var INJECTED_PERIOD = '       + JSON.stringify(period)  + ';<\/script>\n'
                + '<script>var INJECTED_PREVIEW_CODE = ' + JSON.stringify(preview) + ';<\/script>\n'
                + html.getContent();
    return HtmlService.createHtmlOutput(content)
      .setTitle('BLC Quarterly Ratings')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return HtmlService
    .createHtmlOutputFromFile('07-portal/PortalView')
    .setTitle('BLC Job Portal')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================
// portal_getViewData — main data fetch for the portal page
// ============================================================

/**
 * Returns all data needed to render the portal for the current user.
 * Called immediately after page load via google.script.run.
 *
 * @returns {string}  JSON-encoded view data. Shape:
 *   {
 *     actor:  { email, personCode, role, displayName, scope },
 *     jobs:   [ { job_number, client_code, job_type, product_code,
 *                 quantity, current_state, allocated_to, rework_cycle,
 *                 client_return_count, created_at, updated_at } ],
 *     stats:  { total, byState: { STATE: count } },
 *     perms:  { canCreateJob, canViewAll, isQcReviewer, isDesigner }
 *   }
 */
function portal_getViewData() {
  var email = Session.getActiveUser().getEmail();
  return PortalData.getViewData(email);
}

// ============================================================
// portal_submitAction — submits a job action to the queue
// ============================================================

/**
 * Submits a job action to STG_PROCESSING_QUEUE.
 * The queue processor picks it up on the next trigger run.
 * For dev convenience, also calls processQueue() immediately
 * so the result is visible when the page refreshes.
 *
 * @param {string} formType   Config.FORM_TYPES value (e.g. 'WORK_LOG')
 * @param {string} payloadJson  JSON-encoded payload for the handler
 * @returns {string}  JSON: { ok: true, queueId } on success
 * @throws {Error}  on validation failure or permission error
 */
function portal_submitAction(formType, payloadJson) {
  var email = Session.getActiveUser().getEmail();

  Logger.info('PORTAL_ACTION_SUBMIT', {
    module:    'Portal',
    message:   'Portal action submitted',
    form_type: formType,
    actor:     email
  });

  var queueId = PortalData.writeQueueItem(formType, payloadJson, email);

  // Drain the queue immediately so the user sees the result on refresh.
  // Safe to call even if the trigger runs concurrently — QueueProcessor
  // uses a distributed lock to prevent double-processing.
  try {
    QueueProcessor.processQueue();
  } catch (e) {
    // Non-fatal — the item is queued; the trigger will process it.
    Logger.warn('PORTAL_PROCESS_QUEUE_FAILED', {
      module:   'Portal',
      message:  'Immediate processQueue() failed — item remains queued',
      queue_id: queueId,
      error:    e.message
    });
  }

  return JSON.stringify({ ok: true, queueId: queueId });
}

// ============================================================
// portal_processQueue — manual queue drain (dev helper)
// ============================================================

/**
 * Manually triggers a queue drain. Useful in development when the
 * time-based trigger hasn't fired yet.
 *
 * @returns {string}  JSON: { ok: true, message }
 */
function portal_processQueue() {
  try {
    QueueProcessor.processQueue();
    return JSON.stringify({ ok: true, message: 'Queue processed.' });
  } catch (e) {
    return JSON.stringify({ ok: false, message: e.message });
  }
}

// ============================================================
// portal_getClients — returns active clients with their rates
// ============================================================

/**
 * Returns all active clients from DIM_CLIENT_MASTER enriched
 * with their flat hourly rate from DIM_CLIENT_RATES.
 *
 * @returns {string}  JSON array of client objects
 */
function portal_getClients() {
  var email   = Session.getActiveUser().getEmail();
  var clients = ClientOnboarding.getClients(email);
  return JSON.stringify(clients);
}

// ============================================================
// portal_onboardClient — creates a new client + rate
// ============================================================

/**
 * Onboards a new client (writes DIM_CLIENT_MASTER + DIM_CLIENT_RATES).
 * Safe to call for existing clients — adds a new rate row.
 *
 * @param {string} payloadJson  JSON-encoded onboarding payload
 * @returns {string}  JSON: { ok: true, clientCode, isNew }
 */
function portal_onboardClient(payloadJson) {
  var email   = Session.getActiveUser().getEmail();
  var payload;
  try {
    payload = JSON.parse(payloadJson);
  } catch (e) {
    throw new Error('portal_onboardClient: invalid JSON payload.');
  }
  var result = ClientOnboarding.onboardClient(email, payload);
  return JSON.stringify({ ok: true, clientCode: result.clientCode, isNew: result.isNew });
}

// ============================================================
// portal_bulkOnboardStaff — imports staff from STG_STAFF_IMPORT
// ============================================================

/**
 * Reads STG_STAFF_IMPORT and onboards every unprocessed row.
 * Status is written back to the sheet per row.
 * CEO + Admin only.
 *
 * @returns {string}  JSON: { total, created, skipped, errors, results[] }
 */
function portal_bulkOnboardStaff() {
  var email  = Session.getActiveUser().getEmail();
  var result = StaffOnboarding.bulkOnboardStaff(email);
  return JSON.stringify(result);
}

// ============================================================
// portal_getStaffList — returns all active staff (CEO/Admin)
// ============================================================

/**
 * Returns all active staff with contract + banking status.
 * Does NOT expose sensitive banking details.
 * @returns {string}  JSON array of staff summary objects
 */
function portal_getStaffList() {
  var email = Session.getActiveUser().getEmail();
  return JSON.stringify(StaffOnboarding.getStaffList(email));
}

// ============================================================
// portal_onboardStaff — onboards a new staff member
// ============================================================

/**
 * Onboards a new staff member. Writes DIM_STAFF_ROSTER + DIM_STAFF_BANKING.
 * @param {string} payloadJson  JSON-encoded onboarding payload
 * @returns {string}  JSON: { ok, personCode, isNew }
 */
function portal_onboardStaff(payloadJson) {
  var email = Session.getActiveUser().getEmail();
  var payload;
  try {
    payload = JSON.parse(payloadJson);
  } catch (e) {
    throw new Error('portal_onboardStaff: invalid JSON payload.');
  }
  var result = StaffOnboarding.onboardStaff(email, payload);
  return JSON.stringify({ ok: true, personCode: result.personCode, isNew: result.isNew });
}

// ============================================================
// portal_generateContract — generates contractor agreement
// ============================================================

/**
 * Generates a Google Doc contractor agreement for a staff member.
 * @param {string} personCode
 * @param {string} optionsJson  JSON: { startDate, jurisdiction }
 * @returns {string}  JSON: { ok, contractId, docUrl, docTitle }
 */
function portal_generateContract(personCode, optionsJson) {
  var email   = Session.getActiveUser().getEmail();
  var options = {};
  try {
    if (optionsJson) options = JSON.parse(optionsJson);
  } catch (e) { /* ignore */ }
  var result = StaffOnboarding.generateContract(email, personCode, options);
  return JSON.stringify({ ok: true, contractId: result.contractId,
                          docUrl: result.docUrl, docTitle: result.docTitle });
}

// ============================================================
// portal_getBankingDetails — CEO only: full banking record
// ============================================================

/**
 * Returns full OFX/banking details for a staff member.
 * CEO only.
 * @param {string} personCode
 * @returns {string}  JSON banking record or { ok: false }
 */
function portal_getBankingDetails(personCode) {
  var email  = Session.getActiveUser().getEmail();
  var result = StaffOnboarding.getBankingDetails(email, personCode);
  if (!result) return JSON.stringify({ ok: false, message: 'No banking details found.' });
  return JSON.stringify({ ok: true, banking: result });
}

// ============================================================
// portal_sendFeedbackRequests — CEO sends quarterly feedback emails
// ============================================================

/**
 * Creates the feedback form for the period (if needed) and sends
 * one email per active client with pre-filled links per designer.
 * CEO only.
 *
 * @param {string} periodId  e.g. '2026-06' (pass '' for current period)
 * @returns {string}  JSON: { period_id, quarter, emails_sent, designer_client_pairs }
 */
function portal_sendFeedbackRequests(periodId, testEmail) {
  var email  = Session.getActiveUser().getEmail();
  var result = ClientFeedback.sendFeedbackRequests(email, {
    periodId:  periodId  || '',
    testEmail: testEmail || null
  });
  return JSON.stringify(result);
}

// ============================================================
// portal_getFeedbackStatus — response counts for portal display
// ============================================================

/**
 * Returns how many feedback responses have been received for the period.
 * CEO/PM/TL only.
 *
 * @param {string} periodId  e.g. '2026-06' (pass '' for current period)
 * @returns {string}  JSON: { period_id, quarter, responses_received, per_designer[] }
 */
function portal_getFeedbackStatus(periodId) {
  var email  = Session.getActiveUser().getEmail();
  var result = ClientFeedback.getFeedbackStatus(
    email,
    periodId || Identifiers.generateCurrentPeriodId()
  );
  return JSON.stringify(result);
}

// ============================================================
// portal_getLeaderDashboard — team hours + payroll status
// ============================================================

/**
 * Returns team hours and payroll status for the current period.
 * Requires CEO / PM / TEAM_LEAD role.
 *
 * @returns {string}  JSON: { period_id, team_hours[], payroll_status[] }
 */
function portal_getLeaderDashboard() {
  var email = Session.getActiveUser().getEmail();
  return PortalData.getLeaderDashboard(email);
}

// ============================================================
// portal_confirmPaystub — staff confirms their own paystub
// ============================================================

/**
 * Called by a logged-in staff member to confirm their paystub.
 *
 * @param {string} periodId  e.g. '2026-04' (pass '' for current period)
 * @returns {string}  JSON: { ok, message }
 */
function portal_confirmPaystub(periodId) {
  var email  = Session.getActiveUser().getEmail();
  var result = PayrollEngine.confirmPaystub(email, periodId || '');
  return JSON.stringify(result);
}

// ============================================================
// portal_previewQuarterlyBonus — preview quarterly bonus (no write)
// ============================================================

/**
 * Returns a preview of the quarterly bonus calculation without writing anything.
 * CEO only.
 *
 * @param {string} quarter  'Q1'|'Q2'|'Q3'|'Q4'
 * @param {number} year     e.g. 2026
 * @returns {string}  JSON array of bonus rows
 */
function portal_previewQuarterlyBonus(quarter, year) {
  var email  = Session.getActiveUser().getEmail();
  var rows   = QuarterlyBonusEngine.previewQuarterlyBonus(email, quarter, parseInt(year, 10));
  return JSON.stringify(rows);
}

// ============================================================
// portal_runQuarterlyBonus — CEO triggers quarterly bonus run
// ============================================================

/**
 * Runs the quarterly bonus calculation and writes to FACT_QUARTERLY_BONUS.
 * CEO only.
 *
 * @param {string} quarter  'Q1'|'Q2'|'Q3'|'Q4'
 * @param {number} year     e.g. 2026
 * @returns {string}  JSON: { written, pending, skipped, quarterPeriodId }
 */
function portal_runQuarterlyBonus(quarter, year) {
  var email  = Session.getActiveUser().getEmail();
  var result = QuarterlyBonusEngine.runQuarterlyBonus(email, quarter, parseInt(year, 10));
  return JSON.stringify(result);
}

// ============================================================
// portal_runBonusRun — CEO triggers supervisor bonus run
// ============================================================

/**
 * Triggers the supervisor bonus run for the given period.
 * CEO only.
 *
 * @param {string} periodId  e.g. '2026-04' (pass '' for current period)
 * @returns {string}  JSON run result
 */
function portal_runBonusRun(periodId) {
  var email  = Session.getActiveUser().getEmail();
  var result = PayrollEngine.runBonusRun(email, { periodId: periodId || '' });
  return JSON.stringify(result);
}

// ============================================================
// portal_approveAllPayroll — CEO final approval
// ============================================================

/**
 * Marks all CONFIRMED payroll records as PROCESSED for the period.
 * CEO only.
 *
 * @param {string} periodId  e.g. '2026-04' (pass '' for current period)
 * @returns {string}  JSON: { processed, skipped, period_id }
 */
function portal_approveAllPayroll(periodId) {
  var email  = Session.getActiveUser().getEmail();
  var result = PayrollEngine.approveAllPayroll(email, periodId || '');
  return JSON.stringify(result);
}

// ============================================================
// portal_getMyRatees — returns staff the current user should rate
// ============================================================

/**
 * Returns ratees for the current user and quarter.
 * TEAM_LEAD -> their direct report designers
 * PM        -> their mapped designers
 * CEO       -> all TLs and PMs
 *
 * @param {string} quarterPeriodId  e.g. '2026-Q1'
 * @returns {string}  JSON array of { person_code, name, role }
 */
function portal_getMyRatees(quarterPeriodId) {
  var email = Session.getActiveUser().getEmail();
  return PortalData.getMyRatees(email, quarterPeriodId);
}

// ============================================================
// portal_getMyRateesAs — CEO preview: ratees for any TL/PM
// ============================================================

/**
 * Returns ratees for any staff member. CEO only.
 * Used by the rating portal when opened in CEO preview mode.
 *
 * @param {string} targetPersonCode  person_code of the TL/PM to preview as
 * @param {string} quarterPeriodId   e.g. '2026-Q1'
 * @returns {string}  JSON array of ratees
 */
function portal_getMyRateesAs(targetPersonCode, quarterPeriodId) {
  var email = Session.getActiveUser().getEmail();
  return PortalData.getMyRateesAs(email, targetPersonCode, quarterPeriodId);
}

// ============================================================
// portal_getViewDataAs — CEO preview: full portal as any staff
// ============================================================

/**
 * Returns portal view data as if the target person were logged in.
 * CEO only.
 *
 * @param {string} targetPersonCode  person_code of the staff member to preview as
 * @returns {string}  JSON view data with previewMode: true
 */
function portal_getViewDataAs(targetPersonCode) {
  var email = Session.getActiveUser().getEmail();
  return PortalData.getViewDataAs(email, targetPersonCode);
}

// ============================================================
// portal_submitRating — submits a performance rating
// ============================================================

/**
 * Submits a quarterly performance rating for one ratee.
 * payload: { ratee_code, score_quality, score_sop,
 *            score_communication, score_initiative, quarter_period_id }
 *
 * @param {string} payloadJson  JSON-encoded payload
 * @returns {string}  JSON: { ok: true }
 */
function portal_submitRating(payloadJson) {
  var email = Session.getActiveUser().getEmail();
  return PortalData.submitRating(email, payloadJson);
}

// ============================================================
// portal_sendRatingRequests — CEO sends quarterly rating emails to TLs/PMs
// ============================================================

/**
 * Emails every active TL and PM a direct link to the quarterly ratings portal.
 * Requires PORTAL_BASE_URL Script Property to be set (run setPortalBaseUrl() once).
 * CEO only.
 *
 * @param {string} periodId  e.g. '2026-Q1' (pass '' for current quarter)
 * @returns {string}  JSON: { period_id, emails_sent, recipients }
 */
function portal_sendRatingRequests(periodId, testEmail) {
  var email  = Session.getActiveUser().getEmail();
  var result = PortalData.sendRatingRequests(email, periodId || '', testEmail || null);
  return JSON.stringify(result);
}

/**
 * One-time setup: stores the web app /exec URL in Script Properties.
 * Run this manually from the Apps Script editor after deploying.
 * Example: setPortalBaseUrl('https://script.google.com/macros/s/ABC.../exec')
 *
 * @param {string} url  The deployed web app /exec URL
 */
function setPortalBaseUrl(url) {
  PropertiesService.getScriptProperties().setProperty('PORTAL_BASE_URL', url);
  return 'PORTAL_BASE_URL set to: ' + url;
}

// ============================================================
// portal_processSbsIntake — bulk intake from STG_INTAKE_SBS
// ============================================================

/**
 * Processes all pending rows in STG_INTAKE_SBS.
 * PM workflow: paste SBS job rows into the sheet, then click
 * "Process SBS Jobs" in the portal. Each row is mapped using
 * DIM_CLIENT_INTAKE_CONFIG and submitted to STG_PROCESSING_QUEUE.
 * Status (_status, _queue_id, _error) is written back per row.
 *
 * Requires JOB_CREATE permission (PM, ADMIN, CEO).
 *
 * @returns {string}  JSON: { processed, queued, errors[] }
 */
function portal_processSbsIntake() {
  var email  = Session.getActiveUser().getEmail();
  var result = SheetAdapter.processSbsIntake(email);
  return JSON.stringify(result);
}
