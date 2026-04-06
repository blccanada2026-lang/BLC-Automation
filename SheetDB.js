/**
 * SheetDB.js — BLC Job Management System
 * =================================================================
 * Single data-access layer for all Google Sheets I/O.
 *
 * ARCHITECTURE RULE: No other .js file may call getSheetByName(),
 * getDataRange(), setValues(), or any direct Sheets API.
 * All sheet operations MUST go through this module.
 *
 * QUICK REFERENCE
 * ──────────────────────────────────────────────────────────────
 * Read (returns plain objects with a _rowIndex property):
 *
 *   SheetDB.getAll('MASTER')
 *   SheetDB.findRows('MASTER', function(r) { return r.clientCode === 'SBS'; })
 *   SheetDB.findOne('STAFF_ROSTER', function(r) { return r.designerId === 'SGO'; })
 *   SheetDB.count('MASTER', function(r) { return r.status === 'Completed - Billable'; })
 *
 * Write:
 *
 *   SheetDB.insertRows('MASTER', [{ jobNumber: 'SBS-0001', clientCode: 'SBS', ... }])
 *   SheetDB.updateRow('MASTER', row._rowIndex, { status: 'Completed - Billable' })
 *   SheetDB.updateWhere('MASTER', function(r) { return r.jobNumber === 'X'; }, { status: 'Cancelled' })
 *   SheetDB.deleteWhere('MASTER', function(r) { return r.isTest === true; })
 *   SheetDB.deleteWhere('MASTER', fn, { soft: true })  // sets status = '_DELETED'
 *
 * Utility:
 *
 *   SheetDB.schema('MASTER')       // returns schema definition object
 *   SheetDB.verifySchema('MASTER') // checks live sheet headers against schema
 *   SheetDB.clearCache('MASTER')   // invalidates read cache for one sheet
 *   SheetDB.clearAllCaches()       // invalidates all cached reads
 *   SheetDB.nextRowId('MASTER')    // generates next BLC-YYYY-NNNN id under write lock
 *   SheetDB.bootstrap()            // creates any missing managed sheets
 *
 * Row objects:
 *
 *   Every row returned by getAll / findRows / findOne has a _rowIndex
 *   (the 1-based sheet row number, including the header). Use it for updates:
 *
 *     var job = SheetDB.findOne('MASTER', function(r) { return r.jobNumber === id; });
 *     SheetDB.updateRow('MASTER', job._rowIndex, { status: 'In Design', startDate: new Date() });
 *
 * =================================================================
 * IMPORTANT: Schema column indices are 0-based.
 * CONFIG.masterCols values are 1-based — subtract 1 to get the index here.
 * SR / PL / PB / PA values are 0-based — used directly.
 * =================================================================
 */


// =================================================================
// CONSTANTS
// =================================================================

var SHEETDB_SPREADSHEET_ID = '1EIuLg4dJjePPOSinMcGZocKGpe2wnjXI2pEFflD_f9U';

// Set false to disable read caching during debugging.
var SHEETDB_CACHE_ENABLED  = true;

// Max rows deleteWhere / updateWhere will touch in one call without
// throwing a safety warning to the log.
var SHEETDB_BULK_WARN_THRESHOLD = 50;


// =================================================================
// COLUMN TYPES
// Used in schema definitions to drive coercion on read.
// =================================================================

var SDB_T = {
  STRING   : 'STRING',    // returned as trimmed string; empty → ''
  NUMBER   : 'NUMBER',    // returned as Number; non-numeric → 0
  BOOLEAN  : 'BOOLEAN',   // 'Yes'|'TRUE'|true → true; else false
  DATE     : 'DATE',      // Date object or parseable string → Date; else null
  TIMESTAMP: 'TIMESTAMP', // same as DATE
  JSON     : 'JSON',      // stored as JSON string; parsed on read
};


// =================================================================
// SCHEMAS
// One entry per managed sheet.
//
// _sheetName    : exact Google Sheet tab name
// _dataStartRow : number of leading rows to skip (header rows).
//                 1 = one header row, data starts at sheet row 2.
//                 2 = title + header rows, data starts at sheet row 3.
// _idField      : (optional) field auto-populated with a generated id on insert
// _idPrefix     : prefix for generated ids (e.g. 'BLC' → 'BLC-2026-0001')
// _softDeleteField : field set to '_DELETED' on soft delete (usually 'status')
//
// columns.<fieldName> : { col: <0-based index>, type: SDB_T.*, required: bool, default: any }
// =================================================================

var SDB_SCHEMAS = {};


