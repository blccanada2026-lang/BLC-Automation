// ============================================================
// SartyReconAudit.gs — BLC Nexus Billing Reconciliation
// src/12-migration/SartyReconAudit.gs
//
// HOW TO RUN (Apps Script editor):
//   runSartyRecon_2026_06B()
//
// Compares Sarty's ground-truth hour totals (June 16–30) against
// the timesheet engine's output by client and designer nickname.
//
// Nickname → actor_code matching is done dynamically against
// DIM_STAFF_ROSTER. Ambiguous/unmatched cases are flagged.
//
// Output → _TEMP_AUDIT_SARTY_RECON. Read-only.
// ============================================================

var SARTY_RECON_TAB_ = '_TEMP_AUDIT_SARTY_RECON';

// Sarty's ground-truth totals for 2026-06B (June 16–30)
var SARTY_DATA_ = [
  { client: 'SBS',     nickname: 'Bharath',   sarty_hours: 76.5   },
  { client: 'SBS',     nickname: 'Savvy',     sarty_hours: 72     },
  { client: 'SBS',     nickname: 'Abby',      sarty_hours: 103.25 },
  { client: 'SBS',     nickname: 'Bittu',     sarty_hours: 85.75  },
  { client: 'SBS',     nickname: 'Roy',       sarty_hours: 67.5   },
  { client: 'SBS',     nickname: 'Rajkumar',  sarty_hours: 75.5   },
  { client: 'SBS',     nickname: 'Sandy',     sarty_hours: 105.5  },
  { client: 'SBS',     nickname: 'Pabby',     sarty_hours: 46     },
  { client: 'SBS',     nickname: 'Joy',       sarty_hours: 89.5   },
  { client: 'SBS',     nickname: 'Debby',     sarty_hours: 51.5   },
  { client: 'NORSPAN', nickname: 'Bharath',   sarty_hours: 16.25  },
  { client: 'NORSPAN', nickname: 'Vani',      sarty_hours: 8.5    },
  { client: 'NORSPAN', nickname: 'Ravi',      sarty_hours: 34     },
  { client: 'MATIX',   nickname: 'Debby',     sarty_hours: 93     },
  { client: 'MATIX',   nickname: 'Deb',       sarty_hours: 60.5   },
  { client: 'ALBERTA', nickname: 'Priyanka',  sarty_hours: 33     },
  { client: 'ALBERTA', nickname: 'Deb',       sarty_hours: 25.5   },
  { client: 'NELSON',  nickname: 'Deb',       sarty_hours: 22.5   },
  { client: 'NELSON',  nickname: 'Abhishek',  sarty_hours: 65     }
];

// Sarty's client names → system client_codes in VW_JOB_CURRENT_STATE
var CLIENT_ALIASES_SR_ = {
  'SBS':     ['SBS'],
  'NORSPAN': ['NORSPAN', 'NORSPAN-MB'],
  'MATIX':   ['MATIX', 'MATIX-SK'],
  'ALBERTA': ['ALBERTA', 'ALBERTA TRUSS', 'ALBERTATRUSS', 'ALBERTA-TRUSS'],
  'NELSON':  ['NELSON']
};

var SUPERSEDED_SR_ = { 'BTD': true, 'SNA': true };

// CTO-confirmed overrides for nicknames that are ambiguous or not auto-matched.
// Keys are lowercase nicknames; values are actor_codes. Checked before dynamic matching.
var NICKNAME_OVERRIDES_SR_ = {
  'sandy':    'SDA',
  'abby':     'ABB',
  'vani':     'VKV',
  'ravi':     'RKG',
  'abhishek': 'AR001'
};

/**
 * Reconciles Sarty's ground-truth totals against the timesheet engine
 * for the given period. Output → _TEMP_AUDIT_SARTY_RECON.
 *
 * NOTE: 4 Category 1 voids (AR001, PBG×2, SGO) were applied before
 * this audit. Results reflect post-void state for those four entries.
 * ABB/BLC-00304 and BCH/BLC-00251 duplicates remain unvoided.
 *
 * @param {string} [periodId]  Defaults to '2026-06B'.
 */
