/**
 * ConfigService.js — BLC Job Management System
 * ================================================================
 * Reads configuration values from CONFIG_MASTER via SheetDB.
 *
 * USAGE:
 *   ConfigService.get('supervisor_bonus_rate')       // → '25'
 *   ConfigService.getNumber('supervisor_bonus_rate') // → 25
 *   ConfigService.getBoolean('some_flag')            // → true / false
 *   ConfigService.getList('ceo_emails')              // → ['a@b.com', 'c@d.com']
 *
 * Values are cached for the lifetime of one script execution.
 * Call ConfigService.clearCache() to force a re-read (useful in tests).
 *
 * IMPORTANT: CONFIG_MASTER must exist in the spreadsheet.
 * Run SheetDB.bootstrap() once to create it if it is missing.
 * ================================================================
 */

var ConfigService = (function () {

  // In-memory cache: populated on first call, lives for one execution.
  var _cache = null;

  // ── Private: load all config rows into _cache ──────────────────
  function _load() {
    if (_cache !== null) return;

    _cache = {};

    var rows;
    try {
      rows = SheetDB.getAll('CONFIG_MASTER');
    } catch (e) {
      Logger.log('ConfigService: failed to read CONFIG_MASTER — ' + e.message);
      return;
    }

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var key = String(row.configKey || '').trim();
      if (!key) continue;
      _cache[key] = String(row.configValue !== undefined ? row.configValue : '').trim();
    }

    Logger.log('ConfigService: loaded ' + Object.keys(_cache).length + ' config keys.');
  }

  // ── Public API ─────────────────────────────────────────────────

  /**
   * Returns the raw string value for a config key.
   * Returns defaultValue (default: '') if the key is not found.
   */
  function get(key, defaultValue) {
    _load();
    if (defaultValue === undefined) defaultValue = '';

    if (_cache === null || !_cache.hasOwnProperty(key)) {
      Logger.log('ConfigService WARNING: key not found — "' + key + '". Using default: "' + defaultValue + '".');
      return defaultValue;
    }
    return _cache[key];
  }

  /**
   * Returns the value parsed as a Number.
   * Returns defaultValue (default: 0) if the key is missing or not numeric.
   */
  function getNumber(key, defaultValue) {
    if (defaultValue === undefined) defaultValue = 0;
    var raw = get(key, null);
    if (raw === null) return defaultValue;
    var n = parseFloat(raw);
    if (isNaN(n)) {
      Logger.log('ConfigService WARNING: key "' + key + '" value "' + raw + '" is not a number. Using default: ' + defaultValue);
      return defaultValue;
    }
    return n;
  }

  /**
   * Returns the value parsed as a Boolean.
   * Truthy strings: 'true', 'yes', '1'. Everything else is false.
   * Returns defaultValue (default: false) if the key is missing.
   */
  function getBoolean(key, defaultValue) {
    if (defaultValue === undefined) defaultValue = false;
    var raw = get(key, null);
    if (raw === null) return defaultValue;
    var s = raw.toLowerCase();
    return (s === 'true' || s === 'yes' || s === '1');
  }

  /**
   * Returns the value split into an array by commas.
   * Each item is trimmed. Returns [] if the key is missing.
   * Useful for multi-value config like ceo_emails.
   */
  function getList(key) {
    var raw = get(key, '');
    if (!raw) return [];
    return raw.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s !== ''; });
  }

  /**
   * Clears the in-memory cache.
   * Next call to get/getNumber/getBoolean will re-read CONFIG_MASTER.
   */
  function clearCache() {
    _cache = null;
  }

  return {
    get        : get,
    getNumber  : getNumber,
    getBoolean : getBoolean,
    getList    : getList,
    clearCache : clearCache
  };

})();


// =================================================================
// SEED FUNCTION
// Run once from Apps Script to populate CONFIG_MASTER.
//
// HOW TO USE:
//   1. Open Apps Script editor (Extensions → Apps Script).
//   2. Select seedConfigMaster from the function dropdown.
//   3. Click Run.
//
// Safe to re-run: skips any key that already exists in the sheet.
// Set SEED_FORCE = true to overwrite all existing values.
// =================================================================

var SEED_FORCE = false;  // ← set true only if you want to reset all values

