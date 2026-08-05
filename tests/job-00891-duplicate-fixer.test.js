/**
 * job-00891-duplicate-fixer.test.js
 *
 * Tests for Job00891DuplicateFixer.gs — one-time fix for a PM-reported
 * duplicate job creation (BLC-00891/BLC-00892, 2026-08-05). Confirms:
 * only BLC-00891 (the duplicate, held with no work) gets voided;
 * BLC-00892 (the real job, has work logged) is never touched; the fix
 * is idempotent; RBAC is enforced.
 */

const fs   = require('fs');
const path = require('path');

function loadSrc(relPath) {
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

function installMocks() {
  var store = { VW_JOB_CURRENT_STATE: [], FACT_JOB_EVENTS: [] };

  global.DAL = {
    readAll: function (t) { return (store[t] || []).slice(); },
    appendRow: function (t, row) { if (!store[t]) store[t] = []; store[t].push(Object.assign({}, row)); },
    updateWhere: function (t, conditions, updates) {
      var rows = store[t] || [];
      var updated = 0;
      for (var i = 0; i < rows.length; i++) {
        var matches = Object.keys(conditions).every(function (k) { return rows[i][k] === conditions[k]; });
        if (matches) { Object.assign(rows[i], updates); updated++; }
      }
      return { updated: updated };
    }
  };
  global.Config = {
    TABLES: { VW_JOB_CURRENT_STATE: 'VW_JOB_CURRENT_STATE', FACT_JOB_EVENTS: 'FACT_JOB_EVENTS' }
  };
  global.RBAC = {
    ACTIONS: { ADMIN_CONFIG: 'ADMIN_CONFIG' },
    resolveActor: function (email) { return { email: email, role: 'CEO', personCode: 'TCEO' }; },
    enforcePermission: function () {},
    enforceFinancialAccess: function () {}
  };
  global.Identifiers = {
    generateId: function () { return 'EVT-' + Math.random().toString(36).slice(2); },
    generateCurrentPeriodId: function () { return '2026-08'; }
  };
  global.Logger = { info: function () {}, warn: function () {}, error: function () {} };
  global.Session = { getActiveUser: function () { return { getEmail: function () { return 'raj.nair@bluelotuscanada.ca'; } }; } };
  global.console = console;

  return store;
}

let store;

beforeEach(() => {
  store = installMocks();
  loadSrc('../src/12-migration/Job00891DuplicateFixer.gs');
});

function seedBothJobs() {
  store.VW_JOB_CURRENT_STATE.push(
    { job_number: 'BLC-00891', current_state: 'ON_HOLD', client_code: 'SBS', allocated_to: 'SRO', updated_at: '2026-08-05T16:49:00.000Z' },
    { job_number: 'BLC-00892', current_state: 'ALLOCATED', client_code: 'SBS', allocated_to: 'SRO', updated_at: '2026-08-05T16:49:05.000Z' }
  );
}

describe('Job00891DuplicateFixer.runAudit() — read-only', () => {
  test('reports both jobs, no writes', () => {
    seedBothJobs();
    Job00891DuplicateFixer.runAudit();
    expect(store.VW_JOB_CURRENT_STATE.find(r => r.job_number === 'BLC-00891').current_state).toBe('ON_HOLD');
    expect(store.FACT_JOB_EVENTS.length).toBe(0);
  });
});

describe('Job00891DuplicateFixer.runFix() — voids BLC-00891 only', () => {
  test('voids BLC-00891, leaves BLC-00892 completely untouched', () => {
    seedBothJobs();
    const result = Job00891DuplicateFixer.runFix('raj.nair@bluelotuscanada.ca');

    expect(result.status).toBe('FIXED');
    expect(store.VW_JOB_CURRENT_STATE.find(r => r.job_number === 'BLC-00891').current_state).toBe('VOIDED');
    expect(store.VW_JOB_CURRENT_STATE.find(r => r.job_number === 'BLC-00892').current_state).toBe('ALLOCATED');
  });

  test('writes exactly one JOB_DUPLICATE_VOIDED event for BLC-00891, none for BLC-00892', () => {
    seedBothJobs();
    Job00891DuplicateFixer.runFix('raj.nair@bluelotuscanada.ca');

    const events = store.FACT_JOB_EVENTS.filter(e => e.event_type === 'JOB_DUPLICATE_VOIDED');
    expect(events.length).toBe(1);
    expect(events[0].job_number).toBe('BLC-00891');
    expect(events[0].prev_state).toBe('ON_HOLD');
  });

  test('is idempotent — running twice does not double-void or write a second event', () => {
    seedBothJobs();
    Job00891DuplicateFixer.runFix('raj.nair@bluelotuscanada.ca');
    const second = Job00891DuplicateFixer.runFix('raj.nair@bluelotuscanada.ca');

    expect(second.status).toBe('ALREADY_DONE');
    expect(store.FACT_JOB_EVENTS.filter(e => e.event_type === 'JOB_DUPLICATE_VOIDED').length).toBe(1);
  });

  test('reports NOT_FOUND if BLC-00891 does not exist, writes nothing', () => {
    store.VW_JOB_CURRENT_STATE.push({ job_number: 'BLC-00892', current_state: 'ALLOCATED' });
    const result = Job00891DuplicateFixer.runFix('raj.nair@bluelotuscanada.ca');

    expect(result.status).toBe('NOT_FOUND');
    expect(store.FACT_JOB_EVENTS.length).toBe(0);
  });

  test('enforces RBAC — ADMIN_CONFIG and financial access checked before any write', () => {
    seedBothJobs();
    let permissionChecked = false, financialChecked = false;
    global.RBAC.enforcePermission = function (actor, action) {
      if (action === 'ADMIN_CONFIG') permissionChecked = true;
    };
    global.RBAC.enforceFinancialAccess = function () { financialChecked = true; };

    Job00891DuplicateFixer.runFix('raj.nair@bluelotuscanada.ca');

    expect(permissionChecked).toBe(true);
    expect(financialChecked).toBe(true);
  });
});
