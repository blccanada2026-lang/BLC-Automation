// ============================================================
// SendMaruthiPortalLink.gs — BLC Nexus one-off operational fix
//
// URGENT FIX (2026-07-27): Maruthi Vadla (MARV) was sent the bare
// PORTAL_BASE_URL (documented in PROJECT_MEMORY.md as "the Portal
// URL") instead of his personal signed portal link. The bare URL has
// no ?pt= token, so PortalAuth.resolveEmail() fails both checks
// (no Google-session match for a consumer Gmail account, no valid
// token) and every server call throws AUTH_REQUIRED — which
// PortalView.html has no fallback UI for, so he sees a dead
// "unauthorized" screen with no way to self-recover.
//
// This calls the EXISTING, already-tested self-service link function
// (PortalAuth.requestLink — the same one the portal's own "request my
// link" flow uses) directly for Maruthi's email, so he gets a working
// personal link without needing to find a UI option that isn't
// reachable from where he's stuck. No new logic, no new permissions
// (requestLink only reads DIM_STAFF_ROSTER and sends an email — no
// DAL write, no RBAC gate, "unauthenticated by design" per its own
// doc comment in PortalAuth.gs).
//
// HOW TO RUN (Apps Script editor, PROD project only):
//   runSendMaruthiPortalLink()
// ============================================================

var SMPL_PROD_SCRIPT_ID_ = '1HzRiDrQJ6z-BxPzk-MHgm4pUb5enabsEA9Hg16OoRzpOhGjv9FyeiQQ0';
var SMPL_EMAIL_          = 'vadlamaruthi902@gmail.com';

function runSendMaruthiPortalLink() {
  var actualScriptId = ScriptApp.getScriptId();
  console.log('=== Send Maruthi his real portal link — script ID: ' + actualScriptId + ' ===');
  if (actualScriptId !== SMPL_PROD_SCRIPT_ID_) {
    throw new Error('runSendMaruthiPortalLink: refusing to run — this script ID (' + actualScriptId +
                     ') does not match PROD (' + SMPL_PROD_SCRIPT_ID_ + ').');
  }
  console.log('Confirmed: running against PROD.');

  var result = PortalAuth.requestLink(SMPL_EMAIL_);
  console.log('PortalAuth.requestLink(' + SMPL_EMAIL_ + ') result: ' + JSON.stringify(result));
  console.log('Note: requestLink() always returns the same generic { ok: true } result by design ' +
              '(so roster membership is never disclosed) — this does NOT confirm the email actually ' +
              'sent. If Maruthi does not receive it within a few minutes, the next thing to check is ' +
              'whether PORTAL_BASE_URL is set correctly in Script Properties.');
  console.log('=== Done. ===');
  return result;
}