function runSartyRecon(periodId) {
  var MODULE = 'SartyReconAudit';
  periodId   = periodId || '2026-06B';

  var pm = periodId.match(/^(\d{4})-(\d{2})([AB])$/);
  if (!pm) throw new Error('SartyReconAudit: invalid periodId "' + periodId + '"');

  var year     = parseInt(pm[1], 10);
  var monthIdx = parseInt(pm[2], 10) - 1;
  var half     = pm[3];
  var fromDate = half === 'A' ? new Date(year, monthIdx, 1)  : new Date(year, monthIdx, 16);
  var toDate   = half === 'A' ? new Date(year, monthIdx, 15) : new Date(year, monthIdx + 1, 0);
  var partition = pm[1] + '-' + pm[2];

  function ymd_(d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
  var fromYMD = ymd_(fromDate), toYMD = ymd_(toDate);

  Logger.info('SARTY_RECON_START', { module: MODULE, period_id: periodId });

  // ── Load DIM_STAFF_ROSTER → actor_code → { name, first_name } ──
  var staffByCode = {};
  try {
    var staffRows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: MODULE });
    for (var s = 0; s < staffRows.length; s++) {
      var sr   = staffRows[s];
      var code = String(sr.person_code || '').trim().toUpperCase();
      if (!code) continue;
      var full  = String(sr.name || code).trim();
      staffByCode[code] = { name: full, first_name: full.split(/\s+/)[0] };
    }
  } catch (e) {
    Logger.warn('SARTY_RECON_STAFF_FAIL', { module: MODULE, error: e.message });
  }

  // ── Load VW → job_number → system client_code ──────────────
  var jobToSysClient = {};
  var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
  for (var v = 0; v < vwRows.length; v++) {
    var vr = vwRows[v];
    var jn = String(vr.job_number || '').trim();
    if (jn) jobToSysClient[jn] = String(vr.client_code || '').toUpperCase().trim();
  }

  // ── Build reverse map: sys client_code → sarty client name ──
  var sysToSarty = {};
  var sartyKeys  = Object.keys(CLIENT_ALIASES_SR_);
  for (var ck = 0; ck < sartyKeys.length; ck++) {
    var aliases = CLIENT_ALIASES_SR_[sartyKeys[ck]];
    for (var ca = 0; ca < aliases.length; ca++) {
      sysToSarty[aliases[ca].toUpperCase()] = sartyKeys[ck];
    }
  }

  // ── Read FACT_WORK_LOGS ──────────────────────────────────────
  var wlRows = [];
  try {
    wlRows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
      callerModule: MODULE,
      periodId:     partition
    });
  } catch (e) {
    Logger.warn('SARTY_RECON_WL_FAIL', { module: MODULE, error: e.message });
  }

  // ── Apply ClientTimesheetEngine filter chain ─────────────────
  // Net per (actor_code, job_number); collect detail rows
  var netByActorJob = {};  // ac + '\x00' + jn → { net, entries[] }

  for (var w = 0; w < wlRows.length; w++) {
    var row = wlRows[w];
    if (row.migration_batch) continue;

    var ac = String(row.actor_code || '').trim().toUpperCase();
    if (row.event_type === 'WORK_LOG_MIGRATED' && SUPERSEDED_SR_[ac]) continue;

    var d2 = parseSRDate_(row.work_date, year);
    if (!d2) continue;
    var wd = ymd_(d2);
    if (wd < fromYMD || wd > toYMD) continue;

    var hrs = parseFloat(row.hours);
    if (isNaN(hrs) || hrs === 0) continue;

    var jn2 = String(row.job_number || '').trim().split(/\s+/)[0];
    if (!jn2 || !jobToSysClient[jn2]) continue;

    var key = ac + '\x00' + jn2;
    if (!netByActorJob[key]) netByActorJob[key] = { actor_code: ac, job_number: jn2, net: 0, entries: [] };
    netByActorJob[key].net += hrs;
    netByActorJob[key].entries.push({
      work_date:  fmtSRDate_(d2),
      hours:      hrs,
      event_type: String(row.event_type || ''),
      notes:      String(row.notes      || '')
    });
  }

  // ── Aggregate by (actor_code, sarty_client) after netting ───
  // Only include jobs with net > 0
  var sysHoursMap  = {};   // ac + '\x00' + sartyClient → total hours
  var sysDetailMap = {};   // same → [{ job_number, work_date, hours, event_type, notes }]

  var netKeys = Object.keys(netByActorJob);
  for (var nk = 0; nk < netKeys.length; nk++) {
    var e      = netByActorJob[netKeys[nk]];
    var net    = Math.round(e.net * 100) / 100;
    if (net <= 0) continue;

    var sysClient   = jobToSysClient[e.job_number];
    var sartyClient = sysToSarty[sysClient];
    if (!sartyClient) continue;

    var sumKey = e.actor_code + '\x00' + sartyClient;
    if (!sysHoursMap[sumKey]) { sysHoursMap[sumKey] = 0; sysDetailMap[sumKey] = []; }
    sysHoursMap[sumKey] += net;

    for (var ei = 0; ei < e.entries.length; ei++) {
      sysDetailMap[sumKey].push({
        job_number: e.job_number,
        work_date:  e.entries[ei].work_date,
        hours:      e.entries[ei].hours,
        event_type: e.entries[ei].event_type,
        notes:      e.entries[ei].notes
      });
    }
  }
  for (var sk in sysHoursMap) {
    sysHoursMap[sk] = Math.round(sysHoursMap[sk] * 100) / 100;
  }

  // ── Build reconciliation rows ────────────────────────────────
  var COLS = ['Client', 'Nickname', 'Matched Designer', 'Actor Code',
              'Sarty Hours', 'System Hours', 'Delta', 'Status', 'Note'];
  var numCols = COLS.length;

  var reconRows       = [];
  var mismatchDetails = [];
  var totalSarty      = 0, totalSystem = 0, mismatchCount = 0;
  var prevClient      = '';

  for (var i = 0; i < SARTY_DATA_.length; i++) {
    var entry      = SARTY_DATA_[i];
    var sartyHrs   = entry.sarty_hours;
    var match      = matchNicknameSR_(entry.nickname, staffByCode);

    var actorCode, matchedName, note, sysHrs, delta, status, rowBg;

    if (match.status === 'NOT_FOUND') {
      actorCode   = ''; matchedName = '';
      note        = 'Not found in roster — confirm nickname';
      sysHrs      = 0;
      delta       = sartyHrs;
      status      = '⚠️ NOT FOUND';
      rowBg       = '#fce5cd';
    } else if (match.status === 'AMBIGUOUS') {
      actorCode   = match.candidates.map(function(c) { return c.code; }).join(' / ');
      matchedName = match.candidates.map(function(c) { return c.name; }).join(' / ');
      note        = 'Ambiguous — confirm which';
      sysHrs      = 0;
      delta       = sartyHrs;
      status      = '⚠️ AMBIGUOUS';
      rowBg       = '#fce5cd';
    } else {
      actorCode   = match.actor_code;
      matchedName = match.name;
      note        = '';
      sysHrs      = Math.round((sysHoursMap[actorCode + '\x00' + entry.client] || 0) * 100) / 100;
      delta       = Math.round((sartyHrs - sysHrs) * 100) / 100;

      if (delta === 0) {
        status = '✅ MATCH';   rowBg = '#d9ead3';
      } else if (Math.abs(delta) <= 0.5) {
        status = '🟡 MINOR';   rowBg = '#fff2cc';
      } else {
        status = '🔴 MISMATCH'; rowBg = '#f4cccc';
        mismatchCount++;
        var detailKey = actorCode + '\x00' + entry.client;
        mismatchDetails.push({
          client: entry.client, nickname: entry.nickname,
          actor_code: actorCode, matched_name: matchedName,
          sarty_hours: sartyHrs, sys_hours: sysHrs, delta: delta,
          entries: (sysDetailMap[detailKey] || []).slice().sort(function(a, b) {
            return a.work_date < b.work_date ? -1 : 1;
          })
        });
      }
    }

    totalSarty  += sartyHrs;
    totalSystem += sysHrs;
    reconRows.push({ values: [entry.client, entry.nickname, matchedName, actorCode,
                               sartyHrs, sysHrs, delta, status, note],
                     bg: rowBg, clientChanged: entry.client !== prevClient && i > 0 });
    prevClient = entry.client;
  }

  totalSarty  = Math.round(totalSarty  * 100) / 100;
  totalSystem = Math.round(totalSystem * 100) / 100;
  var totalDelta = Math.round((totalSarty - totalSystem) * 100) / 100;

  Logger.info('SARTY_RECON_DONE', {
    module:      MODULE, period_id: periodId,
    mismatches:  mismatchCount, total_delta: totalDelta
  });

  // ── Write to sheet ───────────────────────────────────────────
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(SARTY_RECON_TAB_);
  if (tab) { tab.clearContents(); tab.clearFormats(); }
  else     { tab = ss.insertSheet(SARTY_RECON_TAB_); }

  var sheetValues = [];
  var fmtQueue    = [];
  var row         = 1;

  function push_(values, bg, bold, fontColor) {
    sheetValues.push(values);
    fmtQueue.push({ row: row, bg: bg || '#ffffff', bold: !!bold, fc: fontColor || null });
    row++;
  }

  // Banner
  push_(['AUDIT: Sarty Reconciliation — Period ' + periodId,
         'Run: ' + new Date().toISOString(),
         'Mismatches (>0.5h): ' + mismatchCount,
         'Total delta: ' + totalDelta + 'h',
         '', '', '', '', ''], '#fff2cc', true, null);
  push_(new Array(numCols).fill(''), '#ffffff', false, null);
  push_(COLS, '#cfe2f3', true, '#1a3c5e');

  // Data rows with client separators
  for (var rd = 0; rd < reconRows.length; rd++) {
    var rr = reconRows[rd];
    if (rr.clientChanged) push_(new Array(numCols).fill(''), '#f3f3f3', false, null);
    push_(rr.values, rr.bg, false, null);
  }

  // Totals
  push_(new Array(numCols).fill(''), '#ffffff', false, null);
  push_(['TOTAL', '', '', '', totalSarty, totalSystem, totalDelta,
         totalDelta === 0 ? '✅ BALANCED' : '⚠️ NET DELTA ' + totalDelta + 'h', ''],
        '#d9ead3', true, null);

  // Mismatch detail section
  if (mismatchDetails.length > 0) {
    push_(new Array(numCols).fill(''), '#ffffff', false, null);
    push_(['━━ MISMATCH DETAIL — entries contributing to system total for delta > 0.5h ━━',
           '', '', '', '', '', '', '', ''], '#fce5cd', true, '#b45f06');
    push_(new Array(numCols).fill(''), '#ffffff', false, null);
    push_(['Client', 'Actor', 'Job Number', 'Work Date', 'Hours', 'Event Type', 'Notes', '', ''],
          '#fce5cd', true, '#b45f06');

    for (var md = 0; md < mismatchDetails.length; md++) {
      var mis = mismatchDetails[md];
      push_([mis.client + ' / ' + mis.nickname + ' (' + mis.actor_code + ')'
             + '  Sarty: ' + mis.sarty_hours + 'h  System: ' + mis.sys_hours + 'h  Delta: ' + mis.delta + 'h',
             '', '', '', '', '', '', '', ''], '#fce5cd', true, null);

      if (mis.entries.length === 0) {
        push_(['(no system entries for this actor+client in period)', '', '', '', '', '', '', '', ''],
              '#fff9f5', false, null);
      } else {
        for (var me = 0; me < mis.entries.length; me++) {
          var ent = mis.entries[me];
          push_([mis.client, mis.actor_code, ent.job_number, ent.work_date,
                 ent.hours, ent.event_type, ent.notes, '', ''],
                ent.hours < 0 ? '#f4cccc' : (me % 2 ? '#fff9f5' : '#ffffff'), false, null);
        }
      }
      push_(new Array(numCols).fill(''), '#ffffff', false, null);
    }
  }

  // Bulk write values
  tab.getRange(1, 1, sheetValues.length, numCols).setValues(sheetValues);

  // Apply formatting
  for (var f = 0; f < fmtQueue.length; f++) {
    var fmt = fmtQueue[f];
    var rng = tab.getRange(fmt.row, 1, 1, numCols);
    rng.setBackground(fmt.bg);
    if (fmt.bold) rng.setFontWeight('bold');
    if (fmt.fc)   rng.setFontColor(fmt.fc);
  }

  tab.setFrozenRows(3);
  tab.autoResizeColumns(1, numCols);

  console.log('[SartyReconAudit] Period: ' + periodId +
              ' | Mismatches: ' + mismatchCount +
              ' | Total delta: ' + totalDelta + 'h');
  if (mismatchCount > 0) {
    for (var mx = 0; mx < mismatchDetails.length; mx++) {
      var m = mismatchDetails[mx];
      console.log('  🔴 ' + m.client + ' / ' + m.nickname +
                  ' (' + m.actor_code + ')' +
                  '  Sarty=' + m.sarty_hours + 'h' +
                  '  System=' + m.sys_hours + 'h' +
                  '  Delta=' + m.delta + 'h');
    }
  }

  return { period_id: periodId, mismatches: mismatchCount, total_delta: totalDelta };
}