var CONFIG_MASTER_SEED = [
  // ── PAYROLL ───────────────────────────────────────────────────
  { configKey: 'supervisor_bonus_rate',   configValue: '25',                                configGroup: 'PAYROLL'   },
  { configKey: 'payroll_from_email',      configValue: 'blccanada2026@gmail.com',            configGroup: 'PAYROLL'   },
  { configKey: 'payroll_hr_email',        configValue: 'hr@bluelotuscanada.ca',              configGroup: 'PAYROLL'   },
  { configKey: 'payroll_approval_email',  configValue: 'raj.nair@bluelotuscanada.ca',        configGroup: 'PAYROLL'   },

  // ── BILLING ───────────────────────────────────────────────────
  { configKey: 'gst_rate',               configValue: '0.05',                               configGroup: 'BILLING'   },
  { configKey: 'gst_number',             configValue: '827089830RT0001',                    configGroup: 'BILLING'   },
  { configKey: 'default_billing_rate_cad', configValue: '85',                               configGroup: 'BILLING'   },
  { configKey: 'usd_to_cad_rate',        configValue: '1.42',                               configGroup: 'BILLING'   },

  // ── EMAIL ─────────────────────────────────────────────────────
  { configKey: 'system_from_email',      configValue: 'blccanada2026@gmail.com',            configGroup: 'EMAIL'     },
  { configKey: 'invoice_from_email',     configValue: 'blccanada2026@gmail.com',            configGroup: 'EMAIL'     },
  { configKey: 'contact_email',          configValue: 'contact@bluelotuscanada.ca',         configGroup: 'EMAIL'     },

  // ── SYSTEM ────────────────────────────────────────────────────
  { configKey: 'company_name',           configValue: 'Blue Lotus Consulting Corporation',  configGroup: 'SYSTEM'    },
  { configKey: 'company_address',        configValue: '541 Avenue I north | Saskatoon, SK S7L2G9', configGroup: 'SYSTEM' },
  { configKey: 'company_email',          configValue: 'contact@bluelotuscanada.ca',         configGroup: 'SYSTEM'    },

  // ── SECURITY ──────────────────────────────────────────────────
  { configKey: 'ceo_emails',             configValue: 'rajnaircanada@gmail.com,blccanada2026@gmail.com,Nairscanada@gmail.com', configGroup: 'SECURITY' },

  // ── BONUS ─────────────────────────────────────────────────────
  { configKey: 'quarterly_bonus_threshold_A', configValue: '4.5',                           configGroup: 'BONUS'     },
  { configKey: 'quarterly_bonus_threshold_B', configValue: '3.5',                           configGroup: 'BONUS'     },
  { configKey: 'quarterly_bonus_rate_A', configValue: '0.15',                               configGroup: 'BONUS'     },
  { configKey: 'quarterly_bonus_rate_B', configValue: '0.10',                               configGroup: 'BONUS'     },
  { configKey: 'bonus_links_send_direct',  configValue: 'false',                            configGroup: 'BONUS'     },
  { configKey: 'quarterly_bonus_rate_inr', configValue: '25',                               configGroup: 'BONUS'     },

  // ── WORKFLOW ──────────────────────────────────────────────────
  { configKey: 'billing_period_1_start', configValue: '1',                                  configGroup: 'WORKFLOW'  },
  { configKey: 'billing_period_1_end',   configValue: '15',                                 configGroup: 'WORKFLOW'  },
  { configKey: 'billing_period_2_start', configValue: '16',                                 configGroup: 'WORKFLOW'  },
  { configKey: 'feedback_request_delay_days', configValue: '3',                             configGroup: 'WORKFLOW'  },
];

function seedConfigMaster() {
  // Read what's already in the sheet.
  var existing = {};
  try {
    var rows = SheetDB.getAll('CONFIG_MASTER');
    for (var i = 0; i < rows.length; i++) {
      var k = String(rows[i].configKey || '').trim();
      if (k) existing[k] = true;
    }
  } catch (e) {
    Logger.log('seedConfigMaster: could not read CONFIG_MASTER — ' + e.message +
               '\nMake sure SheetDB.bootstrap() has been run first.');
    return;
  }

  var toInsert = [];
  var skipped  = [];

  for (var j = 0; j < CONFIG_MASTER_SEED.length; j++) {
    var entry = CONFIG_MASTER_SEED[j];
    if (!SEED_FORCE && existing[entry.configKey]) {
      skipped.push(entry.configKey);
    } else {
      toInsert.push(entry);
    }
  }

  if (toInsert.length === 0) {
    Logger.log('seedConfigMaster: all ' + skipped.length + ' keys already exist. Nothing written. Set SEED_FORCE = true to overwrite.');
    return;
  }

  SheetDB.insertRows('CONFIG_MASTER', toInsert);
  ConfigService.clearCache();

  Logger.log('seedConfigMaster: inserted ' + toInsert.length + ' rows.');
  if (skipped.length > 0) {
    Logger.log('seedConfigMaster: skipped ' + skipped.length + ' existing keys: ' + skipped.join(', '));
  }
}
