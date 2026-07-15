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
