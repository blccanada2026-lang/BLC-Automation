// ============================================================
// SartyConfirmation.gs — Billing Confirmation Sheet for Sarty
// src/12-migration/SartyConfirmation.gs
//
// HOW TO RUN (Apps Script editor):
//   runSartyConfirmationSheet()
//
// Generates _TEMP_SARTY_CONFIRMATION with two sections:
//   Section A — 3 jobs to confirm client assignment
//   Section B — missing hours for PBG, DBG, AR001
//
// Read-only. No FACT or VW writes.
// ============================================================

var SARTY_CONF_TAB_ = '_TEMP_SARTY_CONFIRMATION';
var SARTY_CONF_NC_  = 8;

var SC_CLIENT_NAMES_ = {
  'SBS':           'SBS',
  'NORSPAN-MB':    'Norspan',
  'NORSPAN':       'Norspan',
  'MATIX-SK':      'Matix',
  'MATIX':         'Matix',
  'ALBERTA TRUSS': 'Alberta Truss',
  'ALBERTA':       'Alberta Truss',
  'NELSON':        'Nelson Lumber'
};

// June 16–30 weekdays only (designers don't log on weekends)
var SC_JUNE_B_WEEKDAYS_ = [
  20260616, 20260617, 20260618, 20260619,
  20260622, 20260623, 20260624, 20260625, 20260626,
  20260629, 20260630
];

