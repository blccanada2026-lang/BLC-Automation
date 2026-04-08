// ============================================================
// ValidationEngine.gs — BLC Nexus T4 Validation
// src/04-validation/ValidationEngine.gs
//
// LOAD ORDER: First file in T4. Loads after all T3 files.
// DEPENDENCIES: Constants (T0), ErrorHandler (T3)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  All input validation flows through this module.        ║
// ║  Rule V1: handlers must validate before any DAL write.  ║
// ║  Rule V2: validation errors are WARNING severity —      ║
// ║           they are expected, not system failures.       ║
// ╚══════════════════════════════════════════════════════════╝
//
// Responsibilities:
//   1. Full schema validation (type, required, enum, range, pattern)
//   2. Lightweight required-field checks for quick guards
//   3. Single-field enum validation for standalone checks
//   4. Return a clean object containing only schema-defined fields
//   5. Record validation failures to _SYS_EXCEPTIONS (WARNING severity)
//
// SCHEMA FORMAT:
//   A schema is a plain object where each key is a field name
//   and its value is a field descriptor object:
//
//   {
//     field_name: {
//       type:          'string' | 'number' | 'boolean' | 'date' | 'email'
//       required:      true | false          (default: false)
//       allowedValues: ['A', 'B', 'C']       (enum check)
//       minLength:     1                      (string only)
//       maxLength:     100                    (string only)
//       min:           0                      (number only)
//       max:           9999                   (number only)
//       pattern:       /^regex$/              (string — RegExp object)
//       label:         'Human Readable Name'  (used in error messages)
//     }
//   }
//
// SCHEMA EXAMPLE:
//
//   var JOB_CREATE_SCHEMA = {
//     client_code: { type: 'string', required: true, minLength: 2 },
//     job_type:    { type: 'string', required: true,
//                    allowedValues: ['DESIGN', 'QC', 'REVISION'] },
//     quantity:    { type: 'number', required: true, min: 1, max: 9999 },
//     period_id:   { type: 'string', required: true,
//                    pattern: Constants.PERIOD_ID_REGEX },
//     notes:       { type: 'string', required: false, maxLength: 500 }
//   };
//
//   var clean = ValidationEngine.validate(JOB_CREATE_SCHEMA, formData, {
//     module: 'JobCreateHandler'
//   });
//   // clean contains only the keys defined in JOB_CREATE_SCHEMA
//
// VALIDATION ERROR SHAPE:
//   ValidationEngine throws a ValidationError on failure.
//   Catch and inspect e.errors[] for field-level detail:
//
//   try {
//     var clean = ValidationEngine.validate(schema, data, { module: 'X' });
//   } catch (e) {
//     if (e.code === 'VALIDATION_FAILED') {
//       // e.errors = [{ field, rule, message }, ...]
//       return { ok: false, errors: e.errors };
//     }
//     throw e;  // re-throw unexpected errors
//   }
//
// DO NOT:
//   - Call SpreadsheetApp (no sheet access — pure logic only)
//   - Perform any writes (validation is read-only)
//   - Use this for business-rule validation (e.g. "job must be in ALLOCATED
//     state before starting") — that belongs in StateMachine.gs (T6)
// ============================================================

