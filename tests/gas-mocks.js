/**
 * gas-mocks.js
 * Fake versions of Google Apps Script APIs for Jest testing.
 * Think of this as a "pretend Google" that runs on your Mac.
 */

// ── Fake Sheet ────────────────────────────────────────────────
class MockSheet {
  constructor(name, data = []) {
    this.name = name;
    this._data = data;  // 2D array, like a real spreadsheet
    this._lastRow = data.length;
  }

  getName()       { return this.name; }
  getLastRow()    { return this._data.length; }

  getDataRange()  { return new MockRange(this._data, this); }

  getRange(row, col, numRows = 1, numCols = 1) {
    const subset = [];
    for (let r = row - 1; r < row - 1 + numRows; r++) {
      const rowData = [];
      for (let c = col - 1; c < col - 1 + numCols; c++) {
        rowData.push((this._data[r] && this._data[r][c] !== undefined) ? this._data[r][c] : '');
      }
      subset.push(rowData);
    }
    return new MockRange(subset, this, row, col);
  }

  appendRow(rowData) {
    this._data.push(rowData);
    return this;
  }

  deleteRow(rowIndex) {
    this._data.splice(rowIndex - 1, 1);
  }

  clearContents() { this._data = []; return this; }
  clearFormats()  { return this; }
  setFrozenRows() { return this; }
  autoResizeColumn() { return this; }
  getFormUrl()    { return null; }
}

// ── Fake Range ────────────────────────────────────────────────
class MockRange {
  constructor(data, sheet, startRow, startCol) {
    this._data    = data;
    this._sheet   = sheet;
    this._startRow = startRow || 1;
    this._startCol = startCol || 1;
    this._lastSetValue = null;
  }

  getValues()     { return this._data; }
  getValue()      { return (this._data[0] && this._data[0][0] !== undefined) ? this._data[0][0] : ''; }

  setValues(values) {
    for (let r = 0; r < values.length; r++) {
      const sheetRow = this._startRow - 1 + r;
      if (!this._sheet._data[sheetRow]) this._sheet._data[sheetRow] = [];
      for (let c = 0; c < values[r].length; c++) {
        this._sheet._data[sheetRow][this._startCol - 1 + c] = values[r][c];
      }
    }
    return this;
  }

  setValue(value) {
    this._lastSetValue = value;
    if (!this._sheet._data[this._startRow - 1]) this._sheet._data[this._startRow - 1] = [];
    this._sheet._data[this._startRow - 1][this._startCol - 1] = value;
    return this;
  }

  setBackground()  { return this; }
  setFontWeight()  { return this; }
  setFontColor()   { return this; }
  setFontSize()    { return this; }
  getSheet()       { return this._sheet; }
}

// ── Fake Spreadsheet ──────────────────────────────────────────
class MockSpreadsheet {
  constructor() {
    this._sheets = {};
  }

  addSheet(name, data = []) {
    this._sheets[name] = new MockSheet(name, data);
    return this._sheets[name];
  }

  getSheetByName(name) {
    return this._sheets[name] || null;
  }

  insertSheet(name) {
    return this.addSheet(name, []);
  }

  getSheets() {
    return Object.values(this._sheets);
  }

  /**
   * setSheetData(name, data)
   * Helper for tests: creates (or replaces) a named sheet with pre-loaded 2D data.
   * The first row of `data` is treated as the header row by SheetDB.
   */
  setSheetData(name, data) {
    this._sheets[name] = new MockSheet(name, data);
    return this._sheets[name];
  }
}

// ── Global GAS stubs ──────────────────────────────────────────
let _mockSpreadsheet = new MockSpreadsheet();

global.SpreadsheetApp = {
  getActiveSpreadsheet: () => _mockSpreadsheet,
  flush: () => {},
  getUi: () => ({
    alert: () => {},
    ButtonSet: { YES_NO: 'YES_NO' },
    Button: { YES: 'YES' }
  })
};

global.Utilities = {
  formatDate: (date, tz, fmt) => date.toISOString().split('T')[0],
  getUuid:    () => 'test-uuid-' + Math.random().toString(36).substr(2, 9),
  sleep:      () => {}
};

