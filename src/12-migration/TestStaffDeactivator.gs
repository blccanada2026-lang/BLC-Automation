// ============================================================
// TestStaffDeactivator.gs — BLC Nexus T12 Migration
// src/12-migration/TestStaffDeactivator.gs
//
// PROD contamination cleanup — Fix 1. Sets active=false for the
// 6 test-fixture person_codes found in DIM_STAFF_ROSTER by
// runFullContaminationDiscovery(): DS1, QC1, RND, NTL, TLM, WLD.
// (DS1/QC1 — seedTestStaff(); RND/NTL — Raj's DEV-only test personas
// seeded by the same function; TLM/WLD — WorkLogCorrectionHandlerTest.gs's
// self-seeding via wlcSeedFreshDesigner_()/its team-member equivalent.)
//
// Deactivating (not deleting — DIM tables use effective dating per
// Rule D4, not physical removal) immediately removes these codes
// from Team Hours and Load Balance, both of which gate on
// DIM_STAFF_ROSTER.active = true.
//
// HOW TO RUN (Apps Script editor):
//   runTestStaffDeactivate()       — DRY RUN. Lists current active
//                                    status per code. No writes.
//   runTestStaffDeactivate_LIVE()  — LIVE. Sets active=false for
//                                    any of the 6 codes currently
//                                    active=true.
//
// Idempotent: a code already active=false is skipped, not re-written.
// ============================================================

var TestStaffDeactivator = (function() {

  var MODULE       = 'TestStaffDeactivator';
  var TARGET_CODES = ['DS1', 'QC1', 'RND', 'NTL', 'TLM', 'WLD'];

  /** Returns { code -> row } for every TARGET_CODES entry found in DIM_STAFF_ROSTER. */
  function findTargets_() {
    var rows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: MODULE });
    var byCode = {};
    (rows || []).forEach(function(r) {
      var code = String(r.person_code || '').trim().toUpperCase();
      if (TARGET_CODES.indexOf(code) !== -1) byCode[code] = r;
    });
    return byCode;
  }

  function isActive_(row) {
    return row.active === true || String(row.active || '').toUpperCase() === 'TRUE';
  }

  /**
   * Dry run — lists current active status for each of the 6 target
   * codes. No writes.
   * @param {string} actorEmail
   */
  function runDryRun(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    var found = findTargets_();

    console.log('=== Test staff deactivation — DRY RUN ===');
    console.log('Target codes: ' + TARGET_CODES.join(', '));
    console.log('');

    var wouldDeactivate = [];
    TARGET_CODES.forEach(function(code) {
      var row = found[code];
      if (!row) {
        console.log('[NOT FOUND] ' + code + ' — no DIM_STAFF_ROSTER row.');
        return;
      }
      var active = isActive_(row);
      console.log('[' + (active ? 'WOULD DEACTIVATE' : 'ALREADY INACTIVE') + '] ' +
        code + ' | name=' + String(row.name || '') + ' | email=' + String(row.email || '') +
        ' | active=' + active);
      if (active) wouldDeactivate.push(code);
    });

    console.log('');
    console.log('--- SUMMARY ---');
    console.log('Would deactivate: ' + wouldDeactivate.length + ' (' + wouldDeactivate.join(', ') + ')');
    console.log('No changes made — run runTestStaffDeactivate_LIVE() to apply.');

    Logger.info('TEST_STAFF_DEACTIVATE_DRY_RUN', { module: MODULE, wouldDeactivate: wouldDeactivate });

    return { dryRun: true, wouldDeactivate: wouldDeactivate };
  }

  /**
   * Live run — sets active=false for each target code currently
   * active=true. Idempotent — already-inactive codes are skipped.
   * @param {string} actorEmail
   */
  function runLive(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    var found = findTargets_();

    console.log('=== Test staff deactivation — LIVE ===');
    console.log('Target codes: ' + TARGET_CODES.join(', '));
    console.log('');

    var deactivated = 0, alreadyInactive = 0, notFound = 0, failed = 0;

    TARGET_CODES.forEach(function(code) {
      var row = found[code];
      if (!row) {
        console.log('[NOT FOUND] ' + code);
        notFound++;
        return;
      }
      if (!isActive_(row)) {
        console.log('[ALREADY INACTIVE] ' + code);
        alreadyInactive++;
        return;
      }
      try {
        DAL.updateWhere(
          Config.TABLES.DIM_STAFF_ROSTER,
          { person_code: code },
          { active: false },
          { callerModule: MODULE }
        );
        console.log('[DEACTIVATED] ' + code + ' | name=' + String(row.name || ''));
        deactivated++;
      } catch (e) {
        Logger.error('TEST_STAFF_DEACTIVATE_FAIL', { module: MODULE, code: code, error: e.message });
        console.log('[FAILED] ' + code + ' — ' + e.message);
        failed++;
      }
    });

    console.log('');
    console.log('--- SUMMARY ---');
    console.log('Deactivated: ' + deactivated);
    console.log('Already inactive: ' + alreadyInactive);
    console.log('Not found: ' + notFound);
    console.log('Failed: ' + failed);

    Logger.info('TEST_STAFF_DEACTIVATE_DONE', {
      module: MODULE, deactivated: deactivated, alreadyInactive: alreadyInactive,
      notFound: notFound, failed: failed
    });

    return { deactivated: deactivated, alreadyInactive: alreadyInactive, notFound: notFound, failed: failed };
  }

  return { runDryRun: runDryRun, runLive: runLive };
}());

// ── Top-level runners ─────────────────────────────────────────

/** Dry run — lists active status for the 6 target test person_codes. No writes. */
function runTestStaffDeactivate() {
  var email = Session.getActiveUser().getEmail();
  return TestStaffDeactivator.runDryRun(email);
}

/** Live — sets active=false for the 6 target test person_codes. Run dry run first. */
function runTestStaffDeactivate_LIVE() {
  var email = Session.getActiveUser().getEmail();
  return TestStaffDeactivator.runLive(email);
}
