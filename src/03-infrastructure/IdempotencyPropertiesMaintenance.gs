// ============================================================
// IdempotencyPropertiesMaintenance.gs — BLC Nexus T3 Infrastructure
// src/03-infrastructure/IdempotencyPropertiesMaintenance.gs
//
// One-off maintenance for IdempotencyEngine.gs's accumulated Script
// Properties. checkAndMark() writes a permanent IDEM_<key> property per
// processed event and never expires them; historical migration events
// (IDEM_MIGR-WL-*) will never replay, so their markers are pure cruft.
// Found 2026-09-01 via diagnosePropertiesQuota(): store was intermittently
// hitting Apps Script's 500KB PropertiesService limit since 2026-07-22
// (2,705 failed writes, 0 confirmed duplicate FACT rows resulting from
// them — see CTO_TASK_QUEUE.md TASK PQ-1 for full investigation).
//
// IMPORTANT — not all IDEM_MIGR-WL-* keys are equally safe to delete.
// Batch mapping (confirmed from each importer's own source):
//   BATCH-001 = default/general cutover batch (MigrationConfig.CURRENT_BATCH)
//   BATCH-002 = MayTimesheetImporter.gs
//   BATCH-003 = Q1TimesheetImporter.gs (task queue notes raw Q1 dedup still uncleaned)
//   BATCH-004 = JuneWorkLogImporter.gs — ACTIVELY BEING RECONCILED, DO NOT PURGE.
//     JuneWorkLogImporter.gs contains live BATCH-004-HOURS-FIX correction
//     functions referencing "BATCH-004 idempotency gaps" — these markers
//     are still load-bearing. MigrationReplayEngine.gs's replay_status
//     sheet flag is the primary duplicate guard (checked before the
//     handler even runs, line ~375), but batchMarkReplayed_() can silently
//     fail to set it (try/catch swallows the error) — the IDEM_MIGR-WL-*
//     Script Property is the only remaining guard in that case.
//
// SAFE_BATCH_TAGS below must be explicitly confirmed batch-by-batch before
// running the purge — do not widen it without that confirmation.
//
// LOAD ORDER: After IdempotencyEngine.gs
// DEPENDENCIES: none
// ============================================================

/**
 * Read-only. Reports how many Script Properties match the historical
 * migration idempotency-key prefix, bucketed by BATCH tag, plus a census
 * of what the non-matching residual properties actually are.
 */
function censusIdemMigrKeys() {
  var PREFIX = 'IDEM_MIGR-WL-';
  var props = PropertiesService.getScriptProperties().getProperties();
  var allKeys = Object.keys(props);

  var matched = allKeys.filter(function(k) { return k.indexOf(PREFIX) === 0; });
  var unmatched = allKeys.filter(function(k) { return k.indexOf(PREFIX) !== 0; });

  console.log('Total properties: ' + allKeys.length);
  console.log('Matching "' + PREFIX + '": ' + matched.length);
  console.log('NOT matching (residual): ' + unmatched.length);
  console.log('');

  console.log('=== Matched keys, bucketed by BATCH tag ===');
  var batchCounts = {};
  var noBatchSample = [];
  matched.forEach(function(k) {
    var m = k.match(/BATCH-\d+(-[A-Z-]+)?/);
    var tag = m ? m[0] : 'NO_BATCH_TAG';
    batchCounts[tag] = (batchCounts[tag] || 0) + 1;
    if (tag === 'NO_BATCH_TAG' && noBatchSample.length < 10) noBatchSample.push(k);
  });
  Object.keys(batchCounts).sort().forEach(function(tag) {
    console.log('  ' + tag + ': ' + batchCounts[tag]);
  });
  if (noBatchSample.length) {
    console.log('  Sample NO_BATCH_TAG keys:');
    noBatchSample.forEach(function(k) { console.log('    ' + k); });
  }

  console.log('');
  console.log('=== Top 20 prefixes among NON-matching (residual) keys ===');
  var prefixCounts = {};
  var prefixBytes = {};
  unmatched.forEach(function(k) {
    var value = props[k];
    var size = k.length + (value ? value.length : 0);
    var prefix = k.split('_').slice(0, 2).join('_');
    prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
    prefixBytes[prefix] = (prefixBytes[prefix] || 0) + size;
  });
  var prefixes = Object.keys(prefixCounts).sort(function(a, b) { return prefixBytes[b] - prefixBytes[a]; });
  prefixes.slice(0, 20).forEach(function(p) {
    console.log('  ' + p + ':  count=' + prefixCounts[p] + '  bytes=' + prefixBytes[p]);
  });
  if (prefixes.length > 20) {
    console.log('  ... (' + (prefixes.length - 20) + ' more prefixes not shown, ' + prefixes.length + ' total)');
  }
}

