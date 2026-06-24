// ============================================================
// SopImporter.gs — BLC Nexus T13 SOP Checklist Gate
// src/13-sop/SopImporter.gs
//
// One-time migration tool: imports SOP template definitions
// from a flat staging sheet (MIGRATION_SOP_IMPORT) into
// DIM_SOP_TEMPLATES and DIM_SOP_ITEMS, then publishes each.
//
// This is a migration/admin utility — NOT an ongoing input
// path. Google Forms remain permanently banned for Nexus input
// (Rule R1). The staging sheet is a one-time migration artifact.
//
// Staging sheet expected columns (one row per SOP item):
//   client_code, job_type, software, scope_code,
//   item_seq, item_code, item_label, item_description,
//   is_required, requires_comment, requires_attachment
//
// Run from Apps Script editor: runSopImportDryRun() first,
// then runSopImportExecute() after reviewing dry-run output.
// ============================================================

var SopImporter = (function () {

  var MODULE           = 'SopImporter';
  var DEFAULT_SHEET    = 'MIGRATION_SOP_IMPORT';

  // ──────────────────────────────────────────────────────────
  // importFromSheet
  // Reads the staging sheet, groups rows by dimensions, and
  // for each group: createTemplate → addItem × N → publishTemplate.
  //
  // Idempotency: skips any dimension set that already has an
  // ACTIVE template. Re-running is safe.
  //
  // Returns:
  //   { created: number, skipped: number, errors: Object[] }
  // ──────────────────────────────────────────────────────────
  function importFromSheet(actorEmail, sheetName, dryRun) {
    var actor = RBAC.resolveActor(actorEmail);
    if (!RBAC.hasPermission(actor, RBAC.ACTIONS.SOP_ADMIN)) {
      throw SopError_('SOP_RBAC_DENIED', 'SOP_ADMIN permission required for import', {
        actorCode: actor && actor.person_code,
        actorRole: actor && actor.role
      });
    }

    var targetSheet = sheetName || DEFAULT_SHEET;
    var rows;
    try {
      rows = DAL.readAll(targetSheet, { callerModule: MODULE });
    } catch (e) {
      throw SopError_('SOP_IMPORT_SHEET_NOT_FOUND', 'Could not read staging sheet: ' + targetSheet, {
        sheetName: targetSheet, error: e.message
      });
    }

    if (!rows || rows.length === 0) {
      Logger.info('SOP_IMPORT_EMPTY', { module: MODULE, sheet: targetSheet });
      return { created: 0, skipped: 0, errors: [] };
    }

    // Group rows by dimension key
    var groups = {};
    rows.forEach(function (row) {
      var key = [row.client_code, row.job_type, row.software, row.scope_code].join('|');
      if (!groups[key]) {
        groups[key] = {
          client_code: row.client_code,
          job_type:    row.job_type,
          software:    row.software,
          scope_code:  row.scope_code,
          items:       []
        };
      }
      groups[key].items.push(row);
    });

    var created = 0;
    var skipped = 0;
    var errors  = [];

    Object.keys(groups).forEach(function (key) {
      var group = groups[key];
      try {
        // Idempotency: skip if an ACTIVE template already exists
        var existing = SopDAL.getActiveTemplate(
          group.client_code, group.job_type, group.software, group.scope_code
        );
        if (existing) {
          Logger.info('SOP_IMPORT_SKIP', { module: MODULE, key: key, existingId: existing.sop_template_id });
          if (dryRun) console.log('DRY RUN SKIP  — already ACTIVE: ' + key);
          skipped++;
          return;
        }

        if (dryRun) {
          console.log('DRY RUN CREATE — ' + key + ' (' + group.items.length + ' items)');
          group.items.forEach(function (item) {
            console.log('  item_seq=' + item.item_seq + ' code=' + item.item_code + ' required=' + item.is_required);
          });
          created++;
          return;
        }

        // Create DRAFT
        var result = SopAdminEngine.createTemplate(actorEmail, {
          clientCode: group.client_code,
          jobType:    group.job_type,
          software:   group.software,
          scopeCode:  group.scope_code
        });
        var sopTemplateId = result.sopTemplateId;

        // Add items (sorted by item_seq from the sheet)
        var sortedItems = group.items.slice().sort(function (a, b) {
          return Number(a.item_seq) - Number(b.item_seq);
        });
        sortedItems.forEach(function (item) {
          SopAdminEngine.addItem(actorEmail, sopTemplateId, {
            item_seq:            item.item_seq,
            item_code:           item.item_code,
            item_label:          item.item_label,
            item_description:    item.item_description    || '',
            is_required:         item.is_required,
            requires_comment:    item.requires_comment,
            requires_attachment: item.requires_attachment
          });
        });

        // Publish — computes hash and sets ACTIVE
        SopAdminEngine.publishTemplate(actorEmail, sopTemplateId);

        Logger.info('SOP_IMPORT_CREATED', {
          module:        MODULE,
          sopTemplateId: sopTemplateId,
          key:           key,
          items:         sortedItems.length
        });
        created++;

      } catch (e) {
        Logger.error('SOP_IMPORT_ERROR', { module: MODULE, key: key, error: e.message, code: e.code });
        errors.push({ key: key, error: e.message, code: e.code || null });
      }
    });

    Logger.info('SOP_IMPORT_COMPLETE', { module: MODULE, created: created, skipped: skipped, errors: errors.length });
    return { created: created, skipped: skipped, errors: errors };
  }

  // ──────────────────────────────────────────────────────────
  // Private helpers — FormApp import
  // ──────────────────────────────────────────────────────────

  // Structural form item types that carry no checklist content.
  var FORM_SKIP_TYPES_ = [
    FormApp.ItemType.SECTION_HEADER,
    FormApp.ItemType.PAGE_BREAK,
    FormApp.ItemType.IMAGE,
    FormApp.ItemType.VIDEO
  ];

  var COMMENT_KEYWORDS_ = [
    'comment', 'remark', 'exception', 'note', 'explain', 'reason', 'justif'
  ];

  // Parse a Google Form URL or bare ID into just the ID.
  function extractFormId_(urlOrId) {
    var s = String(urlOrId || '').trim();
    var m = s.match(/\/forms\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : s;
  }

  // Convert a question title to a stable, lowercase, hyphen-delimited code.
  function slugify_(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }

  // isRequired() is not on FormItem base — must cast by type.
  // Defaults to true if the type doesn't support isRequired().
  function getItemRequired_(item, type) {
    try {
      switch (type) {
        case FormApp.ItemType.CHECKBOX:        return item.asCheckboxItem().isRequired();
        case FormApp.ItemType.MULTIPLE_CHOICE: return item.asMultipleChoiceItem().isRequired();
        case FormApp.ItemType.TEXT:            return item.asTextItem().isRequired();
        case FormApp.ItemType.PARAGRAPH_TEXT:  return item.asParagraphTextItem().isRequired();
        case FormApp.ItemType.LIST:            return item.asListItem().isRequired();
        case FormApp.ItemType.SCALE:           return item.asScaleItem().isRequired();
        case FormApp.ItemType.DATE:            return item.asDateItem().isRequired();
        case FormApp.ItemType.TIME:            return item.asTimeItem().isRequired();
        case FormApp.ItemType.GRID:            return item.asGridItem().isRequired();
        case FormApp.ItemType.CHECKBOX_GRID:   return item.asCheckboxGridItem().isRequired();
        case FormApp.ItemType.FILE_UPLOAD:     return item.asFileUploadItem().isRequired();
        case FormApp.ItemType.DURATION:        return item.asDurationItem().isRequired();
        default:                               return true;
      }
    } catch (e) {
      return true;  // conservative fallback if cast fails
    }
  }

  function requiresComment_(title) {
    var lower = String(title || '').toLowerCase();
    for (var i = 0; i < COMMENT_KEYWORDS_.length; i++) {
      if (lower.indexOf(COMMENT_KEYWORDS_[i]) !== -1) return true;
    }
    return false;
  }

  // ──────────────────────────────────────────────────────────
  // importSopFromGoogleForm
  // DEV-only migration utility. Reads a Google Form's questions
  // and appends them as rows to MIGRATION_SOP_IMPORT.
  //
  // Does NOT create or publish templates — that is handled by
  // the existing importFromSheet pipeline. This function only
  // populates the staging sheet so the human can review it
  // before template creation.
  //
  // Structural items (SECTION_HEADER, PAGE_BREAK, IMAGE, VIDEO)
  // are silently skipped. All other item types are imported.
  //
  // PREREQUISITE: MIGRATION_SOP_IMPORT must exist in the DEV
  // spreadsheet with this exact header row:
  //   client_code | job_type | software | scope_code | item_seq
  //   | item_code | item_label | item_description | is_required
  //   | requires_comment | requires_attachment
  //
  // Params:
  //   actorEmail   — must have SOP_ADMIN permission
  //   formUrlOrId  — Google Form URL or bare form ID
  //   mappingParams — { client_code, job_type, software, scope_code }
  //   dryRun       — true: print only; false: append rows to sheet
  //
  // Returns: { formTitle, formId, rows }
  // ──────────────────────────────────────────────────────────
  function importSopFromGoogleForm(actorEmail, formUrlOrId, mappingParams, dryRun) {
    if (!Config.isDev()) {
      throw SopError_('SOP_IMPORT_DEV_ONLY',
        'importSopFromGoogleForm is a DEV-only migration utility', {});
    }

    var actor = RBAC.resolveActor(actorEmail);
    if (!RBAC.hasPermission(actor, RBAC.ACTIONS.SOP_ADMIN)) {
      throw SopError_('SOP_RBAC_DENIED', 'SOP_ADMIN permission required for form import', {
        actorCode: actor && actor.person_code
      });
    }

    var required = ['client_code', 'job_type', 'software', 'scope_code'];
    required.forEach(function (k) {
      if (!mappingParams || !String(mappingParams[k] || '').trim()) {
        throw SopError_('SOP_IMPORT_MISSING_PARAM',
          'mappingParams.' + k + ' is required', { param: k });
      }
    });

    var formId = extractFormId_(formUrlOrId);
    var form;
    try {
      form = FormApp.openById(formId);
    } catch (e) {
      throw SopError_('SOP_IMPORT_FORM_NOT_FOUND',
        'Could not open Google Form: ' + formId, { error: e.message });
    }

    var formTitle = form.getTitle();
    var rows      = [];
    var seq       = 1;
    var seenCodes = {};

    form.getItems().forEach(function (item) {
      var type = item.getType();
      if (FORM_SKIP_TYPES_.indexOf(type) !== -1) return;

      var title = String(item.getTitle() || '').trim();
      if (!title) return;

      var helpText = '';
      try { helpText = String(item.getHelpText() || '').trim(); } catch (e) { /* no helpText */ }

      // Generate stable item_code from title; suffix with counter if duplicate
      var slug = slugify_(title);
      var code = slug;
      if (seenCodes[slug]) {
        seenCodes[slug]++;
        code = slug.slice(0, 37) + '-' + seenCodes[slug];
      } else {
        seenCodes[slug] = 1;
      }

      rows.push({
        client_code:         mappingParams.client_code,
        job_type:            mappingParams.job_type,
        software:            mappingParams.software,
        scope_code:          mappingParams.scope_code,
        item_seq:            seq,
        item_code:           code,
        item_label:          title,
        item_description:    helpText,
        is_required:         getItemRequired_(item, type),
        requires_comment:    requiresComment_(title),
        requires_attachment: false
      });
      seq++;
    });

    // ── Dry-run output ───────────────────────────────────────
    if (dryRun) {
      console.log('── DRY RUN ─────────────────────────────────────────');
      console.log('Form:    "' + formTitle + '"');
      console.log('Form ID: ' + formId);
      console.log('Target:  ' + DEFAULT_SHEET);
      console.log('Mapping: ' + mappingParams.client_code + ' / ' + mappingParams.job_type
        + ' / ' + mappingParams.software + ' / ' + mappingParams.scope_code);
      console.log('────────────────────────────────────────────────────');
      if (rows.length === 0) {
        console.log('WARNING: No importable items found (all items are structural types).');
      } else {
        rows.forEach(function (r) {
          console.log('  [' + r.item_seq + '] ' + r.item_code
            + ' | required=' + r.is_required
            + ' | comment=' + r.requires_comment
            + ' | ' + r.item_label);
        });
        console.log('────────────────────────────────────────────────────');
        console.log(rows.length + ' item(s) would be appended to ' + DEFAULT_SHEET + '.');
      }
      Logger.info('SOP_IMPORT_FORM_DRY_RUN', {
        module: MODULE, formId: formId, formTitle: formTitle, rows: rows.length
      });
      return { formTitle: formTitle, formId: formId, rows: rows.length };
    }

    // ── Execute: append rows to staging sheet ────────────────
    if (rows.length === 0) {
      Logger.warn('SOP_IMPORT_FORM_EMPTY', { module: MODULE, formId: formId, formTitle: formTitle });
      console.log('WARNING: No importable items in "' + formTitle + '". Nothing written.');
      return { formTitle: formTitle, formId: formId, rows: 0 };
    }

    try {
      rows.forEach(function (r) {
        DAL.appendRow(DEFAULT_SHEET, r, { callerModule: MODULE });
      });
    } catch (e) {
      throw SopError_('SOP_IMPORT_WRITE_FAILED',
        'Could not write to ' + DEFAULT_SHEET + '. '
        + 'Ensure the tab exists in the DEV spreadsheet with headers: '
        + 'client_code, job_type, software, scope_code, item_seq, item_code, '
        + 'item_label, item_description, is_required, requires_comment, requires_attachment',
        { error: e.message });
    }

    Logger.info('SOP_IMPORT_FORM_STAGED', {
      module: MODULE, formId: formId, formTitle: formTitle,
      rows: rows.length, sheet: DEFAULT_SHEET
    });
    console.log('Staged ' + rows.length + ' row(s) from "' + formTitle + '" → ' + DEFAULT_SHEET + '.');
    return { formTitle: formTitle, formId: formId, rows: rows.length };
  }

  return {
    importFromSheet:         importFromSheet,
    importSopFromGoogleForm: importSopFromGoogleForm
  };

}());

// ============================================================
// TOP-LEVEL RUNNERS — callable from the Apps Script editor
// ============================================================

/** Preview what importFromSheet would create — no data written. */
function runSopImportDryRun() {
  var email  = Session.getActiveUser().getEmail();
  var result = SopImporter.importFromSheet(email, 'MIGRATION_SOP_IMPORT', true);
  console.log('SOP IMPORT DRY RUN — would create: ' + result.created + ', skip: ' + result.skipped);
}

/** Execute the import — creates and publishes templates. Run after dry run review. */
function runSopImportExecute() {
  var email  = Session.getActiveUser().getEmail();
  var result = SopImporter.importFromSheet(email, 'MIGRATION_SOP_IMPORT', false);
  console.log('SOP IMPORT DONE — created: ' + result.created + ', skipped: ' + result.skipped + ', errors: ' + result.errors.length);
  if (result.errors.length > 0) {
    result.errors.forEach(function (e) { console.log('  ERROR [' + e.key + '] ' + e.error); });
  }
}

// ============================================================
// GOOGLE FORM → MIGRATION_SOP_IMPORT RUNNERS — DEV only
//
// Full 5-step migration workflow:
//   Step 1. Edit FORM_IMPORT_CONFIG below with your form details.
//   Step 2. Run runImportSopFromForm()        — dry run, nothing written.
//   Step 3. Review console output. If correct:
//   Step 4. Run runImportSopFromFormExecute() — appends rows to MIGRATION_SOP_IMPORT.
//   Step 5. Review MIGRATION_SOP_IMPORT tab in the DEV spreadsheet.
//   Step 6. Run runSopImportDryRun()          — preview template creation.
//   Step 7. Run runSopImportExecute()         — create + publish ACTIVE templates.
//
// Repeat Steps 1–4 for each Google Form (different client/job_type combos).
// Steps 6–7 run once and process all staged rows together.
//
// PREREQUISITE: Create a tab named MIGRATION_SOP_IMPORT in the DEV
// spreadsheet if it does not already exist, with this exact row 1:
//   client_code  job_type  software  scope_code  item_seq  item_code
//   item_label  item_description  is_required  requires_comment  requires_attachment
// ============================================================

// ── Edit these values before running ────────────────────────
var FORM_IMPORT_CONFIG = {
  formUrlOrId: '',   // Google Form URL or bare Form ID
  client_code: '',   // e.g. 'VW'
  job_type:    '',   // e.g. 'STRUCTURAL'
  software:    '',   // e.g. 'REVIT'
  scope_code:  ''    // e.g. 'FULL'
};
// ────────────────────────────────────────────────────────────

/** Step 2 — Dry run: prints items that would be staged. No data written. */
function runImportSopFromForm() {
  if (!Config.isDev()) { console.log('ERROR: DEV only. Aborted.'); return; }
  var email  = Session.getActiveUser().getEmail();
  SopImporter.importSopFromGoogleForm(
    email,
    FORM_IMPORT_CONFIG.formUrlOrId,
    {
      client_code: FORM_IMPORT_CONFIG.client_code,
      job_type:    FORM_IMPORT_CONFIG.job_type,
      software:    FORM_IMPORT_CONFIG.software,
      scope_code:  FORM_IMPORT_CONFIG.scope_code
    },
    true /* dryRun */
  );
  console.log('If output looks correct → run runImportSopFromFormExecute()');
}

/** Step 4 — Execute: appends rows to MIGRATION_SOP_IMPORT. No templates created yet. */
function runImportSopFromFormExecute() {
  if (!Config.isDev()) { console.log('ERROR: DEV only. Aborted.'); return; }
  var email  = Session.getActiveUser().getEmail();
  var result = SopImporter.importSopFromGoogleForm(
    email,
    FORM_IMPORT_CONFIG.formUrlOrId,
    {
      client_code: FORM_IMPORT_CONFIG.client_code,
      job_type:    FORM_IMPORT_CONFIG.job_type,
      software:    FORM_IMPORT_CONFIG.software,
      scope_code:  FORM_IMPORT_CONFIG.scope_code
    },
    false /* dryRun */
  );
  if (result.rows > 0) {
    console.log('Next: review MIGRATION_SOP_IMPORT tab, then run runSopImportDryRun().');
  }
}
