/**
 * QuarterlyBonusEngine.js
 * Quarterly and annual performance bonus engine for BLC.
 * Designers scored first; TL/PM scored using their designers' averages.
 * Formula: bonus_INR = design_hours x composite_score x INR_25
 *
 * Computation order (enforced in runQuarterlyBonus):
 *   1. getQuarterHours_       — hours per designer from MASTER
 *   2. getErrorRates_         — rework/design ratio per designer
 *   3. getClientQcReturnRates_ — return rate per supervisor
 *   4. getBonusInputs_        — ratings from QUARTERLY_BONUS_INPUTS
 *   5. computeDesignerScores_ — score every designer (PENDING if input missing)
 *   6. computeSupervisorScores_ — score TL then PM (needs designer scores)
 *   7. checkForcedDifferentiation_ — warning flag, not a block
 *   8. writeBonusLedger_      — clear + rewrite BONUS_LEDGER for the quarter
 *   9. runAnnualBonus (Dec only)
 */

/* global SheetDB, ConfigService, CONFIG, normaliseDesignerName, Logger,
          GmailApp, Utilities, getUiSafe_, buildDesignerProfileMap_ */

var QB_QUARTERS = {
  'Q1': [1, 2, 3],
  'Q2': [4, 5, 6],
  'Q3': [7, 8, 9],
  'Q4': [10, 11, 12]
};

// Functions added in subsequent tasks.
