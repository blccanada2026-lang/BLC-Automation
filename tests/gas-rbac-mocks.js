/**
 * gas-rbac-mocks.js
 *
 * Minimal fakes for loading the REAL src/02-security/RBAC.gs source
 * directly (not a stubbed-out RBAC object, unlike gas-v3-staff-mocks.js
 * and gas-v3-mocks.js, which both mock RBAC away for tests that only
 * need it to not throw). This harness exists because Phase B1 needs to
 * test RBAC.gs's own matrix values and enforceFinancialAccess() logic,
 * which a stubbed RBAC can't exercise.
 *
 * RBAC.gs's only external dependencies (confirmed via
 * `grep -noE "\b(DAL|Config|Logger)\.[a-zA-Z_]+" src/02-security/RBAC.gs`):
 *   DAL.readWhere, DAL.readAll — DIM_STAFF_ROSTER lookup (lookupActor_)
 *   Config.isDev, Config.TABLES.DIM_STAFF_ROSTER
 *   Logger.warn, Logger.log (native GAS fallback in emitDenied_)
 */

function makeRbacMocks() {
  var store = {}; // tableName -> array of row objects

  function readAll(tableName) {
    return (store[tableName] || []).slice();
  }

  function readWhere(tableName, conditions) {
    return readAll(tableName).filter(function (row) {
      return Object.keys(conditions).every(function (k) { return row[k] === conditions[k]; });
    });
  }

  return {
    store: store,
    DAL: {
      readAll:   function (tableName) { return readAll(tableName); },
      readWhere: function (tableName, conditions) { return readWhere(tableName, conditions); }
    },
    Config: {
      isDev: function () { return false; }, // PROD-shaped by default — tests opt into DEV explicitly
      TABLES: {
        DIM_STAFF_ROSTER: 'DIM_STAFF_ROSTER',
        REF_ACCOUNT_DESIGNER_MAP: 'REF_ACCOUNT_DESIGNER_MAP'
      }
    },
    Logger: {
      warn: function () {},
      log:  function () {}
    }
  };
}

function installRbacMocks() {
  var mocks = makeRbacMocks();
  global.DAL    = mocks.DAL;
  global.Config = mocks.Config;
  global.Logger = mocks.Logger;
  return mocks;
}

/** Seeds a DIM_STAFF_ROSTER row for lookupActor_() to resolve. */
function seedRosterActor(mocks, row) {
  if (!mocks.store['DIM_STAFF_ROSTER']) mocks.store['DIM_STAFF_ROSTER'] = [];
  mocks.store['DIM_STAFF_ROSTER'].push(Object.assign({
    person_code: '', name: '', email: '', role: 'DESIGNER', active: 'TRUE'
  }, row));
}

module.exports = { makeRbacMocks: makeRbacMocks, installRbacMocks: installRbacMocks, seedRosterActor: seedRosterActor };
