// ============================================================
// RBAC.gs — BLC Nexus T2 Security
// src/02-security/RBAC.gs
//
// LOAD ORDER: First file in T2. Loads after all T0 and T1 files.
// DEPENDENCIES: Config (T0), Constants (T0)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  RBAC.enforcePermission() MUST BE THE FIRST CALL IN     ║
// ║  EVERY HANDLER. No exceptions. See Rule S1.             ║
// ╚══════════════════════════════════════════════════════════╝
//
// Responsibilities:
//   1. Define all roles and their display names
//   2. Define all actions in the system
//   3. Maintain the permission matrix (role × action)
//   4. Resolve an email address to an actor object
//   5. Enforce permissions — throwing RBACError on violations
//   6. Gate financial operations with a second CEO-only check
//   7. Provide a data-scope level for each role (used by ScopeFilter)
//
// ACTOR OBJECT (produced by RBAC.resolveActor):
//   {
//     email:       {string}  submitter email address
//     personCode:  {string}  short code from DIM_STAFF_ROSTER (e.g. 'SGO')
//     role:        {string}  one of RBAC.ROLES values
//     displayName: {string}  full name for logging
//     scope:       {string}  one of RBAC.SCOPES values — used by ScopeFilter
//   }
//
// PHASE 1 (current): resolveActor() uses a mock email→role map.
// PHASE 2 (when DAL is live): replace resolveActor_() body with
//   DAL.readWhere(Config.TABLES.DIM_STAFF_ROSTER, { email: email })
//   The public API surface does not change between phases.
//
// USAGE IN HANDLERS (copy-paste pattern):
//
//   function handle(queueItem) {
//     var actor = RBAC.resolveActor(queueItem.submitter_email);
//     RBAC.enforcePermission(actor, RBAC.ACTIONS.JOB_CREATE); // ← FIRST
//     // ... rest of handler logic
//   }
//
//   // Financial operations need BOTH guards:
//   RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);
//   RBAC.enforceFinancialAccess(actor);
//
// DO NOT:
//   - Write `if (actor.role === 'CEO')` in handlers — use hasPermission()
//   - Skip enforcePermission() for "internal" operations
//   - Add permission bypass flags ("isAdmin", "skipRbac", etc.)
//   - Use this module for sheet access control (that is WriteGuard's job)
// ============================================================

