/**
 * bonus-period.test.js
 *
 * Tests for the pure period-parsing/validation functions in
 * src/10-payroll/BonusPeriodEngine.gs — no DAL, no GAS globals, no
 * live Sheets. These functions accept an explicit "asOf" date rather
 * than reading the wall clock internally, specifically so tests are
 * deterministic regardless of when they're actually run.
 */

const fs   = require('fs');
const path = require('path');

// eval() loads trusted, repo-local .gs source (not user input) — same
// pattern as every other test in this repo.
const src = fs.readFileSync(path.join(__dirname, '../src/10-payroll/BonusPeriodEngine.gs'), 'utf8');
eval(src);

describe('parseBonusPeriod_()', () => {
  test('parses a valid QUARTER period value', () => {
    const p = parseBonusPeriod_('QUARTER', '2026-Q2');
    expect(p.periodType).toBe('QUARTER');
    expect(p.year).toBe(2026);
    expect(p.quarter).toBe('Q2');
  });

  test('parses a valid ANNUAL period value', () => {
    const p = parseBonusPeriod_('ANNUAL', '2026-ANNUAL');
    expect(p.periodType).toBe('ANNUAL');
    expect(p.year).toBe(2026);
    expect(p.quarter).toBeUndefined();
  });

  test('rejects an unrecognised periodType', () => {
    expect(() => parseBonusPeriod_('MONTHLY', '2026-01')).toThrow(/periodType/);
  });

  test('rejects a QUARTER periodValue that does not match YYYY-Qn', () => {
    expect(() => parseBonusPeriod_('QUARTER', '2026-Q5')).toThrow();
    expect(() => parseBonusPeriod_('QUARTER', 'Q2-2026')).toThrow();
    expect(() => parseBonusPeriod_('QUARTER', '2026-ANNUAL')).toThrow();
  });

  test('rejects an ANNUAL periodValue that does not match YYYY-ANNUAL', () => {
    expect(() => parseBonusPeriod_('ANNUAL', '2026-Q2')).toThrow();
    expect(() => parseBonusPeriod_('ANNUAL', '2026')).toThrow();
  });
});

describe('bonusQuarterEndDate_()', () => {
  test('returns the correct last calendar day for each quarter', () => {
    expect(bonusQuarterEndDate_('Q1', 2026).toISOString().slice(0, 10)).toBe('2026-03-31');
    expect(bonusQuarterEndDate_('Q2', 2026).toISOString().slice(0, 10)).toBe('2026-06-30');
    expect(bonusQuarterEndDate_('Q3', 2026).toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(bonusQuarterEndDate_('Q4', 2026).toISOString().slice(0, 10)).toBe('2026-12-31');
  });
});

describe('isQuarterClosed_()', () => {
  test('a quarter is NOT closed while still in progress', () => {
    const midQ2 = new Date(2026, 4, 15); // May 15, 2026 — inside Q2
    expect(isQuarterClosed_('Q2', 2026, midQ2)).toBe(false);
  });

  test('a quarter is NOT closed on its exact last day (still in progress until end of day)', () => {
    const lastDayQ2 = new Date(2026, 5, 30, 10, 0, 0); // June 30, 2026, 10am
    expect(isQuarterClosed_('Q2', 2026, lastDayQ2)).toBe(false);
  });

  test('a quarter IS closed the day after it ends', () => {
    const dayAfterQ2 = new Date(2026, 6, 1); // July 1, 2026
    expect(isQuarterClosed_('Q2', 2026, dayAfterQ2)).toBe(true);
  });

  test('a quarter IS closed well after it ends', () => {
    const wayAfter = new Date(2026, 11, 1); // Dec 1, 2026
    expect(isQuarterClosed_('Q2', 2026, wayAfter)).toBe(true);
  });

  test('a FUTURE quarter is not closed', () => {
    const today = new Date(2026, 1, 1); // Feb 1, 2026
    expect(isQuarterClosed_('Q4', 2026, today)).toBe(false);
  });
});
