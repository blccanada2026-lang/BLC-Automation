// ============================================================
// MigrationTestRunner.gs — BLC Nexus T12 Migration
// src/12-migration/MigrationTestRunner.gs
//
// Phase G — post-migration system tests.
// 5 end-to-end tests verifying migrated data integrity.
// Run after reconciliation passes (Phase F).
// ============================================================

var MigrationTestRunner = (function () {

  var MODULE = 'MigrationTestRunner';

  function pass_(results, name) {
    Logger.info('MIGR_TEST_PASS', { module: MODULE, test: name });
    results.push({ test: name, passed: true });
  }

  function fail_(results, name, reason) {
    Logger.warn('MIGR_TEST_FAIL', { module: MODULE, test: name, reason: reason });
    results.push({ test: name, passed: false, reason: reason });
  }

  /**
   * Test 1: Every WORK_LOG row has a corresponding JOB in FACT_JOB_EVENTS.
   * A work log against a non-existent job_number is a referential integrity failure.
   */
  function testWorkLogsHaveJobs_(batch, results) {
    var wlRows  = DAL.readAll(Config.TABLES.FACT_WORK_LOGS,  { callerModule: MODULE });
    var jobRows = DAL.readAll(Config.TABLES.FACT_JOB_EVENTS, { callerModule: MODULE });

    var migrWl  = (wlRows  || []).filter(function (r) { return r.migration_batch === batch; });
    var jobNums = {};
    (jobRows || []).filter(function (r) { return r.migration_batch === batch; })
                   .forEach(function (r) { jobNums[r.job_number] = true; });

    var orphans = migrWl.filter(function (r) { return !jobNums[r.job_number]; });

    if (orphans.length === 0) {
      pass_(results, 'WORK_LOGS_HAVE_JOBS');
    } else {
      fail_(results, 'WORK_LOGS_HAVE_JOBS',
        orphans.length + ' work log rows reference non-existent jobs: ' +
        orphans.slice(0, 5).map(function (r) { return r.job_number; }).join(', '));
    }
  }

  /**
   * Test 2: Every JOB row has a valid client_code in DIM_CLIENT_MASTER.
   */
  function testJobsHaveClients_(batch, results) {
    var jobRows    = DAL.readAll(Config.TABLES.FACT_JOB_EVENTS,   { callerModule: MODULE });
    var clientRows = DAL.readAll(Config.TABLES.DIM_CLIENT_MASTER, { callerModule: MODULE });

    var migrJobs    = (jobRows || []).filter(function (r) { return r.migration_batch === batch; });
    var clientCodes = {};
    (clientRows || []).forEach(function (r) { clientCodes[r.client_code] = true; });

    var orphans = migrJobs.filter(function (r) { return !clientCodes[r.client_code]; });

    if (orphans.length === 0) {
      pass_(results, 'JOBS_HAVE_CLIENTS');
    } else {
      fail_(results, 'JOBS_HAVE_CLIENTS',
        orphans.length + ' job rows reference non-existent clients: ' +
        orphans.slice(0, 5).map(function (r) { return r.client_code; }).join(', '));
    }
  }

  /**
   * Test 3: Every WORK_LOG person_code resolves to a staff member in DIM_STAFF_ROSTER.
   */
  function testWorkLogsHaveStaff_(batch, results) {
    var wlRows    = DAL.readAll(Config.TABLES.FACT_WORK_LOGS,   { callerModule: MODULE });
    var staffRows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: MODULE });

    var migrWl      = (wlRows || []).filter(function (r) { return r.migration_batch === batch; });
    var personCodes = {};
    (staffRows || []).forEach(function (r) { personCodes[r.person_code] = true; });

    var orphans = migrWl.filter(function (r) { return !personCodes[r.person_code]; });

    if (orphans.length === 0) {
      pass_(results, 'WORK_LOGS_HAVE_STAFF');
    } else {
      fail_(results, 'WORK_LOGS_HAVE_STAFF',
        orphans.length + ' work log rows reference non-existent staff: ' +
        orphans.slice(0, 5).map(function (r) { return r.person_code; }).join(', '));
    }
  }

  /**
   * Test 4: No migrated rows appear in MIGRATION_NORMALIZED with replay_status=PENDING.
   * All rows must be either REPLAYED or FAILED after the replay run.
   */
  function testNoPendingRows_(batch, results) {
    var rows = DAL.readAll(MigrationConfig.TABLES.NORMALIZED, { callerModule: MODULE });
    var pending = (rows || []).filter(function (r) {
      return r.migration_batch === batch && r.replay_status === 'PENDING';
    });

    if (pending.length === 0) {
      pass_(results, 'NO_PENDING_ROWS');
    } else {
      fail_(results, 'NO_PENDING_ROWS',
        pending.length + ' rows still PENDING — replay did not complete. Run replayAll() again.');
    }
  }

  /**
   * Test 5: Migration batch tag is present on all migrated FACT rows.
   * Verifies the billing-inflation guard: all migrated rows have migration_batch set,
   * so live billing/payroll runs can filter them out.
   */
  function testMigrationBatchTagged_(batch, results) {
    var tables = [
      Config.TABLES.FACT_JOB_EVENTS,
      Config.TABLES.FACT_WORK_LOGS,
      Config.TABLES.FACT_BILLING_LEDGER,
      Config.TABLES.FACT_PAYROLL_LEDGER
    ];

    var untagged = 0;
    tables.forEach(function (tableName) {
      var rows = DAL.readAll(tableName, { callerModule: MODULE });
      (rows || []).filter(function (r) { return r.migration_batch === batch; })
                  .forEach(function (r) {
                    if (!r.migration_batch) untagged++;
                  });
    });

    if (untagged === 0) {
      pass_(results, 'MIGRATION_BATCH_TAGGED');
    } else {
      fail_(results, 'MIGRATION_BATCH_TAGGED',
        untagged + ' migrated FACT rows are missing the migration_batch tag');
    }
  }

  /**
   * Runs all 5 post-migration system tests.
   *
   * @param {string} actorEmail
   * @returns {{ batch: string, results: Object[], passed: boolean }}
   */
  function runAll(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);
    RBAC.enforceFinancialAccess(actor);

    var batch   = MigrationConfig.getBatch();
    var results = [];

    Logger.info('MIGR_TEST_START', { module: MODULE, batch: batch });

    testWorkLogsHaveJobs_(batch, results);
    testJobsHaveClients_(batch, results);
    testWorkLogsHaveStaff_(batch, results);
    testNoPendingRows_(batch, results);
    testMigrationBatchTagged_(batch, results);

    var passed = results.every(function (r) { return r.passed; });

    Logger.info('MIGR_TEST_COMPLETE', {
      module:  MODULE,
      batch:   batch,
      passed:  passed,
      total:   results.length,
      passing: results.filter(function (r) { return r.passed; }).length
    });

    return { batch: batch, results: results, passed: passed };
  }

  return { runAll: runAll };
}());
