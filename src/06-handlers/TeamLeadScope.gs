// ============================================================
// TeamLeadScope.gs — BLC Nexus T06 Shared Scope Resolution
// src/06-handlers/TeamLeadScope.gs
//
// LOAD ORDER: T06. Reads Config/DAL only when called, never at load time.
// DEPENDENCIES: Config.gs (T00), DAL.gs (T01).
//
// Which work-log entries a TEAM_LEAD may see and correct (Raj,
// 2026-10-20: "match Team Hours"):
//   1. their own entries;
//   2. entries by roster direct reports (DIM_STAFF_ROSTER.supervisor_code,
//      active, row valid at some point during the period), on any job;
//   3. entries on jobs REF_ACCOUNT_SUPERVISION assigns to them for that
//      designer, resolved like PayrollEngine.buildSupervisorBonusMapByAccount_
//      (as of the period's 1st; an exact product_code row beats a wildcard).
// Shared by PortalData.getLeaderDashboard / getMyHours and
// WorkLogCorrectionHandler, so what a TL sees and what they may correct
// can never disagree. Job-list visibility (PortalData.buildTeamCodes_,
// account-wide by design since 2026-06-16) is deliberately separate.
// ============================================================

var TeamLeadScope = (function () {

  function up_(v) { return String(v == null ? '' : v).trim().toUpperCase(); }

  // Local-date getters, not toISOString(): Sheets returns local midnight.
  function iso_(v) {
    if (!v) return '';
    if (v instanceof Date) {
      var m = String(v.getMonth() + 1); if (m.length < 2) m = '0' + m;
      var d = String(v.getDate());      if (d.length < 2) d = '0' + d;
      return v.getFullYear() + '-' + m + '-' + d;
    }
    return String(v).trim().substring(0, 10);
  }

  function periodEnd_(periodId) {
    var y = parseInt(periodId.substring(0, 4), 10);
    var m = parseInt(periodId.substring(5, 7), 10);
    var d = String(new Date(y, m, 0).getDate());
    return periodId + '-' + (d.length < 2 ? '0' + d : d);
  }

  function readAll_(table) {
    try {
      return DAL.readAll(table, { callerModule: 'TeamLeadScope' }) || [];
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return [];
      throw e;
    }
  }

  /**
   * @param {string} tlCode    TEAM_LEAD person_code
   * @param {string} periodId  'YYYY-MM' — the work-log partition being viewed/corrected
   * @returns {{ inScope: function(string, string): boolean,
   *             couldBeInScope: function(string): boolean }}
   */
  function forPeriod(tlCode, periodId) {
    var tl          = up_(tlCode);
    var periodStart = periodId + '-01';
    var periodLast  = periodEnd_(periodId);

    var direct     = {}; // reports during this period — decides inScope
    var everDirect = {}; // reports at any date — only for the cheap couldBeInScope pre-check
    readAll_(Config.TABLES.DIM_STAFF_ROSTER).forEach(function (r) {
      if (up_(r.supervisor_code) !== tl) return;
      if (r.active !== true && up_(r.active) !== 'TRUE') return;
      if (up_(r.person_code)) everDirect[up_(r.person_code)] = true;
      var from = iso_(r.effective_from);
      var to   = iso_(r.effective_to);
      if (from && from > periodLast)  return;
      if (to   && to   < periodStart) return;
      var pc = up_(r.person_code);
      if (pc) direct[pc] = true;
    });

    var supRows = readAll_(Config.TABLES.REF_ACCOUNT_SUPERVISION);
    var supervisedDesigners = {};
    supRows.forEach(function (r) {
      if (up_(r.supervisor_code) === tl) supervisedDesigners[up_(r.designer_code)] = true;
    });

    var jobMap = null; // loaded only if an account-supervision lookup is needed
    function job_(jobNumber) {
      if (!jobMap) {
        jobMap = {};
        readAll_(Config.TABLES.VW_JOB_CURRENT_STATE).forEach(function (j) {
          var jn = String(j.job_number || '').trim();
          if (jn) jobMap[jn] = { client: String(j.client_code || '').trim(), product: up_(j.product_code) };
        });
      }
      return jobMap[String(jobNumber || '').trim()];
    }

    // Date-independent on purpose: a caller may pre-check with a different
    // period than the entry's real partition (late entries), so this must
    // never reject anything inScope() would allow for some period.
    function couldBeInScope(actorCode) {
      var a = up_(actorCode);
      return !!a && (a === tl || !!everDirect[a] || !!supervisedDesigners[a]);
    }

    function inScope(actorCode, jobNumber) {
      var a = up_(actorCode);
      if (!a || !tl) return false;
      if (a === tl || direct[a]) return true;
      if (!supervisedDesigners[a]) return false;

      var job = job_(jobNumber);
      if (!job) return false;
      var candidates = supRows.filter(function (r) {
        if (String(r.client_code || '').trim() !== job.client) return false;
        if (up_(r.designer_code) !== a) return false;
        var p = up_(r.product_code);
        if (p !== '' && p !== job.product) return false;
        var from = iso_(r.effective_from);
        var to   = iso_(r.effective_to);
        return !(from && from > periodStart) && !(to && to < periodStart);
      });
      var exact = candidates.filter(function (r) { return up_(r.product_code) === job.product; });
      var winners = exact.length > 0 ? exact : candidates.filter(function (r) { return up_(r.product_code) === ''; });
      return winners.length === 1 && up_(winners[0].supervisor_code) === tl;
    }

    return { inScope: inScope, couldBeInScope: couldBeInScope };
  }

  return { forPeriod: forPeriod };
}());