global.Session = {
  getScriptTimeZone: () => 'America/Regina',
  getActiveUser:     () => ({ getEmail: () => 'test@blc.com' })
};

global.Logger = {
  log: () => {}
};

global.MailApp = {
  sendEmail: () => {}
};

// ── MockGmailMessage ──────────────────────────────────────────
class MockGmailMessage {
  constructor(opts = {}) {
    this._from       = opts.from       || 'test@example.com';
    this._subject    = opts.subject    || 'Test Subject';
    this._body       = opts.body       || '';
    this._date       = opts.date       || new Date();
    this._labels     = [];
  }
  getFrom()       { return this._from; }
  getSubject()    { return this._subject; }
  getPlainBody()  { return this._body; }
  getDate()       { return this._date; }
  addLabel(label) { this._labels.push(label); return this; }
}

// ── MockGmailThread ───────────────────────────────────────────
class MockGmailThread {
  constructor(messages = []) {
    this._messages = messages;
    this._labels   = [];
  }
  getMessages()          { return this._messages; }
  addLabel(label)        { this._labels.push(label); return this; }
  getAppliedLabels()     { return this._labels; }
}

// ── MockGmailLabel ────────────────────────────────────────────
class MockGmailLabel {
  constructor(name) { this._name = name; this._threads = []; }
  getName()                { return this._name; }
  addToThread(thread)      { this._threads.push(thread); return this; }
  getThreads()             { return this._threads; }
}

// ── GmailApp stub (extended for intake parser tests) ─────────
let _mockGmailThreads = [];
let _mockGmailLabels  = {};

global.GmailApp = {
  sendEmail:           () => {},
  search:              (query, start, max) => _mockGmailThreads.slice(0, max || 50),
  getUserLabelByName:  (name) => _mockGmailLabels[name] || null,
  createLabel:         (name) => {
    _mockGmailLabels[name] = new MockGmailLabel(name);
    return _mockGmailLabels[name];
  }
};

global.FormApp = {
  openById:   () => ({ getItems: () => [] }),
  openByUrl:  () => ({ getItems: () => [] }),
  ItemType:   { LIST: 'LIST' }
};

global.ScriptApp = {
  getProjectTriggers: () => [],
  newTrigger:         () => ({ forSpreadsheet: () => ({ onFormSubmit: () => ({ create: () => {} }) }), timeBased: () => ({ everyMinutes: () => ({ create: () => {} }), atHour: () => ({ everyDays: () => ({ create: () => {} }) }) }) }),
  deleteTrigger:      () => {}
};

global.DriveApp = {
  getRootFolder: () => ({ getFoldersByName: () => ({ hasNext: () => false }), createFolder: () => ({}) })
};

// ── Test helpers ──────────────────────────────────────────────

/**
 * resetMockSpreadsheet()
 * Call this at the start of each test to get a clean, empty spreadsheet.
 */
function resetMockSpreadsheet() {
  _mockSpreadsheet = new MockSpreadsheet();
  SpreadsheetApp.getActiveSpreadsheet = () => _mockSpreadsheet;
}

function resetMockGmail() {
  _mockGmailThreads = [];
  _mockGmailLabels  = {};
  GmailApp.search = (query, start, max) => _mockGmailThreads.slice(0, max || 50);
}

function addMockEmailThread(opts = {}) {
  var msg    = new MockGmailMessage(opts);
  var thread = new MockGmailThread([msg]);
  _mockGmailThreads.push(thread);
  return thread;
}

/**
 * getMockSpreadsheet()
 * Get the current mock spreadsheet so you can inspect its sheets.
 */
function getMockSpreadsheet() {
  return _mockSpreadsheet;
}

// ── SopIntegration.js stubs ──────────────────────────────────
// These functions are defined in SopIntegration.js which is not loaded
// by every test file. Stub them here so Code.js calls don't throw.
global.sendSopChecklistEmail_       = () => {};
global.sendSopReminderEmail_        = () => {};
global.sendQcChecklistEmail_        = () => {};
global.sendQcChecklistEmailToTeam_  = () => {};

module.exports = {
  resetMockSpreadsheet, getMockSpreadsheet, MockSheet, MockSpreadsheet,
  resetMockGmail, addMockEmailThread, MockGmailMessage, MockGmailThread, MockGmailLabel
};
