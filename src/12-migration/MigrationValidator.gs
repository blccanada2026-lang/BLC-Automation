// ============================================================
// MigrationValidator.gs — BLC Nexus T12 Migration
// src/12-migration/MigrationValidator.gs
//
// Field-level and business-rule validation for normalized rows
// before they are written to MIGRATION_NORMALIZED.
// Called by MigrationNormalizer — not a public entry point.
// ============================================================

var MigrationValidator = (function () {

  var MODULE = 'MigrationValidator';

  var VALID_ROLES    = ['DESIGNER', 'QC', 'TEAM_LEAD', 'PM', 'CEO', 'ADMIN'];
  var VALID_ENTITY_TYPES = ['STAFF', 'CLIENT', 'JOB', 'WORK_LOG', 'BILLING', 'PAYROLL'];

  function required_(obj, field, errors) {
    if (!obj[field] || String(obj[field]).trim() === '') {
      errors.push(field + ' is required');
    }
  }

  function validateStaff_(payload, errors) {
    required_(payload, 'person_code', errors);
    required_(payload, 'name', errors);
    required_(payload, 'role', errors);
    required_(payload, 'pay_design', errors);
    required_(payload, 'pay_qc', errors);
    // email is not present in Stacey STAFF_ROSTER — omit from required check
    if (payload.role && VALID_ROLES.indexOf(payload.role) === -1) {
      errors.push('role "' + payload.role + '" is not a valid role');
    }
  }

  function validateClient_(payload, errors) {
    required_(payload, 'client_code', errors);
    required_(payload, 'client_name', errors);
  }

  function validateJob_(payload, errors) {
    required_(payload, 'job_number', errors);
    required_(payload, 'client_code', errors);
    required_(payload, 'period_id', errors);
  }

  function validateWorkLog_(payload, errors) {
    required_(payload, 'job_number', errors);
    required_(payload, 'person_code', errors);
    required_(payload, 'hours', errors);
    if (payload.hours !== undefined && payload.hours !== null &&
        (isNaN(Number(payload.hours)) || Number(payload.hours) < 0)) {
      errors.push('hours must be a non-negative number, got: ' + payload.hours);
    }
    // person_code containing a space indicates name-to-code resolution failed
    if (payload.person_code && String(payload.person_code).indexOf(' ') !== -1) {
      errors.push('person_code appears to be an unresolved name: "' + payload.person_code + '" — check STAFF_ROSTER name match');
    }
  }

  function validateBilling_(payload, errors) {
    required_(payload, 'job_number', errors);
    required_(payload, 'client_code', errors);
    required_(payload, 'amount', errors);
    if (payload.amount !== undefined && isNaN(Number(payload.amount))) {
      errors.push('amount must be a number, got: ' + payload.amount);
    }
  }

  function validatePayroll_(payload, errors) {
    required_(payload, 'person_code', errors);
    required_(payload, 'period_id', errors);
    required_(payload, 'amount_inr', errors);
    if (payload.amount_inr !== undefined && isNaN(Number(payload.amount_inr))) {
      errors.push('amount_inr must be a number, got: ' + payload.amount_inr);
    }
  }

  /**
   * Validates a normalized payload for the given entity type.
   *
   * @param {string} entityType  — STAFF | CLIENT | JOB | WORK_LOG | BILLING | PAYROLL
   * @param {Object} payload
   * @returns {{ valid: boolean, errors: string[] }}
   */
  function validate(entityType, payload) {
    var errors = [];

    if (VALID_ENTITY_TYPES.indexOf(entityType) === -1) {
      return { valid: false, errors: ['unknown entity_type: ' + entityType] };
    }

    switch (entityType) {
      case 'STAFF':    validateStaff_(payload, errors);    break;
      case 'CLIENT':   validateClient_(payload, errors);   break;
      case 'JOB':      validateJob_(payload, errors);      break;
      case 'WORK_LOG': validateWorkLog_(payload, errors);  break;
      case 'BILLING':  validateBilling_(payload, errors);  break;
      case 'PAYROLL':  validatePayroll_(payload, errors);  break;
    }

    if (errors.length > 0) {
      Logger.warn('MIGRATION_VALIDATION_FAILED', {
        module: MODULE, entityType: entityType, errors: errors.join('; ')
      });
    }

    return { valid: errors.length === 0, errors: errors };
  }

  return { validate: validate };
}());
