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

  return {
    createUpload: createUpload
  };

})();
