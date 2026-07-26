/**
 * gas-v3-staff-mocks.js
 *
 * Minimal fakes for the V3 (src/) DAL-based GAS globals, scoped to what
 * Task 2 (supervisor_code effective-dating) needs: DIM_STAFF_ROSTER
 * (non-partitioned), RBAC, Logger, Identifiers. Distinct from the legacy
 * V2 tests/gas-mocks.js (fakes the root-level system) and from the
 * bonus-run layer's tests/gas-v3-mocks.js (not present on this branch —
 * that layer wasn't part of the promoted aggregation fix-set).
 *
 * DAL.updateWhere is included here (not needed by the aggregation
 * fix-set's mocks) because changeSupervisor() closes out the old roster
 * row in place before appending the new one.
 */

function makeV3StaffMocks() {
  var store = {}; // tableName -> array of row objects (DIM_STAFF_ROSTER is not partitioned)

  function readAll(tableName) {
    return (store[tableName] || []).slice();
  }

  function readWhere(tableName, conditions) {
    return readAll(tableName).filter(function (row) {
      return Object.keys(conditions).every(function (k) { return row[k] === conditions[k]; });
    });
  }

  function appendRow(tableName, row) {
    if (!store[tableName]) store[tableName] = [];
    store[tableName].push(Object.assign({}, row));
  }

  function appendRows(tableName, rows) {
    rows.forEach(function (r) { appendRow(tableName, r); });
  }

  function updateWhere(tableName, conditions, updates) {
    var rows = store[tableName] || [];
    var updated = 0;
    for (var i = 0; i < rows.length; i++) {
      var matches = Object.keys(conditions).every(function (k) { return rows[i][k] === conditions[k]; });
      if (matches) {
        Object.assign(rows[i], updates);
        updated++;
      }
    }
    // Matches the real DAL.updateWhere's return shape ({ updated: N }, not a
    // raw number) — scd2FieldChange_ checks .updated, and a shape mismatch
    // here would make every existing test pass for the wrong reason.
    return { updated: updated };
  }

  var idCounter = 0;
  function generateId() {
    idCounter += 1;
    return 'ID-' + idCounter;
  }

  return {
    store: store,
    DAL: {
      readAll:    function (tableName) { return readAll(tableName); },
      readWhere:  function (tableName, conditions) { return readWhere(tableName, conditions); },
      appendRow:  function (tableName, row) { return appendRow(tableName, row); },
      appendRows: function (tableName, rows) { return appendRows(tableName, rows); },
      updateWhere: function (tableName, conditions, updates) { return updateWhere(tableName, conditions, updates); }
    },
    Config: {
      TABLES: { DIM_STAFF_ROSTER: 'DIM_STAFF_ROSTER' }
    },
    RBAC: {
      ACTIONS: {
        ADMIN_CONFIG: 'ADMIN_CONFIG',
        PAYROLL_RUN:  'PAYROLL_RUN',
        PAYROLL_VIEW: 'PAYROLL_VIEW',
        RATE_STAFF:   'RATE_STAFF'
      },
      resolveActor: function (email) { return { email: email, role: 'CEO', personCode: 'TCEO' }; },
      enforcePermission: function () { return true; },
      enforceFinancialAccess: function () { return true; }
    },
    Logger: {
      info: function () {}, warn: function () {}, error: function () {}
    },
    Identifiers: { generateId: generateId },
    Session: {
      getScriptTimeZone: function () { return 'UTC'; }
    },
    Utilities: {
      // Not a real formatter — sufficient for the yyyy-MM-dd pattern this
      // codebase's toIsoDate_() helpers actually use.
      formatDate: function (date, tz, pattern) {
        var y  = date.getUTCFullYear();
        var m  = String(date.getUTCMonth() + 1); if (m.length < 2) m = '0' + m;
        var d  = String(date.getUTCDate());      if (d.length < 2) d = '0' + d;
        if (pattern === 'yyyy-MM-dd') return y + '-' + m + '-' + d;
        return y + '-' + m + '-' + d;
      }
    }
  };
}

function installV3StaffMocks() {
  var mocks = makeV3StaffMocks();
  global.DAL          = mocks.DAL;
  global.Config        = mocks.Config;
  global.RBAC          = mocks.RBAC;
  global.Logger        = mocks.Logger;
  global.Identifiers   = mocks.Identifiers;
  global.Session       = mocks.Session;
  global.Utilities     = mocks.Utilities;
  return mocks;
}

module.exports = { makeV3StaffMocks: makeV3StaffMocks, installV3StaffMocks: installV3StaffMocks };