// ── MASTER_JOB_DATABASE ──────────────────────────────────────────
// 39 columns (A–AM). Indices derived from CONFIG.masterCols (1-based) − 1.
SDB_SCHEMAS['MASTER'] = {
  _sheetName       : 'MASTER_JOB_DATABASE',
  _dataStartRow    : 1,
  _idField         : 'rowId',
  _idPrefix        : 'BLC',
  _softDeleteField : 'status',
  columns: {
    jobNumber            : { col:  0, type: SDB_T.STRING,    required: true,  default: ''      },
    clientCode           : { col:  1, type: SDB_T.STRING,    required: true,  default: ''      },
    clientName           : { col:  2, type: SDB_T.STRING,    required: false, default: ''      },
    designerName         : { col:  3, type: SDB_T.STRING,    required: true,  default: ''      },
    productType          : { col:  4, type: SDB_T.STRING,    required: false, default: ''      },
    allocatedDate        : { col:  5, type: SDB_T.TIMESTAMP, required: false, default: null    },
    startDate            : { col:  6, type: SDB_T.TIMESTAMP, required: false, default: null    },
    expectedCompletion   : { col:  7, type: SDB_T.TIMESTAMP, required: false, default: null    },
    actualCompletion     : { col:  8, type: SDB_T.TIMESTAMP, required: false, default: null    },
    status               : { col:  9, type: SDB_T.STRING,    required: false, default: 'Received' },
    designHours          : { col: 10, type: SDB_T.NUMBER,    required: false, default: 0       },
    qcHours              : { col: 11, type: SDB_T.NUMBER,    required: false, default: 0       },
    totalBillableHours   : { col: 12, type: SDB_T.NUMBER,    required: false, default: 0       },
    reworkHoursMajor     : { col: 13, type: SDB_T.NUMBER,    required: false, default: 0       },
    reworkHoursMinor     : { col: 14, type: SDB_T.NUMBER,    required: false, default: 0       },
    qcLead               : { col: 15, type: SDB_T.STRING,    required: false, default: ''      },
    qcStatus             : { col: 16, type: SDB_T.STRING,    required: false, default: ''      },
    billingPeriod        : { col: 17, type: SDB_T.STRING,    required: false, default: ''      },
    invoiceMonth         : { col: 18, type: SDB_T.STRING,    required: false, default: ''      },
    sopAcknowledged      : { col: 19, type: SDB_T.STRING,    required: false, default: ''      },
    reallocationFlag     : { col: 20, type: SDB_T.STRING,    required: false, default: ''      },
    previousDesigner     : { col: 21, type: SDB_T.STRING,    required: false, default: ''      },
    reworkFlag           : { col: 22, type: SDB_T.STRING,    required: false, default: ''      },
    reworkCount          : { col: 23, type: SDB_T.NUMBER,    required: false, default: 0       },
    onHoldFlag           : { col: 24, type: SDB_T.STRING,    required: false, default: ''      },
    onHoldReason         : { col: 25, type: SDB_T.STRING,    required: false, default: ''      },
    lastUpdated          : { col: 26, type: SDB_T.TIMESTAMP, required: false, default: null    },
    lastUpdatedBy        : { col: 27, type: SDB_T.STRING,    required: false, default: ''      },
    notes                : { col: 28, type: SDB_T.STRING,    required: false, default: ''      },
    rowId                : { col: 29, type: SDB_T.STRING,    required: false, default: ''      },
    isTest               : { col: 30, type: SDB_T.BOOLEAN,   required: false, default: false   },
    sqftDesigner         : { col: 31, type: SDB_T.NUMBER,    required: false, default: 0       },
    sqftVerified         : { col: 32, type: SDB_T.NUMBER,    required: false, default: 0       },
    boardFootage         : { col: 33, type: SDB_T.NUMBER,    required: false, default: 0       },
    sqftDiscrepancy      : { col: 34, type: SDB_T.NUMBER,    required: false, default: 0       },
    isImported           : { col: 35, type: SDB_T.STRING,    required: false, default: ''      },
    qcExempt             : { col: 36, type: SDB_T.STRING,    required: false, default: ''      },
    sopChecklistSubmitted: { col: 37, type: SDB_T.STRING,    required: false, default: ''      },
    qcChecklistSubmitted : { col: 38, type: SDB_T.STRING,    required: false, default: ''      },
  }
};


// ── STAFF_ROSTER ─────────────────────────────────────────────────
// 14 columns (A–N). Indices from SR constants (already 0-based).
SDB_SCHEMAS['STAFF_ROSTER'] = {
  _sheetName       : 'STAFF_ROSTER',
  _dataStartRow    : 1,
  _softDeleteField : 'status',
  columns: {
    recordId   : { col:  0, type: SDB_T.STRING,    required: false, default: ''    },
    designerId : { col:  1, type: SDB_T.STRING,    required: true,  default: ''    },
    name       : { col:  2, type: SDB_T.STRING,    required: true,  default: ''    },
    role       : { col:  3, type: SDB_T.STRING,    required: false, default: ''    },
    clientCode : { col:  4, type: SDB_T.STRING,    required: false, default: ''    },
    supId      : { col:  5, type: SDB_T.STRING,    required: false, default: ''    },
    supName    : { col:  6, type: SDB_T.STRING,    required: false, default: ''    },
    payDesign  : { col:  7, type: SDB_T.BOOLEAN,   required: false, default: false },
    payQC      : { col:  8, type: SDB_T.BOOLEAN,   required: false, default: false },
    bonusElig  : { col:  9, type: SDB_T.BOOLEAN,   required: false, default: false },
    rate       : { col: 10, type: SDB_T.NUMBER,    required: false, default: 0     },
    effFrom    : { col: 11, type: SDB_T.DATE,      required: false, default: null  },
    effTo      : { col: 12, type: SDB_T.DATE,      required: false, default: null  },
    status     : { col: 13, type: SDB_T.STRING,    required: false, default: 'ACTIVE' },
  }
};


// ── PAYROLL_LEDGER ───────────────────────────────────────────────
// 18 columns (A–R). Indices from PL constants (1-based) − 1.
SDB_SCHEMAS['PAYROLL_LEDGER'] = {
  _sheetName       : 'PAYROLL_LEDGER',
  _dataStartRow    : 1,
  _softDeleteField : 'status',
  columns: {
    billingPeriod : { col:  0, type: SDB_T.STRING,    required: true,  default: ''      },
    designerId    : { col:  1, type: SDB_T.STRING,    required: true,  default: ''      },
    designerName  : { col:  2, type: SDB_T.STRING,    required: true,  default: ''      },
    role          : { col:  3, type: SDB_T.STRING,    required: false, default: ''      },
    designHours   : { col:  4, type: SDB_T.NUMBER,    required: false, default: 0       },
    qcHours       : { col:  5, type: SDB_T.NUMBER,    required: false, default: 0       },
    reworkExcluded: { col:  6, type: SDB_T.NUMBER,    required: false, default: 0       },
    totalPaidHours: { col:  7, type: SDB_T.NUMBER,    required: false, default: 0       },
    rateINR       : { col:  8, type: SDB_T.NUMBER,    required: false, default: 0       },
    basePay       : { col:  9, type: SDB_T.NUMBER,    required: false, default: 0       },
    bonusHours    : { col: 10, type: SDB_T.NUMBER,    required: false, default: 0       },
    bonusINR      : { col: 11, type: SDB_T.NUMBER,    required: false, default: 0       },
    totalPay      : { col: 12, type: SDB_T.NUMBER,    required: false, default: 0       },
    status        : { col: 13, type: SDB_T.STRING,    required: false, default: 'Draft' },
    stubSentAt    : { col: 14, type: SDB_T.TIMESTAMP, required: false, default: null    },
    confirmed     : { col: 15, type: SDB_T.STRING,    required: false, default: ''      },
    confirmedAt   : { col: 16, type: SDB_T.TIMESTAMP, required: false, default: null    },
    runTimestamp  : { col: 17, type: SDB_T.TIMESTAMP, required: false, default: null    },
  }
};


// ── PAYROLL_BONUS_LEDGER ─────────────────────────────────────────
// 8 columns (A–H). Indices from PB constants (1-based) − 1.
SDB_SCHEMAS['PAYROLL_BONUS_LEDGER'] = {
  _sheetName    : 'PAYROLL_BONUS_LEDGER',
  _dataStartRow : 1,
  columns: {
    billingPeriod: { col: 0, type: SDB_T.STRING,    required: true,  default: ''   },
    supId        : { col: 1, type: SDB_T.STRING,    required: true,  default: ''   },
    supName      : { col: 2, type: SDB_T.STRING,    required: false, default: ''   },
    designerId   : { col: 3, type: SDB_T.STRING,    required: true,  default: ''   },
    designerName : { col: 4, type: SDB_T.STRING,    required: false, default: ''   },
    hours        : { col: 5, type: SDB_T.NUMBER,    required: false, default: 0    },
    bonusINR     : { col: 6, type: SDB_T.NUMBER,    required: false, default: 0    },
    runTimestamp : { col: 7, type: SDB_T.TIMESTAMP, required: false, default: null },
  }
};