// ── Nickname → actor_code matching ───────────────────────────
// Strength levels:
//   5 — exact first name match
//   4 — exact last name match
//   3 — nickname startsWith first (≥4 chars) or vice versa
//   2 — first 3 chars match + lengths within 4
//   1 — first 2 chars match + lengths within 3 (weak, flags as ambiguous if tied)

function matchNicknameSR_(nickname, staffByCode) {
  var nick = nickname.toLowerCase().trim();

  // CTO-confirmed override takes priority over dynamic matching
  if (NICKNAME_OVERRIDES_SR_[nick]) {
    var oc = NICKNAME_OVERRIDES_SR_[nick];
    var os = staffByCode[oc];
    return { status: 'MATCHED', actor_code: oc, name: os ? os.name : oc };
  }

  var candidates = [];
  var seen       = {};

  for (var code in staffByCode) {
    var s     = staffByCode[code];
    var full  = s.name.toLowerCase();
    var first = s.first_name.toLowerCase();
    var parts = full.split(/\s+/);
    var last  = parts[parts.length - 1];
    var str   = 0;

    if      (first === nick)                                        str = 5;
    else if (last  === nick)                                        str = 4;
    else if (nick.length >= 4 && first.startsWith(nick))           str = 3;
    else if (nick.length >= 4 && nick.startsWith(first))           str = 3;
    else if (nick.length >= 3 &&
             first.startsWith(nick.substr(0, 3)) &&
             Math.abs(nick.length - first.length) <= 4)            str = 2;
    else if (nick.length >= 4 &&
             nick.substr(0, 2) === first.substr(0, 2) &&
             Math.abs(nick.length - first.length) <= 3)            str = 1;

    if (str > 0 && !seen[code]) {
      candidates.push({ code: code, name: s.name, strength: str });
      seen[code] = true;
    }
  }

  if (candidates.length === 0) return { status: 'NOT_FOUND' };
  candidates.sort(function(a, b) { return b.strength - a.strength; });

  if (candidates.length === 1 || candidates[0].strength > candidates[1].strength) {
    return { status: 'MATCHED', actor_code: candidates[0].code, name: candidates[0].name };
  }
  var top = candidates[0].strength;
  return {
    status:     'AMBIGUOUS',
    candidates: candidates.filter(function(c) { return c.strength === top; })
  };
}

// ── Date helpers ──────────────────────────────────────────────

var SR_MONTH_MAP_ = {
  jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11
};

function parseSRDate_(raw, year) {
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  var s   = String(raw).trim();
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
  var mg  = s.match(/[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})/);
  if (mg) {
    var mi = SR_MONTH_MAP_[mg[1].toLowerCase()];
    if (mi !== undefined) return new Date(year, mi, parseInt(mg[2]));
  }
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function fmtSRDate_(d) {
  if (!d) return '';
  return d.getFullYear() + '-' +
         (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '-' +
         (d.getDate()    < 10 ? '0' : '') + d.getDate();
}

/** Runner — select in the Apps Script editor and click Run. */
function runSartyRecon_2026_06B() {
  runSartyRecon('2026-06B');
}
