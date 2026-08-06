/**
 * generate-timesheet-pdf.test.js
 *
 * Tests for GenerateTimesheetPdf.gs — the timesheet-for-any-period
 * feature (CEO/HR_ACCOUNTING only, RBAC TIMESHEET_GENERATE). Loads the
 * REAL ClientTimesheetEngine.gs + GenerateTimesheet.gs alongside the
 * new file (same integration-style pattern as generate-timesheet.test.js)
 * so this exercises the actual HTML/PDF pipeline — including the
 * ISO-string-to-Date reshape that buildTimesheetHtml_ requires — rather
 * than mocking the collaborators away. DriveApp/Utilities/MimeType are
 * mocked since PDF export is a GAS-only Drive side effect.
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

  global.DAL = {
    readAll: function (t, opts) { return readAll(t, opts); }
  };
  global.Config = {
    TABLES: {
      FACT_WORK_LOGS:        'FACT_WORK_LOGS',
      VW_JOB_CURRENT_STATE:  'VW_JOB_CURRENT_STATE',
      DIM_CLIENT_MASTER:     'DIM_CLIENT_MASTER',
      DIM_PRODUCT_RATES:     'DIM_PRODUCT_RATES',
      DIM_CLIENT_RATES:      'DIM_CLIENT_RATES',
      DIM_STAFF_ROSTER:      'DIM_STAFF_ROSTER'
    }
  };
  global.Logger = { info: function () {}, warn: function () {}, error: function () {} };
  var idCounter = 0;
  global.Identifiers = { generateId: function () { idCounter++; return 'RUN-' + idCounter; } };
  global.HealthMonitor = { isApproachingLimit: function () { return false; } };

  var addViewerCalls = [];
  store.__addViewerCalls = addViewerCalls;

  // Drive mocks for ClientTimesheetEngine.exportHtmlAsPdf_. createFile is
  // called twice (HTML temp file, then the converted PDF file) — the
  // second call's blob is tagged __pdf so getUrl() can return a
  // filename-derived URL for the *actual* PDF, not the temp HTML.
  global.Utilities = {
    newBlob: function (content, mime, name) { return { __pdf: false, content: content, mime: mime, name: name }; }
  };
  global.MimeType = { PDF: 'PDF' };
  global.DriveApp = {
    createFile: function (blob) {
      var isPdf = blob && blob.__pdf === true;
      return {
        getAs: function () { return { setName: function (name) { return { __pdf: true, name: name }; } }; },
        setTrashed: function () {},
        addViewer: function (email) { addViewerCalls.push({ fileName: blob.name, email: email }); },
        getUrl: function () { return isPdf ? ('https://drive.example/' + blob.name) : 'https://drive.example/temp'; }
      };
    }
  };

  return store;
}

let store;

beforeEach(() => {
  store = installMocks();
  loadSrc('../src/00-foundation/Constants.gs');
  loadSrc('../src/06-handlers/WorkLogExclusion.gs');
  loadSrc('../src/11-reporting/ClientTimesheetEngine.gs');
  loadSrc('../src/11-reporting/GenerateTimesheet.gs');
  loadSrc('../src/11-reporting/GenerateTimesheetPdf.gs');
});

function seedJobs(rows) {
  store['VW_JOB_CURRENT_STATE'] = rows.map(r => Object.assign({
    job_number: '', client_code: '', job_type: '', product_code: '',
    current_state: 'IN_PROGRESS', client_job_ref: ''
  }, r));
}

function seedWorkLogs(periodId, rows) {
  var key = 'FACT_WORK_LOGS|' + periodId;
  store[key] = rows.map(r => Object.assign({
    event_type: 'WORK_LOG_SUBMITTED', notes: ''
  }, r));
}

function seedClients(rows) {
  store['DIM_CLIENT_MASTER'] = rows.map(r => Object.assign({
    client_code: '', client_name: '', active: 'TRUE'
  }, r));
}

describe('generateTimesheetPdf(client, startDate, endDate)', () => {
  test('returns null and does not touch Drive when there are no billable entries in range', () => {
    seedJobs([{ job_number: 'BLC-001', client_code: 'ACME' }]);
    seedWorkLogs('2026-08', []);
    const createFileSpy = jest.spyOn(global.DriveApp, 'createFile');

    const result = generateTimesheetPdf('ACME', '2026-08-01', '2026-08-20');

    expect(result).toBeNull();
    expect(createFileSpy).not.toHaveBeenCalled();
  });

  test('happy path: generates a PDF, returns driveUrl/entries/total_hours, filename encodes client + range', () => {
    seedJobs([{ job_number: 'BLC-001', client_code: 'ACME', product_code: 'ROOF_TRUSS', client_job_ref: 'REF-1' }]);
    seedWorkLogs('2026-08', [
      { job_number: 'BLC-001', actor_code: 'SYR', hours: 3, work_date: '2026-08-05' },
      { job_number: 'BLC-001', actor_code: 'SYR', hours: 2, work_date: '2026-08-10' }
    ]);
    seedClients([{ client_code: 'ACME', client_name: 'Acme Corp', active: 'TRUE' }]);

    const result = generateTimesheetPdf('ACME', '2026-08-01', '2026-08-20');

    expect(result).not.toBeNull();
    expect(result.client).toBe('ACME');
    expect(result.entries).toBe(1); // netted: same job+designer -> one line
    expect(result.total_hours).toBe(5);
    expect(result.start_date).toBe('2026-08-01');
    expect(result.end_date).toBe('2026-08-20');
    expect(result.driveUrl).toBe(
      'https://drive.example/BLC-Timesheet_ACME_2026-08-01_to_2026-08-20.pdf'
    );
  });

  test('falls back to the client code as display name when the client is not in DIM_CLIENT_MASTER', () => {
    seedJobs([{ job_number: 'BLC-002', client_code: 'UNKNOWNCO' }]);
    seedWorkLogs('2026-08', [{ job_number: 'BLC-002', actor_code: 'SYR', hours: 1, work_date: '2026-08-03' }]);
    // no seedClients() call — DIM_CLIENT_MASTER stays empty

    const result = generateTimesheetPdf('UNKNOWNCO', '2026-08-01', '2026-08-20');

    expect(result).not.toBeNull();
    expect(result.driveUrl).toContain('UNKNOWNCO');
  });

  test('a date range spanning two calendar months still produces one combined PDF', () => {
    seedJobs([{ job_number: 'BLC-003', client_code: 'ACME' }]);
    seedWorkLogs('2026-07', [{ job_number: 'BLC-003', actor_code: 'SYR', hours: 4, work_date: '2026-07-30' }]);
    seedWorkLogs('2026-08', [{ job_number: 'BLC-003', actor_code: 'SYR', hours: 4, work_date: '2026-08-02' }]);

    const result = generateTimesheetPdf('ACME', '2026-07-25', '2026-08-05');

    expect(result).not.toBeNull();
    expect(result.total_hours).toBe(8);
  });
});

describe('generateAllTimesheetPdfsForRange(startDate, endDate)', () => {
  test('loops every active client, skips inactive ones, and omits clients with zero entries', () => {
    seedClients([
      { client_code: 'ACME',   client_name: 'Acme',   active: 'TRUE' },
      { client_code: 'INACTIVE', client_name: 'Gone', active: 'FALSE' },
      { client_code: 'EMPTY',  client_name: 'Empty',  active: 'TRUE' }
    ]);
    seedJobs([
      { job_number: 'BLC-010', client_code: 'ACME' },
      { job_number: 'BLC-011', client_code: 'INACTIVE' }
    ]);
    seedWorkLogs('2026-08', [
      { job_number: 'BLC-010', actor_code: 'SYR', hours: 2, work_date: '2026-08-04' },
      { job_number: 'BLC-011', actor_code: 'SYR', hours: 2, work_date: '2026-08-04' }
    ]);

    const outcome = generateAllTimesheetPdfsForRange('2026-08-01', '2026-08-20');

    const clients = outcome.results.map(r => r.client).sort();
    expect(clients).toEqual(['ACME']); // INACTIVE skipped by active filter, EMPTY skipped for zero entries
    expect(outcome.truncated).toBe(false);
    expect(outcome.remainingClients).toEqual([]);
  });

  test('returns an empty results array when no clients are configured', () => {
    const outcome = generateAllTimesheetPdfsForRange('2026-08-01', '2026-08-20');
    expect(outcome.results).toEqual([]);
    expect(outcome.truncated).toBe(false);
  });

  test('RULE P1: stops before starting a client once HealthMonitor reports approaching the limit, reports what was skipped', () => {
    seedClients([
      { client_code: 'ACME', client_name: 'Acme', active: 'TRUE' },
      { client_code: 'BETA', client_name: 'Beta', active: 'TRUE' }
    ]);
    seedJobs([
      { job_number: 'BLC-020', client_code: 'ACME' },
      { job_number: 'BLC-021', client_code: 'BETA' }
    ]);
    seedWorkLogs('2026-08', [
      { job_number: 'BLC-020', actor_code: 'SYR', hours: 1, work_date: '2026-08-04' },
      { job_number: 'BLC-021', actor_code: 'SYR', hours: 1, work_date: '2026-08-04' }
    ]);
    global.HealthMonitor.isApproachingLimit = jest.fn().mockReturnValue(true);

    const outcome = generateAllTimesheetPdfsForRange('2026-08-01', '2026-08-20');

    expect(outcome.results).toEqual([]);
    expect(outcome.truncated).toBe(true);
    expect(outcome.remainingClients).toEqual(['ACME', 'BETA']);
  });

  test('threads viewerEmail through to Drive sharing for every generated PDF', () => {
    seedClients([{ client_code: 'ACME', client_name: 'Acme', active: 'TRUE' }]);
    seedJobs([{ job_number: 'BLC-022', client_code: 'ACME' }]);
    seedWorkLogs('2026-08', [{ job_number: 'BLC-022', actor_code: 'SYR', hours: 1, work_date: '2026-08-04' }]);

    generateAllTimesheetPdfsForRange('2026-08-01', '2026-08-20', 'ceo@blclotus.com');

    expect(store.__addViewerCalls).toEqual([
      { fileName: 'BLC-Timesheet_ACME_2026-08-01_to_2026-08-20.pdf', email: 'ceo@blclotus.com' }
    ]);
  });
});

describe('generateTimesheetPdf — viewerEmail sharing', () => {
  test('does not call addViewer when viewerEmail is omitted (Apps-Script-editor callers keep prior behavior)', () => {
    seedJobs([{ job_number: 'BLC-023', client_code: 'ACME' }]);
    seedWorkLogs('2026-08', [{ job_number: 'BLC-023', actor_code: 'SYR', hours: 1, work_date: '2026-08-04' }]);

    generateTimesheetPdf('ACME', '2026-08-01', '2026-08-20');

    expect(store.__addViewerCalls).toEqual([]);
  });
});