// ── PAYROLL_APPROVAL_LOG ─────────────────────────────────────────
// 15 columns (A–O). Indices from PA constants (1-based) − 1.
SDB_SCHEMAS['PAYROLL_APPROVAL_LOG'] = {
  _sheetName    : 'PAYROLL_APPROVAL_LOG',
  _dataStartRow : 1,
  columns: {
    requestId   : { col:  0, type: SDB_T.STRING,    required: true,  default: '' },
    requestType : { col:  1, type: SDB_T.STRING,    required: false, default: '' },
    requestedBy : { col:  2, type: SDB_T.STRING,    required: false, default: '' },
    requestedAt : { col:  3, type: SDB_T.TIMESTAMP, required: false, default: null },
    designerId  : { col:  4, type: SDB_T.STRING,    required: false, default: '' },
    designerName: { col:  5, type: SDB_T.STRING,    required: false, default: '' },
    oldSupId    : { col:  6, type: SDB_T.STRING,    required: false, default: '' },
    oldSupName  : { col:  7, type: SDB_T.STRING,    required: false, default: '' },
    newSupId    : { col:  8, type: SDB_T.STRING,    required: false, default: '' },
    newSupName  : { col:  9, type: SDB_T.STRING,    required: false, default: '' },
    effectiveDate:{ col: 10, type: SDB_T.DATE,      required: false, default: null },
    status      : { col: 11, type: SDB_T.STRING,    required: false, default: 'Pending' },
    reviewedBy  : { col: 12, type: SDB_T.STRING,    required: false, default: '' },
    reviewedAt  : { col: 13, type: SDB_T.TIMESTAMP, required: false, default: null },
    notes       : { col: 14, type: SDB_T.STRING,    required: false, default: '' },
  }
};


// ── EXCEPTIONS_LOG (existing) / AUDIT_LOG (target name) ─────────
// Unified event log. Currently called EXCEPTIONS_LOG; kept for backwards-compat.
SDB_SCHEMAS['AUDIT_LOG'] = {
  _sheetName    : 'EXCEPTIONS_LOG',
  _dataStartRow : 1,
  columns: {
    timestamp  : { col: 0, type: SDB_T.TIMESTAMP, required: false, default: null },
    severity   : { col: 1, type: SDB_T.STRING,    required: false, default: 'INFO' },
    entity     : { col: 2, type: SDB_T.STRING,    required: false, default: '' },
    function_  : { col: 3, type: SDB_T.STRING,    required: false, default: '' },
    message    : { col: 4, type: SDB_T.STRING,    required: false, default: '' },
    user       : { col: 5, type: SDB_T.STRING,    required: false, default: '' },
  }
};


// ── CONFIG_MASTER (new — Phase 1) ────────────────────────────────
// Key-value configuration store. All system constants live here.
// Create this sheet before using ConfigService.
SDB_SCHEMAS['CONFIG_MASTER'] = {
  _sheetName    : 'CONFIG_MASTER',
  _dataStartRow : 1,
  columns: {
    configKey   : { col: 0, type: SDB_T.STRING, required: true,  default: '' },
    configValue : { col: 1, type: SDB_T.STRING, required: false, default: '' },
    configGroup : { col: 2, type: SDB_T.STRING, required: false, default: '' },
    editableBy  : { col: 3, type: SDB_T.STRING, required: false, default: 'ADMIN' },
    description : { col: 4, type: SDB_T.STRING, required: false, default: '' },
    lastUpdated : { col: 5, type: SDB_T.TIMESTAMP, required: false, default: null },
    updatedBy   : { col: 6, type: SDB_T.STRING, required: false, default: '' },
  }
};


// ── CLIENT_MASTER ────────────────────────────────────────────────
// Exists as a sheet already. Schema reflects intended target layout.
SDB_SCHEMAS['CLIENT_MASTER'] = {
  _sheetName       : 'CLIENT_MASTER',
  _dataStartRow    : 1,
  _softDeleteField : 'status',
  columns: {
    clientCode      : { col:  0, type: SDB_T.STRING, required: true,  default: ''      },
    clientName      : { col:  1, type: SDB_T.STRING, required: true,  default: ''      },
    billingContact  : { col:  2, type: SDB_T.STRING, required: false, default: ''      },
    feedbackContact : { col:  3, type: SDB_T.STRING, required: false, default: ''      },
    billingWindow   : { col:  4, type: SDB_T.STRING, required: false, default: 'HALF_MONTH' },
    invoiceFormat   : { col:  5, type: SDB_T.STRING, required: false, default: 'STANDARD'  },
    sopConfigId     : { col:  6, type: SDB_T.STRING, required: false, default: ''      },
    rateOverride    : { col:  7, type: SDB_T.NUMBER, required: false, default: 0       },
    status          : { col:  8, type: SDB_T.STRING, required: false, default: 'ACTIVE' },
    notes           : { col:  9, type: SDB_T.STRING, required: false, default: ''      },
  }
};


// ── SOP_CONFIG (new — Phase 2) ───────────────────────────────────
// Per-client, per-product-type QC form and checklist configuration.
SDB_SCHEMAS['SOP_CONFIG'] = {
  _sheetName    : 'SOP_CONFIG',
  _dataStartRow : 1,
  columns: {
    configId            : { col: 0, type: SDB_T.STRING, required: true,  default: ''    },
    clientCode          : { col: 1, type: SDB_T.STRING, required: true,  default: ''    },
    productType         : { col: 2, type: SDB_T.STRING, required: false, default: '*'   },
    qcFormUrl           : { col: 3, type: SDB_T.STRING, required: false, default: ''    },
    qcSteps             : { col: 4, type: SDB_T.STRING, required: false, default: ''    },
    requiredAttachments : { col: 5, type: SDB_T.STRING, required: false, default: ''    },
    reviewerRole        : { col: 6, type: SDB_T.STRING, required: false, default: 'TL'  },
    effectiveFrom       : { col: 7, type: SDB_T.DATE,   required: false, default: null  },
    effectiveTo         : { col: 8, type: SDB_T.DATE,   required: false, default: null  },
  }
};


