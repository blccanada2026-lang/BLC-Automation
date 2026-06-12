// ============================================================
// PortalAuth.gs — BLC Nexus portal identity (B1 interim fix)
// src/02-security/PortalAuth.gs
//
// PROBLEM: Session.getActiveUser().getEmail() returns '' for
// consumer-Gmail staff in execute-as-me deployments, and the old
// fallback trusted a typed email (no verification).
//
// FIX: personal capability links. Each staff member receives a
// portal URL carrying a signed token:
//
//   <exec-url>?pt=PT1.<person_code>.<base64url(HMAC_SHA256(
//       person_code + '|PORTAL|v1', PORTAL_LINK_SECRET))>
//
// resolveEmail() trusts, in order:
//   1. A non-empty Session email (owner / same-domain users)
//   2. A valid signed token → active roster row → email
// Anything else throws AUTH_REQUIRED.
//
// Revocation: rotate the secret (runGeneratePortalSecret) and
// re-send links (portal_sendPortalLinks). All old links die.
//
// SETUP (once per script project):
//   1. runGeneratePortalSecret()
//   2. setPortalBaseUrl('<exec url>')  — if not already set
//   3. portal_sendPortalLinks from the portal (CEO), or
//      runSendAllPortalLinks() from the editor
// ============================================================

