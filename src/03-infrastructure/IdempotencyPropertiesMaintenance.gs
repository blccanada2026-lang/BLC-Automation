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
// LOAD ORDER: After IdempotencyEngine.gs
// DEPENDENCIES: none
// ============================================================

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
 * Deletes historical migration idempotency-key properties in batches.
 * Recomputes the matching set fresh on every call (never operates on a
 * stale list), self-reports remaining count, self-terminates at 0.
 * Re-run repeatedly until it reports PURGE COMPLETE.
 */
function purgeIdemMigrKeysBatch() {
  var PREFIX = 'IDEM_MIGR-WL-';
  var BATCH_LIMIT = 1000;

  var props = PropertiesService.getScriptProperties();
  var targetKeys = Object.keys(props.getProperties()).filter(function(k) {
    return k.indexOf(PREFIX) === 0;
  });

  console.log('Fresh recount this execution: ' + targetKeys.length + ' keys remain.');
  if (targetKeys.length === 0) {
    console.log('PURGE COMPLETE — no matching keys remain.');
    return;
  }

  var batch = targetKeys.slice(0, BATCH_LIMIT);
  batch.forEach(function(key) { props.deleteProperty(key); });

  console.log('Deleted ' + batch.length + ' keys this run. ' +
              (targetKeys.length - batch.length) + ' remain — re-run to continue.');
}