// ── FEEDBACK_LOG (new — Phase 4) ─────────────────────────────────
SDB_SCHEMAS['FEEDBACK_LOG'] = {
  _sheetName    : 'FEEDBACK_LOG',
  _dataStartRow : 1,
  _idField      : 'feedbackId',
  _idPrefix     : 'FB',
  columns: {
    feedbackId          : { col:  0, type: SDB_T.STRING,    required: false, default: ''    },
    clientCode          : { col:  1, type: SDB_T.STRING,    required: true,  default: ''    },
    jobNumber           : { col:  2, type: SDB_T.STRING,    required: false, default: ''    },
    designerId          : { col:  3, type: SDB_T.STRING,    required: false, default: ''    },
    billingPeriod       : { col:  4, type: SDB_T.STRING,    required: false, default: ''    },
    requestedAt         : { col:  5, type: SDB_T.TIMESTAMP, required: false, default: null  },
    requestSentAt       : { col:  6, type: SDB_T.TIMESTAMP, required: false, default: null  },
    responseReceivedAt  : { col:  7, type: SDB_T.TIMESTAMP, required: false, default: null  },
    ratingOverall       : { col:  8, type: SDB_T.NUMBER,    required: false, default: 0     },
    ratingQuality       : { col:  9, type: SDB_T.NUMBER,    required: false, default: 0     },
    ratingTimeliness    : { col: 10, type: SDB_T.NUMBER,    required: false, default: 0     },
    comments            : { col: 11, type: SDB_T.STRING,    required: false, default: ''    },
    hrReviewed          : { col: 12, type: SDB_T.BOOLEAN,   required: false, default: false },
    hrReviewAt          : { col: 13, type: SDB_T.TIMESTAMP, required: false, default: null  },
    usedInBonusCycle    : { col: 14, type: SDB_T.BOOLEAN,   required: false, default: false },
    bonusCycleId        : { col: 15, type: SDB_T.STRING,    required: false, default: ''    },
    status              : { col: 16, type: SDB_T.STRING,    required: false, default: 'Pending_HR_Review' },
  }
};


// ── BONUS_LEDGER (new — Phase 5) ─────────────────────────────────
SDB_SCHEMAS['BONUS_LEDGER'] = {
  _sheetName    : 'BONUS_LEDGER',
  _dataStartRow : 1,
  _idField      : 'bonusId',
  _idPrefix     : 'BNS',
  columns: {
    bonusId           : { col:  0, type: SDB_T.STRING,    required: false, default: ''      },
    designerId        : { col:  1, type: SDB_T.STRING,    required: true,  default: ''      },
    designerName      : { col:  2, type: SDB_T.STRING,    required: false, default: ''      },
    bonusType         : { col:  3, type: SDB_T.STRING,    required: true,  default: ''      },
    calculationPeriod : { col:  4, type: SDB_T.STRING,    required: false, default: ''      },
    baseHours         : { col:  5, type: SDB_T.NUMBER,    required: false, default: 0       },
    baseINR           : { col:  6, type: SDB_T.NUMBER,    required: false, default: 0       },
    bonusRate         : { col:  7, type: SDB_T.NUMBER,    required: false, default: 0       },
    bonusINR          : { col:  8, type: SDB_T.NUMBER,    required: false, default: 0       },
    feedbackScore     : { col:  9, type: SDB_T.NUMBER,    required: false, default: 0       },
    performanceTier   : { col: 10, type: SDB_T.STRING,    required: false, default: ''      },
    status            : { col: 11, type: SDB_T.STRING,    required: false, default: 'Draft' },
    approvedBy        : { col: 12, type: SDB_T.STRING,    required: false, default: ''      },
    approvedAt        : { col: 13, type: SDB_T.TIMESTAMP, required: false, default: null    },
    paidAt            : { col: 14, type: SDB_T.TIMESTAMP, required: false, default: null    },
  }
};

// ── QUARTERLY_BONUS_INPUTS (new — Phase 5) ──────────────────────
SDB_SCHEMAS['QUARTERLY_BONUS_INPUTS'] = {
  _sheetName    : 'QUARTERLY_BONUS_INPUTS',
  _dataStartRow : 1,
  _idField      : 'inputId',
  _idPrefix     : 'QBI',
  columns: {
    inputId           : { col:  0, type: SDB_T.STRING,    required: false, default: ''      },
    quarter           : { col:  1, type: SDB_T.STRING,    required: true,  default: ''      },
    personId          : { col:  2, type: SDB_T.STRING,    required: true,  default: ''      },
    personName        : { col:  3, type: SDB_T.STRING,    required: false, default: ''      },
    role              : { col:  4, type: SDB_T.STRING,    required: false, default: ''      },
    clientFeedbackAvg : { col:  5, type: SDB_T.NUMBER,    required: false, default: 0       },
    tlRatingAvg       : { col:  6, type: SDB_T.NUMBER,    required: false, default: 0       },
    pmRatingAvg       : { col:  7, type: SDB_T.NUMBER,    required: false, default: 0       },
    ceoRatingAvg      : { col:  8, type: SDB_T.NUMBER,    required: false, default: 0       },
    forcedDiffFlag    : { col:  9, type: SDB_T.BOOLEAN,   required: false, default: false   },
    strengthNote      : { col: 10, type: SDB_T.STRING,    required: false, default: ''      },
    improvementNote   : { col: 11, type: SDB_T.STRING,    required: false, default: ''      },
    compositeScore    : { col: 12, type: SDB_T.NUMBER,    required: false, default: 0       },
    status            : { col: 13, type: SDB_T.STRING,    required: false, default: 'Draft' },
    computedAt        : { col: 14, type: SDB_T.TIMESTAMP, required: false, default: null    }
  }
};


// ── INVOICE_MASTER (new — Phase 3) ───────────────────────────────
SDB_SCHEMAS['INVOICE_MASTER'] = {
  _sheetName    : 'INVOICE_MASTER',
  _dataStartRow : 1,
  _idField      : 'invoiceId',
  _idPrefix     : 'INV',
  columns: {
    invoiceId       : { col:  0, type: SDB_T.STRING,    required: false, default: ''         },
    clientCode      : { col:  1, type: SDB_T.STRING,    required: true,  default: ''         },
    billingPeriod   : { col:  2, type: SDB_T.STRING,    required: true,  default: ''         },
    totalJobs       : { col:  3, type: SDB_T.NUMBER,    required: false, default: 0          },
    totalDesignHrs  : { col:  4, type: SDB_T.NUMBER,    required: false, default: 0          },
    totalQcHrs      : { col:  5, type: SDB_T.NUMBER,    required: false, default: 0          },
    totalBillableHrs: { col:  6, type: SDB_T.NUMBER,    required: false, default: 0          },
    totalAmountINR  : { col:  7, type: SDB_T.NUMBER,    required: false, default: 0          },
    docUrl          : { col:  8, type: SDB_T.STRING,    required: false, default: ''         },
    generatedAt     : { col:  9, type: SDB_T.TIMESTAMP, required: false, default: null       },
    sentAt          : { col: 10, type: SDB_T.TIMESTAMP, required: false, default: null       },
    status          : { col: 11, type: SDB_T.STRING,    required: false, default: 'Draft'    },
    hrApprovedBy    : { col: 12, type: SDB_T.STRING,    required: false, default: ''         },
    hrApprovedAt    : { col: 13, type: SDB_T.TIMESTAMP, required: false, default: null       },
    notes           : { col: 14, type: SDB_T.STRING,    required: false, default: ''         },
  }
};


