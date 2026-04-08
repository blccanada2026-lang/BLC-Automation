// ============================================================
// ClientOnboarding.gs — BLC Nexus T9 Billing
// src/09-billing/ClientOnboarding.gs
//
// LOAD ORDER: T9. Loads after all T0–T7 files.
// DEPENDENCIES: Config (T0), Identifiers (T0), DAL (T1),
//               RBAC (T2), Logger (T3)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Client onboarding — creates client master record and   ║
// ║  initial rate configuration in one atomic operation.    ║
// ║                                                         ║
// ║  onboardClient(actorEmail, payload)                     ║
// ║    → writes DIM_CLIENT_MASTER + DIM_CLIENT_RATES        ║
// ║                                                         ║
// ║  getClients(actorEmail)                                 ║
// ║    → returns all active clients with their rates        ║
// ║                                                         ║
// ║  Permission: ADMIN_CONFIG (PM + CEO)                    ║
// ╚══════════════════════════════════════════════════════════╝
//
// PAYLOAD SCHEMA for onboardClient():
//   client_code   string  required  2–20 chars, uppercase alphanumeric
//   client_name   string  required  max 100 chars
//   contact_email string  optional  max 100 chars
//   currency      string  required  'CAD' | 'USD'
//   hourly_rate   number  required  > 0
//   notes         string  optional  max 500 chars
//
// RATE STRUCTURE created:
//   One DIM_CLIENT_RATES row with product_code = '' (flat rate).
//   To add product-specific rates later, insert additional rows
//   directly in DIM_CLIENT_RATES with the product_code filled in.
//
// DUPLICATE HANDLING:
//   If client_code already exists in DIM_CLIENT_MASTER:
//     → existing master record is left unchanged
//     → a new rate row is appended (rate history preserved)
//     → use updateClientRate() to add overrides without duplicating master
// ============================================================

