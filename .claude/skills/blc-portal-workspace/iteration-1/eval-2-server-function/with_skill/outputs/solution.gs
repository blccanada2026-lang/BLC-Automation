// ============================================================
// portal_previewQuarterlyBonus — Portal.gs (src/07-portal/Portal.gs)
// ============================================================

/**
 * Returns a preview of the quarterly bonus calculation without writing anything.
 * CEO only. Delegates to QuarterlyBonusEngine.previewQuarterlyBonus.
 *
 * @param {string} quarter  Quarter identifier: 'Q1' | 'Q2' | 'Q3' | 'Q4'
 * @param {number} year     Four-digit calendar year, e.g. 2026
 * @returns {string}  JSON array of bonus preview rows, each shaped:
 *   { person_code, name, design_hours, composite_score,
 *     bonus_inr, status, quarter_period_id }
 */
function portal_previewQuarterlyBonus(quarter, year) {
  var email = Session.getActiveUser().getEmail();
  var rows  = QuarterlyBonusEngine.previewQuarterlyBonus(email, quarter, parseInt(year, 10));
  return JSON.stringify(rows);
}

// ============================================================
// NOTE: No PortalData.gs helper is needed.
// QuarterlyBonusEngine.previewQuarterlyBonus enforces PAYROLL_VIEW
// permission internally and returns the full preview array.
// ============================================================
