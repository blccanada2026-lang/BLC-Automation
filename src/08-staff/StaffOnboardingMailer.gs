// ============================================================
// StaffOnboardingMailer.gs — BLC Nexus T8 Staff
// src/08-staff/StaffOnboardingMailer.gs
//
// Sends a new staff member ONE combined onboarding email — role-
// appropriate instructions + their actual personal portal link
// (PortalAuth.buildPersonalLink, not a generic shared URL) —
// automatically when they're onboarded via StaffOnboarding.onboardStaff
// (see that file's onboardStaff(), the isNew branch).
//
// Reuses OnboardingMailer.gs's (T12, src/12-migration/) existing
// DESIGNER/TEAM_LEAD/PM body builders — built and already used for the
// original June 16 launch — for those three roles. Every other role
// (ADMIN, HR_ACCOUNTING, CEO, QC) gets one generic fallback body,
// defined here, per 2026-08-06 business decision, rather than N more
// bespoke templates. Cross-tier reuse (T8 calling a T12 file's
// functions) is safe here — they're plain hoisted function
// declarations with no load-order dependency (not an IIFE module that
// needs something else to have already run at load time) — and
// duplicating ~50 lines of already-tested HTML per role would have
// been worse than the tier crossing.
//
// Best-effort only: any failure here is caught, logged, and swallowed
// — never thrown. A broken/missing email must never block the actual
// staff-roster write in StaffOnboarding.onboardStaff().
//
// role is always one of StaffOnboarding.gs's VALID_ONBOARD_ROLES_
// closed enum (DESIGNER/QC/TEAM_LEAD/PM/CEO/ADMIN/HR_ACCOUNTING) —
// safe to interpolate into HTML directly, no escaping needed.
// ============================================================

function sendNewStaffOnboardingEmail_(personCode) {
  try {
    var rows = DAL.readWhere(
      Config.TABLES.DIM_STAFF_ROSTER,
      { person_code: personCode },
      { callerModule: 'StaffOnboardingMailer' }
    );
    var row = rows && rows[0];
    if (!row) {
      Logger.warn('ONBOARDING_EMAIL_SKIPPED', {
        module: 'StaffOnboardingMailer', person_code: personCode, reason: 'roster row not found'
      });
      return;
    }

    var email = String(row.email || '').trim();
    if (!email) {
      Logger.warn('ONBOARDING_EMAIL_SKIPPED', {
        module: 'StaffOnboardingMailer', person_code: personCode, reason: 'no email on file'
      });
      return;
    }

    var role      = String(row.role || '').toUpperCase().trim();
    var name      = String(row.name || personCode).trim();
    var firstName = name.split(' ')[0] || name;
    var link      = PortalAuth.buildPersonalLink(personCode);

    var body;
    if (role === 'PM') {
      body = buildPMBody_(firstName, link);
    } else if (role === 'TEAM_LEAD' || role === 'QC_REVIEWER') {
      body = buildTLBody_(firstName, link);
    } else if (role === 'DESIGNER') {
      body = buildDesignerBody_(firstName, link);
    } else {
      body = buildGenericOnboardingBody_(firstName, role, link);
    }

    var html = '<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#222;">' +
      buildEmailHeader_() + body + buildEmailFooter_() + '</div>';

    GmailApp.sendEmail(email, 'Welcome to BLC Nexus — Your Portal Access', '', {
      htmlBody: html,
      name:     'Blue Lotus Consulting Corporation'
    });

    Logger.info('ONBOARDING_EMAIL_SENT', {
      module: 'StaffOnboardingMailer', person_code: personCode, role: role, email: email
    });
  } catch (e) {
    Logger.error('ONBOARDING_EMAIL_FAILED', {
      module: 'StaffOnboardingMailer', person_code: personCode, error: e.message
    });
  }
}

// One-off, editor-runnable send for a staff member onboarded before
// this feature existed (so the automatic isNew trigger never fired for
// them). Safe to delete once run — not needed again for this person.
function runSendOnboardingEmailToARN() {
  sendNewStaffOnboardingEmail_('ARN');
}

/**
 * Generic onboarding email body for any role without a dedicated
 * template (ADMIN, HR_ACCOUNTING, CEO, QC). Reuses OnboardingMailer.gs's
 * btn_() helper for the link button — same visual style as the
 * role-specific templates.
 */
function buildGenericOnboardingBody_(firstName, role, portalUrl) {
  return '<div style="border:1px solid #ddd;border-top:none;border-bottom:none;padding:28px;">' +

    '<p style="font-size:15px;margin:0 0 6px;">Hi <strong>' + firstName + '</strong>,</p>' +
    '<p style="font-size:14px;line-height:1.7;margin:0 0 20px;">' +
      'Welcome to <strong>Blue Lotus Consulting Corporation</strong>. You now have access to ' +
      '<strong>BLC Nexus</strong>, our operations portal, as <strong>' + role + '</strong>.' +
    '</p>' +
    '<p style="font-size:14px;line-height:1.7;margin:0 0 20px;">' +
      'Click below to open your portal. This link is personal to you — please don’t share or forward it.' +
    '</p>' +

    btn_(portalUrl, 'Open My Portal') +

    '<p style="font-size:14px;line-height:1.7;margin:20px 0 0;">' +
      'If you have questions about what you can do in the portal, reach out to your manager or reply to this email.' +
    '</p>' +

  '</div>';
}
