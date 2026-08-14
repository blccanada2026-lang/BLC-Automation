// ============================================================
// SopUploadEngine.gs — BLC Nexus T13 SOP Upload Workflow
// src/13-sop/SopUploadEngine.gs
//
// Owns DIM_SOP_UPLOADS (upload lifecycle) and
// FACT_SOP_REVIEW_FEEDBACK (manager review comments). Does NOT
// touch DIM_SOP_TEMPLATES/DIM_SOP_ITEMS directly — template
// creation and publishing goes through the existing
// SopAdminEngine, called from a Claude session, not from here.
//
// LOAD ORDER: T13, after SopDAL.gs.
// DEPENDENCIES: Config (T0), RBAC (T2), Logger (T3), DAL (T1)
// ============================================================

var SopUploadEngine = (function () {

  var MODULE = 'SopUploadEngine';

  function SopUploadError_(code, message, details) {
    var e = new Error(message);
    e.name = 'SopUploadError';
    e.code = code;
    e.details = details || {};
    return e;
  }

  // ──────────────────────────────────────────────────────────
  // createUpload
  // Validates, stores the file in Drive, writes a PENDING
  // DIM_SOP_UPLOADS row, and emails the CEO.
  //
  // params: { clientCode, productCode, docType, fileBlob, fileName }
  // Returns: { uploadId, driveFileUrl }
  // ──────────────────────────────────────────────────────────
  function createUpload(actorEmail, params) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.SOP_UPLOAD);

    params = params || {};
    if (!params.clientCode || !params.productCode || !params.docType || !params.fileBlob) {
      throw SopUploadError_('SOP_UPLOAD_MISSING_FIELDS',
        'clientCode, productCode, docType, and fileBlob are all required', params);
    }
    if (params.docType !== 'DESIGNER_SOP' && params.docType !== 'QC_REVIEW_SOP') {
      throw SopUploadError_('SOP_UPLOAD_INVALID_DOC_TYPE',
        'doc_type must be DESIGNER_SOP or QC_REVIEW_SOP', { docType: params.docType });
    }
    var validProducts = [Config.PRODUCT_CODES.TRUSS, Config.PRODUCT_CODES.OPEN_WOOD_FLOOR, Config.PRODUCT_CODES.I_JOIST_FLOOR];
    if (validProducts.indexOf(params.productCode) === -1) {
      throw SopUploadError_('SOP_UPLOAD_INVALID_PRODUCT',
        'product_code must be one of: ' + validProducts.join(', '), { productCode: params.productCode });
    }

    var clientRows = DAL.readWhere(Config.TABLES.DIM_CLIENT_MASTER,
      { client_code: params.clientCode }, { callerModule: MODULE });
    var activeClient = clientRows.filter(function (r) {
      return String(r.active).toUpperCase() === 'TRUE';
    })[0];
    if (!activeClient) {
      throw SopUploadError_('SOP_UPLOAD_UNKNOWN_CLIENT',
        'client_code "' + params.clientCode + '" is not an active client', { clientCode: params.clientCode });
    }

    var folder = getOrCreateUploadFolder_();
    var driveFile = folder.createFile(params.fileBlob.setName(params.fileName || 'sop-upload'));
    var uploadId = Identifiers.generatePrefixedId(Config.ID_PREFIXES.SOP_UPLOAD);
    var now = new Date().toISOString();

    DAL.appendRow(Config.TABLES.DIM_SOP_UPLOADS, {
      upload_id:              uploadId,
      client_code:            params.clientCode,
      product_code:           params.productCode,
      doc_type:               params.docType,
      drive_file_id:          driveFile.getId(),
      drive_file_url:         driveFile.getUrl(),
      uploaded_by:            actorEmail,
      uploaded_at:            now,
      status:                 'PENDING',
      resulting_template_id:  '',
      notes:                  ''
    }, { callerModule: MODULE });

    Logger.info('SOP_UPLOAD_CREATED', {
      module: MODULE, uploadId: uploadId, clientCode: params.clientCode,
      productCode: params.productCode, docType: params.docType
    });

    notifyCeoOfUpload_(uploadId, params.clientCode, params.productCode, params.docType, driveFile.getUrl());

    return { uploadId: uploadId, driveFileUrl: driveFile.getUrl() };
  }

  function getOrCreateUploadFolder_() {
    var FOLDER_NAME = 'BLC Nexus — SOP Uploads';
    var existing = DriveApp.getFoldersByName(FOLDER_NAME);
    if (existing.hasNext()) return existing.next();
    return DriveApp.createFolder(FOLDER_NAME);
  }

  function notifyCeoOfUpload_(uploadId, clientCode, productCode, docType, driveFileUrl) {
    var recipient = PropertiesService.getScriptProperties().getProperty('HM_ALERT_RECIPIENT');
    if (!recipient) {
      Logger.warn('SOP_UPLOAD_NOTIFY_SKIPPED', { module: MODULE, reason: 'HM_ALERT_RECIPIENT not set', uploadId: uploadId });
      return;
    }
    try {
      MailApp.sendEmail({
        to: recipient,
        subject: 'New SOP document uploaded — needs processing (' + clientCode + ' / ' + productCode + ')',
        body: 'A new ' + docType + ' document was uploaded for client ' + clientCode +
              ', product ' + productCode + '.\n\n' +
              'Upload ID: ' + uploadId + '\n' +
              'Document: ' + driveFileUrl + '\n\n' +
              'Start a Claude Code session and ask it to process this pending SOP upload.'
      });
    } catch (e) {
      Logger.error('SOP_UPLOAD_NOTIFY_FAILED', { module: MODULE, uploadId: uploadId, error: e.message });
    }
  }

  // ──────────────────────────────────────────────────────────
  // Manager-review token — HMAC-SHA256(uploadId, SOP_REVIEW_LINK_SECRET).
  // Same pattern as PortalData.gs's ratingToken_/requireValidRatingToken_
  // (RATING_LINK_SECRET) — a dedicated secret per CLAUDE.md R9, never
  // PORTAL_LINK_SECRET (global rotation = staff lockout event).
  // ──────────────────────────────────────────────────────────
  function tokenForUpload(uploadId) {
    var secret = PropertiesService.getScriptProperties().getProperty('SOP_REVIEW_LINK_SECRET');
    if (!secret) {
      throw new Error('SOP_REVIEW_LINK_SECRET not set. Run runGenerateSopReviewSecret() once from the Apps Script editor.');
    }
    var bytes = Utilities.computeHmacSha256Signature(String(uploadId), secret);
    return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
  }

  function requireValidReviewToken_(uploadId, token) {
    if (!token) {
      throw SopUploadError_('SOP_REVIEW_TOKEN_MISSING', 'Review link token missing.', { uploadId: uploadId });
    }
    if (String(token) !== tokenForUpload(uploadId)) {
      throw SopUploadError_('SOP_REVIEW_TOKEN_INVALID', 'Invalid review link token for upload ' + uploadId + '.', { uploadId: uploadId });
    }
  }

  function getUploadRow_(uploadId) {
    var rows = DAL.readWhere(Config.TABLES.DIM_SOP_UPLOADS, { upload_id: uploadId }, { callerModule: MODULE });
    if (!rows || rows.length === 0) {
      throw SopUploadError_('SOP_UPLOAD_NOT_FOUND', 'Upload not found: ' + uploadId, { uploadId: uploadId });
    }
    return rows[0];
  }

  // ──────────────────────────────────────────────────────────
  // getUploadForReview — token-gated, no actor resolution, no
  // RBAC. Matches the quarterly-ratings external-reviewer model:
  // the token itself is the credential.
  // ──────────────────────────────────────────────────────────
  function getUploadForReview(uploadId, token) {
    requireValidReviewToken_(uploadId, token);
    var row = getUploadRow_(uploadId);
    return {
      uploadId:     row.upload_id,
      clientCode:   row.client_code,
      productCode:  row.product_code,
      docType:      row.doc_type,
      driveFileUrl: row.drive_file_url,
      status:       row.status
    };
  }

  // ──────────────────────────────────────────────────────────
  // submitReviewFeedback — token-gated. Refuses once the upload
  // has moved past DRAFT_READY (link "dies" after publish).
  // ──────────────────────────────────────────────────────────
  function submitReviewFeedback(uploadId, token, reviewerName, verdict, comment) {
    requireValidReviewToken_(uploadId, token);
    var row = getUploadRow_(uploadId);
    if (row.status !== 'DRAFT_READY') {
      throw SopUploadError_('SOP_REVIEW_NOT_OPEN',
        'This SOP is no longer open for review (status: ' + row.status + ').', { uploadId: uploadId, status: row.status });
    }
    if (!reviewerName || (verdict !== 'LOOKS_CORRECT' && verdict !== 'HAS_ISSUES')) {
      throw SopUploadError_('SOP_REVIEW_INVALID_FEEDBACK',
        'reviewerName is required and verdict must be LOOKS_CORRECT or HAS_ISSUES.', { reviewerName: reviewerName, verdict: verdict });
    }

    DAL.appendRow(Config.TABLES.FACT_SOP_REVIEW_FEEDBACK, {
      feedback_id:    Identifiers.generatePrefixedId(Config.ID_PREFIXES.SOP_FEEDBACK),
      upload_id:      uploadId,
      reviewer_name:  reviewerName,
      verdict:        verdict,
      comment:        comment || '',
      submitted_at:   new Date().toISOString()
    }, { callerModule: MODULE });

    Logger.info('SOP_REVIEW_FEEDBACK_SUBMITTED', { module: MODULE, uploadId: uploadId, verdict: verdict });
    return { ok: true };
  }

  // ──────────────────────────────────────────────────────────
  // markDraftReady — called by a Claude session (via the Apps
  // Script editor) once it has structured an upload's source
  // document into a DRAFT template via SopAdminEngine. Not
  // portal-exposed — this is a manual, editor-run step.
  // ──────────────────────────────────────────────────────────
  function markDraftReady(uploadId, resultingTemplateId, notes) {
    if (!resultingTemplateId) {
      throw SopUploadError_('SOP_UPLOAD_MISSING_TEMPLATE_ID', 'resultingTemplateId is required.', { uploadId: uploadId });
    }
    getUploadRow_(uploadId);
    DAL.updateWhere(Config.TABLES.DIM_SOP_UPLOADS,
      { upload_id: uploadId },
      { status: 'DRAFT_READY', resulting_template_id: resultingTemplateId, notes: notes || '' },
      { callerModule: MODULE });
    Logger.info('SOP_UPLOAD_DRAFT_READY', { module: MODULE, uploadId: uploadId, resultingTemplateId: resultingTemplateId });
    return { uploadId: uploadId, status: 'DRAFT_READY' };
  }

  // ──────────────────────────────────────────────────────────
  // listPendingUploads — CEO publish screen. Everything not yet
  // PUBLISHED or REJECTED, each with its feedback and review link.
  // ──────────────────────────────────────────────────────────
  function listPendingUploads(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.SOP_UPLOAD);

    var allUploads = DAL.readWhere(Config.TABLES.DIM_SOP_UPLOADS, {}, { callerModule: MODULE });
    var pending = allUploads.filter(function (r) {
      return r.status !== 'PUBLISHED' && r.status !== 'REJECTED';
    });

    var allFeedback = DAL.readWhere(Config.TABLES.FACT_SOP_REVIEW_FEEDBACK, {}, { callerModule: MODULE });

    return pending.map(function (row) {
      var feedback = allFeedback.filter(function (f) { return f.upload_id === row.upload_id; });
      var reviewLink = '';
      if (row.status === 'DRAFT_READY') {
        try {
          reviewLink = buildReviewLink_(row.upload_id);
        } catch (e) {
          Logger.warn('SOP_REVIEW_LINK_BUILD_FAILED', { module: MODULE, uploadId: row.upload_id, error: e.message });
          reviewLink = '';
        }
      }
      return {
        uploadId:             row.upload_id,
        clientCode:           row.client_code,
        productCode:          row.product_code,
        docType:              row.doc_type,
        driveFileUrl:         row.drive_file_url,
        status:               row.status,
        resultingTemplateId:  row.resulting_template_id,
        notes:                row.notes,
        reviewLink:           reviewLink,
        feedback:             feedback.map(function (f) {
          return { reviewerName: f.reviewer_name, verdict: f.verdict, comment: f.comment, submittedAt: f.submitted_at };
        })
      };
    });
  }

  function buildReviewLink_(uploadId) {
    var base = PropertiesService.getScriptProperties().getProperty('PORTAL_BASE_URL') || '';
    if (!base) return '';
    var sep = base.indexOf('?') === -1 ? '?' : '&';
    return base + sep + 'page=review-sop&uploadId=' + encodeURIComponent(uploadId) +
      '&token=' + encodeURIComponent(tokenForUpload(uploadId));
  }

  // ──────────────────────────────────────────────────────────
  // publishUpload — publishes the linked DIM_SOP_TEMPLATES draft
  // via the existing, unmodified SopAdminEngine.publishTemplate,
  // then marks the upload PUBLISHED.
  // ──────────────────────────────────────────────────────────
  function publishUpload(actorEmail, uploadId) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.SOP_UPLOAD);

    var row = getUploadRow_(uploadId);
    if (row.status === 'PUBLISHED') {
      throw SopUploadError_('SOP_UPLOAD_ALREADY_PUBLISHED', 'This upload has already been published.', { uploadId: uploadId });
    }
    if (!row.resulting_template_id) {
      throw SopUploadError_('SOP_UPLOAD_NOT_STRUCTURED', 'This upload has not been structured into a template yet.', { uploadId: uploadId });
    }

    SopAdminEngine.publishTemplate(actorEmail, row.resulting_template_id);

    DAL.updateWhere(Config.TABLES.DIM_SOP_UPLOADS,
      { upload_id: uploadId }, { status: 'PUBLISHED' }, { callerModule: MODULE });

    Logger.info('SOP_UPLOAD_PUBLISHED', { module: MODULE, uploadId: uploadId, templateId: row.resulting_template_id });
    return { uploadId: uploadId, status: 'PUBLISHED' };
  }

  return {
    createUpload:          createUpload,
    tokenForUpload:        tokenForUpload,
    getUploadForReview:    getUploadForReview,
    submitReviewFeedback:  submitReviewFeedback,
    markDraftReady:        markDraftReady,
    listPendingUploads:    listPendingUploads,
    publishUpload:         publishUpload
  };

})();
