# Feedback & Performance Rating Rules — BLC Nexus

## Client Feedback System (T9 — src/09-feedback/)
- Module: `ClientFeedback.gs` + `ClientFeedbackTrigger.gs`
- **Flow**: CEO clicks "Send Feedback Requests" → Google Form created via FormApp → one email per client with pre-filled links (one per designer) → client submits → `onFeedbackFormSubmit` trigger → `STG_PROCESSING_QUEUE` → QueueProcessor → `ClientFeedback.processFeedbackResponse()` → `FACT_CLIENT_FEEDBACK`
- Form created per quarter, stored via Script Properties (`FEEDBACK_FORM_{periodId}`)
- Score: 1–5 linear scale → normalized 0–100 via `(raw-1)/4*100`
- `getFeedbackSummary(periodId)` returns per-designer average for quarterly bonus engine
- **One-time setup**: run `installFeedbackTrigger()` from Apps Script editor after first form is created
- Designer→client mapping from `REF_ACCOUNT_DESIGNER_MAP` — NOT from FACT_WORK_LOGS

---

## Performance Rating Rules (TL/PM/CEO quarterly ratings)

### Who rates whom
| Rater | Rates | How determined |
|---|---|---|
| CEO | All active TLs + PMs | `role = TEAM_LEAD or PM` |
| TEAM_LEAD | All direct reports (any role) | `supervisor_code = TL's person_code` |
| PM | All active DESIGNERs in the org | `pm_code = PM's person_code AND role = DESIGNER` |

- TLs can have other TLs as direct reports (e.g. SVN/PBG report to SDA via `supervisor_code=SDA`)
- TLs are rated by CEO only — not by PM
- A designer is rated by **both** their TL and their PM (two separate rows in FACT_PERFORMANCE_RATINGS per designer per period)
- A TL with no direct reports gets no email and rates no one

### Rating request emails (`sendRatingRequests`)
- CEO → 1 email listing all TLs + PMs (sent to CEO's own email)
- Each TL → 1 email listing their direct reports by name
- PM → 1 email listing all designers under them by name
- TLs with no direct reports are skipped
- All emails contain: `PORTAL_BASE_URL?page=rate-staff&period=periodId`
- Portal `getMyRatees()` filters correct ratees based on logged-in user's role

### Portal `getMyRatees()` logic
- CEO: all active staff with `role = TEAM_LEAD or PM`
- TEAM_LEAD: all active staff where `supervisor_code = actor.personCode` (any role)
- PM: all active staff where `pm_code = actor.personCode AND role = DESIGNER`

---

## Stored In
- Client feedback → `FACT_CLIENT_FEEDBACK`
- TL/PM ratings → `FACT_PERFORMANCE_RATINGS`
- Error rate derived from `FACT_QC_EVENTS` rework_cycle counts per designer per period