var ValidationEngine = (function () {

  // ============================================================
  // SECTION 1: VALIDATION ERROR TYPE
  //
  // Custom error type so callers can branch: catch(e) { if
  // (e.code === 'VALIDATION_FAILED') show field errors to user }
  //
  // e.errors is an array of field-level failures:
  //   [{ field: 'client_code', rule: 'required', message: '...' }]
  //
  // rule values: 'required', 'type', 'enum', 'minLength',
  //              'maxLength', 'min', 'max', 'pattern'
  // ============================================================

  /**
   * Structured validation error.
   * Thrown by validate(), validateRequired(), and validateEnum().
   *
   * @param {string}   message      Summary message
   * @param {Object[]} fieldErrors  Array of { field, rule, message }
   * @param {Object}   [context]    Extra context for ErrorHandler
   */
  function ValidationError_(message, fieldErrors, context) {
    this.name    = 'ValidationError';
    this.code    = 'VALIDATION_FAILED';
    this.message = message;
    this.errors  = fieldErrors || [];
    this.context = context    || {};
    this.stack   = (new Error()).stack;
  }
  ValidationError_.prototype = Object.create(Error.prototype);
  ValidationError_.prototype.constructor = ValidationError_;

  // ============================================================
  // SECTION 2: TYPE CHECKERS
  //
  // Each checker returns true if the value is valid for that type.
  // All checkers handle null/undefined as invalid (presence is
  // checked separately by the required rule).
  //
  // GAS / Google Sheets quirks handled:
  //   - Sheets stores boolean cells as actual JS booleans, but
  //     form responses may return 'TRUE'/'FALSE' strings.
  //   - Date cells arrive as JS Date objects; form text fields
  //     may contain ISO date strings — both are accepted.
  //   - Numbers from Sheets are always JS numbers (never strings),
  //     but form responses may send numeric strings; coercion is
  //     explicit and documented rather than silent.
  // ============================================================

  /** Returns true if value is a non-empty string. */
  function isString_(value) {
    return typeof value === 'string';
  }

  /** Returns true if value is a finite number (not NaN, not Infinity). */
  function isNumber_(value) {
    return typeof value === 'number' && isFinite(value);
  }

  /**
   * Returns true if value is a boolean or the strings 'TRUE'/'FALSE'
   * (case-insensitive). Google Sheets form responses use string booleans.
   */
  function isBoolean_(value) {
    if (typeof value === 'boolean') return true;
    if (typeof value === 'string') {
      var upper = value.toUpperCase();
      return upper === 'TRUE' || upper === 'FALSE';
    }
    return false;
  }

  /**
   * Returns true if value is a Date object or a parseable date string.
   * Rejects empty strings and strings that produce Invalid Date.
   */
  function isDate_(value) {
    if (value instanceof Date) return !isNaN(value.getTime());
    if (typeof value === 'string' && value.trim() !== '') {
      return !isNaN(new Date(value).getTime());
    }
    return false;
  }

  /**
   * Returns true if value is a string matching a basic email pattern.
   * Validates structure only — does not verify deliverability.
   */
  function isEmail_(value) {
    if (typeof value !== 'string') return false;
    // Basic RFC 5322-ish pattern: local@domain.tld
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }

  /**
   * Dispatches to the correct type checker by type name.
   * @param {string} typeName  'string'|'number'|'boolean'|'date'|'email'
   * @param {*}      value
   * @returns {boolean}
   */
  function checkType_(typeName, value) {
    switch (typeName) {
      case 'string':  return isString_(value);
      case 'number':  return isNumber_(value);
      case 'boolean': return isBoolean_(value);
      case 'date':    return isDate_(value);
      case 'email':   return isEmail_(value);
      default:        return false;  // unknown type = invalid
    }
  }

  // ============================================================
  // SECTION 3: FIELD-LEVEL VALIDATOR
  //
  // Validates a single field against its descriptor.
  // Returns an array of error objects (empty = field is valid).
  //
  // Rules are applied in this order:
  //   1. required    — value must be present and non-empty
  //   2. type        — value must match the declared type
  //   3. enum        — value must be in allowedValues
  //   4. minLength   — string length lower bound
  //   5. maxLength   — string length upper bound
  //   6. min         — number lower bound
  //   7. max         — number upper bound
  //   8. pattern     — RegExp match
  //
  // Rules 3–8 are only applied if the value is present and
  // passes the type check — avoids cascading errors on null.
  // ============================================================

  /** Sentinel for "value is absent or blank". */
  function isAbsent_(value) {
    return value === null || value === undefined ||
           (typeof value === 'string' && value.trim() === '');
  }

  /**
   * Validates one field against one descriptor.
   * @param {string} fieldName   Key in the data object
   * @param {*}      value       The field's current value
   * @param {Object} descriptor  Schema descriptor for this field
   * @returns {Object[]}  Array of { field, rule, message }. Empty if valid.
   */
  function validateField_(fieldName, value, descriptor) {
    var errs  = [];
    var label = descriptor.label || fieldName;
    var absent = isAbsent_(value);

    // ── Rule 1: required ───────────────────────────────────
    if (descriptor.required && absent) {
      errs.push({
        field:   fieldName,
        rule:    'required',
        message: '"' + label + '" is required.'
      });
      // No further rules make sense on an absent value
      return errs;
    }

    // If optional and absent — all subsequent rules are skipped
    if (absent) return errs;

    // ── Rule 2: type ───────────────────────────────────────
    if (descriptor.type && !checkType_(descriptor.type, value)) {
      errs.push({
        field:   fieldName,
        rule:    'type',
        message: '"' + label + '" must be a valid ' + descriptor.type +
                 '. Received: ' + typeof value + ' (' + String(value) + ').'
      });
      // Type failure makes range/pattern checks meaningless — stop here
      return errs;
    }

    // ── Rule 3: enum (allowedValues) ───────────────────────
    if (descriptor.allowedValues && descriptor.allowedValues.length > 0) {
      var found = false;
      for (var i = 0; i < descriptor.allowedValues.length; i++) {
        if (descriptor.allowedValues[i] === value) { found = true; break; }
      }
      if (!found) {
        errs.push({
          field:   fieldName,
          rule:    'enum',
          message: '"' + label + '" must be one of: ' +
                   descriptor.allowedValues.join(', ') +
                   '. Received: "' + value + '".'
        });
      }
    }

    // ── Rule 4 & 5: minLength / maxLength (strings) ────────
    if (descriptor.type === 'string' || typeof value === 'string') {
      var len = String(value).length;
      if (descriptor.minLength !== undefined && len < descriptor.minLength) {
        errs.push({
          field:   fieldName,
          rule:    'minLength',
          message: '"' + label + '" must be at least ' + descriptor.minLength +
                   ' character(s). Got ' + len + '.'
        });
      }
      if (descriptor.maxLength !== undefined && len > descriptor.maxLength) {
        errs.push({
          field:   fieldName,
          rule:    'maxLength',
          message: '"' + label + '" must be no more than ' + descriptor.maxLength +
                   ' character(s). Got ' + len + '.'
        });
      }
    }

    // ── Rule 6 & 7: min / max (numbers) ────────────────────
    if (descriptor.type === 'number' || typeof value === 'number') {
      var num = Number(value);
      if (descriptor.min !== undefined && num < descriptor.min) {
        errs.push({
          field:   fieldName,
          rule:    'min',
          message: '"' + label + '" must be at least ' + descriptor.min +
                   '. Got ' + num + '.'
        });
      }
      if (descriptor.max !== undefined && num > descriptor.max) {
        errs.push({
          field:   fieldName,
          rule:    'max',
          message: '"' + label + '" must be no more than ' + descriptor.max +
                   '. Got ' + num + '.'
        });
      }
    }

    // ── Rule 8: pattern (RegExp) ───────────────────────────
    if (descriptor.pattern && descriptor.pattern instanceof RegExp) {
      if (!descriptor.pattern.test(String(value))) {
        errs.push({
          field:   fieldName,
          rule:    'pattern',
          message: '"' + label + '" does not match the required format. ' +
                   'Got: "' + value + '".'
        });
      }
    }

    return errs;
  }

  // ============================================================
  // SECTION 4: ErrorHandler INTEGRATION HELPER
  //
  // Records validation failures as WARNING-severity exceptions.
  // Validation errors are expected operational events (user input
  // problems), not system failures — hence WARNING not ERROR.
  // Fail-safe: if ErrorHandler itself throws, swallow silently
  // so a logging failure never masks the validation result.
  // ============================================================

  /**
   * Records a validation failure to _SYS_EXCEPTIONS via ErrorHandler.
   * Never throws.
   *
   * @param {ValidationError_} validationError  The error about to be thrown
   * @param {Object}           options          Caller options { module, actor }
   */
  function recordToErrorHandler_(validationError, options) {
    try {
      ErrorHandler.record(
        'VALIDATION_FAILED',
        validationError.message,
        {
          module:      (options && options.module) || 'ValidationEngine',
          severity:    Constants.SEVERITIES.WARNING,
          actor:       (options && options.actor)  || null,
          field_count: validationError.errors.length,
          fields:      validationError.errors.map(function (e) {
            return e.field + ':' + e.rule;
          }).join(', ')
        }
      );
    } catch (ignored) {}
  }

  // ============================================================
  // SECTION 5: validate — FULL SCHEMA VALIDATION
  //
  // Validates all fields in data against the schema descriptor.
  // Collects ALL field errors before throwing (fail-all strategy)
  // so callers receive the complete error set in one pass.
  //
  // Returns a clean object: only keys defined in the schema are
  // included — unknown keys are silently dropped. This prevents
  // field injection from form submissions including extra keys
  // that downstream handlers might accidentally act on.
  // ============================================================

  /**
   * Validates data against a full schema descriptor.
   * Throws ValidationError if any field fails.
   * Returns a clean object with only schema-defined fields on success.
   *
   * @param {Object} schema   Field descriptors keyed by field name
   * @param {Object} data     Input data to validate
   * @param {Object} [options]
   * @param {string} [options.module]  Calling module name (for error records)
   * @param {Object} [options.actor]   RBAC actor object (for error records)
   *
   * @returns {Object}  Validated, clean copy of data (schema keys only)
   * @throws  {ValidationError_}  If any field fails validation
   *
   * @example
   *   var clean = ValidationEngine.validate(JOB_CREATE_SCHEMA, formData, {
   *     module: 'JobCreateHandler'
   *   });
   *   // clean is safe to write to DAL — only known fields, all validated
   */
  function validate(schema, data, options) {
    options = options || {};

    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      throw new ValidationError_(
        'validate(): schema must be a plain object.',
        [{ field: '_schema', rule: 'type', message: 'Invalid schema argument.' }],
        options
      );
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ValidationError_(
        'validate(): data must be a plain object.',
        [{ field: '_data', rule: 'type', message: 'Invalid data argument.' }],
        options
      );
    }

    // Collect all field errors (fail-all strategy)
    var allErrors = [];
    var fields    = Object.keys(schema);

    for (var i = 0; i < fields.length; i++) {
      var fieldName  = fields[i];
      var descriptor = schema[fieldName];
      var value      = data.hasOwnProperty(fieldName) ? data[fieldName] : undefined;
      var fieldErrs  = validateField_(fieldName, value, descriptor);

      for (var j = 0; j < fieldErrs.length; j++) {
        allErrors.push(fieldErrs[j]);
      }
    }

    if (allErrors.length > 0) {
      var summary = allErrors.length + ' field(s) failed validation: ' +
                    allErrors.map(function (e) { return e.field; }).join(', ') + '.';
      var error   = new ValidationError_(summary, allErrors, options);
      recordToErrorHandler_(error, options);
      throw error;
    }

    // Build clean output — only schema-defined keys, in schema order
    var clean = {};
    for (var k = 0; k < fields.length; k++) {
      var f = fields[k];
      if (data.hasOwnProperty(f) && !isAbsent_(data[f])) {
        clean[f] = data[f];
      }
    }
    return clean;
  }

  // ============================================================
  // SECTION 6: validateRequired — LIGHTWEIGHT REQUIRED CHECK
  //
  // Checks that a list of field names are present and non-empty
  // in data. No type or range checks — use when you only need
  // a quick presence guard before further processing.
  //
  // Useful for queue item guards and internal module pre-checks
  // where a full schema would be over-engineered.
  // ============================================================

  /**
   * Checks that all listed fields are present and non-empty in data.
   * Throws ValidationError listing every missing field.
   *
   * @param {Object}   data            Data object to check
   * @param {string[]} requiredFields  Array of field name strings
   * @param {Object}   [options]       { module, actor }
   *
   * @throws {ValidationError_}  If any required field is absent
   *
   * @example
   *   ValidationEngine.validateRequired(queueItem,
   *     ['queue_id', 'form_type', 'submitter_email'],
   *     { module: 'QueueProcessor' }
   *   );
   */
  function validateRequired(data, requiredFields, options) {
    options = options || {};

    if (!Array.isArray(requiredFields) || requiredFields.length === 0) {
      throw new ValidationError_(
        'validateRequired(): requiredFields must be a non-empty array.',
        [{ field: '_requiredFields', rule: 'type', message: 'Invalid argument.' }],
        options
      );
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ValidationError_(
        'validateRequired(): data must be a plain object.',
        [{ field: '_data', rule: 'type', message: 'Invalid data argument.' }],
        options
      );
    }

    var missing = [];
    for (var i = 0; i < requiredFields.length; i++) {
      var field = requiredFields[i];
      var value = data.hasOwnProperty(field) ? data[field] : undefined;
      if (isAbsent_(value)) {
        missing.push({
          field:   field,
          rule:    'required',
          message: '"' + field + '" is required and was not provided.'
        });
      }
    }

    if (missing.length > 0) {
      var summary = 'Missing required field(s): ' +
                    missing.map(function (e) { return e.field; }).join(', ') + '.';
      var error   = new ValidationError_(summary, missing, options);
      recordToErrorHandler_(error, options);
      throw error;
    }
  }

  // ============================================================
  // SECTION 7: validateEnum — SINGLE FIELD ENUM CHECK
  //
  // Validates a single value against an array of allowed values.
  // Strict equality (===) — no type coercion.
  //
  // Use for standalone field checks, e.g. validating event_type
  // or status values mid-handler without running a full schema.
  // ============================================================

  /**
   * Checks that value is one of the allowed values.
   * Throws ValidationError if not.
   *
   * @param {string}   field          Field name (for error context)
   * @param {*}        value          The value to check
   * @param {Array}    allowedValues  Array of valid values
   * @param {Object}   [options]      { module, actor }
   *
   * @throws {ValidationError_}  If value is not in allowedValues
   *
   * @example
   *   ValidationEngine.validateEnum(
   *     'event_type', payload.event_type,
   *     Object.values(Constants.EVENT_TYPES),
   *     { module: 'JobCreateHandler' }
   *   );
   */
  function validateEnum(field, value, allowedValues, options) {
    options = options || {};

    if (!Array.isArray(allowedValues) || allowedValues.length === 0) {
      throw new ValidationError_(
        'validateEnum(): allowedValues must be a non-empty array.',
        [{ field: '_allowedValues', rule: 'type', message: 'Invalid argument.' }],
        options
      );
    }

    for (var i = 0; i < allowedValues.length; i++) {
      if (allowedValues[i] === value) return;  // valid — exit cleanly
    }

    var fieldErrors = [{
      field:   field,
      rule:    'enum',
      message: '"' + field + '" must be one of: ' + allowedValues.join(', ') +
               '. Received: "' + value + '".'
    }];
    var error = new ValidationError_(
      '"' + field + '" has an invalid value: "' + value + '".',
      fieldErrors,
      options
    );
    recordToErrorHandler_(error, options);
    throw error;
  }

  // ============================================================
  // SECTION 8: BUILT-IN SCHEMA FRAGMENTS
  //
  // Reusable descriptor objects for common BLC field types.
  // Import these into handler-specific schemas via object spread
  // (or manual copy in ES5):
  //
  //   var MY_SCHEMA = {
  //     period_id:   SCHEMA_FRAGMENTS.PERIOD_ID,
  //     event_type:  SCHEMA_FRAGMENTS.EVENT_TYPE,
  //     client_code: { type: 'string', required: true, minLength: 2 }
  //   };
  //
  // IMPORTANT: These are reference objects — do not mutate them.
  // ============================================================

  var SCHEMA_FRAGMENTS = {

    /** YYYY-MM period identifier */
    PERIOD_ID: {
      type:     'string',
      required: true,
      pattern:  Constants.PERIOD_ID_REGEX,
      label:    'Period ID'
    },

    /** BLC-NNNNN job number */
    JOB_NUMBER: {
      type:      'string',
      required:  true,
      pattern:   /^BLC-\d{5}$/,
      label:     'Job Number'
    },

    /** Email address */
    EMAIL: {
      type:     'email',
      required: true,
      label:    'Email Address'
    },

    /** Any of the canonical event types */
    EVENT_TYPE: {
      type:          'string',
      required:      true,
      allowedValues: (function () {
        var vals = [];
        var et   = Constants.EVENT_TYPES;
        for (var k in et) { if (et.hasOwnProperty(k)) vals.push(et[k]); }
        return vals;
      }()),
      label: 'Event Type'
    },

    /** Staff role */
    ROLE: {
      type:          'string',
      required:      true,
      allowedValues: (function () {
        var vals = [];
        var r    = Constants.ROLES;
        for (var k in r) { if (r.hasOwnProperty(k)) vals.push(r[k]); }
        return vals;
      }()),
      label: 'Role'
    },

    /** Currency code */
    CURRENCY: {
      type:          'string',
      required:      false,
      allowedValues: (function () {
        var vals = [];
        var c    = Constants.CURRENCIES;
        for (var k in c) { if (c.hasOwnProperty(k)) vals.push(c[k]); }
        return vals;
      }()),
      label: 'Currency'
    },

    /** Positive integer quantity */
    QUANTITY: {
      type:     'number',
      required: true,
      min:      1,
      max:      99999,
      label:    'Quantity'
    }

  };

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {

    // ── Primary validation methods ────────────────────────────
    /**
     * Full schema validation. Returns clean object on success.
     * @type {function(Object, Object, Object=): Object}
     */
    validate: validate,

    /**
     * Presence check for a list of required fields.
     * @type {function(Object, string[], Object=): void}
     */
    validateRequired: validateRequired,

    /**
     * Single-field enum check.
     * @type {function(string, *, Array, Object=): void}
     */
    validateEnum: validateEnum,

    // ── Built-in schema fragments ─────────────────────────────
    /**
     * Reusable descriptor objects for common BLC field types.
     * Use as building blocks in handler-specific schemas.
     */
    SCHEMA_FRAGMENTS: SCHEMA_FRAGMENTS,

    // ── Error type (for instanceof checks in catch blocks) ────
    /**
     * The ValidationError constructor. Useful for:
     *   catch(e) { if (e instanceof ValidationEngine.ValidationError) ... }
     */
    ValidationError: ValidationError_

  };

}());