/**
 * Read-only. Exports ALL IDEM_MIGR-WL-* keys+values to a Drive file
 * before any purge touches them — makes the purge reversible.
 */
function exportIdemMigrKeysBeforePurge() {
  var PREFIX = 'IDEM_MIGR-WL-';
  var props = PropertiesService.getScriptProperties().getProperties();
  var matched = Object.keys(props).filter(function(k) { return k.indexOf(PREFIX) === 0; });

  var lines = ['IDEM_MIGR-WL-* properties export (pre-purge backup) — ' + new Date().toISOString(),
               'Total keys: ' + matched.length, ''];
  matched.forEach(function(k) { lines.push(k + ' = ' + props[k]); });

  var filename = 'idem_migr_wl_export_' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt';
  var file = DriveApp.createFile(filename, lines.join('\n'), MimeType.PLAIN_TEXT);
  console.log('Exported ' + matched.length + ' keys to: ' + file.getUrl());
}

/**
 * Read-only. Reports how many Script Properties match the historical
 * migration idempotency-key prefix, with a sample of matched keys, so the
 * set can be eyeballed before purgeIdemMigrKeysBatch() deletes anything.
 */
function previewIdemMigrKeyPurge() {
  var PREFIX = 'IDEM_MIGR-WL-';
  var props = PropertiesService.getScriptProperties().getProperties();
  var allKeys = Object.keys(props);
  var targetKeys = allKeys.filter(function(k) { return k.indexOf(PREFIX) === 0; });

  console.log('Total properties in store: ' + allKeys.length);
  console.log('Keys matching prefix "' + PREFIX + '": ' + targetKeys.length);
  console.log('');
  console.log('=== First 10 matched keys ===');
  targetKeys.slice(0, 10).forEach(function(k, i) { console.log('  ' + (i + 1) + ': ' + k); });
  console.log('');
  console.log('=== Last 10 matched keys ===');
  targetKeys.slice(-10).forEach(function(k, i) {
    console.log('  ' + (targetKeys.length - 10 + i + 1) + ': ' + k);
  });
}

/**
 * Restores IDEM_MIGR-WL-* keys from a Drive export file written by
 * exportIdemMigrKeysBeforePurge() (or selfTestRestoreRoundTrip()'s
 * disposable copy of the same format). Every value in these markers is
 * the literal string '1' — the property's existence is the marker, not
 * its content — so restoration is a plain setProperty() replay of each
 * exported line. This is the actual undo path for the purge below.
 *
 * @param {string} fileId  Drive file ID of the export to restore from.
 * @returns {number}  Count of keys restored.
 */
function restoreIdemMigrKeysFromExport(fileId) {
  var file = DriveApp.getFileById(fileId);
  var content = file.getBlob().getDataAsString();
  var lines = content.split('\n');
  var props = PropertiesService.getScriptProperties();

  var restored = 0;
  lines.forEach(function(line) {
    var idx = line.indexOf(' = ');
    if (idx === -1) return; // header/blank lines, not a key=value row
    var key = line.substring(0, idx);
    var value = line.substring(idx + 3);
    if (key.indexOf('IDEM_MIGR-WL-') !== 0) return; // safety: only restore expected prefix
    props.setProperty(key, value);
    restored++;
  });

  console.log('Restored ' + restored + ' keys from export file ' + fileId);
  return restored;
}

/**
 * Self-contained round-trip test of the export → delete → restore path,
 * using disposable IDEM_MIGR-WL-RESTORETEST-* keys that don't collide
 * with any real data. Creates them, exports, deletes (simulating the
 * purge), restores from the export, verifies, then cleans up both the
 * test keys and the test export file. Safe to run directly against PROD —
 * touches nothing but its own throwaway keys.
 */