function runSartyConfirmationSheet() {
  var MODULE    = 'SartyConfirmation';
  var PARTITION = '2026-06';
  var FROM_YMD  = 20260616;
  var TO_YMD    = 20260630;
  var NC        = SARTY_CONF_NC_;

  // ── Date helpers ─────────────────────────────────────────────
  function toYMD_(raw) {
    if (!raw) return 0;
    if (raw instanceof Date) {
      return isNaN(raw.getTime()) ? 0
        : raw.getFullYear() * 10000 + (raw.getMonth() + 1) * 100 + raw.getDate();
    }
    var s   = String(raw).trim();
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return +iso[1] * 10000 + +iso[2] * 100 + +iso[3];
    var p = new Date(s);
    return isNaN(p.getTime()) ? 0
      : p.getFullYear() * 10000 + (p.getMonth() + 1) * 100 + p.getDate();
  }

  function fmtDate_(raw) {
    var yv = toYMD_(raw);
    if (!yv) return String(raw || '');
    var mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return mo[Math.floor(yv / 100) % 100 - 1] + ' ' + (yv % 100);
  }

  function fmtYMD_(ymdV) {
    var mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return mo[Math.floor(ymdV / 100) % 100 - 1] + ' ' + (ymdV % 100);
  }

  function dayName_(ymdV) {
    var yr = Math.floor(ymdV / 10000);
    var mo = Math.floor((ymdV % 10000) / 100);
    var da = ymdV % 100;
    return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(yr, mo - 1, da).getDay()];
  }

  function clientDisplayName_(cc) {
    return SC_CLIENT_NAMES_[String(cc || '').toUpperCase().trim()] || String(cc || '');
  }

  // ── Load reference data ──────────────────────────────────────
  var staffNames = {};
  try {
    var sRows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: MODULE });
    for (var s = 0; s < sRows.length; s++) {
      var sc = String(sRows[s].person_code || '').trim().toUpperCase();
      if (sc) staffNames[sc] = String(sRows[s].name || sc).trim();
    }
  } catch (e) {
    Logger.warn('SC_STAFF_FAIL', { module: MODULE, error: e.message });
  }

  var vwByJob = {};
  try {
    var vRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
    for (var v = 0; v < vRows.length; v++) {
      var jn = String(vRows[v].job_number || '').trim();
      if (jn) vwByJob[jn] = vRows[v];
    }
  } catch (e) {
    Logger.warn('SC_VW_FAIL', { module: MODULE, error: e.message });
  }

  var wlAll = [];
  try {
    wlAll = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
      callerModule: MODULE, periodId: PARTITION
    });
  } catch (e) {
    Logger.warn('SC_WL_FAIL', { module: MODULE, error: e.message });
  }

  // Apply June B engine filter chain (no migration_batch, date window)
  var SUPERS_ = { 'BTD': true, 'SNA': true };
  var juneBLogs = [];
  for (var w = 0; w < wlAll.length; w++) {
    var row = wlAll[w];
    if (row.migration_batch) continue;
    var ac = String(row.actor_code || '').trim().toUpperCase();
    if (row.event_type === 'WORK_LOG_MIGRATED' && SUPERS_[ac]) continue;
    var wd = toYMD_(row.work_date);
    if (wd < FROM_YMD || wd > TO_YMD) continue;
    juneBLogs.push(row);
  }

  // ── Data helpers ─────────────────────────────────────────────

  // Get work logs for an actor on a specific job number
  function getActorJobLogs_(actor, jobNumber) {
    var out = [];
    for (var i = 0; i < juneBLogs.length; i++) {
      var r = juneBLogs[i];
      if (String(r.actor_code || '').trim().toUpperCase() !== actor) continue;
      if (String(r.job_number || '').trim().split(/\s+/)[0] !== jobNumber) continue;
      out.push(r);
    }
    out.sort(function(a, b) { return toYMD_(a.work_date) - toYMD_(b.work_date); });
    return out;
  }

  // Get work logs for an actor on a set of client_codes (VW join)
  function getActorClientLogs_(actor, ccList) {
    var ccSet = {};
    for (var i = 0; i < ccList.length; i++) ccSet[ccList[i].toUpperCase()] = true;
    var out = [];
    for (var i = 0; i < juneBLogs.length; i++) {
      var r = juneBLogs[i];
      if (String(r.actor_code || '').trim().toUpperCase() !== actor) continue;
      var jn2 = String(r.job_number || '').trim().split(/\s+/)[0];
      var vw  = vwByJob[jn2];
      if (!vw) continue;
      var cc  = String(vw.client_code || '').toUpperCase().trim();
      if (!ccSet[cc]) continue;
      out.push(r);
    }
    out.sort(function(a, b) { return toYMD_(a.work_date) - toYMD_(b.work_date); });
    return out;
  }

  // Build net-hours-per-day map from a log set
  function dailyNetMap_(logs) {
    var netByDateJob = {};
    for (var i = 0; i < logs.length; i++) {
      var r   = logs[i];
      var ymd = toYMD_(r.work_date);
      var jn2 = String(r.job_number || '').trim().split(/\s+/)[0];
      var key = ymd + '|' + jn2;
      if (!netByDateJob[key]) netByDateJob[key] = 0;
      netByDateJob[key] += parseFloat(r.hours) || 0;
    }
    var daily = {};
    for (var k in netByDateJob) {
      var ymd2 = parseInt(k.split('|')[0], 10);
      var net  = Math.round(netByDateJob[k] * 100) / 100;
      if (net > 0) {
        daily[ymd2] = (daily[ymd2] || 0) + net;
      }
    }
    return daily;
  }

  // ── Sheet builder ─────────────────────────────────────────────
  var sheetRows = [];

  function push_(values, bg, bold) {
    while (values.length < NC) values.push('');
    sheetRows.push({ values: values.slice(0, NC), bg: bg || '#ffffff', bold: !!bold });
  }

  function blank_()         { push_([], '#ffffff', false); }
  function separator_()     { push_([], '#e8eaed', false); }

  function banner_(text, sub) {
    push_([text, '', '', '', '', '', '', ''], '#1c4587', true);
    if (sub) push_([sub, '', '', '', '', '', '', ''], '#4a86e8', false);
  }

  function sectionHeader_(label, desc) {
    push_([label, '', '', '', '', '', '', ''], '#c9daf8', true);
    if (desc) push_([desc, '', '', '', '', '', '', ''], '#e8f0fe', false);
  }

  function subHeader_(text) {
    push_([text, '', '', '', '', '', '', ''], '#fce5cd', true);
  }

  function note_(text) {
    push_(['    ' + text, '', '', '', '', '', '', ''], '#fffde7', false);
  }

  function tableHdr_(cols) {
    push_(cols, '#b6d7a8', true);
  }

  function confirmRow_(label) {
    push_(['', '✅  YES', '', '❌  NO', '', '📝 ' + label + ':', '', ''], '#f3f3f3', false);
  }

  // ── BANNER ───────────────────────────────────────────────────
  banner_(
    'JUNE 2026 BILLING — CONFIRMATION REQUEST FOR SARTY',
    'Please review both sections below and add your answers in the last column. Prepared: ' + new Date().toDateString()
  );
  blank_();
  push_(['This sheet has two sections:',
         'Section A = 3 jobs where the client may be wrong (quick yes/no).',
         '', 'Section B = 3 designers with missing hours (ask them to submit).',
         '', '', '', ''], '#e8f0fe', false);
  blank_();
  blank_();

  // ════════════════════════════════════════════════════════════
  // SECTION A — Client Attribution
  // ════════════════════════════════════════════════════════════
  push_(['SECTION A — Client Assignment Check (3 jobs)', '', '', '', '', '', '', ''],
        '#1155cc', true);
  push_(['For each job below, we are not sure which client it belongs to. Your answer will fix the billing.',
         '', '', '', '', '', '', ''], '#c9daf8', false);
  blank_();

  // ── A1: BCH NORSPAN ─────────────────────────────────────────
  subHeader_('A1 — Bharath Charles — Norspan work that might actually be SBS');
  note_('Our system shows Bharath logged 17.75h to Norspan in June 16–30.');
  note_('Your spreadsheet shows 16.25h for Norspan — 1.5h less.');
  note_('This means one of the jobs below is probably SBS work that was tagged Norspan in our system.');
  note_('Please look through the list and mark the row that belongs to SBS in the last column.');
  blank_();

  tableHdr_(['Date', 'Our Job #', "Client's Own Ref", 'Product', 'Net Hours', 'QC / Notes', 'Current Client', 'Correct Client? (write SBS or leave blank)']);

  // Group BCH NORSPAN logs by (date, job), net out voids
  var bchNorspanLogs = getActorClientLogs_('BCH', ['NORSPAN-MB', 'NORSPAN']);
  var bchNetMap      = {};  // date|job → { wd, job, cref, product, net, notes }
  for (var i = 0; i < bchNorspanLogs.length; i++) {
    var r   = bchNorspanLogs[i];
    var jn2 = String(r.job_number || '').trim().split(/\s+/)[0];
    var wd  = toYMD_(r.work_date);
    var key = wd + '|' + jn2;
    if (!bchNetMap[key]) {
      var vwJ = vwByJob[jn2] || {};
      bchNetMap[key] = {
        wd:      wd,
        job:     jn2,
        cref:    String(vwJ.client_job_ref || vwJ.job_ref || '').trim(),
        product: String(vwJ.product_code   || '').trim(),
        net:     0,
        notes:   []
      };
    }
    bchNetMap[key].net += parseFloat(r.hours) || 0;
    var nt = String(r.notes || '').trim();
    if (nt && bchNetMap[key].notes.indexOf(nt) < 0) bchNetMap[key].notes.push(nt);
  }

  var bchEntries = [];
  for (var k in bchNetMap) bchEntries.push(bchNetMap[k]);
  bchEntries.sort(function(a, b) { return a.wd - b.wd || (a.job < b.job ? -1 : 1); });

  var bchTotalNorspan = 0;
  for (var i = 0; i < bchEntries.length; i++) {
    var e   = bchEntries[i];
    var net = Math.round(e.net * 100) / 100;
    if (net === 0) continue;
    bchTotalNorspan += net;
    // Highlight entries worth exactly 1.5h — most likely candidate
    var isCandidate = Math.abs(net - 1.5) < 0.01;
    var bg = isCandidate ? '#fff2cc' : '#ffffff';
    push_([
      fmtYMD_(e.wd),
      e.job,
      e.cref || '—',
      e.product || '—',
      net + 'h',
      e.notes.join('; ') || '',
      'Norspan',
      isCandidate ? '← Most likely SBS (1.5h matches gap)' : ''
    ], bg, false);
  }

  // Total row
  push_(['', 'TOTAL', '', '', Math.round(bchTotalNorspan * 100) / 100 + 'h',
         '', 'Norspan (system)', 'Sarty count: 16.25h'], '#e2efda', true);
  blank_();
  blank_();

  // ── A2: DBS / BLC-00169 ─────────────────────────────────────
  subHeader_('A2 — Deb Sen — Is job BLC-00169 a Matix job or Alberta Truss job?');
  note_('Our system has this job under Alberta Truss.');
  note_('Deb\'s Matix total is 6.5h short of your count. If BLC-00169 is actually a Matix job, it fixes 1.5h of that gap.');

  var vw169 = vwByJob['BLC-00169'] || {};
  blank_();
  push_(['JOB DETAILS', '', '', '', '', '', '', ''], '#e6f2ff', true);
  push_(['Our Job #',     'BLC-00169',
         '',
         'Client\'s Ref', String(vw169.client_job_ref || vw169.job_ref || '(none)').trim(),
         '', '', ''], '#f8fbff', false);
  push_(['Currently assigned to', clientDisplayName_(vw169.client_code),
         '',
         'Product', String(vw169.product_code || '—').trim(),
         '', '', ''], '#f8fbff', false);
  push_(['Job Type', String(vw169.job_type || '—'),
         '',
         'Allocated To', staffNames[String(vw169.allocated_to || '').trim().toUpperCase()] ||
                         String(vw169.allocated_to || '—'),
         '', '', ''], '#f8fbff', false);
  blank_();

  push_(['Deb\'s work logged on BLC-00169 (Jun 16–30):', '', '', '', '', '', '', ''], '#e6f2ff', true);
  tableHdr_(['Date', 'Hours', '', '', '', '', '', '']);

  var dbs169Logs = getActorJobLogs_('DBS', 'BLC-00169');
  var dbs169Total = 0;
  if (dbs169Logs.length === 0) {
    push_(['(no entries found in this period)', '', '', '', '', '', '', ''], '#fff9f5', false);
  } else {
    for (var i = 0; i < dbs169Logs.length; i++) {
      var r   = dbs169Logs[i];
      var hrs = parseFloat(r.hours) || 0;
      dbs169Total += hrs;
      push_([fmtDate_(r.work_date), hrs + 'h', '', '', '', '', '', ''],
            hrs < 0 ? '#f4cccc' : '#ffffff', false);
    }
    push_(['Total', Math.round(dbs169Total * 100) / 100 + 'h', '', '', '', '', '', ''],
          '#e2efda', true);
  }

  blank_();
  push_(['QUESTION: Should BLC-00169 be assigned to Matix instead of Alberta Truss?',
         '', '', '', '', '', '', ''], '#fff2cc', true);
  confirmRow_('write your answer here');
  blank_();
  blank_();

  // ── A3: DBS / BLC-00373 ─────────────────────────────────────
  subHeader_('A3 — Deb Sen — Is job BLC-00373 a Matix job or Nelson Lumber job?');
  note_('Our system has this job under Nelson Lumber.');
  note_('Deb\'s Matix total is 6.5h short and Nelson is 5h over your count.');
  note_('If BLC-00373 is actually a Matix job, it resolves 5h of the Matix gap and closes the Nelson gap.');

  var vw373 = vwByJob['BLC-00373'] || {};
  blank_();
  push_(['JOB DETAILS', '', '', '', '', '', '', ''], '#e6f2ff', true);
  push_(['Our Job #',     'BLC-00373',
         '',
         'Client\'s Ref', String(vw373.client_job_ref || vw373.job_ref || '(none)').trim(),
         '', '', ''], '#f8fbff', false);
  push_(['Currently assigned to', clientDisplayName_(vw373.client_code),
         '',
         'Product', String(vw373.product_code || '—').trim(),
         '', '', ''], '#f8fbff', false);
  push_(['Job Type', String(vw373.job_type || '—'),
         '',
         'Allocated To', staffNames[String(vw373.allocated_to || '').trim().toUpperCase()] ||
                         String(vw373.allocated_to || '—'),
         '', '', ''], '#f8fbff', false);
  blank_();

  push_(['Deb\'s work logged on BLC-00373 (Jun 16–30):', '', '', '', '', '', '', ''], '#e6f2ff', true);
  tableHdr_(['Date', 'Hours', '', '', '', '', '', '']);

  var dbs373Logs  = getActorJobLogs_('DBS', 'BLC-00373');
  var dbs373Total = 0;
  if (dbs373Logs.length === 0) {
    push_(['(no entries found in this period)', '', '', '', '', '', '', ''], '#fff9f5', false);
  } else {
    for (var i = 0; i < dbs373Logs.length; i++) {
      var r   = dbs373Logs[i];
      var hrs = parseFloat(r.hours) || 0;
      dbs373Total += hrs;
      push_([fmtDate_(r.work_date), hrs + 'h', '', '', '', '', '', ''],
            hrs < 0 ? '#f4cccc' : '#ffffff', false);
    }
    push_(['Total', Math.round(dbs373Total * 100) / 100 + 'h', '', '', '', '', '', ''],
          '#e2efda', true);
  }

  blank_();
  push_(['QUESTION: Should BLC-00373 be assigned to Matix instead of Nelson Lumber?',
         '', '', '', '', '', '', ''], '#fff2cc', true);
  confirmRow_('write your answer here');
  blank_();
  blank_();

  // ════════════════════════════════════════════════════════════
  // SECTION B — Missing Hours
  // ════════════════════════════════════════════════════════════
  push_(['SECTION B — Missing Hours (3 Designers)', '', '', '', '', '', '', ''],
        '#1155cc', true);
  push_(['These designers have hours in your spreadsheet that are not yet in our system.',
         'Please ask each designer to submit the missing hours through the portal.',
         '', '', '', '', '', ''], '#c9daf8', false);
  blank_();

  function buildMissingSection_(sectionLabel, actor, ccList, clientDisplay,
                                 sartyHours, sysHours, delta) {
    var name = staffNames[actor] || actor;
    var firstName = name.split(' ')[0];

    subHeader_(sectionLabel + ' — ' + name + '  (' + clientDisplay + ')');
    note_('Your count: ' + sartyHours + 'h   |   Our system: ' + sysHours + 'h   |   Missing: ' + delta + 'h');
    note_('Highlighted dates below have no hours logged. These are the likely gaps.');
    blank_();

    tableHdr_(['Date', 'Day', 'Hours Logged', 'Status', '', '', '', '']);

    var logs    = getActorClientLogs_(actor, ccList);
    var dailyNet = dailyNetMap_(logs);

    var loggedTotal = 0;
    for (var i = 0; i < SC_JUNE_B_WEEKDAYS_.length; i++) {
      var ymdV    = SC_JUNE_B_WEEKDAYS_[i];
      var hrs     = dailyNet[ymdV];
      var dateStr = fmtYMD_(ymdV);
      var day     = dayName_(ymdV);

      if (hrs && hrs > 0) {
        loggedTotal += hrs;
        push_([dateStr, day, hrs + 'h', '✅  Logged', '', '', '', ''],
              '#d9ead3', false);
      } else {
        push_([dateStr, day, '—', '⚠️  No hours logged', '', '', '', ''],
              '#fce5cd', false);
      }
    }

    blank_();
    push_(['', 'Total logged (system): ' + Math.round(loggedTotal * 100) / 100 + 'h',
           '', 'Your count: ' + sartyHours + 'h',
           '', 'Gap: ' + delta + 'h',
           '', ''], '#e2efda', true);
    blank_();
    push_(['ACTION: Please ask ' + firstName + ' to submit ' + delta + 'h through the portal.',
           '', '', '', '', '', '', ''], '#fff2cc', true);
    blank_();
    blank_();
  }

  buildMissingSection_('B1', 'PBG',  ['SBS'],    'SBS',          46,   43,  3);
  buildMissingSection_('B2', 'DBG',  ['SBS'],    'SBS',          51.5, 47.5, 4);
  buildMissingSection_('B3', 'AR001',['NELSON'], 'Nelson Lumber', 65,   60,  5);

  // ── Write to sheet ───────────────────────────────────────────
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(SARTY_CONF_TAB_);
  if (tab) { tab.clearContents(); tab.clearFormats(); }
  else     { tab = ss.insertSheet(SARTY_CONF_TAB_); }

  var allValues = sheetRows.map(function(r) { return r.values; });
  tab.getRange(1, 1, allValues.length, NC).setValues(allValues);

  for (var f = 0; f < sheetRows.length; f++) {
    var rng = tab.getRange(f + 1, 1, 1, NC);
    rng.setBackground(sheetRows[f].bg);
    if (sheetRows[f].bold) rng.setFontWeight('bold');
  }

  tab.setFrozenRows(3);
  tab.setColumnWidth(1, 90);   // Date
  tab.setColumnWidth(2, 120);  // Job / Day
  tab.setColumnWidth(3, 160);  // Client ref / Label
  tab.setColumnWidth(4, 130);  // Product / Value
  tab.setColumnWidth(5, 90);   // Hours
  tab.setColumnWidth(8, 220);  // Answer column

  Logger.info('SARTY_CONF_DONE', { module: MODULE, rows: sheetRows.length });
  console.log('[SartyConfirmation] Written ' + sheetRows.length + ' rows to ' + SARTY_CONF_TAB_);

  return { rows: sheetRows.length };
}
