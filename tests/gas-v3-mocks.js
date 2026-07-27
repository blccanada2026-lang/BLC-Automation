/**
 * gas-v3-mocks.js
 *
 * Minimal fakes for the V3 (src/) DAL-based GAS globals — DAL,
 * Config.TABLES, RBAC, Logger, Identifiers, CacheService, Utilities,
 * HealthMonitor. This repo's existing tests/gas-mocks.js fakes the
 * *legacy V2* root-level system (SpreadsheetApp-shaped, Code.js/
 * PayrollEngine.js) — a different codebase living in the same repo
 * (see TEST_EVIDENCE.md, Phase 0's "structural discovery"). Nothing in
 * V3 has had Jest coverage before this file.
 *
 * Deliberately minimal: only what BonusPeriodEngine.gs/BonusPeriodCommit.gs
 * need, not a general-purpose DAL simulator. Each test resets the store
 * via resetV3Mocks().
 */

function makeV3Mocks() {
  var store = {}; // sheetKey -> array of row objects. sheetKey is 'TABLE' for
                   // non-partitioned tables, 'TABLE|periodId' for partitioned
                   // ones (mirrors real DAL's 'TABLE|YYYY-MM' tab naming) —
                   // opts.periodId selects the key; omitted opts == old flat
                   // per-table behaviour, so existing FACT_QUARTERLY_BONUS
                   // callers (never pass periodId) are unaffected.

  function sheetKey_(tableName, opts) {
    return (opts && opts.periodId) ? (tableName + '|' + opts.periodId) : tableName;
  }

  function readAll(tableName, opts) {
    return (store[sheetKey_(tableName, opts)] || []).slice();
  }

  function readWhere(tableName, conditions, opts) {
    return readAll(tableName, opts).filter(function (row) {
      return Object.keys(conditions).every(function (k) { return row[k] === conditions[k]; });
    });
  }

  function appendRow(tableName, row, opts) {
    var key = sheetKey_(tableName, opts);
    if (!store[key]) store[key] = [];
    store[key].push(Object.assign({}, row));
  }

  function appendRows(tableName, rows, opts) {
    rows.forEach(function (r) { appendRow(tableName, r, opts); });
  }

  function listSheets() {
    return Object.keys(store);
  }

  var idCounter = 0;
  function generateId() {
    idCounter += 1;
    return 'ID-' + idCounter;
  }

  var cacheStore = {};

  return {
    store: store,
    DAL: {
      readAll: function (tableName, opts) { return readAll(tableName, opts); },
      readWhere: function (tableName, conditions, opts) { return readWhere(tableName, conditions, opts); },
      appendRow: function (tableName, row, opts) { return appendRow(tableName, row, opts); },
      appendRows: function (tableName, rows, opts) { return appendRows(tableName, rows, opts); },
      listSheets: function () { return listSheets(); }
    },
    Config: {
      TABLES: { FACT_QUARTERLY_BONUS: 'FACT_QUARTERLY_BONUS', FACT_WORK_LOGS: 'FACT_WORK_LOGS' }
    },
    RBAC: {
      ACTIONS: { PAYROLL_RUN: 'PAYROLL_RUN', PAYROLL_VIEW: 'PAYROLL_VIEW' },
      resolveActor: function (email) { return { email: email, role: 'CEO', personCode: 'TCEO' }; },
      enforcePermission: function () { return true; },
      enforceFinancialAccess: function () { return true; }
    },
    Logger: {
      info: function () {}, warn: function () {}, error: function () {}
    },
    Identifiers: { generateId: generateId },
    HealthMonitor: { isApproachingLimit: function () { return false; } },
    CacheService: {
      getScriptCache: function () {
        return {
          put: function (key, value) { cacheStore[key] = value; },
          get: function (key) { return Object.prototype.hasOwnProperty.call(cacheStore, key) ? cacheStore[key] : null; },
          remove: function (key) { delete cacheStore[key]; }
        };
      },
      _cacheStore: cacheStore
    },
    Utilities: {
      DigestAlgorithm: { MD5: 'MD5' },
      // Not a real hash — deterministic, sufficient for equality checks in tests.
      computeDigest: function (algo, str) {
        var bytes = [];
        for (var i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i) % 256);
        return bytes.slice(0, 16);
      }
    }
  };
}

function installV3Mocks() {
  var mocks = makeV3Mocks();
  global.DAL          = mocks.DAL;
  global.Config        = mocks.Config;
  global.RBAC          = mocks.RBAC;
  global.Logger        = mocks.Logger;
  global.Identifiers   = mocks.Identifiers;
  global.HealthMonitor = mocks.HealthMonitor;
  global.CacheService  = mocks.CacheService;
  global.Utilities     = mocks.Utilities;
  return mocks;
}

module.exports = { makeV3Mocks: makeV3Mocks, installV3Mocks: installV3Mocks };