// ── WORKFLOW_QUEUE (new — Phase 1) ───────────────────────────────
// Async job queue for operations that exceed GAS 6-minute limit.
SDB_SCHEMAS['WORKFLOW_QUEUE'] = {
  _sheetName    : 'WORKFLOW_QUEUE',
  _dataStartRow : 1,
  columns: {
    jobId       : { col: 0, type: SDB_T.STRING,    required: true,  default: ''        },
    jobType     : { col: 1, type: SDB_T.STRING,    required: true,  default: ''        },
    payload     : { col: 2, type: SDB_T.JSON,      required: false, default: ''        },
    status      : { col: 3, type: SDB_T.STRING,    required: false, default: 'Pending' },
    createdAt   : { col: 4, type: SDB_T.TIMESTAMP, required: false, default: null      },
    startedAt   : { col: 5, type: SDB_T.TIMESTAMP, required: false, default: null      },
    completedAt : { col: 6, type: SDB_T.TIMESTAMP, required: false, default: null      },
    errorMessage: { col: 7, type: SDB_T.STRING,    required: false, default: ''        },
    retryCount  : { col: 8, type: SDB_T.NUMBER,    required: false, default: 0         },
  }
};


// =================================================================
// MODULE STATE
// _cache holds raw values arrays per sheet, valid for one execution.
// Cleared on every write.
// =================================================================

var _SDB_STATE = {
  cache : {},   // { sheetName: { values: [[...]], readAt: timestamp } }
  ss    : null, // cached Spreadsheet reference
};


// =================================================================
// PRIVATE HELPERS
// Prefix: _sdb
// =================================================================

/**
 * Returns the Spreadsheet, using a cached reference when possible.
 */
function _sdbSpreadsheet() {
  if (!_SDB_STATE.ss) {
    try {
      _SDB_STATE.ss = SpreadsheetApp.getActiveSpreadsheet()
        || SpreadsheetApp.openById(SHEETDB_SPREADSHEET_ID);
    } catch (e) {
      _SDB_STATE.ss = SpreadsheetApp.openById(SHEETDB_SPREADSHEET_ID);
    }
  }
  return _SDB_STATE.ss;
}

/**
 * Returns the Sheet object for the given alias, throwing a clear
 * error if the schema alias or physical sheet is not found.
 */
function _sdbSheet(alias) {
  var schema = SDB_SCHEMAS[alias];
  if (!schema) throw new Error('SheetDB: unknown schema alias "' + alias + '"');
  var sh = _sdbSpreadsheet().getSheetByName(schema._sheetName);
  if (!sh) throw new Error(
    'SheetDB: sheet "' + schema._sheetName + '" not found. ' +
    'Run SheetDB.bootstrap() to create missing sheets.'
  );
  return sh;
}

/**
 * Returns raw values array for a sheet, using cache if available.
 * Cache is keyed by alias (not sheet name) so that schema remappings
 * don't share stale cache entries.
 */
function _sdbReadRaw(alias) {
  if (SHEETDB_CACHE_ENABLED && _SDB_STATE.cache[alias]) {
    return _SDB_STATE.cache[alias];
  }
  var raw = _sdbSheet(alias).getDataRange().getValues();
  if (SHEETDB_CACHE_ENABLED) _SDB_STATE.cache[alias] = raw;
  return raw;
}

/**
 * Converts a raw sheet row (array of values) to a typed object using
 * the schema definition. Adds _rowIndex (1-based sheet row number).
 *
 * dataStartRow: number of header rows skipped before data rows.
 * arrayIndex  : index of this row within the *data* portion (0-based).
 * rawRow      : the actual array from getValues()
 */
function _sdbRowToObject(schema, rawRow, arrayIndex) {
  var obj = {};
  var cols = schema.columns;

  for (var field in cols) {
    if (!cols.hasOwnProperty(field)) continue;
    var def = cols[field];
    var raw = def.col < rawRow.length ? rawRow[def.col] : undefined;
    obj[field] = _sdbCoerce(raw, def.type, def.default);
  }

  // _rowIndex is 1-based sheet row: header rows + arrayIndex + 1
  obj._rowIndex = schema._dataStartRow + arrayIndex + 1;
  return obj;
}

/**
 * Converts a plain object to a flat row array sized to fit the widest
 * column in the schema. Fields not in the schema are ignored.
 * Unset fields use their schema default.
 */
function _sdbObjectToRow(schema, obj) {
  var cols = schema.columns;

  // Find the highest column index in this schema.
  var maxCol = 0;
  for (var f in cols) {
    if (cols.hasOwnProperty(f) && cols[f].col > maxCol) maxCol = cols[f].col;
  }

  var row = new Array(maxCol + 1).fill('');

  for (var field in cols) {
    if (!cols.hasOwnProperty(field)) continue;
    var def = cols[field];
    var val = obj.hasOwnProperty(field) ? obj[field] : def.default;
    row[def.col] = _sdbSerialise(val, def.type);
  }

  return row;
}

/**
 * Coerces a raw sheet value to the target type.
 * Returns defaultVal when the raw value is null/undefined/blank.
 */
function _sdbCoerce(raw, type, defaultVal) {
  // Treat empty-ish as default
  if (raw === null || raw === undefined || raw === '') {
    return (defaultVal !== undefined) ? defaultVal : null;
  }

  switch (type) {
    case SDB_T.NUMBER:
      // Strip any currency symbol (₹, $, CAD, etc.), commas, and whitespace.
      // Keep digits, decimal point, and leading minus for negatives.
      var n = parseFloat(String(raw).replace(/[^0-9.-]/g, ''));
      if (isNaN(n)) {
        Logger.log(
          'SheetDB _sdbCoerce WARNING: could not parse NUMBER from value "' +
          raw + '" — using default (' + (defaultVal || 0) + ')'
        );
        return (defaultVal || 0);
      }
      return n;

    case SDB_T.BOOLEAN:
      if (typeof raw === 'boolean') return raw;
      var s = String(raw).trim().toLowerCase();
      // 'checked' covers native Google Sheets checkbox cells.
      return (s === 'yes' || s === 'true' || s === '1' || s === 'checked');

    case SDB_T.DATE:
    case SDB_T.TIMESTAMP:
      if (raw instanceof Date) return raw;
      var d = new Date(raw);
      return isNaN(d.getTime()) ? (defaultVal || null) : d;

    case SDB_T.JSON:
      if (typeof raw === 'object') return raw;
      try { return JSON.parse(String(raw)); }
      catch (e) { return defaultVal || null; }

    case SDB_T.STRING:
    default:
      return String(raw).trim();
  }
}

