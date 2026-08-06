/**
 * job-create-handler-recent-duplicate.test.js
 *
 * Prevention fix for the BLC-00891/BLC-00892 duplicate job creation
 * (Sarty, PM, 2026-08-05): JobCreateHandler's existing idempotency is
 * keyed on queue_id alone, which cannot catch two genuinely separate
 * submissions (each gets a fresh queue_id — confirmed via
 * JobDuplicateTimingCheck.gs, 16.4 seconds apart). This adds a
 * content-based safety net: block a new JOB_CREATE if an identical one
 * (same client + product + description + submitter + intended
 * designer) was created in the last 60 seconds.
 *
 * Deliberately scoped to when client_job_ref (a real, specific
 * description) is present and non-blank — two blank-description jobs
 * for the same client/product by the same PM within a minute is a much
 * weaker duplicate signal and a real, legitimate PM workflow.
 *
 * Designer is also part of the match — confirmed real business pattern
 * (2026-08-05): the same client_job_ref can legitimately cover multiple
 * distinct scopes (e.g. one ref spanning a roof job and a floor job for
 * some clients), each sometimes assigned to a different designer.
 * product_code already distinguishes most of those; requiring the same
 * designer too catches the remaining case. The designer is resolved via
 * _intended_designer (portal_createJob's own hint field, Portal.gs —
 * see resolveIntendedDesigner_'s own header comment for why
 * cleanPayload.allocated_to alone is NOT reliable here), with a
 * fallback to cleanPayload.allocated_to for any other caller that sets
 * it directly.
 */

const fs   = require('fs');
const path = require('path');

