/**
 * data-integrity-checks-job-lists.test.js
 *
 * checkDuplicateWorkLogs_(), checkOrphanedWorkLogs_(), and
 * checkAllocatedToValidity_() each already compute a complete list of
 * affected job_numbers internally before slicing it down to a 10-item
 * "samples" cap for human-readable reporting. This adds a new
 * `data.all_job_numbers` field carrying the COMPLETE, uncapped list,
 * so PreBillingGate.gs's caller (ClientTimesheetEngine.gs) can map a
 * blocker to the specific client(s) it actually affects instead of
 * blocking every client on any single blocker.
 *
 * Purely additive: `message`, `samples`, `count`/`jobs` and every other
 * existing field must stay byte-identical, since DataIntegrityMonitor.gs's
 * daily/weekly digest reads those same fields and must be unaffected.
 */

const fs   = require('fs');
const path = require('path');

function loadSrc(relPath) {
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

function installMocks() {
  var store = {};
  function readAll(tableName, opts) {
    var key = tableName;
    if (opts && opts.periodId) key = tableName + '|' + opts.periodId;
    return (store[key] || store[tableName] || []).slice();
  }

  global.DAL = { readAll: function (t, opts) { return readAll(t, opts); } };
  global.Config = {
    TABLES: {
      FACT_WORK_LOGS:       'FACT_WORK_LOGS',
      VW_JOB_CURRENT_STATE: 'VW_JOB_CURRENT_STATE',
      DIM_STAFF_ROSTER:     'DIM_STAFF_ROSTER'
    }
  };
  global.Constants = {
    EVENT_TYPES: {
      WORK_LOG_SUBMITTED: 'WORK_LOG_SUBMITTED',
      WORK_LOG_MIGRATED:  'WORK_LOG_MIGRATED',
      WORK_LOG_VOIDED:    'WORK_LOG_VOIDED'
    }
  };
  global.DIM_SEVERITY_ = { CRITICAL: 'CRITICAL', HIGH: 'HIGH', MEDIUM: 'MEDIUM', INFO: 'INFO' };

  return store;
}

let store;

beforeEach(() => {
  store = installMocks();
});

describe('checkDuplicateWorkLogs_() — all_job_numbers field', () => {
  beforeEach(() => {
    loadSrc('../src/12-migration/WorkLogDedupAudit.gs'); // normWd_
    loadSrc('../src/09-notifications/DataIntegrityChecks_WorkLog.gs');
  });

  function seedDuplicateGroups(count) {
    var rows = [];
    for (var i = 0; i < count; i++) {
      var jobNumber = 'JOB-' + i;
      // Two WORK_LOG_SUBMITTED rows with identical actor/job/date/hours = one net duplicate group.
      rows.push({ actor_code: 'DBS', job_number: jobNumber, work_date: '2026-08-05', hours: '2', event_type: 'WORK_LOG_SUBMITTED' });
      rows.push({ actor_code: 'DBS', job_number: jobNumber, work_date: '2026-08-05', hours: '2', event_type: 'WORK_LOG_SUBMITTED' });
    }
    store['FACT_WORK_LOGS|2026-08'] = rows;
  }

  test('returns all affected job_numbers uncapped, while samples stays capped at 10', () => {
    seedDuplicateGroups(15);

    var result = checkDuplicateWorkLogs_('2026-08', null);

    expect(result).toHaveLength(1);
    expect(result[0].data.samples).toHaveLength(10);
    expect(result[0].data.all_job_numbers).toHaveLength(15);
  });

  test('all_job_numbers contains every affected job_number, not just the sampled ones', () => {
    seedDuplicateGroups(15);

    var result = checkDuplicateWorkLogs_('2026-08', null);
    var jobs = result[0].data.all_job_numbers;

    for (var i = 0; i < 15; i++) {
      expect(jobs).toContain('JOB-' + i);
    }
  });

  test('existing message/samples/dupe_groups fields are unchanged', () => {
    seedDuplicateGroups(3);

    var result = checkDuplicateWorkLogs_('2026-08', null);

    expect(result[0].message).toMatch(/3 duplicate work log group\(s\)/);
    expect(result[0].data.dupe_groups).toBe(3);
    expect(result[0].data.samples).toHaveLength(3);
  });
});

describe('checkOrphanedWorkLogs_() — all_job_numbers field', () => {
  beforeEach(() => {
    global.isAdminOverheadJobNumber_ = function () { return false; };
    global.sumOrphanHours_ = function (orphans) {
      return orphans.reduce(function (sum, o) { return sum + o.total_hours; }, 0);
    };
    global.computeWorkLogOrphans_ = function () {
      var orphans = [];
      for (var i = 0; i < 15; i++) {
        orphans.push({ job_number: 'ORPHAN-' + i, total_hours: 5, most_recent_partition: '2026-08' });
      }
      return { orphans: orphans };
    };
    loadSrc('../src/09-notifications/DataIntegrityChecks_WorkLog.gs');
  });

  test('returns all affected job_numbers uncapped, while samples stays capped at 10', () => {
    var result = checkOrphanedWorkLogs_('2026-08', null);

    expect(result).toHaveLength(1);
    expect(result[0].data.samples).toHaveLength(10);
    expect(result[0].data.all_job_numbers).toHaveLength(15);
  });

  test('all_job_numbers contains every affected job_number, not just the sampled ones', () => {
    var result = checkOrphanedWorkLogs_('2026-08', null);
    var jobs = result[0].data.all_job_numbers;

    for (var i = 0; i < 15; i++) {
      expect(jobs).toContain('ORPHAN-' + i);
    }
  });

  test('existing message/samples/orphan_count fields are unchanged', () => {
    global.computeWorkLogOrphans_ = function () {
      return { orphans: [{ job_number: 'ORPHAN-0', total_hours: 5, most_recent_partition: '2026-08' }] };
    };

    var result = checkOrphanedWorkLogs_('2026-08', null);

    expect(result[0].message).toMatch(/1 orphaned job_number\(s\)/);
    expect(result[0].data.orphan_count).toBe(1);
    expect(result[0].data.samples).toHaveLength(1);
  });
});

describe('checkAllocatedToValidity_() — all_job_numbers field', () => {
  beforeEach(() => {
    loadSrc('../src/09-notifications/DataIntegrityChecks_Entity.gs');
  });

  function seedInvalidAllocations(count) {
    store['DIM_STAFF_ROSTER'] = [{ person_code: 'DBS', active: 'TRUE' }];
    var rows = [];
    for (var i = 0; i < count; i++) {
      rows.push({ job_number: 'JOB-' + i, current_state: 'IN_PROGRESS', allocated_to: 'GHOST' });
    }
    store['VW_JOB_CURRENT_STATE'] = rows;
  }

  test('returns all affected job_numbers uncapped, while the per-code jobs list stays capped at 10', () => {
    seedInvalidAllocations(15);

    var result = checkAllocatedToValidity_(null);

    expect(result).toHaveLength(1);
    expect(result[0].data.samples.GHOST.jobs).toHaveLength(10);
    expect(result[0].data.all_job_numbers).toHaveLength(15);
  });

  test('all_job_numbers contains every affected job_number, not just the sampled ones', () => {
    seedInvalidAllocations(15);

    var result = checkAllocatedToValidity_(null);
    var jobs = result[0].data.all_job_numbers;

    for (var i = 0; i < 15; i++) {
      expect(jobs).toContain('JOB-' + i);
    }
  });

  test('existing message/samples/invalid_count/job_count fields are unchanged', () => {
    seedInvalidAllocations(3);

    var result = checkAllocatedToValidity_(null);

    expect(result[0].message).toMatch(/1 invalid allocated_to value\(s\) across 3 job\(s\)/);
    expect(result[0].data.invalid_count).toBe(1);
    expect(result[0].data.job_count).toBe(3);
    expect(result[0].data.samples.GHOST.count).toBe(3);
  });
});