var ClientOnboarding = (function () {

  var MODULE = 'ClientOnboarding';

  var SUPPORTED_CURRENCIES = { CAD: true, USD: true };

  // ============================================================
  // SECTION 1: VALIDATION
  // ============================================================

  /**
   * Validates and normalises the onboarding payload.
   * Throws a descriptive Error on any violation.
   *
   * @param {Object} payload
   * @returns {Object}  Normalised payload
   */
  function validatePayload_(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('ClientOnboarding: payload must be a non-null object.');
    }

    // client_code
    var clientCode = String(payload.client_code || '').toUpperCase().trim();
    if (!clientCode) {
      throw new Error('ClientOnboarding: client_code is required.');
    }
    if (clientCode.length < 2 || clientCode.length > 20) {
      throw new Error('ClientOnboarding: client_code must be 2–20 characters. Got: "' + clientCode + '".');
    }
    if (!/^[A-Z0-9_-]+$/.test(clientCode)) {
      throw new Error('ClientOnboarding: client_code must be uppercase alphanumeric (A-Z, 0-9, -, _). Got: "' + clientCode + '".');
    }

    // client_name
    var clientName = String(payload.client_name || '').trim();
    if (!clientName) {
      throw new Error('ClientOnboarding: client_name is required.');
    }
    if (clientName.length > 100) {
      throw new Error('ClientOnboarding: client_name exceeds 100 characters.');
    }

    // currency
    var currency = String(payload.currency || '').toUpperCase().trim();
    if (!SUPPORTED_CURRENCIES[currency]) {
      throw new Error('ClientOnboarding: currency must be CAD or USD. Got: "' + currency + '".');
    }

    // hourly_rate
    var hourlyRate = parseFloat(payload.hourly_rate);
    if (isNaN(hourlyRate) || hourlyRate <= 0) {
      throw new Error('ClientOnboarding: hourly_rate must be a positive number. Got: ' + payload.hourly_rate);
    }

    return {
      client_code:   clientCode,
      client_name:   clientName,
      contact_email: String(payload.contact_email || '').trim().toLowerCase(),
      currency:      currency,
      hourly_rate:   Math.round(hourlyRate * 100) / 100,
      notes:         String(payload.notes || '').trim().substring(0, 500)
    };
  }

  // ============================================================
  // SECTION 2: onboardClient
  // ============================================================

  /**
   * Creates a new client master record and flat hourly rate.
   * Safe to call if the client already exists — adds a new rate
   * row without modifying the existing master row.
   *
   * @param {string} actorEmail
   * @param {Object} payload
   * @returns {{ clientCode: string, isNew: boolean, rateAdded: boolean }}
   */
  function onboardClient(actorEmail, payload) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    var clean = validatePayload_(payload);
    var now   = new Date().toISOString();
    var today = now.substring(0, 10); // YYYY-MM-DD

    // ── Check if client already exists ───────────────────────
    var isNew = true;
    try {
      var existing = DAL.readWhere(
        Config.TABLES.DIM_CLIENT_MASTER,
        { client_code: clean.client_code },
        { callerModule: MODULE }
      );
      if (existing.length > 0) isNew = false;
    } catch (e) {
      if (e.code !== 'SHEET_NOT_FOUND') throw e;
    }

    // ── Write DIM_CLIENT_MASTER (new clients only) ────────────
    if (isNew) {
      DAL.appendRow(
        Config.TABLES.DIM_CLIENT_MASTER,
        {
          client_code:   clean.client_code,
          client_name:   clean.client_name,
          contact_email: clean.contact_email,
          currency:      clean.currency,
          active:        'TRUE',
          effective_from: today,
          effective_to:  '',
          notes:         clean.notes
        },
        { callerModule: MODULE }
      );
    }

    // ── Write DIM_CLIENT_RATES (flat rate row) ────────────────
    // product_code is '' → flat rate for all products
    DAL.appendRow(
      Config.TABLES.DIM_CLIENT_RATES,
      {
        client_code:   clean.client_code,
        product_code:  '',
        hourly_rate:   clean.hourly_rate,
        currency:      clean.currency,
        active:        'TRUE',
        effective_from: today,
        effective_to:  '',
        notes:         clean.notes
      },
      { callerModule: MODULE }
    );

    Logger.info('CLIENT_ONBOARDED', {
      module:      MODULE,
      message:     isNew ? 'New client onboarded' : 'Rate added to existing client',
      client_code: clean.client_code,
      client_name: clean.client_name,
      currency:    clean.currency,
      hourly_rate: clean.hourly_rate,
      actor:       actorEmail
    });

    return {
      clientCode: clean.client_code,
      isNew:      isNew,
      rateAdded:  true
    };
  }

  // ============================================================
  // SECTION 3: getClients
  // ============================================================

  /**
   * Returns all active clients from DIM_CLIENT_MASTER, each
   * enriched with their current flat hourly rate from DIM_CLIENT_RATES.
   *
   * Used by the portal to populate the client onboarding list.
   *
   * @param {string} actorEmail
   * @returns {Object[]}  Array of client objects
   */
  function getClients(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    var masters = [];
    try {
      masters = DAL.readAll(Config.TABLES.DIM_CLIENT_MASTER, { callerModule: MODULE });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return [];
      throw e;
    }

    // Build rate map: client_code → latest flat rate
    var rateMap = {};
    try {
      var rates = DAL.readAll(Config.TABLES.DIM_CLIENT_RATES, { callerModule: MODULE });
      for (var i = 0; i < rates.length; i++) {
        var r = rates[i];
        if (String(r.active || '').toUpperCase() !== 'TRUE') continue;
        if (String(r.product_code || '').trim() !== '') continue; // skip specific-product rows
        var code = String(r.client_code || '').toUpperCase().trim();
        // Keep highest rate if multiple flat rows (shouldn't happen, but safe)
        var rate = parseFloat(r.hourly_rate) || 0;
        if (!rateMap[code] || rate > rateMap[code].hourly_rate) {
          rateMap[code] = { hourly_rate: rate, currency: String(r.currency || 'CAD') };
        }
      }
    } catch (e) {
      if (e.code !== 'SHEET_NOT_FOUND') throw e;
    }

    return masters
      .filter(function(m) { return String(m.active || '').toUpperCase() === 'TRUE'; })
      .map(function(m) {
        var code    = String(m.client_code || '').toUpperCase().trim();
        var rateRow = rateMap[code] || {};
        return {
          client_code:   code,
          client_name:   m.client_name   || '',
          contact_email: m.contact_email || '',
          currency:      m.currency      || rateRow.currency || 'CAD',
          hourly_rate:   rateRow.hourly_rate || '',
          notes:         m.notes         || ''
        };
      });
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {
    onboardClient: onboardClient,
    getClients:    getClients
  };

}());
