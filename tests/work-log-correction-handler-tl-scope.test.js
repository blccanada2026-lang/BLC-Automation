/**
 * work-log-correction-handler-tl-scope.test.js
 *
 * 2026-10-20: a TEAM_LEAD could amend/void/reassign the hours of anyone who
 * shared a client account with them (RBAC.buildTeamCodes path 1). For Sandy
 * (SDA) that meant 12 people, including his PM. Raj: corrections must match
 * what the TL sees in Team Hours / My Hours. TeamLeadScope decides per
 * entry: own + direct reports + account-supervised entries. A reassign must
 * also land on a job that is still in the TL's scope.
 */

const fs   = require('fs');
const path = require('path');

function loadSrc(relPath) {
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

var store;

function key(table, opts) { return table + '|' + (opts && opts.periodId); }

beforeEach(() => {
  store = {};
  global.Config = {
    TABLES: {
      FACT_WORK_LOGS:          'FACT_WORK_LOGS',
      FACT_PAYROLL_LEDGER:     'FACT_PAYROLL_LEDGER',
      DIM_STAFF_ROSTER:        'DIM_STAFF_ROSTER',
      REF_ACCOUNT_SUPERVISION: 'REF_ACCOUNT_SUPERVISION',
      VW_JOB_CURRENT_STATE:    'VW_JOB_CURRENT_STATE',
      REF_ACCOUNT_DESIGNER_MAP: 'REF_ACCOUNT_DESIGNER_MAP'
    },
    FORM_TYPES: { WORK_LOG_AMEND: 'WORK_LOG_AMEND', WORK_LOG_VOID: 'WORK_LOG_VOID', WORK_LOG_REASSIGN: 'WORK_LOG_REASSIGN' }
  };
  global.Logger = { info: function () {}, warn: function () {}, error: function () {}, log: function () {} };
  global.Identifiers = {
    generateId:              function () { return 'EVT-' + Math.random().toString(36).slice(2); },
    generateCurrentPeriodId: function () { return '2026-10'; }
  };
  global.DAL = {
    readAll:   function (t, opts) { return (store[key(t, opts)] || store[t + '|undefined'] || []).slice(); },
    readWhere: function (t, cond, opts) {
      return (store[key(t, opts)] || []).filter(function (r) {
        return Object.keys(cond).every(function (k) { return r[k] === cond[k]; });
      });
    },
    appendRow: function (t, row, opts) {
      var k = key(t, opts);
      if (!store[k]) store[k] = [];
      store[k].push(Object.assign({}, row));
    },
    ensurePartition: function () {}
  };
  global.ValidationEngine = { validate: function (schema, data) { return data; } };
  global.IdempotencyEngine = { checkAndMark: function () { return true; }, clear: function () {} };
  global.StateMachine = {
    getJobView: function () { return { current_state: 'IN_PROGRESS' }; },
    isTerminal: function () { return false; }
  };
  global.QueueProcessor = { registerHandler: function () {} };

  loadSrc('../src/00-foundation/Constants.gs');
  loadSrc('../src/02-security/RBAC.gs');
  loadSrc('../src/06-handlers/TeamLeadScope.gs');
  loadSrc('../src/06-handlers/WorkLogCorrectionHandler.gs');

  store['DIM_STAFF_ROSTER|undefined'] = [
    { person_code: 'PBG',   supervisor_code: 'SDA', active: true },
    { person_code: 'AR001', supervisor_code: 'SGO', active: true },
    { person_code: 'BCH',   supervisor_code: 'SGO', active: true },
    { person_code: 'NEW',   supervisor_code: 'SDA', active: true, effective_from: '2026-10-15', effective_to: '' }
  ];
  store['REF_ACCOUNT_SUPERVISION|undefined'] = [
    { client_code: 'SBS', product_code: '', designer_code: 'AR001', supervisor_code: 'SDA', effective_from: '2026-10-01', effective_to: '' }
  ];
  // Everyone shares SBS and AR001 is also on Nelson — this is what used to grant scope.
  store['REF_ACCOUNT_DESIGNER_MAP|undefined'] = ['SDA', 'PBG', 'AR001', 'BCH'].map(function (c) {
    return { client_code: 'SBS', designer_code: c };
  }).concat([{ client_code: 'NELSON', designer_code: 'AR001' }]);
  store['VW_JOB_CURRENT_STATE|undefined'] = [
    { job_number: 'J-SBS',  client_code: 'SBS',    product_code: 'ROOF_TRUSS' },
    { job_number: 'J-SBS2', client_code: 'SBS',    product_code: 'FLOOR_TRUSS' },
    { job_number: 'J-NEL',  client_code: 'NELSON', product_code: 'ROOF_TRUSS' }
  ];
});

function seed(actorCode, jobNumber, workDate) {
  var row = { event_id: 'EVT-' + actorCode + jobNumber, job_number: jobNumber, actor_code: actorCode,
              actor_role: 'DESIGNER', hours: 4, work_date: workDate || '2026-10-10', event_type: 'WORK_LOG_SUBMITTED', notes: '' };
  var k = 'FACT_WORK_LOGS|2026-10';
  store[k] = (store[k] || []).concat([row]);
}

function actor(role, code) {
  return { email: code.toLowerCase() + '@test.blc.internal', role: role, personCode: code,
           displayName: 'Test ' + code, _rbacResolved: true };
}

function amend(actorCode, jobNumber) {
  return { queue_id: 'Q-' + Math.random(), payload_json: JSON.stringify({
    actor_code: actorCode, job_number: jobNumber, work_date: '2026-10-10',
    original_hours: 4, new_hours: 3, reason: 'test' }) };
}

function reassign(actorCode, jobNumber, newJob) {
  return { queue_id: 'Q-' + Math.random(), payload_json: JSON.stringify({
    actor_code: actorCode, job_number: jobNumber, work_date: '2026-10-10',
    hours: 4, new_job_number: newJob, reason: 'test' }) };
}

var SANDY = actor('TEAM_LEAD', 'SDA');

describe('WorkLogCorrectionHandler — TEAM_LEAD correction scope matches Team Hours', () => {
  test('TL can amend a direct report\'s entry on any job', () => {
    seed('PBG', 'J-NEL');
    expect(() => WorkLogCorrectionHandler.handleAmend(amend('PBG', 'J-NEL'), SANDY)).not.toThrow();
  });

  test('TL can amend an account-supervised entry (AR001 on SBS)', () => {
    seed('AR001', 'J-SBS');
    expect(() => WorkLogCorrectionHandler.handleAmend(amend('AR001', 'J-SBS'), SANDY)).not.toThrow();
  });

  test('TL cannot amend the same designer\'s entry on an account they do not supervise (AR001 on Nelson)', () => {
    seed('AR001', 'J-NEL');
    expect(() => WorkLogCorrectionHandler.handleAmend(amend('AR001', 'J-NEL'), SANDY)).toThrow(/not on their team|scope/);
  });

  test('TL cannot void a peer TL\'s entry just because they share an account', () => {
    seed('BCH', 'J-SBS');
    var item = { queue_id: 'Q-V', payload_json: JSON.stringify({
      actor_code: 'BCH', job_number: 'J-SBS', work_date: '2026-10-10', hours: 4, reason: 'test' }) };
    expect(() => WorkLogCorrectionHandler.handleVoid(item, SANDY)).toThrow(/not on their team|scope/);
  });

  test('TL cannot reassign account-supervised hours onto a job outside their scope', () => {
    seed('AR001', 'J-SBS');
    expect(() => WorkLogCorrectionHandler.handleReassign(reassign('AR001', 'J-SBS', 'J-NEL'), SANDY)).toThrow(/scope/);
  });

  test('TL can reassign account-supervised hours onto another in-scope job', () => {
    seed('AR001', 'J-SBS');
    expect(() => WorkLogCorrectionHandler.handleReassign(reassign('AR001', 'J-SBS', 'J-SBS2'), SANDY)).not.toThrow();
  });

  test('late entry: a report who joined Oct 15 logged a Sept 30 entry into the Oct partition — My Hours shows it, so amend must be allowed', () => {
    seed('NEW', 'J-NEL', '2026-09-30');
    var item = { queue_id: 'Q-LATE', payload_json: JSON.stringify({
      actor_code: 'NEW', job_number: 'J-NEL', work_date: '2026-09-30',
      original_hours: 4, new_hours: 3, reason: 'test' }) };
    expect(() => WorkLogCorrectionHandler.handleAmend(item, SANDY)).not.toThrow();
  });

  test('PM (ALL scope) is unchanged — can amend anyone', () => {
    seed('BCH', 'J-SBS');
    expect(() => WorkLogCorrectionHandler.handleAmend(amend('BCH', 'J-SBS'), actor('PM', 'SGO'))).not.toThrow();
  });
});