var PortalAuth = (function () {

  var TOKEN_PREFIX  = 'PT1';
  var SECRET_PROP   = 'PORTAL_LINK_SECRET';
  var TOKEN_VERSION = 'v1';
  var RATE_PREFIX   = 'PLINK_RATE_';
  var RATE_LIMIT_SECONDS = 600; // one self-service link email per 10 min

  function getSecret_() {
    var secret = PropertiesService.getScriptProperties().getProperty(SECRET_PROP);
    if (!secret) {
      throw new Error(
        'PortalAuth: PORTAL_LINK_SECRET not set. ' +
        'Run runGeneratePortalSecret() once from the Apps Script editor.'
      );
    }
    return secret;
  }

  function sign_(personCode) {
    var msg   = String(personCode) + '|PORTAL|' + TOKEN_VERSION;
    var bytes = Utilities.computeHmacSha256Signature(msg, getSecret_());
    return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
  }

  /**
   * Issues a portal token for a person_code.
   * @param {string} personCode
   * @returns {string} e.g. 'PT1.DS1.AbC...'
   */
  function issueToken(personCode) {
    personCode = String(personCode || '').trim();
    if (!personCode) throw new Error('PortalAuth.issueToken: personCode required.');
    return TOKEN_PREFIX + '.' + personCode + '.' + sign_(personCode);
  }

  /**
   * Verifies a token. Returns the person_code on success, null on
   * any failure (malformed, bad signature, wrong prefix).
   * Never throws — callers decide how to fail.
   * @param {string} token
   * @returns {string|null}
   */
  function verifyToken(token) {
    if (!token || typeof token !== 'string') return null;
    var parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
    var personCode = parts[1];
    if (!personCode) return null;
    try {
      if (parts[2] === sign_(personCode)) return personCode;
    } catch (e) {
      // secret missing — treat as invalid rather than leaking the error
    }
    return null;
  }

  /**
   * Looks up the active roster row for a person_code.
   * @returns {Object|null}  roster row or null
   */
  function rosterRowByCode_(personCode) {
    var rows;
    try {
      rows = DAL.readWhere(Config.TABLES.DIM_STAFF_ROSTER, { person_code: personCode });
    } catch (e) {
      return null;
    }
    for (var i = 0; i < (rows || []).length; i++) {
      var active = rows[i].active;
      if (active === true || String(active).toUpperCase() === 'TRUE') return rows[i];
    }
    return null;
  }

  /**
   * Resolves the calling user's email. THE single identity entry
   * point for every portal_* server function.
   *
   * @param {string} ptoken  Portal token from the client (may be '')
   * @returns {string} verified email
   * @throws  {Error}  AUTH_REQUIRED when neither source verifies
   */
  function resolveEmail(ptoken) {
    // 1. Google-verified session (script owner / same-domain users)
    var sessionEmail = '';
    try { sessionEmail = Session.getActiveUser().getEmail() || ''; } catch (e) {}
    if (sessionEmail) return sessionEmail;

    // 2. Signed capability token
    var personCode = verifyToken(ptoken);
    if (personCode) {
      var row = rosterRowByCode_(personCode);
      if (row) {
        var email = String(row.email || '').trim();
        if (email) return email;
      }
    }

    throw new Error(
      'AUTH_REQUIRED: This action requires your personal portal link. ' +
      'Open the portal from the link in your onboarding email, or request ' +
      'a new link from the login screen.'
    );
  }

  /**
   * Self-service: emails the personal portal link to a roster email.
   * Rate-limited per email. ALWAYS returns the same generic result so
   * roster membership is not disclosed to outsiders.
   *
   * @param {string} email  address typed on the login screen
   * @returns {{ok: boolean}}
   */
  function requestLink(email) {
    var generic = { ok: true };
    email = String(email || '').toLowerCase().trim();
    if (!email || email.indexOf('@') === -1) return generic;

    // Rate limit
    var cache = CacheService.getScriptCache();
    var rateKey = RATE_PREFIX + email;
    if (cache.get(rateKey)) return generic;
    cache.put(rateKey, '1', RATE_LIMIT_SECONDS);

    // Roster lookup by email
    var rows;
    try {
      rows = DAL.readWhere(Config.TABLES.DIM_STAFF_ROSTER, { email: email });
    } catch (e) { return generic; }
    var row = null;
    for (var i = 0; i < (rows || []).length; i++) {
      var active = rows[i].active;
      if (active === true || String(active).toUpperCase() === 'TRUE') { row = rows[i]; break; }
    }
    if (!row || !String(row.person_code || '').trim()) return generic;

    try {
      sendLinkEmail_(String(row.person_code).trim(), String(row.name || ''), email, false);
    } catch (e) {
      Logger.warn('PORTAL_LINK_SEND_FAILED', { module: 'PortalAuth', email: email, error: e.message });
    }
    return generic;
  }

  /** Builds the personal portal URL for a person_code. */
  function buildLink_(personCode) {
    var base = PropertiesService.getScriptProperties().getProperty('PORTAL_BASE_URL') || '';
    if (!base) {
      throw new Error('PORTAL_BASE_URL not set. Run setPortalBaseUrl(url) once from the Apps Script editor.');
    }
    return base + (base.indexOf('?') === -1 ? '?' : '&') + 'pt=' + encodeURIComponent(issueToken(personCode));
  }

  function sendLinkEmail_(personCode, name, recipient, isTest) {
    var link = buildLink_(personCode);
    MailApp.sendEmail({
      to:      recipient,
      subject: 'BLC Nexus — your personal portal link' + (isTest ? ' [TEST]' : ''),
      htmlBody: [
        '<p>Hi ' + (name || personCode) + ',</p>',
        '<p>Here is your personal link to the BLC Nexus portal. ',
        'It identifies you — <strong>do not share or forward it</strong>.</p>',
        '<p><a href="' + link + '" style="display:inline-block;padding:10px 20px;',
        'background:#2563eb;color:#fff;text-decoration:none;border-radius:4px;">Open My Portal</a></p>',
        '<p>If the button does not work, copy this address into your browser:<br>' + link + '</p>',
        '<p>Bookmark it. If you lose it, request a new one from the portal login screen.</p>',
        '<p>Thanks,<br>BLC Nexus</p>'
      ].join('\n')
    });
  }

  /**
   * Bulk-sends personal links to every active roster member.
   * Caller must already be authorised (Portal.gs gates on CEO).
   *
   * @param {string|null} testEmail  redirect all emails here (test mode)
   * @param {boolean}     dryRun     list recipients without sending
   * @returns {{sent: number, recipients: string[], skipped: string[]}}
   */
  function sendAllLinks(testEmail, dryRun) {
    var allStaff = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'PortalAuth' });
    var sent = 0, recipients = [], skipped = [];
    var seen = {};

    for (var i = 0; i < allStaff.length; i++) {
      var s      = allStaff[i];
      var active = s.active === true || String(s.active).toUpperCase() === 'TRUE';
      var code   = String(s.person_code || '').trim();
      var email  = String(s.email || '').trim();
      if (!active || !code || !email) {
        skipped.push(code || email || ('row ' + i));
        continue;
      }
      if (seen[code]) {
        skipped.push(code + ' (duplicate row)');
        continue;
      }
      seen[code] = true;
      if (!dryRun) {
        sendLinkEmail_(code, String(s.name || ''), testEmail || email, !!testEmail);
      }
      recipients.push(code + ' → ' + (testEmail || email));
      sent++;
    }
    return { sent: sent, recipients: recipients, skipped: skipped };
  }

  return {
    issueToken:   issueToken,
    verifyToken:  verifyToken,
    resolveEmail: resolveEmail,
    requestLink:  requestLink,
    sendAllLinks: sendAllLinks
  };

}());

// ============================================================
// ONE-TIME SETUP HELPERS (run from the Apps Script editor)
// ============================================================

