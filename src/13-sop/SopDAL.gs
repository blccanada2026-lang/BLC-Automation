// ============================================================
// SopDAL.gs — BLC Nexus T13 SOP Checklist Gate
// src/13-sop/SopDAL.gs
//
// All sheet I/O for the SOP subsystem. Only this file may
// read or write DIM_SOP_TEMPLATES, DIM_SOP_ITEMS,
// FACT_SOP_AUDITS, and FACT_SOP_CURRENT_STATUS.
//
// callerModule context:
//   - 'SopChecklistHandler' for FACT table writes
//   - 'SopAdminEngine'      for DIM table writes
// ============================================================

// Top-level global — accessible across all 13-sop files in GAS
function SopError_(code, message, context) {
  var err     = new Error(message);
  err.code    = code;
  err.context = context || {};
  return err;
}

var SopDAL = (function () {

  var MODULE = 'SopDAL';

  // ──────────────────────────────────────────────────────────
  // getActiveTemplate
  // Reads DIM_SOP_TEMPLATES and returns the single ACTIVE
  // template matching (clientCode, jobType, software, scopeCode).
  // Effective-date filtering is done in memory after readWhere
  // because Sheets stores dates as strings and loose-equality
  // matching on date ranges is unreliable.
  //
  // Returns the matching row object, or null if none found.
  // Throws SopError_('MULTIPLE_ACTIVE_TEMPLATES') if more than
  // one ACTIVE + in-date template matches (data integrity error).
  // ──────────────────────────────────────────────────────────
  function getActiveTemplate(clientCode, jobType, software, scopeCode) {
    var rows;
    try {
      rows = DAL.readWhere(
        Config.TABLES.DIM_SOP_TEMPLATES,
        {
          client_code: clientCode,
          job_type:    jobType,
          software:    software,
          scope_code:  scopeCode,
          status:      'ACTIVE'
        },
        { callerModule: MODULE }
      );
    } catch (e) {
      Logger.error('SOP_DAL_READ_FAILED', { module: MODULE, table: Config.TABLES.DIM_SOP_TEMPLATES, error: e.message });
      throw e;
    }

    if (!rows || rows.length === 0) return null;

    // Effective-date filter in memory
    var today = new Date();
    var inDate = rows.filter(function (r) {
      var from = r.effective_from ? new Date(r.effective_from) : null;
      var to   = r.effective_to   ? new Date(r.effective_to)   : null;
      var afterStart = !from || from <= today;
      var beforeEnd  = !to   || to   >= today;
      return afterStart && beforeEnd;
    });

    if (inDate.length === 0) return null;
    if (inDate.length > 1) {
      throw SopError_('MULTIPLE_ACTIVE_TEMPLATES', 'More than one active SOP template found', {
        clientCode: clientCode, jobType: jobType, software: software, scopeCode: scopeCode
      });
    }
    return inDate[0];
  }

  // ──────────────────────────────────────────────────────────
  // getSopItems
  // Returns all active items for a template, sorted by item_seq.
  // active_flag is post-filtered in memory (Sheets may store
  // booleans as TRUE/FALSE strings — loose equality is not
  // reliable for boolean column filtering in readWhere).
  // ──────────────────────────────────────────────────────────
  function getSopItems(sopTemplateId) {
    var rows;
    try {
      rows = DAL.readWhere(
        Config.TABLES.DIM_SOP_ITEMS,
        { sop_template_id: sopTemplateId },
        { callerModule: MODULE }
      );
    } catch (e) {
      Logger.error('SOP_DAL_READ_FAILED', { module: MODULE, table: Config.TABLES.DIM_SOP_ITEMS, error: e.message });
      throw e;
    }

    if (!rows || rows.length === 0) return [];

    // Post-filter active_flag in memory
    var active = rows.filter(function (r) {
      var f = String(r.active_flag).toUpperCase();
      return f === 'TRUE' || f === '1';
    });

    // Sort by item_seq ascending
    active.sort(function (a, b) {
      return Number(a.item_seq) - Number(b.item_seq);
    });

    return active;
  }

  // ──────────────────────────────────────────────────────────
  // getCurrentStatus
  // Returns all FACT_SOP_CURRENT_STATUS rows for a job.
  // One row per (job_id, sop_item_id) — the projection of
  // the latest check state for each checklist item.
  // ──────────────────────────────────────────────────────────
  function getCurrentStatus(jobId) {
    try {
      return DAL.readWhere(
        Config.TABLES.FACT_SOP_CURRENT_STATUS,
        { job_id: jobId },
        { callerModule: MODULE }
      ) || [];
    } catch (e) {
      Logger.error('SOP_DAL_READ_FAILED', { module: MODULE, table: Config.TABLES.FACT_SOP_CURRENT_STATUS, error: e.message });
      throw e;
    }
  }

  // ──────────────────────────────────────────────────────────
  // appendAuditRow
  // Appends one event row to the partitioned FACT_SOP_AUDITS.
  // FACT_SOP_AUDITS is append-only (Rule A5).
  // ──────────────────────────────────────────────────────────
  function appendAuditRow(auditRow) {
    try {
      DAL.appendRow(Config.TABLES.FACT_SOP_AUDITS, auditRow, { callerModule: 'SopChecklistHandler' });
    } catch (e) {
      Logger.error('SOP_DAL_APPEND_FAILED', { module: MODULE, table: Config.TABLES.FACT_SOP_AUDITS, error: e.message });
      throw e;
    }
  }

  // ──────────────────────────────────────────────────────────
  // upsertCurrentStatus
  // FACT_SOP_CURRENT_STATUS holds at most one row per
  // (job_id, sop_item_id). If a row exists, overwrite it via
  // updateWhere. If none exists, appendRow.
  //
  // No LockService here — race protection is provided by
  // audit-level idempotency in SopAuditEngine. LockService
  // is reserved for the QCHandler gate in PR 5.
  // ──────────────────────────────────────────────────────────
  function upsertCurrentStatus(statusRow) {
    var existing;
    try {
      existing = DAL.readWhere(
        Config.TABLES.FACT_SOP_CURRENT_STATUS,
        { job_id: statusRow.job_id, sop_item_id: statusRow.sop_item_id },
        { callerModule: MODULE }
      );
    } catch (e) {
      Logger.error('SOP_DAL_READ_FAILED', { module: MODULE, table: Config.TABLES.FACT_SOP_CURRENT_STATUS, error: e.message });
      throw e;
    }

    try {
      if (existing && existing.length > 0) {
        DAL.updateWhere(
          Config.TABLES.FACT_SOP_CURRENT_STATUS,
          { job_id: statusRow.job_id, sop_item_id: statusRow.sop_item_id },
          statusRow,
          { callerModule: 'SopChecklistHandler' }
        );
      } else {
        DAL.appendRow(Config.TABLES.FACT_SOP_CURRENT_STATUS, statusRow, { callerModule: 'SopChecklistHandler' });
      }
    } catch (e) {
      Logger.error('SOP_DAL_UPSERT_FAILED', { module: MODULE, table: Config.TABLES.FACT_SOP_CURRENT_STATUS, error: e.message });
      throw e;
    }
  }

  // ──────────────────────────────────────────────────────────
  // saveTemplate
  // Appends a new row to DIM_SOP_TEMPLATES (admin use only).
  // ──────────────────────────────────────────────────────────
  function saveTemplate(templateRow) {
    try {
      DAL.appendRow(Config.TABLES.DIM_SOP_TEMPLATES, templateRow, { callerModule: 'SopAdminEngine' });
    } catch (e) {
      Logger.error('SOP_DAL_APPEND_FAILED', { module: MODULE, table: Config.TABLES.DIM_SOP_TEMPLATES, error: e.message });
      throw e;
    }
  }

  // ──────────────────────────────────────────────────────────
  // saveItem
  // Appends a new row to DIM_SOP_ITEMS (admin use only).
  // ──────────────────────────────────────────────────────────
  function saveItem(itemRow) {
    try {
      DAL.appendRow(Config.TABLES.DIM_SOP_ITEMS, itemRow, { callerModule: 'SopAdminEngine' });
    } catch (e) {
      Logger.error('SOP_DAL_APPEND_FAILED', { module: MODULE, table: Config.TABLES.DIM_SOP_ITEMS, error: e.message });
      throw e;
    }
  }

  return {
    getActiveTemplate:   getActiveTemplate,
    getSopItems:         getSopItems,
    getCurrentStatus:    getCurrentStatus,
    appendAuditRow:      appendAuditRow,
    upsertCurrentStatus: upsertCurrentStatus,
    saveTemplate:        saveTemplate,
    saveItem:            saveItem
  };

}());
