// ============================================================
// WorkLogReminder.gs — BLC Nexus T9 Notifications
// src/09-notifications/WorkLogReminder.gs
//
// LOAD ORDER: T9. Loads after T0–T8.
// DEPENDENCIES: Config (T0), DAL (T1), Logger (T3)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Fires daily at ~9 PM IST (Mon–Sat).                    ║
// ║  Finds designers with IN_PROGRESS jobs who have not     ║
// ║  logged any hours for today, then sends:                ║
// ║    • Email to the designer                              ║
// ║    • CC to their supervisor                             ║
// ║    • Telegram message if telegram_chat_id is set        ║
// ║      in DIM_STAFF_ROSTER and TELEGRAM_BOT_TOKEN is      ║
// ║      set in Script Properties                           ║
// ║                                                         ║
// ║  Entry points (top-level, trigger-safe):                ║
// ║    runWorkLogReminder()                                 ║
// ║    runInstallWorkLogReminderTrigger()                   ║
// ║    runRemoveWorkLogReminderTrigger()                    ║
// ║    runTestWorkLogReminder()  — manual dry-run           ║
// ╚══════════════════════════════════════════════════════════╝
//
// TRIGGER SETUP:
//   Script timezone = America/Regina (CST = UTC-6)
//   9 PM IST = 3:30 PM UTC = 9:30 AM CST → atHour(9)
//   Fires Mon–Sat; Sunday is skipped in code.
//
// TELEGRAM SETUP (optional):
//   1. Create a bot via Telegram BotFather → get token
//   2. Set Script Property: TELEGRAM_BOT_TOKEN = <token>
//   3. Each designer starts a chat with the bot, sends /start
//   4. Retrieve their chat_id and store in DIM_STAFF_ROSTER
//      column: telegram_chat_id
//
// ============================================================