/**
 * Prepares a value for writing back to the sheet.
 */
function _sdbSerialise(val, type) {
  if (val === null || val === undefined) return '';

  switch (type) {
    case SDB_T.BOOLEAN:
      if (typeof val === 'boolean') return val ? 'Yes' : 'No';
      return val;

    case SDB_T.JSON:
      if (typeof val === 'string') return val;
      try { return JSON.stringify(val); }
      catch (e) { return ''; }

    case SDB_T.NUMBER:
      return (typeof val === 'number') ? val : (parseFloat(val) || 0);

    default:
      return (val instanceof Date) ? val : String(val);
  }
}

/**
 * Acquires a spreadsheet-level write lock, waiting up to 15 seconds.
 * Throws if the lock cannot be acquired.
 */
function _sdbAcquireLock() {
  var lock = LockService.getSpreadsheetLock();
  if (!lock.tryLock(15000)) {
    throw new Error(
      'SheetDB: could not acquire write lock after 15 s. ' +
      'Another operation is in progress. Retry in a moment.'
    );
  }
  return lock;
}

/**
 * Validates required fields before insert. Throws with a descriptive
 * message listing every missing required field.
 */
function _sdbValidateRequired(schema, obj) {
  var missing = [];
  var cols = schema.columns;
  for (var field in cols) {
    if (!cols.hasOwnProperty(field)) continue;
    if (!cols[field].required) continue;
    var v = obj[field];
    if (v === null || v === undefined || v === '') missing.push(field);
  }
  if (missing.length > 0) {
    throw new Error(
      'SheetDB [' + schema._sheetName + ']: missing required fields: ' +
      missing.join(', ')
    );
  }
}

/**
 * Generates the next Row_ID for a schema that has _idField defined.
 * Format: {PREFIX}-{YYYY}-{seq4}  e.g.  BLC-2026-0042
 * Must be called inside a write lock.
 */