function loadSrc(relPath) {
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

function installMocks() {
  var store = {
    FACT_JOB_EVENTS: [], VW_JOB_CURRENT_STATE: [],
    DIM_SEQUENCE_COUNTERS: [{ counter_name: 'JOB_NUMBER', current_value: 890 }]
  };
  var idempotencyMarks = {};

  function readWhere(tableName, conditions) {
    return (store[tableName] || []).filter(function (row) {
      return Object.keys(conditions).every(function (k) { return row[k] === conditions[k]; });
    });
  }

  global.DAL = {
    readWhere: readWhere,
    readAll: function (t) { return (store[t] || []).slice(); },
    appendRow: function (t, row) { if (!store[t]) store[t] = []; store[t].push(Object.assign({}, row)); },
    updateWhere: function (t, conditions, updates) {
      var rows = store[t] || [];
      var updated = 0;
      rows.forEach(function (r) {
        if (Object.keys(conditions).every(function (k) { return r[k] === conditions[k]; })) {
          Object.assign(r, updates); updated++;
        }
      });
      return { updated: updated };
    },
    ensurePartition: function () { return { created: false }; }
  };
  global.Config = {
    TABLES: { FACT_JOB_EVENTS: 'FACT_JOB_EVENTS', VW_JOB_CURRENT_STATE: 'VW_JOB_CURRENT_STATE', DIM_SEQUENCE_COUNTERS: 'DIM_SEQUENCE_COUNTERS' },
    STATES: { ALLOCATED: 'ALLOCATED', INTAKE_RECEIVED: 'INTAKE_RECEIVED' }
  };
  global.Constants = { EVENT_TYPES: { JOB_CREATED: 'JOB_CREATED' } };
  global.RBAC = {
    ACTIONS: { JOB_CREATE: 'JOB_CREATE' },
    enforcePermission: function () {}
  };
  global.ValidationEngine = {
    validate: function (schema, payload) { return Object.assign({}, payload); }
  };
  global.IdempotencyEngine = {
    checkAndMark: function (key) {
      if (idempotencyMarks[key]) return false;
      idempotencyMarks[key] = true;
      return true;
    },
    clear: function (key) { delete idempotencyMarks[key]; }
  };
  global.Identifiers = {
    generateId: function () { return 'EVT-' + Math.random().toString(36).slice(2); },
    generateCurrentPeriodId: function () { return '2026-08'; },
    generateJobId: function (seq) { return 'BLC-' + String(seq).padStart(5, '0'); },
    buildIdempotencyKey: function () { return Array.prototype.slice.call(arguments).join('|'); }
  };
  global.Logger = { info: function () {}, warn: function () {}, error: function () {} };

  return store;
}

let store;
let _now;

function mockNow(iso) {
  _now = new Date(iso).getTime();
  global.Date.now = function () { return _now; };
}

beforeEach(() => {
  store = installMocks();
  loadSrc('../src/06-handlers/JobCreateHandler.gs');
  mockNow('2026-08-05T16:49:00.000Z');
});

function actor() { return { email: 'sarty@blclotus.com', personCode: 'SGO', role: 'PM' }; }

/** Matches what portal_createJob() (Portal.gs) actually sends — designer via _intended_designer, never allocated_to. */
function payload(overrides) {
  return Object.assign({
    client_code: 'SBS', job_type: 'DESIGN', product_code: 'ROOF_TRUSS',
    quantity: 1, client_job_ref: '2608-9955 Litchfield Rev 1', _intended_designer: 'SYR'
  }, overrides || {});
}

function queueItem(p) {
  return { queue_id: 'Q-' + Math.random().toString(36).slice(2), payload_json: JSON.stringify(p) };
}

/** A prior JOB_CREATED event row, as actually stored — payload_json included, since that's what the designer comparison reads. */
function priorEvent(overrides) {
  var base = {
    event_type: 'JOB_CREATED', client_code: 'SBS', product_code: 'ROOF_TRUSS',
    client_job_ref: '2608-9955 Litchfield Rev 1', actor_code: 'SGO',
    timestamp: '2026-08-05T16:48:41.471Z', job_number: 'BLC-00891'
  };
  var merged = Object.assign(base, overrides || {});
  if (!merged.payload_json) {
    merged.payload_json = JSON.stringify({ _intended_designer: overrides && 'designer' in overrides ? overrides.designer : 'SYR' });
  }
  return merged;
}

describe('JobCreateHandler.handle() — recent content-duplicate guard', () => {
  test('blocks a second create with identical client/product/description/submitter/designer within 60 seconds', () => {
    store.FACT_JOB_EVENTS.push(priorEvent());

    expect(() => JobCreateHandler.handle(queueItem(payload()), actor()))
      .toThrow(/similar job|duplicate|already created/i);
  });

  test('does NOT block when the prior job was created more than 60 seconds ago', () => {
    store.FACT_JOB_EVENTS.push(priorEvent({ timestamp: '2026-08-05T16:47:00.000Z' })); // 120s before mockNow

    expect(() => JobCreateHandler.handle(queueItem(payload()), actor())).not.toThrow();
  });

  test('does NOT block when client_job_ref is blank on the new submission — weak signal, legitimate bulk-create workflow', () => {
    store.FACT_JOB_EVENTS.push(priorEvent({ client_job_ref: '' }));

    expect(() => JobCreateHandler.handle(queueItem(payload({ client_job_ref: '' })), actor())).not.toThrow();
  });

  test('does NOT block a different submitter creating the same-looking job', () => {
    store.FACT_JOB_EVENTS.push(priorEvent({ actor_code: 'OTHER_PM' }));

    expect(() => JobCreateHandler.handle(queueItem(payload()), actor())).not.toThrow();
  });

  test('does NOT block a different client or product', () => {
    store.FACT_JOB_EVENTS.push(priorEvent({ client_code: 'MATIX' }));

    expect(() => JobCreateHandler.handle(queueItem(payload()), actor())).not.toThrow();
  });

  test('genuinely new (no prior matching event) creates successfully', () => {
    const result = JobCreateHandler.handle(queueItem(payload()), actor());
    expect(result).toMatch(/^BLC-/);
    expect(store.FACT_JOB_EVENTS.some(e => e.event_type === 'JOB_CREATED')).toBe(true);
  });

  describe('designer-aware matching (2026-08-05 correction — same client_job_ref can legitimately span multiple designers)', () => {
    test('does NOT block the same client/product/description when assigned to a DIFFERENT designer — legitimate split-across-designers workflow (e.g. MATIX)', () => {
      store.FACT_JOB_EVENTS.push(priorEvent({ designer: 'ALICE_DESIGNER' }));

      expect(() => JobCreateHandler.handle(queueItem(payload({ _intended_designer: 'BOB_DESIGNER' })), actor())).not.toThrow();
    });

    test('DOES block when client/product/description/submitter AND designer all match — the actual confirmed incident shape', () => {
      store.FACT_JOB_EVENTS.push(priorEvent({ designer: 'SYR' }));

      expect(() => JobCreateHandler.handle(queueItem(payload({ _intended_designer: 'SYR' })), actor()))
        .toThrow(/similar job|duplicate|already created/i);
    });

    test('falls back to cleanPayload.allocated_to when _intended_designer is absent (non-portal callers, e.g. SBS intake)', () => {
      store.FACT_JOB_EVENTS.push(priorEvent({
        payload_json: JSON.stringify({ allocated_to: 'SYR' }) // real schema field, no _intended_designer hint
      }));

      expect(() => JobCreateHandler.handle(queueItem(payload({ _intended_designer: undefined, allocated_to: 'SYR' })), actor()))
        .toThrow(/similar job|duplicate|already created/i);
    });

    test('two unassigned (no designer either way) submissions of the same description still block — no split-workflow ambiguity when neither has a designer', () => {
      store.FACT_JOB_EVENTS.push(priorEvent({ designer: '' }));

      expect(() => JobCreateHandler.handle(queueItem(payload({ _intended_designer: '' })), actor()))
        .toThrow(/similar job|duplicate|already created/i);
    });
  });
});