var WorkLogReminder = (function () {

  var MODULE = 'WorkLogReminder';

  // IST is UTC+5:30
  var IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

  // ── Helpers ──────────────────────────────────────────────

  /** Returns today's date in IST as YYYY-MM-DD */
  function todayIST_() {
    var d = new Date(Date.now() + IST_OFFSET_MS);
    return d.toISOString().substring(0, 10);
  }

  /** Returns YYYY-MM from a YYYY-MM-DD string */
  function periodFromDate_(dateStr) {
    return dateStr.substring(0, 7);
  }

  /** Builds a lookup map from an array of roster rows keyed by person_code */
  function buildRosterMap_(roster) {
    var map = {};
    for (var i = 0; i < roster.length; i++) {
      map[String(roster[i].person_code || '').trim()] = roster[i];
    }
    return map;
  }

  // ── Core logic ───────────────────────────────────────────

  /**
   * Main check: finds active designers who have not logged hours today
   * and sends reminders. Returns summary for logging.
   *
   * @param {boolean} dryRun  If true, logs but does not send messages
   * @returns {{ checked: number, reminded: number, skipped: number }}
   */
  function checkAndNotify_(dryRun) {
    var today = todayIST_();
    var period = periodFromDate_(today);

    // 1. Designers with at least one IN_PROGRESS job today
    var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
    var activeDesignerCodes = {};
    for (var i = 0; i < vwRows.length; i++) {
      if (String(vwRows[i].current_state || '').trim() === Config.STATES.IN_PROGRESS) {
        var code = String(vwRows[i].allocated_to || '').trim();
        if (code) activeDesignerCodes[code] = true;
      }
    }

    var activeCodes = Object.keys(activeDesignerCodes);
    if (activeCodes.length === 0) {
      Logger.info('WORK_LOG_REMINDER_NO_ACTIVE_JOBS', { module: MODULE, date: today });
      return { checked: 0, reminded: 0, skipped: 0 };
    }

    // 2. Who has already logged today?
    var loggedTodayCodes = {};
    try {
      var logs = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
        callerModule: MODULE,
        periodId:     period
      });
      for (var j = 0; j < logs.length; j++) {
        if (String(logs[j].work_date || '').trim() === today) {
          loggedTodayCodes[String(logs[j].person_code || '').trim()] = true;
        }
      }
    } catch (e) {
      if (e.code !== 'SHEET_NOT_FOUND') throw e;
      // No work log partition yet this period — nobody has logged
    }

    // 3. Load roster for name + email + supervisor lookup
    var roster = DAL.readAll('DIM_STAFF_ROSTER', { callerModule: MODULE });
    var rosterMap = buildRosterMap_(roster);

    // 4. Send reminders
    var reminded = 0;
    var skipped  = 0;

    for (var k = 0; k < activeCodes.length; k++) {
      var personCode = activeCodes[k];

      if (loggedTodayCodes[personCode]) { skipped++; continue; }

      var designer = rosterMap[personCode];
      if (!designer || designer.active === false || designer.active === 'false') {
        skipped++;
        continue;
      }

      var supervisor = designer.supervisor_code ? rosterMap[designer.supervisor_code] : null;
      var pm         = designer.pm_code         ? rosterMap[designer.pm_code]         : null;

      if (dryRun) {
        Logger.info('WORK_LOG_REMINDER_DRY_RUN', {
          module:      MODULE,
          person_code: personCode,
          name:        designer.name,
          email:       designer.email,
          supervisor:  supervisor ? supervisor.email : 'none',
          date:        today
        });
      } else {
        sendEmail_(designer, supervisor, pm, today);
        sendTelegram_(designer, today);
      }

      reminded++;
    }

    Logger.info('WORK_LOG_REMINDER_COMPLETE', {
      module:   MODULE,
      date:     today,
      checked:  activeCodes.length,
      reminded: reminded,
      skipped:  skipped,
      dry_run:  dryRun || false
    });

    return { checked: activeCodes.length, reminded: reminded, skipped: skipped };
  }

  // ── Email ─────────────────────────────────────────────────

  function sendEmail_(designer, supervisor, pm, date) {
    var name    = designer.name || designer.person_code;
    var portalUrl = PropertiesService.getScriptProperties().getProperty('PORTAL_BASE_URL') || '';

    var subject = '[BLC] Reminder: Please log your hours for ' + date;

    var body = 'Hi ' + name + ',\n\n'
      + 'This is a friendly reminder that you have not logged your work hours for today (' + date + ').\n\n'
      + 'Please log your hours in the BLC Portal as soon as possible:\n'
      + portalUrl + '\n\n'
      + 'If you did not work today, no action is needed.\n\n'
      + 'Blue Lotus Consulting\n'
      + '— This is an automated message';

    var ccEmails = [];
    if (supervisor && supervisor.email && supervisor.email !== designer.email) {
      ccEmails.push(supervisor.email);
    }
    if (pm && pm.email && pm.email !== designer.email && ccEmails.indexOf(pm.email) === -1) {
      ccEmails.push(pm.email);
    }

    try {
      MailApp.sendEmail({
        to:      designer.email,
        cc:      ccEmails.join(','),
        subject: subject,
        body:    body,
        name:    'BLC Nexus'
      });
    } catch (e) {
      Logger.error('WORK_LOG_REMINDER_EMAIL_FAIL', {
        module:      MODULE,
        person_code: designer.person_code,
        error:       e.message
      });
    }
  }

  // ── Telegram ──────────────────────────────────────────────

  function sendTelegram_(designer, date) {
    var chatId = String(designer.telegram_chat_id || '').trim();
    if (!chatId) return;

    var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN') || '';
    if (!token) return;

    var name = designer.name || designer.person_code;
    var portalUrl = PropertiesService.getScriptProperties().getProperty('PORTAL_BASE_URL') || '';

    var message = 'Hi ' + name + '! This is your BLC reminder: you have not logged work hours for today ('
      + date + '). Please log via the portal: ' + portalUrl;

    try {
      UrlFetchApp.fetch(
        'https://api.telegram.org/bot' + token + '/sendMessage',
        {
          method:      'post',
          contentType: 'application/json',
          payload:     JSON.stringify({ chat_id: chatId, text: message }),
          muteHttpExceptions: true
        }
      );
    } catch (e) {
      Logger.warn('WORK_LOG_REMINDER_TELEGRAM_FAIL', {
        module:      MODULE,
        person_code: designer.person_code,
        error:       e.message
      });
    }
  }

  // ── Trigger management ────────────────────────────────────

  function installTrigger_() {
    var existing = ScriptApp.getProjectTriggers();
    for (var i = 0; i < existing.length; i++) {
      if (existing[i].getHandlerFunction() === 'runWorkLogReminder') {
        ScriptApp.deleteTrigger(existing[i]);
      }
    }
    // 9 PM IST = 3:30 PM UTC = 9:30 AM CST (America/Regina)
    // GAS fires within the hour window: atHour(9) = 9:00–10:00 AM CST = 8:30–9:30 PM IST
    ScriptApp.newTrigger('runWorkLogReminder')
      .timeBased()
      .everyDays(1)
      .atHour(9)
      .nearMinute(30)
      .create();

    Logger.info('WORK_LOG_REMINDER_TRIGGER_INSTALLED', { module: MODULE });
  }

  function removeTrigger_() {
    var existing = ScriptApp.getProjectTriggers();
    for (var i = 0; i < existing.length; i++) {
      if (existing[i].getHandlerFunction() === 'runWorkLogReminder') {
        ScriptApp.deleteTrigger(existing[i]);
      }
    }
    Logger.info('WORK_LOG_REMINDER_TRIGGER_REMOVED', { module: MODULE });
  }

  // ── Public API ────────────────────────────────────────────

  return {
    run:            function (dryRun) { return checkAndNotify_(dryRun || false); },
    installTrigger: installTrigger_,
    removeTrigger:  removeTrigger_
  };

})();

// ── Top-level entry points (trigger + manual) ─────────────

/** Daily trigger handler — skip Sunday automatically */
function runWorkLogReminder() {
  if (new Date().getDay() === 0) return; // 0 = Sunday
  try {
    WorkLogReminder.run(false);
  } catch (e) {
    Logger.error('WORK_LOG_REMINDER_FATAL', { module: 'WorkLogReminder', error: e.message });
  }
}

/** Run from Apps Script editor to install the daily trigger */
function runInstallWorkLogReminderTrigger() {
  WorkLogReminder.installTrigger();
  console.log('Work log reminder trigger installed — fires daily ~9 PM IST, Mon–Sat');
}

/** Run from Apps Script editor to remove the trigger */
function runRemoveWorkLogReminderTrigger() {
  WorkLogReminder.removeTrigger();
  console.log('Work log reminder trigger removed');
}

/**
 * Dry-run — logs who WOULD receive a reminder without sending anything.
 * Run from Apps Script editor to verify before going live.
 */
function runTestWorkLogReminder() {
  var result = WorkLogReminder.run(true);
  console.log('Dry run complete — checked: ' + result.checked
    + ', would remind: ' + result.reminded
    + ', already logged / inactive: ' + result.skipped);
}
