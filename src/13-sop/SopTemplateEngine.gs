// ============================================================
// SopTemplateEngine.gs — BLC Nexus T13 SOP Checklist Gate
// src/13-sop/SopTemplateEngine.gs
//
// Template resolution and hash computation.
// Depends on: SopDAL (same module, loaded earlier in GAS)
// ============================================================

var SopTemplateEngine = (function () {

  var MODULE = 'SopTemplateEngine';

  // ──────────────────────────────────────────────────────────
  // computeTemplateHash
  // SHA-256 over the canonical JSON representation of all
  // active SOP items. All 9 substantive fields are included
  // so that any wording or requirement change produces a new
  // hash and forces a new template version.
  //
  // Items must be sorted by item_seq before hashing so that
  // reordering without content change still triggers a new
  // hash (item_seq itself is in the hash payload).
  //
  // Fields included (by explicit spec):
  //   sop_item_id, item_seq, item_code, item_label,
  //   item_description, is_required, requires_comment,
  //   requires_attachment, active_flag
  // ──────────────────────────────────────────────────────────
  function computeTemplateHash(items) {
    var sorted = items.slice().sort(function (a, b) {
      return Number(a.item_seq) - Number(b.item_seq);
    });

    var canonical = sorted.map(function (item) {
      return {
        sop_item_id:         String(item.sop_item_id         || ''),
        item_seq:            String(item.item_seq             || ''),
        item_code:           String(item.item_code            || ''),
        item_label:          String(item.item_label           || ''),
        item_description:    String(item.item_description     || ''),
        is_required:         String(item.is_required          || ''),
        requires_comment:    String(item.requires_comment     || ''),
        requires_attachment: String(item.requires_attachment  || ''),
        active_flag:         String(item.active_flag          || '')
      };
    });

    var json  = JSON.stringify(canonical);
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, json);
    return bytes.map(function (b) {
      return ('0' + (b & 0xFF).toString(16)).slice(-2);
    }).join('');
  }

  // ──────────────────────────────────────────────────────────
  // resolveTemplate
  // Looks up the ACTIVE SOP template for the given dimensions,
  // loads its items, recomputes the hash, and returns a
  // resolved context object.
  //
  // Throws:
  //   SopError_('NO_SOP_TEMPLATE')      — no active template found
  //   SopError_('SOP_TEMPLATE_NO_ITEMS')— template has no active items
  //   SopError_('SOP_HASH_MISMATCH')    — stored hash doesn't match
  //                                        computed (data integrity)
  //
  // Returns:
  //   {
  //     template:     <DIM_SOP_TEMPLATES row>,
  //     items:        <DIM_SOP_ITEMS[]>,
  //     computedHash: <hex string>
  //   }
  // ──────────────────────────────────────────────────────────
  function resolveTemplate(clientCode, jobType, software, scopeCode) {
    var template = SopDAL.getActiveTemplate(clientCode, jobType, software, scopeCode);

    if (!template) {
      throw SopError_('NO_SOP_TEMPLATE', 'No active SOP template found for this job', {
        clientCode: clientCode, jobType: jobType, software: software, scopeCode: scopeCode
      });
    }

    var items = SopDAL.getSopItems(template.sop_template_id);

    if (!items || items.length === 0) {
      throw SopError_('SOP_TEMPLATE_NO_ITEMS', 'Active SOP template has no active items', {
        sopTemplateId: template.sop_template_id
      });
    }

    var computedHash = computeTemplateHash(items);

    if (template.template_hash && template.template_hash !== computedHash) {
      Logger.warn('SOP_HASH_MISMATCH', {
        module:        MODULE,
        sopTemplateId: template.sop_template_id,
        stored:        template.template_hash,
        computed:      computedHash
      });
      throw SopError_('SOP_HASH_MISMATCH', 'SOP template hash does not match stored items — template may have been modified out of band', {
        sopTemplateId: template.sop_template_id,
        stored:        template.template_hash,
        computed:      computedHash
      });
    }

    return {
      template:     template,
      items:        items,
      computedHash: computedHash
    };
  }

  return {
    resolveTemplate:     resolveTemplate,
    computeTemplateHash: computeTemplateHash
  };

}());
