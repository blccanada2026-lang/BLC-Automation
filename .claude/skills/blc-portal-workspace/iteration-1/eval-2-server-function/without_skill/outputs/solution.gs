// portal_previewQuarterlyBonus — portal server function for CEO quarterly bonus preview

/**
 * Returns a preview of the quarterly bonus calculation without writing anything.
 * CEO only (PAYROLL_VIEW permission enforced inside QuarterlyBonusEngine).
 *
 * @param {string} quarter  'Q1'|'Q2'|'Q3'|'Q4'
 * @param {number} year     e.g. 2026
 * @returns {string}  JSON array of bonus preview rows
 */
function portal_previewQuarterlyBonus(quarter, year) {
  var email = Session.getActiveUser().getEmail();
  var rows  = QuarterlyBonusEngine.previewQuarterlyBonus(email, quarter, parseInt(year, 10));
  return JSON.stringify(rows);
}