var RBAC = (function () {

  // ============================================================
  // SECTION 1: ROLES
  //
  // Canonical role identifiers. These mirror Constants.ROLES and
  // must stay in sync. They are redefined here so RBAC.gs is
  // self-contained and readable without cross-referencing another file.
  //
  // Role hierarchy (high → low privilege):
  //   CEO > PM > TEAM_LEAD > DESIGNER
  //                        > QC
  //   ADMIN  — system administration (no financial access)
  //   SYSTEM — internal automation (bypasses human permission checks)
  //   CLIENT — external read-only (scoped to own accounts)
  //
  // Note: PROJECT_MANAGER and ADMIN are user-facing aliases for PM
  // and CEO. They are exposed in this module but the canonical
  // stored value in DIM_STAFF_ROSTER.role is PM / CEO.
  // ============================================================

  var ROLES = {
    DESIGNER:         'DESIGNER',    // Production designer — logs own work
    TEAM_LEAD:        'TEAM_LEAD',   // Senior designer — creates jobs, leads team
    QC:               'QC',          // Quality control reviewer
    PM:               'PM',          // Project Manager — billing, queue, client ops
    CEO:              'CEO',         // Full access including payroll and admin config
    ADMIN:            'ADMIN',       // System admin — config only, no financial access
    SYSTEM:           'SYSTEM',      // Internal automation — bypasses human permission gates
    CLIENT:           'CLIENT',      // External client portal — read-only, scoped
    // ── Aliases (user-facing display names → canonical values) ──
    PROJECT_MANAGER:  'PM',          // Alias: same permission set as PM
    SUPER_ADMIN:      'CEO'          // Alias: same permission set as CEO
  };

  // Canonical role set (aliases excluded) — used for validation
  var CANONICAL_ROLES = {
    DESIGNER:  true,
    TEAM_LEAD: true,
    QC:        true,
    PM:        true,
    CEO:       true,
    ADMIN:     true,
    SYSTEM:    true,
    CLIENT:    true
  };

  // ── ROLE HIERARCHY ─────────────────────────────────────────
  // Numeric privilege rank per canonical role. Higher = more privilege.
  //
  // Rules:
  //   - ADMIN and PM share rank 4: different domains, neither is a
  //     superset of the other (PM can run billing; ADMIN cannot)
  //   - SYSTEM outranks all human roles — internal automation
  //   - CLIENT is rank 0 — lowest, read-only external access
  //
  // Use roleRanksAbove() for comparisons — never compare these
  // numbers directly in handler code.
  var ROLE_HIERARCHY = {
    CLIENT:    0,
    DESIGNER:  1,
    QC:        2,
    TEAM_LEAD: 3,
    ADMIN:     4,  // config domain — not a superset of PM
    PM:        4,  // operational domain — not a superset of ADMIN
    CEO:       5,
    SYSTEM:    6   // highest — internal automation
  };

  // ============================================================
  // SECTION 2: ACTIONS
  //
  // All operations that require a permission check.
  // Every handler that calls enforcePermission() must pass one
  // of these constants — never a raw string.
  //
  // Grouped by domain. Adding a new action requires:
  //   1. Add the constant here
  //   2. Add a row to the PERMISSION_MATRIX below
  //   3. Update docs/SYSTEM_ARCHITECTURE.md permission table
  //   4. Add a test in tests/rbac.test.js
  // ============================================================

  var ACTIONS = {
    // ── Job lifecycle ────────────────────────────────────────
    JOB_CREATE:         'JOB_CREATE',      // Create a new job record
    JOB_ALLOCATE:       'JOB_ALLOCATE',    // Assign a job to a designer
    JOB_START:          'JOB_START',       // Begin working on an allocated job
    JOB_HOLD:           'JOB_HOLD',        // Place a job on hold
    JOB_RESUME:         'JOB_RESUME',      // Resume a held job
    JOB_VIEW:           'JOB_VIEW',        // Read job data (all non-client roles)
    // ── Work logs ────────────────────────────────────────────
    WORK_LOG_SUBMIT:    'WORK_LOG_SUBMIT', // Submit design or QC hours
    // ── QC ───────────────────────────────────────────────────
    QC_SUBMIT:          'QC_SUBMIT',       // Submit a job for QC review
    QC_APPROVE:         'QC_APPROVE',      // Approve a QC review
    QC_REJECT:          'QC_REJECT',       // Reject/return a QC review
    // ── Financial ────────────────────────────────────────────
    BILLING_RUN:        'BILLING_RUN',     // Execute a billing calculation
    PAYROLL_RUN:        'PAYROLL_RUN',     // Execute payroll (CEO + SYSTEM only)
    PAYROLL_VIEW:       'PAYROLL_VIEW',    // View payroll figures
    // ── Queue ────────────────────────────────────────────────
    QUEUE_MODIFY:       'QUEUE_MODIFY',    // Update STG_PROCESSING_QUEUE entries
    // ── Admin ────────────────────────────────────────────────
    ADMIN_CONFIG:       'ADMIN_CONFIG',    // Modify system config and DIM tables
    CLIENT_VIEW:        'CLIENT_VIEW',     // View client account data
    DATA_EXPORT:        'DATA_EXPORT',     // Export data to external formats
    // ── Aliases (match user-supplied requirement names) ───────
    CREATE_JOB:         'JOB_CREATE',      // Alias: same as JOB_CREATE
    LOG_WORK:           'WORK_LOG_SUBMIT', // Alias: same as WORK_LOG_SUBMIT
    QC_REVIEW:          'QC_SUBMIT',       // Alias: same as QC_SUBMIT
    APPROVE_QC:         'QC_APPROVE',      // Alias: same as QC_APPROVE
    MODIFY_QUEUE:       'QUEUE_MODIFY',    // Alias: same as QUEUE_MODIFY
    ADMIN_OVERRIDE:     'ADMIN_CONFIG',     // Alias: same as ADMIN_CONFIG
    // ── Performance ratings ──────────────────────────────────
    RATE_STAFF:         'RATE_STAFF',      // Submit quarterly performance ratings (TL, PM, CEO)
  };

  // ============================================================
  // SECTION 3: DATA SCOPES
  //
  // Scope determines which rows a role can see in query results.
  // ScopeFilter.gs (T2) applies these when filtering DAL reads.
  //
  //   SELF      — only the actor's own rows (person_code matches)
  //   TEAM      — actor's rows + direct reports' rows
  //   ACCOUNTS  — rows for client accounts assigned to this actor
  //   ALL       — no row-level restriction
  // ============================================================

  var SCOPES = {
    SELF:     'SELF',
    TEAM:     'TEAM',
    ACCOUNTS: 'ACCOUNTS',
    ALL:      'ALL'
  };

  // Which scope each canonical role gets
  var ROLE_SCOPES = {
    DESIGNER:  SCOPES.SELF,
    TEAM_LEAD: SCOPES.TEAM,
    QC:        SCOPES.SELF,
    PM:        SCOPES.ALL,
    CEO:       SCOPES.ALL,
    ADMIN:     SCOPES.ALL,
    SYSTEM:    SCOPES.ALL,
    CLIENT:    SCOPES.ACCOUNTS
  };

  // ============================================================
  // SECTION 4: PERMISSION MATRIX
  //
  // PERMISSIONS[role][action] = true | false
  //
  // This is the single source of truth for all access decisions.
  // Rules:
  //   - Every canonical role must appear as a key
  //   - Every canonical action (non-alias) must appear in every role
  //   - SYSTEM: true for all — internal automation is never blocked
  //   - CLIENT: read-only CLIENT_VIEW only
  //   - Aliases are resolved before lookup — do not add alias rows
  //
  // Audit notes (why each non-obvious permission is set):
  //   TEAM_LEAD / JOB_CREATE: Team leads intake jobs on behalf of clients
  //   QC / QC_APPROVE: QC reviewers can approve/reject their own reviews
  //   PM / BILLING_RUN: PMs run billing, but NOT payroll (financial isolation)
  //   CEO / PAYROLL_RUN: CEO-only. Also requires enforceFinancialAccess().
  //   ADMIN / ADMIN_CONFIG: System admins configure DIM tables without financial access
  // ============================================================

  var PERMISSION_MATRIX = {

    // ── DESIGNER ──────────────────────────────────────────────
    // Can only log their own work hours. Cannot create jobs,
    // view client data, or modify any queue or financial record.
    DESIGNER: {
      JOB_CREATE:      false,
      JOB_ALLOCATE:    false,
      JOB_START:       true,   // designers start jobs allocated to them
      JOB_HOLD:        false,
      JOB_RESUME:      false,
      JOB_VIEW:        true,
      WORK_LOG_SUBMIT: true,
      QC_SUBMIT:       true,   // designers submit their completed work for QC review
      QC_APPROVE:      false,
      QC_REJECT:       false,
      BILLING_RUN:     false,
      PAYROLL_RUN:     false,
      PAYROLL_VIEW:    false,
      QUEUE_MODIFY:    false,
      ADMIN_CONFIG:    false,
      CLIENT_VIEW:     false,
      DATA_EXPORT:     false,
      RATE_STAFF:      false
    },

    // ── TEAM_LEAD ─────────────────────────────────────────────
    // Can create and hold jobs, log work, and submit for QC.
    // Cannot approve QC (that is the QC reviewer's role),
    // run financial processes, or modify the queue.
    TEAM_LEAD: {
      JOB_CREATE:      true,
      JOB_ALLOCATE:    true,
      JOB_START:       true,
      JOB_HOLD:        true,
      JOB_RESUME:      true,
      JOB_VIEW:        true,
      WORK_LOG_SUBMIT: true,
      QC_SUBMIT:       true,
      QC_APPROVE:      false,
      QC_REJECT:       false,
      BILLING_RUN:     false,
      PAYROLL_RUN:     false,
      PAYROLL_VIEW:    false,
      QUEUE_MODIFY:    false,
      ADMIN_CONFIG:    false,
      CLIENT_VIEW:     true,
      DATA_EXPORT:     false,
      RATE_STAFF:      true
    },

    // ── QC ────────────────────────────────────────────────────
    // Dedicated quality control role. Can approve or reject QC
    // submissions. Cannot create jobs or touch financial data.
    QC: {
      JOB_CREATE:      false,
      JOB_ALLOCATE:    false,
      JOB_START:       false,  // QC reviewers do not start design jobs
      JOB_HOLD:        false,
      JOB_RESUME:      false,
      JOB_VIEW:        true,
      WORK_LOG_SUBMIT: true,   // logs QC hours against reviewed jobs
      QC_SUBMIT:       true,
      QC_APPROVE:      true,
      QC_REJECT:       true,
      BILLING_RUN:     false,
      PAYROLL_RUN:     false,
      PAYROLL_VIEW:    false,
      QUEUE_MODIFY:    false,
      ADMIN_CONFIG:    false,
      CLIENT_VIEW:     false,
      DATA_EXPORT:     false,
      RATE_STAFF:      false
    },

    // ── PM (Project Manager) ──────────────────────────────────
    // Manages jobs end-to-end, runs billing, views payroll.
    // Cannot run payroll (CEO-only financial gate) or change
    // system config.
    PM: {
      JOB_CREATE:      true,
      JOB_ALLOCATE:    true,
      JOB_START:       true,
      JOB_HOLD:        true,
      JOB_RESUME:      true,
      JOB_VIEW:        true,
      WORK_LOG_SUBMIT: true,
      QC_SUBMIT:       true,
      QC_APPROVE:      true,
      QC_REJECT:       true,
      BILLING_RUN:     true,
      PAYROLL_RUN:     false,  // PM cannot run payroll — CEO only
      PAYROLL_VIEW:    true,
      QUEUE_MODIFY:    true,
      ADMIN_CONFIG:    false,  // PM cannot change system config
      CLIENT_VIEW:     true,
      DATA_EXPORT:     true,
      RATE_STAFF:      true
    },

    // ── CEO ───────────────────────────────────────────────────
    // Full system access. PAYROLL_RUN additionally requires
    // enforceFinancialAccess() — a second gate that confirms
    // CEO identity before any payroll write.
    CEO: {
      JOB_CREATE:      true,
      JOB_ALLOCATE:    true,
      JOB_START:       true,
      JOB_HOLD:        true,
      JOB_RESUME:      true,
      JOB_VIEW:        true,
      WORK_LOG_SUBMIT: true,
      QC_SUBMIT:       true,
      QC_APPROVE:      true,
      QC_REJECT:       true,
      BILLING_RUN:     true,
      PAYROLL_RUN:     true,   // CEO only — enforceFinancialAccess() also required
      PAYROLL_VIEW:    true,
      QUEUE_MODIFY:    true,
      ADMIN_CONFIG:    true,
      CLIENT_VIEW:     true,
      DATA_EXPORT:     true,
      RATE_STAFF:      true
    },

    // ── ADMIN ─────────────────────────────────────────────────
    // System administrator. Can modify DIM tables and config.
    // Deliberately excluded from PAYROLL_RUN and BILLING_RUN
    // — financial operations are CEO-only, not admin-accessible.
    ADMIN: {
      JOB_CREATE:      false,
      JOB_ALLOCATE:    false,
      JOB_START:       false,  // admin does not start jobs
      JOB_HOLD:        false,
      JOB_RESUME:      false,
      JOB_VIEW:        true,
      WORK_LOG_SUBMIT: false,
      QC_SUBMIT:       false,
      QC_APPROVE:      false,
      QC_REJECT:       false,
      BILLING_RUN:     false,
      PAYROLL_RUN:     false,  // financial isolation: admin ≠ CEO
      PAYROLL_VIEW:    false,
      QUEUE_MODIFY:    true,
      ADMIN_CONFIG:    true,
      CLIENT_VIEW:     true,
      DATA_EXPORT:     true,
      RATE_STAFF:      false
    },

    // ── SYSTEM ────────────────────────────────────────────────
    // Internal automation identity (QueueProcessor, RetryManager,
    // HealthMonitor, etc.). Granted all permissions.
    // Physical access control is handled by WriteGuard (DAL) —
    // SYSTEM actors still go through DAL, never SpreadsheetApp.
    SYSTEM: {
      JOB_CREATE:      true,
      JOB_ALLOCATE:    true,
      JOB_START:       true,
      JOB_HOLD:        true,
      JOB_RESUME:      true,
      JOB_VIEW:        true,
      WORK_LOG_SUBMIT: true,
      QC_SUBMIT:       true,
      QC_APPROVE:      true,
      QC_REJECT:       true,
      BILLING_RUN:     true,
      PAYROLL_RUN:     true,
      PAYROLL_VIEW:    true,
      QUEUE_MODIFY:    true,
      ADMIN_CONFIG:    true,
      CLIENT_VIEW:     true,
      DATA_EXPORT:     true,
      RATE_STAFF:      true
    },

    // ── CLIENT ────────────────────────────────────────────────
    // External client portal access. Read-only, scoped to their
    // own account (ScopeFilter enforces ACCOUNTS scope).
    CLIENT: {
      JOB_CREATE:      false,
      JOB_ALLOCATE:    false,
      JOB_START:       false,
      JOB_HOLD:        false,
      JOB_RESUME:      false,
      JOB_VIEW:        false,  // read via CLIENT_VIEW, not JOB_VIEW
      WORK_LOG_SUBMIT: false,
      QC_SUBMIT:       false,
      QC_APPROVE:      false,
      QC_REJECT:       false,
      BILLING_RUN:     false,
      PAYROLL_RUN:     false,
      PAYROLL_VIEW:    false,
      QUEUE_MODIFY:    false,
      ADMIN_CONFIG:    false,
      CLIENT_VIEW:     true,   // scoped by ScopeFilter to own accounts
      DATA_EXPORT:     false,
      RATE_STAFF:      false
    }

  };

  // ============================================================
  // SECTION 5: FINANCIAL TABLES
  //
  // Tables that require enforceFinancialAccess() as a second gate
  // beyond the standard enforcePermission() check.
  // Only CEO and SYSTEM may read or write these.
  // ============================================================

  var FINANCIAL_TABLES = {
    'FACT_PAYROLL_LEDGER':   true,
    'FACT_BILLING_LEDGER':   true,
    'MART_PAYROLL_SUMMARY':  true,
    'MART_BILLING_SUMMARY':  true
  };

  // ============================================================
  // SECTION 6: MOCK EMAIL → ACTOR MAP (Phase 1)
  //
  // Used by resolveActor_() until DIM_STAFF_ROSTER is live.
  // Contains test/dev actor definitions only — no production emails.
  //
  // PHASE 2 MIGRATION: Replace resolveActor_() with a DAL.readWhere
  //   call. This mock block can be deleted entirely. The public API
  //   (resolveActor, getUserRole) does not change.
  //
  // !! DO NOT add real production email addresses here !!
  //    Use DIM_STAFF_ROSTER for production actor resolution.
  // ============================================================

  var MOCK_ACTOR_MAP = {
    // ── System / automation ──────────────────────────────────
    'system@blclotus.com':        { personCode: 'SYS', role: ROLES.SYSTEM,    displayName: 'System Automation' },
    // ── CEO / Founder ────────────────────────────────────────
    'ceo@blclotus.com':                { personCode: 'CEO', role: ROLES.CEO, displayName: 'BLC CEO' },
    'founder@blclotus.com':            { personCode: 'CEO', role: ROLES.CEO, displayName: 'BLC Founder' },
    'raj.nair@bluelotuscanada.ca':     { personCode: 'RNR', role: ROLES.CEO, displayName: 'Raj Nair' },
    // ── Project Manager ──────────────────────────────────────
    'pm@blclotus.com':            { personCode: 'PMG', role: ROLES.PM,        displayName: 'Project Manager' },
    'sarty@blclotus.com':         { personCode: 'SGO', role: ROLES.PM,        displayName: 'Sarty Gosh' },
    // ── Team Leads ───────────────────────────────────────────
    'teamlead@blclotus.com':      { personCode: 'TL1', role: ROLES.TEAM_LEAD, displayName: 'Team Lead' },
    // ── Designers ────────────────────────────────────────────
    'designer@blclotus.com':      { personCode: 'DS1', role: ROLES.DESIGNER,  displayName: 'Designer' },
    'designer2@blclotus.com':     { personCode: 'DS2', role: ROLES.DESIGNER,  displayName: 'Designer 2' },
    // ── QC Reviewers ─────────────────────────────────────────
    'qc@blclotus.com':            { personCode: 'QC1', role: ROLES.QC,        displayName: 'QC Reviewer' },
    // ── Admin ────────────────────────────────────────────────
    'admin@blclotus.com':         { personCode: 'ADM', role: ROLES.ADMIN,     displayName: 'System Admin' },
    // ── Test actors (used in tests/ only) ────────────────────
    'test.ceo@blclotus.com':      { personCode: 'TC0', role: ROLES.CEO,       displayName: 'Test CEO' },
    'test.pm@blclotus.com':       { personCode: 'TP0', role: ROLES.PM,        displayName: 'Test PM' },
    'test.designer@blclotus.com': { personCode: 'TD0', role: ROLES.DESIGNER,  displayName: 'Test Designer' },
    'test.qc@blclotus.com':       { personCode: 'TQ0', role: ROLES.QC,        displayName: 'Test QC' }
  };

  // ============================================================
  // SECTION 7: PRIVATE HELPERS
  // ============================================================

  // ── DENIED ACTION LOG HOOK ─────────────────────────────────
  // No-op placeholder until Logger.gs (T3) registers a hook via
  // RBAC.setDeniedLogHook(). Logger calls this during its own
  // init — no manual wiring needed in handlers.
  var _deniedLogHook = null;

  /**
   * Emits a denied-action event through the registered hook.
   * Called immediately before every RBACError throw so that
   * all access denials are observable once Logger is live.
   * Falls back to GAS native Logger.log if no hook registered.
   *
   * @param {string} action     Canonical action that was denied
   * @param {Object} actor      Actor object (may be partial for bad-actor cases)
   * @param {string} errorCode  The RBACError code about to be thrown
   */
  function emitDenied_(action, actor, errorCode) {
    var entry = {
      action:     action                          || 'UNKNOWN',
      email:      (actor && actor.email)          || 'UNKNOWN',
      personCode: (actor && actor.personCode)     || 'UNKNOWN',
      role:       (actor && actor.role)           || 'UNKNOWN',
      errorCode:  errorCode                       || 'PERMISSION_DENIED',
      timestamp:  new Date().toISOString()
    };
    if (_deniedLogHook) {
      try { _deniedLogHook(entry); } catch (e) { /* hook must never throw */ }
      return;
    }
    // Fallback: GAS native execution log (visible in Apps Script IDE)
    Logger.log('[RBAC DENIED] ' + JSON.stringify(entry));
  }

  /**
   * Validates that an actor object was produced by resolveActor()
   * and has all required fields. Throws RBACError if malformed.
   *
   * All enforcement functions call this first — it centralises the
   * actor guard so each function does not duplicate the check.
   *
   * Structural requirements:
   *   - Non-null object
   *   - actor.role: non-empty string
   *   - actor.email: non-empty string
   *   - actor._rbacResolved === true (set only by resolveActor())
   *
   * The _rbacResolved flag prevents manually constructed objects
   * (e.g. { role: 'CEO' }) from passing enforcement gates —
   * the actor must have gone through the resolver.
   *
   * @param {Object} actor   Actor to validate
   * @param {string} caller  Calling function name (for error message)
   * @throws {RBACError_}  INVALID_ACTOR or ACTOR_NOT_RESOLVED
   */
  function assertActorExists_(actor, caller) {
    var label = caller || 'RBAC';

    if (!actor || typeof actor !== 'object') {
      emitDenied_('UNKNOWN', actor, 'INVALID_ACTOR');
      throw new RBACError_(
        'INVALID_ACTOR',
        label + '() requires an actor object. ' +
        'Call RBAC.resolveActor(email) first to obtain one.',
        { receivedType: typeof actor }
      );
    }

    if (!actor.role || typeof actor.role !== 'string' || actor.role.trim() === '') {
      emitDenied_('UNKNOWN', actor, 'INVALID_ACTOR');
      throw new RBACError_(
        'INVALID_ACTOR',
        label + '() — actor is missing a valid role field. ' +
        'Ensure the actor was returned by RBAC.resolveActor().',
        { actor: actor }
      );
    }

    if (!actor.email || typeof actor.email !== 'string') {
      emitDenied_('UNKNOWN', actor, 'INVALID_ACTOR');
      throw new RBACError_(
        'INVALID_ACTOR',
        label + '() — actor is missing an email address.',
        { actor: actor }
      );
    }

    if (actor._rbacResolved !== true) {
      emitDenied_('UNKNOWN', actor, 'ACTOR_NOT_RESOLVED');
      throw new RBACError_(
        'ACTOR_NOT_RESOLVED',
        label + '() — actor was not produced by RBAC.resolveActor(). ' +
        'Manually constructed actor objects are rejected by all enforcement ' +
        'functions. Always call RBAC.resolveActor(submitter_email) first.',
        { email: actor.email, role: actor.role }
      );
    }
  }

  /**
   * Resolves an alias role string to its canonical form.
   * e.g. 'PROJECT_MANAGER' → 'PM', 'SUPER_ADMIN' → 'CEO'
   * Canonical roles pass through unchanged.
   *
   * @param {string} role  Any ROLES value (canonical or alias)
   * @returns {string}  Canonical role string
   */
  function resolveRole_(role) {
    // If already canonical, return as-is
    if (CANONICAL_ROLES.hasOwnProperty(role)) return role;
    // Resolve through ROLES map (aliases map to canonical values)
    var resolved = ROLES[role];
    return resolved || role; // return original if not found — caller will handle unknown
  }

  /**
   * Resolves an alias action string to its canonical form.
   * e.g. 'CREATE_JOB' → 'JOB_CREATE', 'LOG_WORK' → 'WORK_LOG_SUBMIT'
   *
   * @param {string} action  Any ACTIONS value (canonical or alias)
   * @returns {string}  Canonical action string
   */
  function resolveAction_(action) {
    // ACTIONS values are already canonical strings for canonical keys,
    // and canonical strings for alias keys too (e.g. ACTIONS.CREATE_JOB = 'JOB_CREATE')
    return ACTIONS[action] || action;
  }

  /**
   * Resolves an actor object (Phase 1: mock map; Phase 2: DAL lookup).
   * Returns null if the email is not recognised.
   *
   * ── PHASE 2 MIGRATION ──
   * Replace this function body with:
   *   var rows = DAL.readWhere(Config.TABLES.DIM_STAFF_ROSTER, { email: email, active: 'TRUE' });
   *   if (!rows.length) return null;
   *   var r = rows[0];
   *   return { email: email, personCode: r.person_code, role: r.role, displayName: r.full_name };
   * ───────────────────────
   *
   * @param {string} email  Google account email address
   * @returns {Object|null}  { personCode, role, displayName } or null
   */
  function lookupMockActor_(email) {
    if (!email) return null;
    return MOCK_ACTOR_MAP[email.toLowerCase().trim()] || null;
  }

  // ============================================================
  // SECTION 8: RBAC ERROR TYPE
  //
  // Structured error for all RBAC failures.
  // Handlers catch err.code to decide recovery path.
  // ============================================================

  /**
   * @param {string} code        Machine-readable identifier
   * @param {string} message     Human-readable explanation
   * @param {Object} [context]   { action, role, email, ... }
   */
  function RBACError_(code, message, context) {
    this.name    = 'RBACError';
    this.code    = code;
    this.message = '[RBAC:' + code + '] ' + message;
    this.context = context || {};
    this.stack   = (new Error()).stack;
  }
  RBACError_.prototype = Object.create(Error.prototype);
  RBACError_.prototype.constructor = RBACError_;

  // ============================================================
  // SECTION 9: PUBLIC — ROLE RESOLUTION
  // ============================================================

  /**
   * Returns the role string for a given email address.
   * Phase 1: looks up the mock actor map.
   * Phase 2: will query DIM_STAFF_ROSTER via DAL.
   *
   * Returns ROLES.DESIGNER (most restrictive non-system role) if
   * the email is not found. This safe-default prevents unknown
   * actors from gaining elevated access.
   *
   * @param {string} email  Google account email address
   * @returns {string}  A canonical ROLES value
   */
  function getUserRole(email) {
    var mock = lookupMockActor_(email);
    if (mock) return mock.role;
    // Unknown email — default to most restrictive human role
    return ROLES.DESIGNER;
  }

  /**
   * Resolves a full actor object from an email address.
   * The actor object is the standard identity token passed to all
   * enforcePermission() calls throughout the system.
   *
   * If the email is not recognised, returns a restricted guest actor.
   * Handlers that require a fully identified actor should check
   * actor.personCode !== 'UNKNOWN' after calling this.
   *
   * @param {string} email  Google account email address
   * @returns {{ email, personCode, role, displayName, scope }}
   */
  function resolveActor(email) {
    if (!email || typeof email !== 'string') {
      throw new RBACError_(
        'INVALID_EMAIL',
        'resolveActor() requires a non-empty email string. Received: ' + typeof email,
        { email: email }
      );
    }

    var normalised = email.toLowerCase().trim();
    var mock       = lookupMockActor_(normalised);

    if (mock) {
      return {
        email:          normalised,
        personCode:     mock.personCode,
        role:           mock.role,
        displayName:    mock.displayName,
        scope:          getScopeForRole(mock.role),
        _rbacResolved:  true   // marks this actor as properly resolver-produced
      };
    }

    // Unknown actor: restricted DESIGNER-level guest.
    // Handlers can detect this via actor.personCode === 'UNKNOWN'.
    // Still sets _rbacResolved so the object passes assertActorExists_().
    return {
      email:          normalised,
      personCode:     'UNKNOWN',
      role:           ROLES.DESIGNER,
      displayName:    normalised,
      scope:          SCOPES.SELF,
      _rbacResolved:  true   // resolver-produced — unknown identity, minimum privilege
    };
  }

  /**
   * Returns the data scope string for a given role.
   * Used by ScopeFilter.gs (T2) to filter query results.
   *
   * @param {string} role  A canonical ROLES value
   * @returns {string}  A SCOPES value
   */
  function getScopeForRole(role) {
    var canonical = resolveRole_(role);
    return ROLE_SCOPES[canonical] || SCOPES.SELF; // safe default
  }

  // ============================================================
  // SECTION 10: PUBLIC — PERMISSION CHECKS
  // ============================================================

  /**
   * Returns true if a role is allowed to perform an action.
   * Pure boolean — does not throw. Use for conditional logic.
   *
   * Prefer hasPermission(actor, action) when you already have
   * an actor object. Use this only when you have a role string.
   *
   * @param {string} role    A ROLES value (canonical or alias)
   * @param {string} action  An ACTIONS value (canonical or alias)
   * @returns {boolean}
   *
   * @example
   *   if (RBAC.canPerform(RBAC.ROLES.DESIGNER, RBAC.ACTIONS.JOB_CREATE)) { ... }
   */
  function canPerform(role, action) {
    var canonicalRole   = resolveRole_(role);
    var canonicalAction = resolveAction_(action);
    var rolePerms       = PERMISSION_MATRIX[canonicalRole];
    if (!rolePerms) return false;
    return rolePerms[canonicalAction] === true;
  }

  /**
   * Throws RBACError if a role is NOT allowed to perform an action.
   * Takes a role string. Use enforcePermission(actor, action) in
   * handlers — this variant is provided for utility/test contexts
   * where only the role string is available.
   *
   * @param {string} role    A ROLES value
   * @param {string} action  An ACTIONS value
   * @throws {RBACError_}  PERMISSION_DENIED if role cannot perform action
   * @throws {RBACError_}  UNKNOWN_ROLE if role is not in the matrix
   * @throws {RBACError_}  UNKNOWN_ACTION if action is not registered
   *
   * @example
   *   RBAC.assertPermission(RBAC.ROLES.PM, RBAC.ACTIONS.BILLING_RUN);
   */
  function assertPermission(role, action) {
    var canonicalRole   = resolveRole_(role);
    var canonicalAction = resolveAction_(action);

    if (!PERMISSION_MATRIX[canonicalRole]) {
      throw new RBACError_(
        'UNKNOWN_ROLE',
        '"' + role + '" is not a registered role. ' +
        'Valid roles: ' + Object.keys(CANONICAL_ROLES).join(', '),
        { role: role, action: action }
      );
    }

    var rolePerms = PERMISSION_MATRIX[canonicalRole];
    if (!rolePerms.hasOwnProperty(canonicalAction)) {
      throw new RBACError_(
        'UNKNOWN_ACTION',
        '"' + action + '" is not a registered action. ' +
        'Add it to ACTIONS and PERMISSION_MATRIX in RBAC.gs.',
        { role: role, action: action }
      );
    }

    if (rolePerms[canonicalAction] !== true) {
      emitDenied_(canonicalAction, { role: canonicalRole, email: 'role-check', personCode: 'N/A' }, 'PERMISSION_DENIED');
      throw new RBACError_(
        'PERMISSION_DENIED',
        'Role "' + canonicalRole + '" does not have permission to perform "' + canonicalAction + '".',
        { role: canonicalRole, action: canonicalAction }
      );
    }
  }

  /**
   * Returns true if an actor object is allowed to perform an action.
   * Boolean version for conditional logic in handlers.
   *
   * @param {{ role: string }} actor  Actor object from resolveActor()
   * @param {string} action           An ACTIONS value
   * @returns {boolean}
   *
   * @example
   *   if (!RBAC.hasPermission(actor, RBAC.ACTIONS.PAYROLL_VIEW)) {
   *     return [];  // return empty — actor cannot see payroll
   *   }
   */
  function hasPermission(actor, action) {
    if (!actor || !actor.role) return false;
    return canPerform(actor.role, action);
  }

  /**
   * Enforces permission for an actor object. Throws RBACError on failure.
   * THIS IS THE FUNCTION TO USE IN HANDLERS — always as the first call.
   *
   * @param {{ role: string, email: string, personCode: string }} actor
   * @param {string} action  An ACTIONS value
   * @throws {RBACError_}  PERMISSION_DENIED if actor cannot perform action
   * @throws {RBACError_}  INVALID_ACTOR if actor object is malformed
   *
   * @example — standard handler pattern:
   *   function handle(queueItem) {
   *     var actor = RBAC.resolveActor(queueItem.submitter_email);
   *     RBAC.enforcePermission(actor, RBAC.ACTIONS.JOB_CREATE); // ← FIRST
   *     // ... rest of handler
   *   }
   */
  function enforcePermission(actor, action) {
    // Validate actor structure and _rbacResolved flag first.
    // assertActorExists_ emits a denied log and throws if invalid.
    assertActorExists_(actor, 'enforcePermission');

    var canonicalRole   = resolveRole_(actor.role);
    var canonicalAction = resolveAction_(action);

    if (!PERMISSION_MATRIX[canonicalRole]) {
      emitDenied_(canonicalAction, actor, 'UNKNOWN_ROLE');
      throw new RBACError_(
        'UNKNOWN_ROLE',
        'Actor role "' + actor.role + '" is not in the permission matrix.',
        { email: actor.email, role: actor.role, action: canonicalAction }
      );
    }

    var rolePerms = PERMISSION_MATRIX[canonicalRole];
    if (!rolePerms.hasOwnProperty(canonicalAction)) {
      emitDenied_(canonicalAction, actor, 'UNKNOWN_ACTION');
      throw new RBACError_(
        'UNKNOWN_ACTION',
        '"' + action + '" is not a registered action. ' +
        'Add it to ACTIONS and PERMISSION_MATRIX in RBAC.gs.',
        { email: actor.email, role: actor.role, action: canonicalAction }
      );
    }

    if (rolePerms[canonicalAction] !== true) {
      emitDenied_(canonicalAction, actor, 'PERMISSION_DENIED');
      throw new RBACError_(
        'PERMISSION_DENIED',
        '"' + (actor.displayName || actor.email) + '" (' + canonicalRole + ') ' +
        'does not have permission to perform "' + canonicalAction + '".',
        {
          email:      actor.email,
          personCode: actor.personCode,
          role:       canonicalRole,
          action:     canonicalAction
        }
      );
    }
  }

  // ============================================================
  // SECTION 11: PUBLIC — FINANCIAL ACCESS GATE
  //
  // A second permission layer for financial operations.
  // Must be called IN ADDITION TO enforcePermission(), not instead.
  //
  // Pattern (PayrollEngine):
  //   RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);
  //   RBAC.enforceFinancialAccess(actor);   ← second gate
  //   // Only reaches here if both pass
  //
  // Only CEO and SYSTEM pass this gate. PM has PAYROLL_VIEW
  // but still fails enforceFinancialAccess — they may read
  // summaries but cannot execute payroll writes.
  // ============================================================

  /**
   * Enforces that the actor has CEO-level financial access.
   * Must be called for all PAYROLL_RUN and direct FACT_PAYROLL_LEDGER
   * or FACT_BILLING_LEDGER write operations.
   *
   * @param {{ role: string, email: string }} actor
   * @throws {RBACError_}  FINANCIAL_ACCESS_DENIED if actor is not CEO or SYSTEM
   */
  function enforceFinancialAccess(actor) {
    // Full actor validation including _rbacResolved flag.
    // A manually constructed { role: 'CEO' } object fails here —
    // financial access requires a resolver-produced identity.
    assertActorExists_(actor, 'enforceFinancialAccess');

    var canonical = resolveRole_(actor.role);
    if (canonical === ROLES.CEO || canonical === ROLES.SYSTEM) return; // granted

    emitDenied_('FINANCIAL_ACCESS', actor, 'FINANCIAL_ACCESS_DENIED');
    throw new RBACError_(
      'FINANCIAL_ACCESS_DENIED',
      '"' + (actor.displayName || actor.email) + '" (' + canonical + ') ' +
      'does not have financial access. ' +
      'Only CEO and SYSTEM may execute payroll or direct billing ledger writes.',
      {
        email:      actor.email,
        personCode: actor.personCode,
        role:       canonical
      }
    );
  }

  /**
   * Returns true if the actor has financial access (CEO or SYSTEM).
   * Boolean version for conditional checks.
   *
   * @param {{ role: string }} actor
   * @returns {boolean}
   */
  function hasFinancialAccess(actor) {
    if (!actor || !actor.role) return false;
    var canonical = resolveRole_(actor.role);
    return canonical === ROLES.CEO || canonical === ROLES.SYSTEM;
  }

  // ============================================================
  // SECTION 12: PUBLIC — VALIDATION HELPERS
  // ============================================================

  /**
   * Returns true if the given string is a known canonical role.
   * Use before writing to DIM_STAFF_ROSTER to validate role values.
   *
   * @param {string} role
   * @returns {boolean}
   */
  function isValidRole(role) {
    return CANONICAL_ROLES.hasOwnProperty(resolveRole_(role));
  }

  /**
   * Returns true if the given string is a known action (canonical or alias).
   *
   * @param {string} action
   * @returns {boolean}
   */
  function isValidAction(action) {
    return ACTIONS.hasOwnProperty(action);
  }

  /**
   * Returns true if the given table name requires enforceFinancialAccess().
   *
   * @param {string} tableName  A Config.TABLES constant value
   * @returns {boolean}
   */
  function isFinancialTable(tableName) {
    return FINANCIAL_TABLES.hasOwnProperty(tableName);
  }

  // ── ROLE HIERARCHY HELPER ──────────────────────────────────
  /**
   * Returns true if roleA has strictly higher privilege rank than roleB.
   * Uses ROLE_HIERARCHY numeric rankings.
   *
   * Use for UI gating and reporting scope decisions — NOT as a
   * substitute for enforcePermission() in handlers.
   *
   * @param {string} roleA  ROLES value to test
   * @param {string} roleB  ROLES value to compare against
   * @returns {boolean}
   *
   * @example
   *   RBAC.roleRanksAbove(RBAC.ROLES.CEO, RBAC.ROLES.PM)    // → true
   *   RBAC.roleRanksAbove(RBAC.ROLES.PM, RBAC.ROLES.CEO)    // → false
   *   RBAC.roleRanksAbove(RBAC.ROLES.PM, RBAC.ROLES.ADMIN)  // → false (equal rank)
   */
  function roleRanksAbove(roleA, roleB) {
    var a = ROLE_HIERARCHY[resolveRole_(roleA)];
    var b = ROLE_HIERARCHY[resolveRole_(roleB)];
    if (a === undefined || b === undefined) return false;
    return a > b;
  }

  /**
   * Public wrapper for assertActorExists_().
   * Validates that an actor was produced by resolveActor() and has
   * all required fields. Use at the start of utility functions that
   * receive actor objects but don't call enforcePermission().
   *
   * @param {Object} actor  Actor object from resolveActor()
   * @throws {RBACError_}  INVALID_ACTOR or ACTOR_NOT_RESOLVED
   */
  function assertActorExists(actor) {
    assertActorExists_(actor, 'assertActorExists');
  }

  /**
   * Registers a hook function called on every denied action.
   * Called by Logger.gs (T3) during its own initialization.
   * Hook receives a single context object:
   *   { action, email, personCode, role, errorCode, timestamp }
   *
   * @param {Function} hookFn
   * @throws {RBACError_}  If hookFn is not a function
   */
  function setDeniedLogHook(hookFn) {
    if (typeof hookFn !== 'function') {
      throw new RBACError_(
        'INVALID_HOOK',
        'setDeniedLogHook() requires a function. Received: ' + typeof hookFn,
        {}
      );
    }
    _deniedLogHook = hookFn;
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {

    // ── Constants ─────────────────────────────────────────────
    ROLES:          ROLES,
    ACTIONS:        ACTIONS,
    SCOPES:         SCOPES,
    ROLE_HIERARCHY: ROLE_HIERARCHY,  // numeric rank map — read-only reference

    // ── Actor resolution ──────────────────────────────────────
    resolveActor:       resolveActor,       // email → full actor object
    getUserRole:        getUserRole,        // email → role string
    getScopeForRole:    getScopeForRole,
    assertActorExists:  assertActorExists,  // validates actor was resolver-produced

    // ── Permission checks (boolean) ───────────────────────────
    canPerform:         canPerform,         // (role, action) → boolean
    hasPermission:      hasPermission,      // (actor, action) → boolean

    // ── Permission enforcement (throws) ───────────────────────
    assertPermission:   assertPermission,   // (role, action) — for utility contexts
    enforcePermission:  enforcePermission,  // (actor, action) — USE IN HANDLERS

    // ── Financial gate (second layer) ─────────────────────────
    enforceFinancialAccess: enforceFinancialAccess,
    hasFinancialAccess:     hasFinancialAccess,

    // ── Role hierarchy ────────────────────────────────────────
    roleRanksAbove:     roleRanksAbove,     // (roleA, roleB) → boolean

    // ── Validation helpers ────────────────────────────────────
    isValidRole:        isValidRole,
    isValidAction:      isValidAction,
    isFinancialTable:   isFinancialTable,

    // ── Logging bridge ────────────────────────────────────────
    setDeniedLogHook:   setDeniedLogHook    // called by Logger.gs during init

  };

})();
