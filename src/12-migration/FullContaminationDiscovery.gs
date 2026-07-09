// ============================================================
// FullContaminationDiscovery.gs — BLC Nexus T12 Migration
// src/12-migration/FullContaminationDiscovery.gs
//
// PROD contamination discovery — read-only, console output only.
// One-off deep scan (broader match criteria than the recurring
// runProdContaminationCheck() in ExecutionHealthMonitor.gs) plus a
// static report on whether the CEO dashboard's Load Balance,
// Quality Rates, and Team Hours panels would surface any of it.
//
// HOW TO RUN (Apps Script editor):
//   runFullContaminationDiscovery()
//
// Scans:
//   1. DIM_STAFF_ROSTER  — person_code in {DS1,QC1,RND,NTL}, or
//      name contains "Test", or email contains "test.blc.internal",
//      "designer@blclotus.com", or "nobody@notinrbac.com".
//   2. FACT_WORK_LOGS    — current + previous month partitions only.
//      actor_code in {DS1,QC1,RND,NTL}. Count + total hours.
//   3. VW_JOB_CURRENT_STATE — client_code = 'TEST-CLIENT' or
//      'NORSPAN', or allocated_to containing a test email. Count +
//      states.
//   4. CEO dashboard exposure — reports which PortalData.gs
//      functions power Load Balance / Quality Rates / Team Hours,
//      and whether each filters DIM_STAFF_ROSTER.active = true.
//      (Static findings from source review, not runtime
//      introspection — Apps Script has no reflection into another
//      module's closures.)
//
// No writes. Safe to run repeatedly.
// ============================================================

var FCD_TEST_PERSON_CODES = { DS1: true, QC1: true, RND: true, NTL: true };
var FCD_TEST_CLIENT_CODES = { 'TEST-CLIENT': true, 'NORSPAN': true };
var FCD_TEST_EMAIL_NEEDLES = [
  'test.blc.internal',
  'designer@blclotus.com',
  'nobody@notinrbac.com'
];

function fcdContainsTestEmail_(value) {
  var v = String(value || '').toLowerCase();
  for (var i = 0; i < FCD_TEST_EMAIL_NEEDLES.length; i++) {
    if (v.indexOf(FCD_TEST_EMAIL_NEEDLES[i]) !== -1) return true;
  }
  return false;
}

/** Discovers FACT_WORK_LOGS|YYYY-MM partition tab names, sorted ascending. */
function fcdDiscoverWorkLogPartitions_() {
  var sheets  = DAL.listSheets();
  var prefix  = Config.TABLES.FACT_WORK_LOGS + '|';
  var periods = [];
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i];
    if (name.indexOf(prefix) === 0) {
      var period = name.substring(prefix.length);
      if (/^\d{4}-\d{2}$/.test(period)) periods.push(period);
    }
  }
  periods.sort();
  return periods;
}

