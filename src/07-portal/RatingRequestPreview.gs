// ============================================================
// RatingRequestPreview.gs — BLC Nexus T7 Portal
// src/07-portal/RatingRequestPreview.gs
//
// Read-only preview for PortalData.sendRatingRequests() (internal
// TL/PM/CEO quarterly performance ratings — see PortalData.gs Section 9,
// distinct from ClientFeedback.gs's external client feedback flow).
// New small file rather than adding to PortalData.gs (already 1770
// lines, well over RULE A8's ~500-line cap) — matches the precedent set
// by src/12-migration/IntegrityMonitorBaselineAudit.gs earlier this
// session: one-off diagnostic/preview logic gets its own small file
// instead of growing an already-oversized module further.
//
// sendRatingRequests() already has a genuine, built-in dryRun parameter
// that gates its one MailApp.sendEmail() call per recipient — confirmed
// by reading the function directly, not assumed. There is no FormApp
// usage anywhere in this flow at all (portal-link emails only), so
// dryRun=true has zero side effects already; unlike ClientFeedback.gs's
// sendFeedbackRequests(), no new preview-only code path was needed for
// the who-rates-whom data itself. This file only adds: (1) console
// output formatting, and (2) a reproduction (not a call) of the exact
// subject/body email template for display, since the dry-run result
// doesn't include rendered content.
// ============================================================

/**
 * TRUE PREVIEW — calls the real PortalData.sendRatingRequests(...,
 * dryRun=true). No writes, no emails sent. Uses the real who-rates-whom
 * mapping that function returns (not a reimplementation), and separately
 * reproduces its exact subject/body template for display — that template
 * is built inline inside the function's MailApp.sendEmail() calls, not
 * returned by the dry-run result itself.
 *
 * @returns {Object}  The raw dry-run result from sendRatingRequests()
 *   (period_id, dry_run, would_send[] — each with to/label/rates/url).
 */
function runQ2RatingRequestPreview() {
  var REDIRECT_TO = 'hr@bluelotuscanada.ca';
  var periodId    = '2026-Q2';

  var result = PortalData.sendRatingRequests('raj.nair@bluelotuscanada.ca', periodId, REDIRECT_TO, true);

  console.log('\n══════ Q2 2026 Manager/TL Rating Request PREVIEW — no writes, nothing sent ══════');
  console.log('period_id: ' + result.period_id);
  console.log('dry_run: ' + result.dry_run + '  (MailApp.sendEmail() is only called when dryRun is falsy — confirmed in PortalData.gs)');

  if (!result.would_send || result.would_send.length === 0) {
    console.log('  Nothing to preview — would_send is empty. Check DIM_STAFF_ROSTER for active');
    console.log('  TL/PM/designer supervisor_code/pm_code assignments, and confirm PORTAL_BASE_URL is set.');
    console.log('══════ End preview ══════\n');
    return result;
  }

  console.log('Would send: ' + result.would_send.length + ' email(s), all redirected to ' + REDIRECT_TO);

  result.would_send.forEach(function(entry) {
    var isCeo = entry.label === 'CEO';

    console.log('\n──── ' + entry.label + (entry.personCode ? ' [' + entry.personCode + ']' : '') + ' ────');
    console.log('  Actually would send to (redirected): ' + entry.to);
    if (entry.realEmail) console.log('  Rater\'s real email (embedded in subject tag below, not used as recipient): ' + entry.realEmail);
    console.log('  Rates: ' + entry.rates.join(', '));
    console.log('  Real portal URL (signed token computed by the real function — this is the actual live link): ' + entry.url);

    // Reproduced verbatim from PortalData.gs's sendRatingRequests() inline
    // template — not called, no send. Matches ClientFeedback.gs's
    // runQ2FeedbackRequestPreview() approach for the same reason: no
    // side-effect-free way to get rendered content out of the real
    // function without calling MailApp.sendEmail() for real. The [TEST —
    // for X] tag uses the rater's REAL email (entry.realEmail), not the
    // redirected recipient — matches the live code exactly (rater.email,
    // not recipient), so HR can see who each redirected email was really
    // meant for.
    var subject = isCeo
      ? 'BLC Nexus — Please submit your ' + periodId + ' performance ratings [TEST]'
      : 'BLC Nexus — Please submit your ' + periodId + ' performance ratings [TEST — for ' + entry.realEmail + ']';

    var body = isCeo ? [
      'Hi,',
      '',
      'Please submit your quarterly performance ratings for ' + periodId + '.',
      '',
      'You are rating: ' + entry.rates.join(', '),
      '',
      'Submit Ratings: ' + entry.url,
      '',
      'Thanks,',
      'BLC Nexus'
    ].join('\n') : [
      'Hi ' + entry.label.replace(/ \([^)]*\)$/, '') + ',',
      '',
      'Please submit your quarterly performance ratings for ' + periodId + '.',
      '',
      'You are rating: ' + entry.rates.join(', '),
      '',
      'Submit Ratings: ' + entry.url,
      '',
      'Please submit by end of month.',
      '',
      'Thanks,',
      'BLC Nexus'
    ].join('\n');

    console.log('  Subject: ' + subject);
    console.log('  --- body ---');
    console.log(body);
  });

  console.log('\n══════ ' + result.would_send.length + ' rating request(s) previewed. Nothing was sent. ══════');
  console.log('To actually send (redirected to ' + REDIRECT_TO + '), that is a separate, explicit next step —');
  console.log('not run automatically by this preview.');
  console.log('══════ End preview ══════\n');

  return result;
}

