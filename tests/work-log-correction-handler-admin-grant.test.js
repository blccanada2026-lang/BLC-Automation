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