function _sdbNextId(alias) {
  var schema = SDB_SCHEMAS[alias];
  if (!schema._idField || !schema._idPrefix) {
    throw new Error('SheetDB.nextRowId: schema "' + alias + '" has no _idField/_idPrefix');
  }

  var year     = new Date().getFullYear();
  var prefix   = schema._idPrefix + '-' + year + '-';
  var raw      = _sdbReadRaw(alias);
  var idCol    = schema.columns[schema._idField].col;
  var maxSeq   = 0;

  for (var i = schema._dataStartRow; i < raw.length; i++) {
    var cellVal = String(raw[i][idCol] || '');
    if (cellVal.indexOf(prefix) === 0) {
      var seq = parseInt(cellVal.slice(prefix.length), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }

  return prefix + String(maxSeq + 1).padStart(4, '0');
}


// =================================================================
// PUBLIC API
// =================================================================

var SheetDB = {};

/**
 * Returns every data row in the sheet as an array of typed objects.
 * Results are cached for the lifetime of the current script execution.
 *
 * @param  {string}  alias  Schema alias (e.g. 'MASTER', 'STAFF_ROSTER')
 * @return {Object[]} array of row objects, each with a _rowIndex property
 */
SheetDB.getAll = function(alias) {
  var schema = SDB_SCHEMAS[alias];
  if (!schema) throw new Error('SheetDB.getAll: unknown alias "' + alias + '"');

  var raw    = _sdbReadRaw(alias);
  var result = [];

  for (var i = schema._dataStartRow; i < raw.length; i++) {
    // Skip entirely empty rows (all cells blank).
    var row = raw[i];
    if (!row.some(function(c) { return c !== '' && c !== null && c !== undefined; })) continue;
    result.push(_sdbRowToObject(schema, row, i - schema._dataStartRow));
  }

  return result;
};

/**
 * Returns all rows matching the predicate function.
 *
 * @param  {string}   alias
 * @param  {Function} predicate  function(rowObject) → boolean
 * @return {Object[]}
 */
SheetDB.findRows = function(alias, predicate) {
  return SheetDB.getAll(alias).filter(predicate);
};

/**
 * Returns the first row matching the predicate, or null if none found.
 *
 * @param  {string}   alias
 * @param  {Function} predicate
 * @return {Object|null}
 */
SheetDB.findOne = function(alias, predicate) {
  var all = SheetDB.getAll(alias);
  for (var i = 0; i < all.length; i++) {
    if (predicate(all[i])) return all[i];
  }
  return null;
};

/**
 * Returns the count of rows matching the predicate.
 *
 * @param  {string}   alias
 * @param  {Function} [predicate]  omit to count all rows
 * @return {number}
 */
SheetDB.count = function(alias, predicate) {
  var all = SheetDB.getAll(alias);
  if (!predicate) return all.length;
  return all.filter(predicate).length;
};

/**
 * Appends one or more rows to the sheet.
 * Auto-populates _idField, lastUpdated, lastUpdatedBy where defined in schema.
 * Acquires a write lock to prevent duplicate IDs under concurrent access.
 *
 * @param  {string}   alias
 * @param  {Object[]} rows  array of plain objects. Fields not in schema are ignored.
 * @return {Object[]} the inserted rows with _rowIndex populated
 */
SheetDB.insertRows = function(alias, rows) {
  if (!rows || rows.length === 0) return [];

  var schema = SDB_SCHEMAS[alias];
  if (!schema) throw new Error('SheetDB.insertRows: unknown alias "' + alias + '"');

  var lock = _sdbAcquireLock();
  try {
    Logger.log('SheetDB WRITE: INSERT [' + alias + '] ' + rows.length + ' row(s)');

    // Invalidate cache before reading fresh data inside lock.
    delete _SDB_STATE.cache[alias];

    var sh      = _sdbSheet(alias);
    var now     = new Date();
    var user    = (function() {
      try { return Session.getActiveUser().getEmail() || 'SYSTEM'; }
      catch (e) { return 'SYSTEM'; }
    }());
    var rowArrays = [];

    for (var i = 0; i < rows.length; i++) {
      var obj = {};
      // Copy all provided fields.
      for (var k in rows[i]) {
        if (rows[i].hasOwnProperty(k)) obj[k] = rows[i][k];
      }

      // Apply required-field validation.
      _sdbValidateRequired(schema, obj);

      // Auto-generate ID if schema defines one and it is not already set.
      if (schema._idField && !obj[schema._idField]) {
        obj[schema._idField] = _sdbNextId(alias);
        // Re-invalidate cache after each ID read so next iteration sees new max.
        delete _SDB_STATE.cache[alias];
      }

      // Auto-populate audit fields where present in schema.
      if (schema.columns.lastUpdated    && !obj.lastUpdated)    obj.lastUpdated    = now;
      if (schema.columns.lastUpdatedBy  && !obj.lastUpdatedBy)  obj.lastUpdatedBy  = user;
      if (schema.columns.createdAt      && !obj.createdAt)      obj.createdAt      = now;
      if (schema.columns.runTimestamp   && !obj.runTimestamp)   obj.runTimestamp   = now;

      rowArrays.push(_sdbObjectToRow(schema, obj));
    }

    // Write all rows in a single setValues call for performance.
    var firstNewRow = sh.getLastRow() + 1;
    sh.getRange(firstNewRow, 1, rowArrays.length, rowArrays[0].length)
      .setValues(rowArrays);

    // Invalidate cache after write.
    delete _SDB_STATE.cache[alias];

    // Return objects with _rowIndex attached.
    return rows.map(function(r, idx) {
      var out = {};
      for (var f in r) if (r.hasOwnProperty(f)) out[f] = r[f];
      out._rowIndex = firstNewRow + idx;
      return out;
    });
  } finally {
    lock.releaseLock();
  }
};

/**
 * Updates specific fields in a single row identified by its 1-based _rowIndex.
 * Only the columns that correspond to keys in `updates` are touched —
 * other columns in the row are left unchanged.
 *
 * @param  {string} alias
 * @param  {number} rowIndex  1-based sheet row number (from row._rowIndex)
 * @param  {Object} updates   plain object of field → new value
 */
SheetDB.updateRow = function(alias, rowIndex, updates) {
  var schema = SDB_SCHEMAS[alias];
  if (!schema) throw new Error('SheetDB.updateRow: unknown alias "' + alias + '"');
  if (!rowIndex || rowIndex < schema._dataStartRow + 1) {
    throw new Error(
      'SheetDB.updateRow: invalid rowIndex ' + rowIndex +
      ' (data rows start at ' + (schema._dataStartRow + 1) + ')'
    );
  }

  var lock = _sdbAcquireLock();
  try {
    Logger.log(
      'SheetDB WRITE: UPDATE [' + alias + '] rowIndex=' + rowIndex +
      ' fields=[' + Object.keys(updates).join(', ') + ']'
    );

    var sh  = _sdbSheet(alias);
    var now = new Date();
    var user = (function() {
      try { return Session.getActiveUser().getEmail() || 'SYSTEM'; }
      catch (e) { return 'SYSTEM'; }
    }());

    // Auto-populate audit fields in the updates map.
    if (schema.columns.lastUpdated)   updates.lastUpdated   = now;
    if (schema.columns.lastUpdatedBy) updates.lastUpdatedBy = user;

    // Write each changed field as a targeted single-cell setValue.
    // This avoids overwriting columns outside our schema entirely.
    var cols = schema.columns;
    for (var field in updates) {
      if (!updates.hasOwnProperty(field)) continue;
      if (!cols[field]) {
        Logger.log(
          'SheetDB.updateRow WARNING: [' + alias + '] field "' + field +
          '" does not exist in schema — skipped. Check your updates object.'
        );
        continue;
      }
      var colIndex = cols[field].col + 1;  // 1-based for getRange
      var serialised = _sdbSerialise(updates[field], cols[field].type);
      sh.getRange(rowIndex, colIndex).setValue(serialised);
    }

    delete _SDB_STATE.cache[alias];
  } finally {
    lock.releaseLock();
  }
};

/**
 * Updates matching rows with the given field changes.
 * Logs a warning if more than SHEETDB_BULK_WARN_THRESHOLD rows are affected.
 *
 * @param  {string}   alias
 * @param  {Function} predicate  function(rowObject) → boolean
 * @param  {Object}   updates
 * @return {number}   count of rows updated
 */
SheetDB.updateWhere = function(alias, predicate, updates) {
  var matches = SheetDB.findRows(alias, predicate);

  if (matches.length > SHEETDB_BULK_WARN_THRESHOLD) {
    Logger.log(
      'SheetDB.updateWhere [' + alias + ']: WARNING — about to update ' +
      matches.length + ' rows (> threshold of ' + SHEETDB_BULK_WARN_THRESHOLD + '). ' +
      'Verify your predicate is correct before proceeding.'
    );
  }

  for (var i = 0; i < matches.length; i++) {
    SheetDB.updateRow(alias, matches[i]._rowIndex, updates);
  }
  return matches.length;
};

/**
 * Marks rows matching the predicate as deleted by setting the schema's
 * _softDeleteField (usually 'status') to '_DELETED'.
 *
 * Hard delete is DISABLED. Permanently removing rows is not permitted
 * in this system. Passing { soft: false } or omitting opts both throw.
 * This protects production data from accidental or programmatic loss.
 *
 * @param  {string}   alias
 * @param  {Function} predicate
 * @param  {Object}   [opts]  must be { soft: true } — no other value accepted
 * @return {number}   count of rows marked _DELETED
 */
SheetDB.deleteWhere = function(alias, predicate, opts) {
  var schema = SDB_SCHEMAS[alias];
  if (!schema) throw new Error('SheetDB.deleteWhere: unknown alias "' + alias + '"');

  // Hard delete is not permitted. Caller must explicitly pass { soft: true }.
  if (!opts || opts.soft !== true) {
    throw new Error(
      'SheetDB.deleteWhere [' + alias + ']: hard delete is disabled. ' +
      'Pass { soft: true } to mark rows as _DELETED instead of removing them.'
    );
  }

  var matches = SheetDB.findRows(alias, predicate);
  if (matches.length === 0) return 0;

  if (matches.length > SHEETDB_BULK_WARN_THRESHOLD) {
    Logger.log(
      'SheetDB.deleteWhere [' + alias + ']: WARNING — soft-deleting ' +
      matches.length + ' rows (> threshold of ' + SHEETDB_BULK_WARN_THRESHOLD + '). ' +
      'Verify your predicate is correct before proceeding.'
    );
  }

  var field   = schema._softDeleteField || 'status';
  var updates = {};
  updates[field] = '_DELETED';
  return SheetDB.updateWhere(alias, predicate, updates);
};

/**
 * Generates the next Row_ID for a schema that declares _idField and _idPrefix.
 * Acquires a write lock to ensure uniqueness under concurrent calls.
 *
 * @param  {string} alias
 * @return {string} e.g. 'BLC-2026-0042'
 */
SheetDB.nextRowId = function(alias) {
  var lock = _sdbAcquireLock();
  try {
    return _sdbNextId(alias);
  } finally {
    lock.releaseLock();
  }
};

/**
 * Returns the raw schema definition for an alias.
 * Useful for introspection in service modules.
 *
 * @param  {string} alias
 * @return {Object}
 */
SheetDB.schema = function(alias) {
  var schema = SDB_SCHEMAS[alias];
  if (!schema) throw new Error('SheetDB.schema: unknown alias "' + alias + '"');
  return schema;
};

/**
 * Reads the actual header row from the live sheet and compares it against
 * the schema's column definitions. Logs a warning for every mismatch.
 * Run this after deploying a new schema or after manually reordering columns.
 *
 * @param  {string} alias
 * @return {{ ok: bool, mismatches: string[] }}
 */
SheetDB.verifySchema = function(alias) {
  var schema  = SDB_SCHEMAS[alias];
  if (!schema) throw new Error('SheetDB.verifySchema: unknown alias "' + alias + '"');

  var raw     = _sdbSheet(alias).getDataRange().getValues();
  var headers = raw[schema._dataStartRow - 1] || [];  // the last header row

  var mismatches = [];
  var cols       = schema.columns;

  for (var field in cols) {
    if (!cols.hasOwnProperty(field)) continue;
    var def        = cols[field];
    var liveHeader = String(headers[def.col] || '').trim();

    // Normalise both to lowercase, underscores → spaces, for fuzzy match.
    var norm = function(s) { return s.toLowerCase().replace(/_/g, ' '); };

    if (!liveHeader) {
      mismatches.push(
        'col ' + def.col + ' (' + field + '): sheet column is EMPTY or does not exist'
      );
    } else if (norm(liveHeader) !== norm(field) && norm(liveHeader) !== norm(field.replace(/([A-Z])/g, ' $1'))) {
      // Allow camelCase ↔ Title Case mismatches — flag only genuine differences.
      Logger.log(
        'SheetDB.verifySchema [' + alias + ']: col ' + def.col +
        ' — schema field "' + field + '" ↔ sheet header "' + liveHeader + '" (may be OK)'
      );
    }
  }

  if (mismatches.length > 0) {
    Logger.log('SheetDB.verifySchema [' + alias + ']: MISMATCHES:\n  ' + mismatches.join('\n  '));
  } else {
    Logger.log('SheetDB.verifySchema [' + alias + ']: OK (' + Object.keys(cols).length + ' columns checked)');
  }

  return { ok: mismatches.length === 0, mismatches: mismatches };
};

/**
 * Clears the read cache for a specific sheet alias.
 * The next read will hit the spreadsheet directly.
 *
 * @param {string} alias
 */
SheetDB.clearCache = function(alias) {
  delete _SDB_STATE.cache[alias];
};

/**
 * Clears all read caches.
 */
SheetDB.clearAllCaches = function() {
  _SDB_STATE.cache = {};
};


// =================================================================
// BOOTSTRAP
// Creates managed sheets that do not yet exist.
// Safe to run multiple times — skips sheets that already exist.
// Run once after deploying to a new spreadsheet.
// =================================================================

var SDB_NEW_SHEET_HEADERS = {
  'CONFIG_MASTER'  : ['Config_Key','Config_Value','Config_Group','Editable_By','Description','Last_Updated','Updated_By'],
  'SOP_CONFIG'     : ['Config_ID','Client_Code','Product_Type','QC_Form_URL','QC_Steps','Required_Attachments','Reviewer_Role','Effective_From','Effective_To'],
  'FEEDBACK_LOG'   : ['Feedback_ID','Client_Code','Job_Number','Designer_ID','Billing_Period','Requested_At','Request_Sent_At','Response_Received_At','Rating_Overall','Rating_Quality','Rating_Timeliness','Comments','HR_Reviewed','HR_Review_At','Used_In_Bonus_Cycle','Bonus_Cycle_ID','Status'],
  'BONUS_LEDGER'   : ['Bonus_ID','Designer_ID','Designer_Name','Bonus_Type','Calculation_Period','Base_Hours','Base_INR','Bonus_Rate','Bonus_INR','Feedback_Score','Performance_Tier','Status','Approved_By','Approved_At','Paid_At'],
  'INVOICE_MASTER' : ['Invoice_ID','Client_Code','Billing_Period','Total_Jobs','Total_Design_Hrs','Total_QC_Hrs','Total_Billable_Hrs','Total_Amount_INR','Doc_URL','Generated_At','Sent_At','Status','HR_Approved_By','HR_Approved_At','Notes'],
  'WORKFLOW_QUEUE' : ['Job_ID','Job_Type','Payload','Status','Created_At','Started_At','Completed_At','Error_Message','Retry_Count'],
};

/**
 * Creates any managed sheets that do not yet exist in the spreadsheet,
 * adding the correct header row. Existing sheets are not modified.
 *
 * Run this function once from the Apps Script editor after deploying.
 */
function bootstrapSheetDB() {
  var ss      = _sdbSpreadsheet();
  var created = [];
  var skipped = [];

  for (var alias in SDB_NEW_SHEET_HEADERS) {
    if (!SDB_NEW_SHEET_HEADERS.hasOwnProperty(alias)) continue;
    var sheetName = SDB_SCHEMAS[alias]._sheetName;
    var existing  = ss.getSheetByName(sheetName);

    if (existing) {
      skipped.push(sheetName);
      continue;
    }

    var sh      = ss.insertSheet(sheetName);
    var headers = SDB_NEW_SHEET_HEADERS[alias];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);

    // Basic formatting: freeze header, bold, grey background.
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#d9d9d9');

    created.push(sheetName);
    Logger.log('bootstrapSheetDB: created sheet "' + sheetName + '"');
  }

  var msg = 'bootstrapSheetDB complete.\n' +
    'Created: ' + (created.length ? created.join(', ') : 'none') + '\n' +
    'Already exist: ' + (skipped.length ? skipped.join(', ') : 'none');

  Logger.log(msg);

  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    // No UI context (triggered run) — log only.
  }

  return { created: created, skipped: skipped };
}

// Expose bootstrap on the SheetDB namespace as well.
SheetDB.bootstrap = bootstrapSheetDB;