/**
 * READ-ONLY, no writes — raw dump of every DIM_STAFF_ROSTER row's
 * rating-relevant columns. Run this BEFORE implementing the 2026-07-13
 * "roster-driven rating assignment" directive: that directive assumes (a)
 * bonus_eligible=TRUE actually holds for real raters/ratees on PROD — but
 * SeedStaffImport.gs sets bonus_eligible='FALSE' for every seeded row
 * ("eligibility is determined elsewhere"), so this must be confirmed
 * against live data, not assumed, or an active+bonus_eligible filter could
 * silently empty the entire rating flow — and (b) that Deb Sen ("DBS")
 * exists in the roster with supervisor_code/pm_code set correctly. This
 * dump answers both, plus shows who (if anyone) has supervisor_code or
 * pm_code pointing at the CEO's own person_code, which the current
 * sendRatingRequests() role-based CEO logic doesn't need to know but a
 * roster-driven rewrite would.
 *
 * @returns {Array} raw roster rows (rating-relevant columns only)
 */
function runRatingRosterDataQualityReport() {
  var allStaff = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'RatingRequestPreview' });

  console.log('\n══════ DIM_STAFF_ROSTER — rating-relevant columns, ALL rows, no filtering ══════');
  console.log('Total rows: ' + allStaff.length);

  var passActiveAndBonus = 0;
  var rows = [];

  allStaff.forEach(function(s) {
    var isActive        = (s.active === true || String(s.active).toUpperCase().trim() === 'TRUE');
    var isBonusEligible  = (s.bonus_eligible === true || String(s.bonus_eligible).toUpperCase().trim() === 'TRUE');
    if (isActive && isBonusEligible) passActiveAndBonus++;

    var row = {
      person_code:     s.person_code,
      name:            s.name,
      email:           s.email,
      role:            s.role,
      supervisor_code: s.supervisor_code,
      pm_code:         s.pm_code,
      bonus_eligible:  s.bonus_eligible,
      active:          s.active,
      effective_to:    s.effective_to
    };
    rows.push(row);
    console.log('  ' + JSON.stringify(row));
  });

  console.log('\nRows passing active=TRUE AND bonus_eligible=TRUE: ' + passActiveAndBonus + ' / ' + allStaff.length);

  console.log('\n── Looking for "Deb Sen" / person_code containing DBS ──');
  var debSenMatches = rows.filter(function(r) {
    return String(r.name || '').toLowerCase().indexOf('deb sen') !== -1 ||
           String(r.person_code || '').toUpperCase().indexOf('DBS') !== -1;
  });
  if (debSenMatches.length === 0) {
    console.log('  No match for "Deb Sen" / person_code containing "DBS" found in DIM_STAFF_ROSTER.');
  } else {
    debSenMatches.forEach(function(r) { console.log('  MATCH: ' + JSON.stringify(r)); });
  }

  console.log('\n── CEO person_code / who points at it ──');
  var ceoRows = rows.filter(function(r) { return String(r.role || '').toUpperCase().trim() === 'CEO'; });
  if (ceoRows.length === 0) {
    console.log('  No row with role=CEO found.');
  } else {
    ceoRows.forEach(function(ceo) {
      console.log('  CEO person_code: ' + ceo.person_code + ' (' + ceo.name + ')');
      var pointers = rows.filter(function(r) {
        return r.supervisor_code === ceo.person_code || r.pm_code === ceo.person_code;
      });
      if (pointers.length === 0) {
        console.log('    No row has supervisor_code or pm_code === ' + ceo.person_code + '.');
      } else {
        pointers.forEach(function(p) {
          console.log('    ' + p.person_code + ' (' + p.name + ') → supervisor_code=' + p.supervisor_code + ' pm_code=' + p.pm_code);
        });
      }
    });
  }

  console.log('══════ End report ══════\n');
  return rows;
}
