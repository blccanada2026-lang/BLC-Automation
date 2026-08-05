/**
 * partition-header-integrity-monitor.test.js
 *
 * Covers: (1) runPartitionHeaderIntegrityCheck() now returns a
 * structured result in addition to its existing console logging, so a
 * caller can act on it programmatically; (2) the new daily monitor job
 * that alerts (email) when a BLANK header is found — the actively
 * dangerous case this session's Aug 2026 incident was exactly this,
 * undetected for 4 days because this check only ever ran manually.
 * Deliberately does NOT alert on mismatch/unknown findings — those were
 * separately confirmed latent/harmless (2026-07-27 full PROD scan,
 * PROJECT_MEMORY.md), and alerting on them would be noise without being
 * actionable.
 */

const fs   = require('fs');
const path = require('path');

function loadSrc(relPath) {
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

function makeMockSheet(name, opts) {
  opts = opts || {};
  return {
    getName:       function () { return name; },
    getLastColumn: function () { return (opts.headerRow || []).length; },
    getRange:      function () {
      return { getValues: function () { return [opts.headerRow || []]; } };
    }
  };
}

let sheetsByName;
let scriptProps;
let triggers;
let sentEmails;

function installMocks() {
  sheetsByName = {};
  scriptProps  = {};
  triggers     = [];
  sentEmails   = [];

  global.ScriptApp = {
    getScriptId: function () { return 'TEST-SCRIPT-ID'; },
    newTrigger: function (fnName) {
      var t = { fnName: fnName, frequency: null };
      return {
        timeBased: function () {
          return {
            everyDays: function (n) { t.frequency = 'everyDays:' + n; return this; },
            atHour:    function (h) { t.atHour = h; return this; },
            create:    function () { triggers.push(t); return t; }
          };
        }
      };
    },
    getProjectTriggers: function () {
      return triggers.map(function (t) {
        return { getHandlerFunction: function () { return t.fnName; }, _ref: t };
      });
    },
    deleteTrigger: function (triggerHandle) {
      triggers = triggers.filter(function (t) { return t !== triggerHandle._ref; });
    }
  };

  global.SpreadsheetApp = {
    getActiveSpreadsheet: function () {
      return { getSheetByName: function (name) { return sheetsByName[name] || null; } };
    }
  };

  global.DAL = {
    listSheets: function () { return Object.keys(sheetsByName); }
  };

  global.RBAC = {
    ACTIONS: { PAYROLL_VIEW: 'PAYROLL_VIEW' },
    resolveActor: function (email) { return { email: email, personCode: 'TCEO', role: 'CEO' }; },
    enforcePermission: function () {}
  };

  global.SCHEMAS = {
    FACT_WORK_LOGS: ['event_id', 'job_number', 'period_id', 'event_type', 'actor_code', 'hours'],
    FACT_QC_EVENTS: ['event_id', 'job_number', 'period_id', 'event_type', 'qc_result', 'qc_session_id']
  };

  global.PropertiesService = {
    getScriptProperties: function () {
      return {
        getProperty: function (k) { return scriptProps[k] || null; },
        setProperty: function (k, v) { scriptProps[k] = v; }
      };
    }
  };

  global.MailApp = { sendEmail: function (opts) { sentEmails.push(opts); } };
  global.Utilities = { formatDate: function () { return 'MOCK-DATE'; } };
  global.Session   = { getScriptTimeZone: function () { return 'UTC'; } };
  global.Logger    = { log: function () {} };
  global.console   = console;
}

beforeEach(() => {
  installMocks();
  loadSrc('../src/12-migration/PartitionHeaderIntegrityCheck.gs');
});

describe('runPartitionHeaderIntegrityCheck() — structured return value', () => {
  test('reports clean when every partition matches canonical', () => {
    sheetsByName['FACT_WORK_LOGS|2026-08'] = makeMockSheet('FACT_WORK_LOGS|2026-08', { headerRow: global.SCHEMAS.FACT_WORK_LOGS });
    const result = runPartitionHeaderIntegrityCheck();
    expect(result.ok).toBe(true);
    expect(result.blankCount).toBe(0);
    expect(result.blankTabs).toEqual([]);
  });

  test('reports a blank header and names the tab', () => {
    sheetsByName['FACT_WORK_LOGS|2026-08'] = makeMockSheet('FACT_WORK_LOGS|2026-08', { headerRow: [] });
    const result = runPartitionHeaderIntegrityCheck();
    expect(result.ok).toBe(false);
    expect(result.blankCount).toBe(1);
    expect(result.blankTabs).toEqual(['FACT_WORK_LOGS|2026-08']);
  });

  test('reports a mismatch separately from blank, ok stays true (mismatches are not the alerting condition)', () => {
    sheetsByName['FACT_QC_EVENTS|2026-04'] = makeMockSheet('FACT_QC_EVENTS|2026-04', { headerRow: global.SCHEMAS.FACT_QC_EVENTS.slice(0, -1) });
    const result = runPartitionHeaderIntegrityCheck();
    expect(result.blankCount).toBe(0);
    expect(result.mismatchCount).toBe(1);
    expect(result.mismatchTabs).toEqual(['FACT_QC_EVENTS|2026-04']);
  });
});

describe('runPartitionHeaderMonitorJob() — daily alert on blank headers only', () => {
  test('sends an alert email when a blank header is found', () => {
    sheetsByName['FACT_WORK_LOGS|2026-09'] = makeMockSheet('FACT_WORK_LOGS|2026-09', { headerRow: [] });
    runPartitionHeaderMonitorJob();
    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0].htmlBody).toMatch(/FACT_WORK_LOGS\|2026-09/);
  });

  test('does NOT send an alert when only mismatches/unknowns are found (no blanks)', () => {
    sheetsByName['FACT_QC_EVENTS|2026-04'] = makeMockSheet('FACT_QC_EVENTS|2026-04', { headerRow: global.SCHEMAS.FACT_QC_EVENTS.slice(0, -1) });
    runPartitionHeaderMonitorJob();
    expect(sentEmails.length).toBe(0);
  });

  test('does NOT send when everything is clean', () => {
    sheetsByName['FACT_WORK_LOGS|2026-08'] = makeMockSheet('FACT_WORK_LOGS|2026-08', { headerRow: global.SCHEMAS.FACT_WORK_LOGS });
    runPartitionHeaderMonitorJob();
    expect(sentEmails.length).toBe(0);
  });

  test('respects the alert cooldown — a second run within the window does not re-send', () => {
    sheetsByName['FACT_WORK_LOGS|2026-09'] = makeMockSheet('FACT_WORK_LOGS|2026-09', { headerRow: [] });
    runPartitionHeaderMonitorJob();
    runPartitionHeaderMonitorJob();
    expect(sentEmails.length).toBe(1);
  });

  test('a manual run with forceSend=true bypasses the cooldown', () => {
    sheetsByName['FACT_WORK_LOGS|2026-09'] = makeMockSheet('FACT_WORK_LOGS|2026-09', { headerRow: [] });
    runPartitionHeaderMonitorJob();
    runPartitionHeaderMonitorJob(true);
    expect(sentEmails.length).toBe(2);
  });
});

describe('trigger install/remove — idempotent', () => {
  test('runInstallPartitionHeaderMonitorTrigger() installs exactly one trigger, even if run twice', () => {
    runInstallPartitionHeaderMonitorTrigger();
    runInstallPartitionHeaderMonitorTrigger();
    const matching = triggers.filter(function (t) { return t.fnName === 'runPartitionHeaderMonitorJob'; });
    expect(matching.length).toBe(1);
  });

  test('runRemovePartitionHeaderMonitorTrigger() removes it', () => {
    runInstallPartitionHeaderMonitorTrigger();
    runRemovePartitionHeaderMonitorTrigger();
    const matching = triggers.filter(function (t) { return t.fnName === 'runPartitionHeaderMonitorJob'; });
    expect(matching.length).toBe(0);
  });
});
