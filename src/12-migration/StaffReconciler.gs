// ============================================================
// StaffReconciler.gs — BLC Nexus T12 Migration
// src/12-migration/StaffReconciler.gs
//
// Compares STAFF_ROSTER vs DESIGNER_MASTER from the Stacey
// legacy spreadsheet and writes a STAFF_RECONCILE tab in Nexus.
//
// Read-only against Stacey. Does not touch FACT tables,
// MIGRATION_RAW_IMPORT, or any migration state.
//
// A2 note: SpreadsheetApp used here under the approved migration
// exception (same as StaceyAuditor). The STAFF_RECONCILE output
// is a diagnostic sheet, not a FACT table — setValues is correct.
// ============================================================

var StaffReconciler = (function () {

  var MODULE     = 'StaffReconciler';
  var OUTPUT_TAB = 'STAFF_RECONCILE';

  var HEADERS = [
    'person_code',
    'name_roster',     'name_designer',
    'email_roster',    'email_designer',
    'role_roster',     'role_designer',
    'pay_rate_roster', 'pay_rate_designer',
    'supervisor_roster', 'supervisor_designer',
    'pm_code_roster',  'pm_code_designer',
    'STATUS',
    'conflict_fields',
    'present_in'
  ];

  // Aliases match MigrationNormalizer STAFF_MAP — single source of truth.
  var FIELD_ALIASES = {
    person_code:     ['Designer_ID', 'person_code', 'PersonCode'],
    name:            ['Designer_Name', 'Designer Name', 'name', 'Name'],
    email:           ['Email', 'email', 'EmailAddress'],
    role:            ['Role', 'role'],
    pay_rate:        ['Hourly_Rate', 'pay_design', 'PayDesign', 'Rate'],
    supervisor_code: ['Supervisor_ID', 'supervisor_code', 'SupervisorCode'],
    pm_code:         ['pm_code', 'PM_Code', 'PMCode']
  };

  // ── Helpers ───────────────────────────────────────────────

  function readTab_(ss, tabName, headerRow) {
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) return null;
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < headerRow + 1 || lastCol < 1) return [];
    var data    = sheet.getRange(headerRow, 1, lastRow - headerRow + 1, lastCol).getValues();
    var headers = data[0].map(function (h) { return String(h).trim(); });
    return data.slice(1).map(function (row) {
      var obj = {};
      headers.forEach(function (h, i) { obj[h] = row[i]; });
      return obj;
    });
  }

  function getField_(row, aliases) {
    for (var i = 0; i < aliases.length; i++) {
      var v = row[aliases[i]];
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        return String(v).trim();
      }
    }
    return '';
  }

  function extractRecord_(row) {
    var rec = {};
    Object.keys(FIELD_ALIASES).forEach(function (field) {
      rec[field] = getField_(row, FIELD_ALIASES[field]);
    });
    return rec;
  }

  // Returns { map: { code → record }, dupes: { code → count } }
  function indexRows_(rows) {
    var map   = {};
    var dupes = {};
    rows.forEach(function (row) {
      var rec  = extractRecord_(row);
      var code = rec.person_code;
      if (!code) return;
      if (map[code]) {
        dupes[code] = (dupes[code] || 1) + 1;
      } else {
        map[code] = rec;
      }
    });
    return { map: map, dupes: dupes };
  }

  var COMPARE_FIELDS = ['name', 'email', 'role', 'pay_rate', 'supervisor_code', 'pm_code'];

  function classify_(r, d, isDupe) {
    if (isDupe)  return { status: 'DUPLICATE',          conflicts: isDupe };
    if (!r && d) return { status: 'MISSING_IN_ROSTER',  conflicts: '' };
    if (r && !d) return { status: 'MISSING_IN_DESIGNER', conflicts: '' };

    var conflicts = COMPARE_FIELDS.filter(function (f) {
      return r[f] !== '' && d[f] !== '' && r[f] !== d[f];
    });
    return {
      status:    conflicts.length ? 'CONFLICT' : 'OK',
      conflicts: conflicts.join(', ')
    };
  }

  // ── Public ────────────────────────────────────────────────

  /**
   * Reads STAFF_ROSTER and DESIGNER_MASTER from Stacey, compares every
   * person_code, and writes results to a STAFF_RECONCILE tab in Nexus.
   *
   * STATUS values:
   *   OK                  — present in both, no field conflicts
   *   CONFLICT            — present in both, one or more fields differ
   *   MISSING_IN_ROSTER   — only in DESIGNER_MASTER
   *   MISSING_IN_DESIGNER — only in STAFF_ROSTER
   *   DUPLICATE           — same person_code appears more than once in a source
   *
   * @param {string} actorEmail  CEO email required.
   * @returns {{ total: number, sheet: string }}
   */
  function runStaffReconcile(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);
    RBAC.enforceFinancialAccess(actor);

    Logger.info('STAFF_RECONCILE_START', { module: MODULE, actor: actor.person_code });

    // ── Read Stacey (read-only) ───────────────────────────
    var stacey;
    try {
      stacey = SpreadsheetApp.openById(MigrationConfig.getStaceyId());
    } catch (e) {
      throw new Error('StaffReconciler: cannot open Stacey — ' + e.message);
    }

    var rosterRows   = readTab_(stacey, 'STAFF_ROSTER',   2); // row 1 = title, row 2 = headers
    var designerRows = readTab_(stacey, 'DESIGNER_MASTER', 1);

    if (!rosterRows)   throw new Error('StaffReconciler: STAFF_ROSTER tab not found in Stacey.');
    if (!designerRows) throw new Error('StaffReconciler: DESIGNER_MASTER tab not found in Stacey.');

    // ── Index both sources ────────────────────────────────
    var rosterIdx   = indexRows_(rosterRows);
    var designerIdx = indexRows_(designerRows);

    // Union of all known person codes
    var allCodes = {};
    Object.keys(rosterIdx.map).forEach(function (c)   { allCodes[c] = true; });
    Object.keys(designerIdx.map).forEach(function (c) { allCodes[c] = true; });
    Object.keys(rosterIdx.dupes).forEach(function (c)   { allCodes[c] = true; });
    Object.keys(designerIdx.dupes).forEach(function (c) { allCodes[c] = true; });

    // ── Build output rows ─────────────────────────────────
    var rows = [HEADERS];

    Object.keys(allCodes).sort().forEach(function (code) {
      var r = rosterIdx.map[code];
      var d = designerIdx.map[code];

      var dupeNote = '';
      if (rosterIdx.dupes[code])   dupeNote += 'STAFF_ROSTER×' + rosterIdx.dupes[code] + ' ';
      if (designerIdx.dupes[code]) dupeNote += 'DESIGNER_MASTER×' + designerIdx.dupes[code];
      dupeNote = dupeNote.trim();

      var result  = classify_(r, d, dupeNote || null);
      var sources = [r ? 'ROSTER' : '', d ? 'DESIGNER' : ''].filter(Boolean).join(' + ');

      rows.push([
        code,
        r ? r.name : '',            d ? d.name : '',
        r ? r.email : '',           d ? d.email : '',
        r ? r.role : '',            d ? d.role : '',
        r ? r.pay_rate : '',        d ? d.pay_rate : '',
        r ? r.supervisor_code : '', d ? d.supervisor_code : '',
        r ? r.pm_code : '',         d ? d.pm_code : '',
        result.status,
        result.conflicts,
        sources
      ]);
    });

    // ── Write to Nexus via setValues (diagnostic sheet) ───
    var nexus = SpreadsheetApp.getActiveSpreadsheet();
    var out   = nexus.getSheetByName(OUTPUT_TAB) || nexus.insertSheet(OUTPUT_TAB);
    out.clearContents();
    out.getRange(1, 1, rows.length, HEADERS.length).setValues(rows);
    out.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');

    var dataRows = rows.slice(1);
    var summary  = {
      total:               dataRows.length,
      ok:                  0,
      conflict:            0,
      missing_in_roster:   0,
      missing_in_designer: 0,
      duplicate:           0
    };
    dataRows.forEach(function (r) {
      var s = r[13];
      if      (s === 'OK')                  summary.ok++;
      else if (s === 'CONFLICT')            summary.conflict++;
      else if (s === 'MISSING_IN_ROSTER')   summary.missing_in_roster++;
      else if (s === 'MISSING_IN_DESIGNER') summary.missing_in_designer++;
      else if (s === 'DUPLICATE')           summary.duplicate++;
    });

    Logger.info('STAFF_RECONCILE_DONE', { module: MODULE, summary: summary });

    return { total: rows.length - 1, sheet: OUTPUT_TAB };
  }

  return { runStaffReconcile: runStaffReconcile };

}());

function runStaffReconcileNow() {
  StaffReconciler.runStaffReconcile(Session.getActiveUser().getEmail());
}
