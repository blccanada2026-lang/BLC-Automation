// ============================================================
// IdempotencyEngine.gs — BLC Nexus T3 Infrastructure
// src/03-infrastructure/IdempotencyEngine.gs
//
// Prevents duplicate processing of form submissions and migration
// events. Uses ScriptProperties for persistence across executions
// with an in-memory cache for speed within a single run.
//
// Interface: checkAndMark(key) → true if first time, false if duplicate
//
// LOAD ORDER: After Logger.gs
// DEPENDENCIES: none
// ============================================================

var IdempotencyEngine = (function () {

  var MODULE   = 'IdempotencyEngine';
  var PREFIX   = 'IDEM_';
  var cache_   = {};   // resets each execution — backed by ScriptProperties

  /**
   * Checks whether `key` has been processed before.
   * If not, marks it as processed and returns true (caller should proceed).
   * If already processed, returns false (caller should skip).
   *
   * @param {string} key  Unique idempotency key (e.g. source_submission_id)
   * @returns {boolean}
   */
  function checkAndMark(key) {
    if (!key) return true; // no key = cannot deduplicate — allow through

    if (cache_[key]) return false;

    var props    = PropertiesService.getScriptProperties();
    var propKey  = PREFIX + key;

    if (props.getProperty(propKey) !== null) {
      cache_[key] = true;
      return false;
    }

    try {
      props.setProperty(propKey, '1');
    } catch (e) {
      // ScriptProperties full — log and allow through to avoid silent data loss
      Logger.warn('IDEMPOTENCY_STORE_FULL', { module: MODULE, key: key, error: e.message });
      return true;
    }

    cache_[key] = true;
    return true;
  }

  /**
   * Removes a key from both the in-memory cache and ScriptProperties.
   * Use when a handler fails partway through and the write must be retried.
   *
   * @param {string} key
   */
  function clear(key) {
    if (!key) return;
    delete cache_[key];
    try {
      PropertiesService.getScriptProperties().deleteProperty(PREFIX + key);
    } catch (e) {
      Logger.warn('IDEMPOTENCY_CLEAR_FAILED', { module: MODULE, key: key, error: e.message });
    }
  }

  /**
   * Resets the in-memory cache. Does NOT touch ScriptProperties.
   * Useful in test suites where you want a fresh in-memory state
   * without clearing the persistent store.
   */
  function resetCache() {
    cache_ = {};
  }

  return {
    checkAndMark: checkAndMark,
    clear:        clear,
    resetCache:   resetCache
  };

}());
