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

  return { importFromSheet: importFromSheet };

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