function selfTestRestoreRoundTrip() {
  var props = PropertiesService.getScriptProperties();
  var testKeys = [
    'IDEM_MIGR-WL-RESTORETEST-1-BATCH-001',
    'IDEM_MIGR-WL-RESTORETEST-2-BATCH-001',
    'IDEM_MIGR-WL-RESTORETEST-3-BATCH-001'
  ];

  testKeys.forEach(function(k) { props.setProperty(k, '1'); });
  console.log('Setup: created ' + testKeys.length + ' disposable test keys.');

  var lines = ['SELF-TEST export — ' + new Date().toISOString(),
               'Total keys: ' + testKeys.length, ''];
  testKeys.forEach(function(k) { lines.push(k + ' = ' + props.getProperty(k)); });
  var filename = 'selftest_restore_' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt';
  var file = DriveApp.createFile(filename, lines.join('\n'), MimeType.PLAIN_TEXT);
  console.log('Exported test keys to: ' + file.getUrl());

  testKeys.forEach(function(k) { props.deleteProperty(k); });
  var allGone = testKeys.every(function(k) { return props.getProperty(k) === null; });
  console.log('Deleted test keys (simulating purge). All gone: ' + allGone);

  var restoredCount = restoreIdemMigrKeysFromExport(file.getId());
  var allRestored = testKeys.every(function(k) { return props.getProperty(k) === '1'; });
  console.log('Restore reported ' + restoredCount + ' keys. All correctly restored: ' + allRestored);

  testKeys.forEach(function(k) { props.deleteProperty(k); });
  file.setTrashed(true);
  console.log('Cleanup complete — test keys removed, test export file trashed.');
  console.log('');
  console.log(allGone && allRestored && restoredCount === testKeys.length
    ? 'ROUND-TRIP TEST PASSED'
    : 'ROUND-TRIP TEST FAILED — do not trust the restore path until this is fixed.');
}

/**
 * Deletes historical migration idempotency-key properties in batches,
 * RESTRICTED to SAFE_BATCH_TAGS only — BATCH-004 (JuneWorkLogImporter,
 * still being actively reconciled per CTO_TASK_QUEUE.md) is deliberately
 * excluded until explicitly confirmed closed. Recomputes the matching set
 * fresh on every call, self-reports remaining count, self-terminates at 0.
 * Re-run repeatedly until it reports PURGE COMPLETE.
 */
function purgeIdemMigrKeysBatch() {
  var PREFIX = 'IDEM_MIGR-WL-';
  var SAFE_BATCH_TAGS = []; // INTENTIONALLY EMPTY — populate only after
                            // per-batch confirmation from censusIdemMigrKeys()
                            // output; see file header for batch mapping.
  var BATCH_LIMIT = 1000;

  if (SAFE_BATCH_TAGS.length === 0) {
    console.log('SAFE_BATCH_TAGS is empty — refusing to delete anything. ' +
                'Run censusIdemMigrKeys() first, confirm which batches are ' +
                'safe, then populate SAFE_BATCH_TAGS before re-running.');
    return;
  }

  var props = PropertiesService.getScriptProperties();
  var allMatched = Object.keys(props.getProperties()).filter(function(k) {
    return k.indexOf(PREFIX) === 0;
  });
  var targetKeys = allMatched.filter(function(k) {
    return SAFE_BATCH_TAGS.some(function(tag) { return k.indexOf(tag) !== -1; });
  });

  console.log('Fresh recount this execution: ' + targetKeys.length +
              ' keys remain (restricted to ' + SAFE_BATCH_TAGS.join(', ') + ').');
  if (targetKeys.length === 0) {
    console.log('PURGE COMPLETE — no matching keys remain in the approved batch set.');
    return;
  }

  var batch = targetKeys.slice(0, BATCH_LIMIT);
  batch.forEach(function(key) { props.deleteProperty(key); });

  console.log('Deleted ' + batch.length + ' keys this run. ' +
              (targetKeys.length - batch.length) + ' remain — re-run to continue.');
}
