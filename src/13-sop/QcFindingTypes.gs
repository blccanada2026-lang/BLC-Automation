// ============================================================
// QcFindingTypes.gs — BLC Nexus T13 QMS Layer 3
// src/13-sop/QcFindingTypes.gs
//
// PURPOSE: QC Finding Taxonomy — controlled vocabulary of defect
// categories used in the QC Review Process (Layer 3).
//
// USAGE:
//   QcFindingTypes.getSeedData()   — returns the 17-code seed array
//   QcFindingTypes.seed(email)     — idempotent seed to DIM_QC_FINDING_TYPES
//   QcFindingTypes.CODES           — finding code string constants
//
// SEED IDEMPOTENCY:
//   seed() reads existing finding_codes before writing. Any code
//   already present in DIM_QC_FINDING_TYPES is skipped. Safe to
//   call more than once without creating duplicates.
//
// DEPENDENCIES: Config, DAL, BatchOperations, Logger
// CALLED BY:    SetupScript.runSetupSeedData() (one-time setup)
//               QcFindingTypesTests.testSeedIdempotency (test)
//
// NO RUNTIME WIRING: This module has no trigger-registered
// functions and does not participate in the queue processing
// path. It is reference data only.
// ============================================================

var QcFindingTypes = (function () {

  // ──────────────────────────────────────────────────────────
  // FINDING CODE CONSTANTS
  // Reference these constants instead of raw string literals
  // anywhere finding codes are compared or filtered.
  // ──────────────────────────────────────────────────────────
  var CODES = {
    LOAD_ERROR:                'LOAD_ERROR',
    GEOMETRY_ERROR:            'GEOMETRY_ERROR',
    BEARING_ERROR:             'BEARING_ERROR',
    CONNECTOR_ERROR:           'CONNECTOR_ERROR',
    PLATE_ERROR:               'PLATE_ERROR',
    ENGINEERING_ERROR:         'ENGINEERING_ERROR',
    INPUT_ERROR:               'INPUT_ERROR',
    DRAFTING_ERROR:            'DRAFTING_ERROR',
    OUTPUT_ERROR:              'OUTPUT_ERROR',
    DOCUMENTATION_ERROR:       'DOCUMENTATION_ERROR',
    CLIENT_REQUIREMENT_MISSED: 'CLIENT_REQUIREMENT_MISSED',
    REVISION_MISSED:           'REVISION_MISSED',
    WRONG_DESIGN_STANDARD:     'WRONG_DESIGN_STANDARD',
    CALCULATION_ERROR:         'CALCULATION_ERROR',
    SOFTWARE_WARNING_IGNORED:  'SOFTWARE_WARNING_IGNORED',
    SPECIAL_INSTRUCTION_MISSED:'SPECIAL_INSTRUCTION_MISSED',
    OTHER:                     'OTHER'
  };

  // ──────────────────────────────────────────────────────────
  // SEED DATA
  // 17 finding codes. Column order matches DIM_QC_FINDING_TYPES
  // schema in SetupScript.gs (20 columns).
  //
  // Columns:
  //   finding_code, finding_label, finding_group, category,
  //   severity_default, kpi_weight, is_structural_risk,
  //   product_applicability, requires_comment, common_in_rework,
  //   active_flag, description, display_order, notes,
  //   created_by, created_at, last_updated_at, last_updated_by,
  //   retired_at, benchmark_code
  //
  // is_structural_risk=TRUE codes (exactly 8):
  //   LOAD_ERROR, GEOMETRY_ERROR, BEARING_ERROR, CONNECTOR_ERROR,
  //   PLATE_ERROR, ENGINEERING_ERROR, WRONG_DESIGN_STANDARD,
  //   CALCULATION_ERROR
  //
  // product_applicability≠ALL (exactly 1):
  //   PLATE_ERROR — plate sizing is TRUSS-specific
  // ──────────────────────────────────────────────────────────
  function getSeedData() {
    var now     = new Date().toISOString();
    var creator = 'SYSTEM';

    return [
      // ── STRUCTURAL RISK — 8 codes ────────────────────────
      {
        finding_code:         CODES.LOAD_ERROR,
        finding_label:        'Load Error',
        finding_group:        'STRUCTURAL',
        category:             'Engineering',
        severity_default:     'CRITICAL',
        kpi_weight:           9.0,
        is_structural_risk:   'TRUE',
        product_applicability:'ALL',
        requires_comment:     'N',
        common_in_rework:     'TRUE',
        active_flag:          'TRUE',
        description:          'Incorrect loading applied — snow, wind, dead load, live load, or load combination does not match client specification or design standard.',
        display_order:        10,
        notes:                '',
        created_by:           creator,
        created_at:           now,
        last_updated_at:      now,
        last_updated_by:      creator,
        retired_at:           '',
        benchmark_code:       'ISO9001-8.5.1'
      },
      {
        finding_code:         CODES.GEOMETRY_ERROR,
        finding_label:        'Geometry Error',
        finding_group:        'STRUCTURAL',
        category:             'Design',
        severity_default:     'MAJOR',
        kpi_weight:           7.0,
        is_structural_risk:   'TRUE',
        product_applicability:'ALL',
        requires_comment:     'N',
        common_in_rework:     'TRUE',
        active_flag:          'TRUE',
        description:          'Incorrect geometry or dimensions — member lengths, spans, pitches, or heel heights do not match architectural drawings or client specifications.',
        display_order:        20,
        notes:                '',
        created_by:           creator,
        created_at:           now,
        last_updated_at:      now,
        last_updated_by:      creator,
        retired_at:           '',
        benchmark_code:       ''
      },
      {
        finding_code:         CODES.BEARING_ERROR,
        finding_label:        'Bearing Error',
        finding_group:        'STRUCTURAL',
        category:             'Engineering',
        severity_default:     'CRITICAL',
        kpi_weight:           9.0,
        is_structural_risk:   'TRUE',
        product_applicability:'ALL',
        requires_comment:     'N',
        common_in_rework:     'TRUE',
        active_flag:          'TRUE',
        description:          'Bearing location or bearing condition error — bearing points, widths, or load transfer conditions do not match the structural plan.',
        display_order:        30,
        notes:                '',
        created_by:           creator,
        created_at:           now,
        last_updated_at:      now,
        last_updated_by:      creator,
        retired_at:           '',
        benchmark_code:       ''
      },
      {
        finding_code:         CODES.CONNECTOR_ERROR,
        finding_label:        'Connector Error',
        finding_group:        'STRUCTURAL',
        category:             'Engineering',
        severity_default:     'MAJOR',
        kpi_weight:           7.0,
        is_structural_risk:   'TRUE',
        product_applicability:'ALL',
        requires_comment:     'N',
        common_in_rework:     'FALSE',
        active_flag:          'TRUE',
        description:          'Connector, hanger, or fastener error — incorrect connector type, capacity, or installation detail specified.',
        display_order:        40,
        notes:                '',
        created_by:           creator,
        created_at:           now,
        last_updated_at:      now,
        last_updated_by:      creator,
        retired_at:           '',
        benchmark_code:       ''
      },
      {
        finding_code:         CODES.PLATE_ERROR,
        finding_label:        'Plate Error',
        finding_group:        'STRUCTURAL',
        category:             'Design',
        severity_default:     'MAJOR',
        kpi_weight:           7.0,
        is_structural_risk:   'TRUE',
        product_applicability:'TRUSS',
        requires_comment:     'N',
        common_in_rework:     'FALSE',
        active_flag:          'TRUE',
        description:          'Truss plate size, placement, or orientation error — metal connector plates do not meet engineering requirements at joints.',
        display_order:        50,
        notes:                'Applies to TRUSS products only. Not applicable to wood frame or joist products.',
        created_by:           creator,
        created_at:           now,
        last_updated_at:      now,
        last_updated_by:      creator,
        retired_at:           '',
        benchmark_code:       ''
      },
      {
        finding_code:         CODES.ENGINEERING_ERROR,
        finding_label:        'Engineering Error',
        finding_group:        'STRUCTURAL',
        category:             'Engineering',
        severity_default:     'CRITICAL',
        kpi_weight:           10.0,
        is_structural_risk:   'TRUE',
        product_applicability:'ALL',
        requires_comment:     'N',
        common_in_rework:     'TRUE',
        active_flag:          'TRUE',
        description:          'Structural engineering calculation or logic error — member sizing, stress ratios, deflection limits, or engineering judgment is incorrect.',
        display_order:        60,
        notes:                '',
        created_by:           creator,
        created_at:           now,
        last_updated_at:      now,
        last_updated_by:      creator,
        retired_at:           '',
        benchmark_code:       'ISO9001-8.5.1'
      },
      {
        finding_code:         CODES.WRONG_DESIGN_STANDARD,
        finding_label:        'Wrong Design Standard',
        finding_group:        'STRUCTURAL',
        category:             'Engineering',
        severity_default:     'CRITICAL',
        kpi_weight:           8.0,
        is_structural_risk:   'TRUE',
        product_applicability:'ALL',
        requires_comment:     'N',
        common_in_rework:     'FALSE',
        active_flag:          'TRUE',
        description:          'Wrong design standard or building code applied — design was executed to an incorrect code version, jurisdiction, or standard.',
        display_order:        70,
        notes:                '',
        created_by:           creator,
        created_at:           now,
        last_updated_at:      now,
        last_updated_by:      creator,
        retired_at:           '',
        benchmark_code:       ''
      },
      {
        finding_code:         CODES.CALCULATION_ERROR,
        finding_label:        'Calculation Error',
        finding_group:        'STRUCTURAL',
        category:             'Engineering',
        severity_default:     'CRITICAL',
        kpi_weight:           9.0,
        is_structural_risk:   'TRUE',
        product_applicability:'ALL',
        requires_comment:     'N',
        common_in_rework:     'TRUE',
        active_flag:          'TRUE',
        description:          'Arithmetic or calculation error — numeric mistake in manual or software-assisted calculations that affects the design outcome.',
        display_order:        80,
        notes:                '',
        created_by:           creator,
        created_at:           now,
        last_updated_at:      now,
        last_updated_by:      creator,
        retired_at:           '',
        benchmark_code:       ''
      },

      // ── NON-STRUCTURAL — 9 codes ─────────────────────────
      {
        finding_code:         CODES.INPUT_ERROR,
        finding_label:        'Input Error',
        finding_group:        'PROCESS',
        category:             'Design',
        severity_default:     'MINOR',
        kpi_weight:           3.0,
        is_structural_risk:   'FALSE',
        product_applicability:'ALL',
        requires_comment:     'N',
        common_in_rework:     'TRUE',
        active_flag:          'TRUE',
        description:          'Incorrect input parameters in design software — values entered do not match the job specification or client-supplied data.',
        display_order:        90,
        notes:                '',
        created_by:           creator,
        created_at:           now,
        last_updated_at:      now,
        last_updated_by:      creator,
        retired_at:           '',
        benchmark_code:       ''
      },
      {
        finding_code:         CODES.DRAFTING_ERROR,
        finding_label:        'Drafting Error',
        finding_group:        'PROCESS',
        category:             'Design',
        severity_default:     'MINOR',
        kpi_weight:           2.0,
        is_structural_risk:   'FALSE',
        product_applicability:'ALL',
        requires_comment:     'N',
        common_in_rework:     'FALSE',
        active_flag:          'TRUE',
        description:          'Drawing or output presentation error — dimensions, labels, notes, or graphic elements in the output are incorrect or misleading.',
        display_order:        100,
        notes:                '',
        created_by:           creator,
        created_at:           now,
        last_updated_at:      now,
        last_updated_by:      creator,
        retired_at:           '',
        benchmark_code:       ''
      },
      {
        finding_code:         CODES.OUTPUT_ERROR,
        finding_label:        'Output Error',
        finding_group:        'PROCESS',
        category:             'Production',
        severity_default:     'MINOR',
        kpi_weight:           2.0,
        is_structural_risk:   'FALSE',
        product_applicability:'ALL',
        requires_comment:     'N',
        common_in_rework:     'FALSE',
        active_flag:          'TRUE',
        description:          'Missing or incorrect output files — required deliverables are absent, incomplete, or named incorrectly.',
        display_order:        110,
        notes:                '',
        created_by:           creator,
        created_at:           now,
        last_updated_at:      now,
        last_updated_by:      creator,
        retired_at:           '',
        benchmark_code:       ''
      },
      {
        finding_code:         CODES.SOFTWARE_WARNING_IGNORED,
        finding_label:        'Software Warning Ignored',
        finding_group:        'PROCESS',
        category:             'Engineering',
        severity_default:     'MAJOR',
        kpi_weight:           5.0,
        is_structural_risk:   'FALSE',
        product_applicability:'ALL',
        requires_comment:     'N',
        common_in_rework:     'FALSE',
        active_flag:          'TRUE',
        description:          'Software-generated warning not addressed — design software flagged a condition that was dismissed without documented justification.',
        display_order:        120,
        notes:                '',
        created_by:           creator,
        created_at:           now,
        last_updated_at:      now,
        last_updated_by:      creator,
        retired_at:           '',
        benchmark_code:       ''
      },
      {
        finding_code:         CODES.CLIENT_REQUIREMENT_MISSED,
        finding_label:        'Client Requirement Missed',
        finding_group:        'PROCESS',
        category:             'Client Requirement',
        severity_default:     'MAJOR',
        kpi_weight:           6.0,
        is_structural_risk:   'FALSE',
        product_applicability:'ALL',
        requires_comment:     'N',
        common_in_rework:     'TRUE',
        active_flag:          'TRUE',
        description:          'Client-specific standard, specification, or requirement was not followed — design does not meet documented client preferences or contract obligations.',
        display_order:        130,
        notes:                '',
        created_by:           creator,
        created_at:           now,
        last_updated_at:      now,
        last_updated_by:      creator,
        retired_at:           '',
        benchmark_code:       ''
      },
      {
        finding_code:         CODES.REVISION_MISSED,
        finding_label:        'Revision Missed',
        finding_group:        'PROCESS',
        category:             'Client Requirement',
        severity_default:     'MAJOR',
        kpi_weight:           5.0,
        is_structural_risk:   'FALSE',
        product_applicability:'ALL',
        requires_comment:     'N',
        common_in_rework:     'TRUE',
        active_flag:          'TRUE',
        description:          'A requested revision or correction was not applied — client or PM feedback from a previous submission cycle was not incorporated.',
        display_order:        140,
        notes:                '',
        created_by:           creator,
        created_at:           now,
        last_updated_at:      now,
        last_updated_by:      creator,
        retired_at:           '',
        benchmark_code:       ''
      },
      {
        finding_code:         CODES.SPECIAL_INSTRUCTION_MISSED,
        finding_label:        'Special Instruction Missed',
        finding_group:        'PROCESS',
        category:             'Client Requirement',
        severity_default:     'MAJOR',
        kpi_weight:           5.0,
        is_structural_risk:   'FALSE',
        product_applicability:'ALL',
        requires_comment:     'N',
        common_in_rework:     'FALSE',
        active_flag:          'TRUE',
        description:          'Special instruction from client or PM was not followed — a specific directive in the job notes or communication was overlooked.',
        display_order:        150,
        notes:                '',
        created_by:           creator,
        created_at:           now,
        last_updated_at:      now,
        last_updated_by:      creator,
        retired_at:           '',
        benchmark_code:       ''
      },
      {
        finding_code:         CODES.DOCUMENTATION_ERROR,
        finding_label:        'Documentation Error',
        finding_group:        'DOCUMENTATION',
        category:             'Documentation',
        severity_default:     'INFO',
        kpi_weight:           1.0,
        is_structural_risk:   'FALSE',
        product_applicability:'ALL',
        requires_comment:     'N',
        common_in_rework:     'FALSE',
        active_flag:          'TRUE',
        description:          'Missing or incorrect documentation — sign-offs, checklists, or supporting documents required by the SOP are absent or incorrect.',
        display_order:        160,
        notes:                '',
        created_by:           creator,
        created_at:           now,
        last_updated_at:      now,
        last_updated_by:      creator,
        retired_at:           '',
        benchmark_code:       ''
      },
      {
        finding_code:         CODES.OTHER,
        finding_label:        'Other',
        finding_group:        'DOCUMENTATION',
        category:             'QC',
        severity_default:     'INFO',
        kpi_weight:           0.5,
        is_structural_risk:   'FALSE',
        product_applicability:'ALL',
        requires_comment:     'Y',
        common_in_rework:     'FALSE',
        active_flag:          'TRUE',
        description:          'Finding does not fit any defined category — a comment is required to describe the specific issue.',
        display_order:        170,
        notes:                'requires_comment=Y is enforced at submission time.',
        created_by:           creator,
        created_at:           now,
        last_updated_at:      now,
        last_updated_by:      creator,
        retired_at:           '',
        benchmark_code:       ''
      }
    ];
  }

  // ──────────────────────────────────────────────────────────
  // SEED — idempotent write to DIM_QC_FINDING_TYPES
  // ──────────────────────────────────────────────────────────

  /**
   * Seeds DIM_QC_FINDING_TYPES with the initial 17-code taxonomy.
   * Idempotent — reads existing finding_codes first, skips any
   * already present. Safe to call more than once.
   *
   * @param {string} actorEmail  Email of the person running setup.
   * @returns {{ inserted: number, skipped: number }}
   */
  function seed(actorEmail) {
    Logger.info('QC_FINDING_TYPES_SEED_START', { module: 'QcFindingTypes', actor: actorEmail });

    var existing  = {};
    var allRows   = DAL.readWhere(Config.TABLES.DIM_QC_FINDING_TYPES, {});

    if (allRows && allRows.length > 0) {
      for (var i = 0; i < allRows.length; i++) {
        if (allRows[i].finding_code) {
          existing[String(allRows[i].finding_code)] = true;
        }
      }
    }

    var seedData   = getSeedData();
    var toInsert   = [];
    var skipped    = 0;

    for (var j = 0; j < seedData.length; j++) {
      if (existing[seedData[j].finding_code]) {
        skipped++;
      } else {
        toInsert.push(seedData[j]);
      }
    }

    if (toInsert.length > 0) {
      BatchOperations.appendRows(Config.TABLES.DIM_QC_FINDING_TYPES, toInsert);
    }

    Logger.info('QC_FINDING_TYPES_SEED_COMPLETE', {
      module:   'QcFindingTypes',
      actor:    actorEmail,
      inserted: toInsert.length,
      skipped:  skipped
    });

    return { inserted: toInsert.length, skipped: skipped };
  }

  // ──────────────────────────────────────────────────────────
  // PUBLIC API
  // ──────────────────────────────────────────────────────────
  return {
    CODES:       CODES,
    getSeedData: getSeedData,
    seed:        seed
  };

})();