/** Generates the portal-link secret. Rotating it kills ALL existing links. */
function runGeneratePortalSecret() {
  var secret = Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + Date.now() + Math.random())
  );
  PropertiesService.getScriptProperties().setProperty('PORTAL_LINK_SECRET', secret);
  console.log('PORTAL_LINK_SECRET generated. Existing portal links (if any) are now invalid — re-send with runSendAllPortalLinks().');
}

/** Emails every active roster member their personal portal link. */
function runSendAllPortalLinks() {
  var r = PortalAuth.sendAllLinks(null, false);
  console.log('Sent: ' + r.sent + '\n' + r.recipients.join('\n') +
              (r.skipped.length ? '\nSkipped: ' + r.skipped.join(', ') : ''));
}

/** Dry run — lists who would receive a link without sending anything. */
function runListPortalLinkRecipients() {
  var r = PortalAuth.sendAllLinks(null, true);
  console.log('Would send: ' + r.sent + '\n' + r.recipients.join('\n') +
              (r.skipped.length ? '\nSkipped: ' + r.skipped.join(', ') : ''));
}

/** Sends ALL links to one test inbox (subject tagged [TEST]). */
function runSendPortalLinksTest() {
  var TEST_INBOX = 'blccanada2026@gmail.com'; // change if needed
  var r = PortalAuth.sendAllLinks(TEST_INBOX, false);
  console.log('Sent ' + r.sent + ' test emails to ' + TEST_INBOX);
}

/**
 * Audits DIM_STAFF_ROSTER for portal-link readiness.
 * Prints environment, then groups by person_code and reports:
 *   WILL RECEIVE LINK — one usable active row
 *   DUPLICATE ACTIVE ROWS — multiple active rows (needs manual cleanup)
 *   LOCKED OUT — rows exist but no active row with email (critical)
 *   TEST ACTORS — known dev-only codes that must not exist in PROD
 * Ends with SAFE TO SEND or FIX ROSTER BEFORE SENDING.
 */
function runAuditPortalLinkRoster() {
  var ss  = SpreadsheetApp.openById(Config.getSpreadsheetId());
  console.log('Spreadsheet: ' + ss.getName() + ' | ENV: ' + Config.getEnvironment());
  console.log('══════════════════════════════════════════');

  var TEST_ACTOR_CODES = { DS1: true, QC1: true, RND: true, NTL: true };
  var allStaff = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'PortalAuth' });

  // Group all rows by person_code
  var byCode = {};
  for (var i = 0; i < allStaff.length; i++) {
    var s    = allStaff[i];
    var code = String(s.person_code || '').trim();
    if (!code) continue;
    if (!byCode[code]) byCode[code] = [];
    byCode[code].push(s);
  }

  var willReceive = [], duplicateActive = [], lockedOut = [], testActors = [];

  for (var code in byCode) {
    if (!byCode.hasOwnProperty(code)) continue;
    var rows = byCode[code];

    var activeRows = rows.filter(function(r) {
      var active = r.active === true || String(r.active).toUpperCase() === 'TRUE';
      return active && String(r.email || '').trim();
    });

    if (TEST_ACTOR_CODES[code]) {
      testActors.push(code + ' → ' + (activeRows.length ? activeRows[0].email : '(inactive)'));
      continue;
    }

    if (activeRows.length === 0) {
      lockedOut.push(code);
    } else if (activeRows.length === 1) {
      willReceive.push(code + ' → ' + activeRows[0].email);
    } else {
      duplicateActive.push(code + ' (' + activeRows.length + ' active rows: ' +
        activeRows.map(function(r) { return r.email; }).join(', ') + ')');
    }
  }

  console.log('WILL RECEIVE LINK (' + willReceive.length + '):');
  willReceive.forEach(function(l) { console.log('  ' + l); });

  if (duplicateActive.length) {
    console.log('\nDUPLICATE ACTIVE ROWS (' + duplicateActive.length + ') — needs manual cleanup:');
    duplicateActive.forEach(function(l) { console.log('  ' + l); });
  }

  if (lockedOut.length) {
    console.log('\nLOCKED OUT (' + lockedOut.length + ') — no active row with email:');
    lockedOut.forEach(function(l) { console.log('  ' + l); });
  }

  if (testActors.length) {
    console.log('\nTEST ACTORS (' + testActors.length + ') — must not exist in PROD roster:');
    testActors.forEach(function(l) { console.log('  ' + l); });
  }

  console.log('══════════════════════════════════════════');
  var safe = duplicateActive.length === 0 && lockedOut.length === 0;
  console.log(safe ? 'SAFE TO SEND' : 'FIX ROSTER BEFORE SENDING');
}
