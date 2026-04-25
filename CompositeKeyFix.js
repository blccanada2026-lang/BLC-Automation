// CompositeKeyFix.gs
// Revision-aware composite key matching — updated March 9, 2026
// Fixes: QC submissions landing on wrong row when job has revision suffix (-B, -C etc.)

var ACTIVE_STATUSES = [
  'Picked Up',
  'In Design',
  'Submitted For QC',
  'QC In Progress',
  'Rework - Major',
  'Rework - Minor',
  'Waiting Re-QC',
  'Waiting Spot Check',
  'Spot Check In Progress',
  'On Hold',
  'Revision',
  'Allocated'
];

var TERMINAL_STATUSES = [
  'Completed - Billable',
  'Billed'
];

/**
 * findJobRowByKey()
 * 8-level priority matching — revised March 12, 2026.
 * Fixes parallel component cross-write bug where two designers
 * working different product types on the same job number would
 * have hours written to the wrong row.
 *
 * Priority:
 *   0a — active + exact designer + exact product (best possible match)
 *   0b — active + exact designer only
 *   0c — active + exact product only
 *   0d — active, non-imported (any — last resort for active rows)
 *   1  — exact designer + product, non-imported (terminal ok)
 *   2  — exact designer, non-imported (terminal ok)
 *   3  — exact product, non-imported (terminal ok)
 *   4  — non-imported, non-terminal
 *   5  — any row including imported (absolute last resort)
 */
function findJobRowByKey(jobNumber, productType, designerName) {
  if (!jobNumber) return -1;

  var masterSheet = getSheet(CONFIG.sheets.masterJobDatabase);
  var data        = masterSheet.getDataRange().getValues();
  var MJ          = CONFIG.masterCols;

  var colJob      = MJ.jobNumber   - 1;
  var colDesigner = MJ.designerName - 1;
  var colProduct  = MJ.productType  - 1;
  var colStatus   = MJ.status       - 1;
  var colImported = MJ.isImported   - 1;

  var normDesigner = designerName ? normaliseDesignerName(designerName) : null;
  var normProduct  = productType  ? productType.trim()                  : null;
  var normJob      = jobNumber    ? jobNumber.trim()                    : null;

  // Priority buckets — all collect 1-based row indices
  var p0a = []; // active + exact designer + exact product ← KEY FIX
  var p0b = []; // active + exact designer
  var p0c = []; // active + exact product
  var p0d = []; // active, non-imported (any)
  var p0i = []; // active, imported (fallback)
  var p1  = []; // exact designer + product, non-imported
  var p2  = []; // exact designer, non-imported
  var p3  = []; // exact product, non-imported
  var p4  = []; // non-imported, non-terminal
  var p5  = []; // all rows including imported

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rowJob      = row[colJob]      ? String(row[colJob]).trim()      : '';
    var rowDesigner = row[colDesigner] ? String(row[colDesigner]).trim() : '';
    var rowProduct  = row[colProduct]  ? String(row[colProduct]).trim()  : '';
    var rowStatus   = row[colStatus]   ? String(row[colStatus]).trim()   : '';
    var rowImported = row[colImported] ? String(row[colImported]).trim() : '';

    if (rowJob.toUpperCase() !== normJob.toUpperCase()) continue;

    var isImported = (rowImported.toLowerCase() === 'yes');
    var isActive   = (ACTIVE_STATUSES.indexOf(rowStatus)   !== -1);
    var isTerminal = (TERMINAL_STATUSES.indexOf(rowStatus) !== -1);

    var matchDesigner = normDesigner
      ? (normaliseDesignerName(rowDesigner) === normDesigner)
      : true;

    // Product match — if rowProduct is blank, treat as wildcard
    // This handles old rows created before product type was mandatory
    var matchProduct = normProduct
      ? (rowProduct === normProduct || rowProduct === '')
      : true;

    // Exact product match — blank row product does NOT count as exact
    var exactProduct = normProduct
      ? (rowProduct === normProduct)
      : true;

    var sheetRow = i + 1; // 1-based

    // ── ACTIVE ROW BUCKETS ────────────────────────────────────
    if (isActive) {
      if (!isImported) {
        if (matchDesigner && exactProduct) p0a.push(sheetRow); // best
        else if (matchDesigner)            p0b.push(sheetRow);
        else if (exactProduct)             p0c.push(sheetRow);
        else                               p0d.push(sheetRow);
      } else {
        p0i.push(sheetRow);
      }
    }

    // ── NON-ACTIVE BUCKETS ────────────────────────────────────
    if (matchDesigner && matchProduct && !isImported) p1.push(sheetRow);
    if (matchDesigner && !isImported)                 p2.push(sheetRow);
    if (matchProduct  && !isImported)                 p3.push(sheetRow);
    if (!isImported && !isTerminal)                   p4.push(sheetRow);
    p5.push(sheetRow);
  }

  // Return best match — prefer most recent row within each bucket
  if (p0a.length > 0) return p0a[p0a.length - 1];
  if (p0b.length > 0) return p0b[p0b.length - 1];
  if (p0c.length > 0) return p0c[p0c.length - 1];
  if (p0d.length > 0) return p0d[p0d.length - 1];
  if (p1.length  > 0) return p1[p1.length   - 1];
  if (p2.length  > 0) return p2[p2.length   - 1];
  if (p3.length  > 0) return p3[p3.length   - 1];
  if (p4.length  > 0) return p4[p4.length   - 1];
  if (p0i.length > 0) return p0i[p0i.length - 1];
  if (p5.length  > 0) return p5[p5.length   - 1];

  return -1;
}