function runFullContaminationDiscovery() {
  var MODULE = 'FullContaminationDiscovery';

  console.log('=== PROD Contamination Discovery — FULL SCAN ===');
  console.log('Read-only. No writes.');
  console.log('');

  // ── 1. DIM_STAFF_ROSTER ────────────────────────────────────
  console.log('--- 1. DIM_STAFF_ROSTER ---');
  var staffRows = [];
  try {
    staffRows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: MODULE });
  } catch (e) {
    console.log('  ERROR reading DIM_STAFF_ROSTER: ' + e.message);
  }

  var staffHits = (staffRows || []).filter(function(r) {
    var code = String(r.person_code || '').toUpperCase();
    var name = String(r.name || '');
    var email = String(r.email || '');
    return FCD_TEST_PERSON_CODES[code] ||
           name.toLowerCase().indexOf('test') !== -1 ||
           fcdContainsTestEmail_(email);
  });

  console.log('Rows scanned: ' + staffRows.length);
  console.log('Matches: ' + staffHits.length);
  console.log('');
  staffHits.forEach(function(r, i) {
    var isActive = r.active === true || String(r.active || '').toUpperCase() === 'TRUE';
    console.log('[' + (i + 1) + '] person_code=' + String(r.person_code || '') +
      ' | name=' + String(r.name || '') +
      ' | email=' + String(r.email || '') +
      ' | role=' + String(r.role || '') +
      ' | active=' + isActive);
  });
  if (staffHits.length === 0) console.log('  (none found)');
  console.log('');

  // ── 2. FACT_WORK_LOGS — current + previous month only ─────
  console.log('--- 2. FACT_WORK_LOGS (current + previous month) ---');
  var allPeriods  = fcdDiscoverWorkLogPartitions_();
  var scanPeriods = allPeriods.slice(-2);
  console.log('Partitions available: ' + allPeriods.join(', '));
  console.log('Partitions scanned: ' + scanPeriods.join(', '));
  console.log('');

  var wlCount = 0, wlHours = 0;
  var wlByCode = {}; // code -> { count, hours }
  scanPeriods.forEach(function(periodId) {
    var rows = [];
    try {
      rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: MODULE, periodId: periodId });
    } catch (e) {
      console.log('  [' + periodId + '] ERROR: ' + e.message);
      return;
    }
    rows.forEach(function(r) {
      var code = String(r.actor_code || '').toUpperCase();
      if (!FCD_TEST_PERSON_CODES[code]) return;
      var hrs = parseFloat(r.hours) || 0;
      wlCount++;
      wlHours += hrs;
      if (!wlByCode[code]) wlByCode[code] = { count: 0, hours: 0 };
      wlByCode[code].count++;
      wlByCode[code].hours += hrs;
    });
  });

  console.log('Total matching entries: ' + wlCount);
  console.log('Total hours: ' + (Math.round(wlHours * 100) / 100));
  Object.keys(wlByCode).forEach(function(code) {
    var e = wlByCode[code];
    console.log('  ' + code + ': ' + e.count + ' entrie(s), ' + (Math.round(e.hours * 100) / 100) + ' hour(s)');
  });
  if (wlCount === 0) console.log('  (none found)');
  console.log('');

  // ── 3. VW_JOB_CURRENT_STATE ─────────────────────────────────
  console.log('--- 3. VW_JOB_CURRENT_STATE ---');
  var vwRows = [];
  try {
    vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
  } catch (e) {
    console.log('  ERROR reading VW_JOB_CURRENT_STATE: ' + e.message);
  }

  var vwHits = (vwRows || []).filter(function(r) {
    var cc = String(r.client_code || '').trim();
    return FCD_TEST_CLIENT_CODES[cc] || fcdContainsTestEmail_(r.allocated_to);
  });

  var vwByState = {};
  vwHits.forEach(function(r) {
    var st = String(r.current_state || 'UNKNOWN');
    vwByState[st] = (vwByState[st] || 0) + 1;
  });

  console.log('Rows scanned: ' + vwRows.length);
  console.log('Matches: ' + vwHits.length);
  console.log('By state:');
  Object.keys(vwByState).forEach(function(st) {
    console.log('  ' + st + ': ' + vwByState[st]);
  });
  if (vwHits.length === 0) console.log('  (none found)');
  console.log('');
  console.log('Sample job_numbers (first 15):');
  vwHits.slice(0, 15).forEach(function(r) {
    console.log('  ' + String(r.job_number || '') +
      ' | client_code=' + String(r.client_code || '') +
      ' | allocated_to=' + String(r.allocated_to || '') +
      ' | state=' + String(r.current_state || ''));
  });
  if (vwHits.length > 15) console.log('  (+' + (vwHits.length - 15) + ' more)');
  console.log('');

  // ── 4. CEO dashboard exposure ───────────────────────────────
  console.log('--- 4. CEO dashboard exposure (source review, not live introspection) ---');
  console.log('');
  console.log('Team Hours       — PortalData.gs getLeaderDashboard(email), ~line 408');
  console.log('  Filters DIM_STAFF_ROSTER active=true? YES (line ~424: "exclude inactive,');
  console.log('  departed, and test actors"). Hours only aggregated for codes present in');
  console.log('  the active staffNameMap (line ~452).');
  console.log('  Additional hardcoded exclusion regardless of active status: DS1, UNKNOWN');
  console.log('  (EXCLUDED_CODES, line ~442) — NOT QC1, RND, or NTL.');
  console.log('  => QC1/RND/NTL WILL appear in Team Hours if their roster row is active=true.');
  console.log('');
  console.log('Load Balance     — PortalData.gs getCEODashboard(email), ~line 1122');
  console.log('  Filters DIM_STAFF_ROSTER active=true? YES (line ~1136, same pattern).');
  console.log('  Additional hardcoded exclusion: DS1, UNKNOWN, BTD, SNA');
  console.log('  (CEO_ABSOLUTE_EXCLUDE, line ~1203) — NOT QC1, RND, or NTL.');
  console.log('  => QC1/RND/NTL WILL appear in Load Balance if their roster row is active=true.');
  console.log('');
  console.log('Quality Rates    — PortalData.gs getCEODashboard(email), ~line 1221 (qMap)');
  console.log('  Filters DIM_STAFF_ROSTER active=true? NO. Built directly from');
  console.log('  VW_JOB_CURRENT_STATE.allocated_to with zero roster lookup and zero code');
  console.log('  exclusion list — not even the DS1 exclusion applied elsewhere.');
  console.log('  => ANY allocated_to code with rework counts on a VW row appears here,');
  console.log('     active roster or not, real staff or not. This is the widest exposure');
  console.log('     of the three panels.');
  console.log('');

  console.log('=== End ===');

  return {
    rosterMatches:   staffHits.length,
    workLogMatches:  wlCount,
    workLogHours:    Math.round(wlHours * 100) / 100,
    vwMatches:       vwHits.length,
    vwByState:       vwByState
  };
}
