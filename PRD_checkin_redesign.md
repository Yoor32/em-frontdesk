# PRD — Check-in Redesign: Class-Linked Check-ins + Attendance
**System:** EM Passport / bachatasensual.ca · Front Desk API (n8n `ufxpM1g6H35KGiKI`) + dashboard (`em-frontdesk` GitHub Pages)
**Date:** 2026-07-10 · **Status:** SHIPPED — backend published (version `2865848d`), all acceptance tests passed against live Notion; dashboard files ready for GitHub upload

## 1. Problem & why now
Check-ins are currently logged with no link to what the student attended. The Check-ins DB has a `Class` relation that is never written, so attendance per class is unknowable and per-class rosters can't be reconciled against bookings. This blocks attendance reporting and makes stamps unauditable.

## 2. Success criteria
1. Every new check-in row has a class/event link. `checkin` without one → 400, no row, no stamp.
2. Staff can pull a roster for a class and check students in individually or all at once, from the tablet, in under ~15 seconds.
3. Existing behavior preserved: member +1 stamp, non-member logged w/o stamp, dedupe guard, Toronto timestamps.
4. All acceptance tests (§8) pass against the live webhook with real records.

## 3. Environment verification (done 2026-07-10)
- ✅ Workflow `ufxpM1g6H35KGiKI` live; 12-rule switch + fallback; node structure matches the build doc exactly.
- ✅ Check-ins schema: `Check-in` (title), `Checked in by`, `Class` (relation → Classes `80874a5e…`), `Date`, `Stamps awarded`, `Student`.
- ✅ Bookings Log schema: `Student`, `Class`, `Event` (relation → Events collection `9d6495fd-7a02-4dc9-83c1-587455d78b18`), `Scheduled date`, `Booking status` (select: **New booking / Rescheduled / Cancelled**), `Booking ID`, `Package`, `Amount`, `Payment method`, `Payments`.
- ✅ Dashboard `index.html` in Drive (id `1Vijz98VBXQvgTxS_thttTPRFpCfXW97n`, `front-desk-dashboard` folder, last modified today).

## 4. Issues found in the build doc (need decisions — see §7)
- **D1 — Events can't be linked as specified.** The doc says write "the Class (or Event) relation" on Check-ins. The Check-ins DB has **no Event relation** — only `Class`, scoped to the Classes DB. A Notion relation can't hold a page from another database. Either we add an `Event` relation property to Check-ins, or v1 is classes-only.
- **D2 — 45-min dedupe scoped "per student" conflicts with the feature itself.** A student taking back-to-back classes (common at a dance studio) would be blocked from checking into the second class. If attendance is now per-class, the dedupe should arguably be per **student + class**. Stamp policy question hiding inside: does a two-class night earn 1 stamp or 2?
- **D3 — Roster scope is undefined.** "Students who have a Booking for that class" — bookings have status and `Scheduled date`. All non-cancelled bookings ever? Only today's scheduled date? For recurring classes with package bookings, "today only" may return nobody.

## 5. Scope
**In:** `checkin` (modified), `roster` (new), `bulkcheckin` (new); dashboard popup class-picker + "Take attendance" card; SW cache bump; full workflow rebuild from SDK code (per doc — avoids switch output-index drift); end-to-end tests.
**Out (explicitly):** Stripe workflows/credentials, live cutover, reports API, Classes/Events catalog data, PIN/auth changes, historical check-in backfill (old rows stay class-less).

## 6. Design
### 6.1 API changes (`POST /webhook/front-desk`, body `{pin, action, ...}`)
**`checkin` (modified)** — requires `classId` + `itemType` (`class`|`event`, default `class`). Missing/empty → `400 {ok:false, error:"Select a class"}`, no side effects. Flow: validate → find student → dedupe check (scope per D2) → stamp calc (member +1) → create Check-in row **with relation set** → update stamps. Relation value per SDK gotcha: `["={{ classId }}"]`, never bare conditionals; IF-branch when relation could be empty.

**`roster` (new)** — input `{classId, itemType?}`. Query Bookings where Class (or Event, per D1/D3) contains the id, filter per D3 decision, resolve linked Students, and for each compute `checkedInToday` = has a Check-in row today (Toronto day) linked to this same class. Returns `{ok:true, students:[{studentId, name, passport, member, checkedInToday}]}`. Empty roster → `ok:true, students:[]` (not an error).

**`bulkcheckin` (new)** — input `{classId, itemType, studentIds:[]}`. Per student, run identical check-in logic (link + stamp + dedupe); failures don't abort the batch. Returns `{ok:true, results:[{studentId, ok, message}]}`. Implementation: single code-node loop performing the per-student Notion ops sequentially (n8n Notion nodes don't batch cleanly per-item with divergent branches; a loop keeps per-student results ordered and isolated).

### 6.2 Workflow rebuild
Fetch current workflow → regenerate entirely from SDK code with 14 rules (`roster`, `bulkcheckin` appended before fallback; fallback stays LAST) → `validate_workflow` → `test_workflow` with pinned data (validates routing/code only — Notion nodes get simulated data) → publish → archive old version → real `execute_workflow`/live webhook calls to confirm actual Notion writes. SDK prep: `get_sdk_reference`, `get_workflow_best_practices`, `search_nodes`, `get_node_types` first; no arrows/`.map()` in builder code; database **page** ids in Notion nodes (not collection ids).

### 6.3 Dashboard
- `qaCheckin()` (popup): insert class-picker step reusing the `qaEnrollForm()` catalog-picker pattern → call `checkin` with `classId`/`itemType`.
- New "Take attendance" card in `TABS.classes.acts`: pick class from `catalog` → `roster` list with per-student "Check in" buttons + "Check in all" (`bulkcheckin`) → live per-student result states.
- Bump `sw.js` `CACHE` (`em-frontdesk-v7` → `v8`). Owner re-uploads `index.html` (and `sw.js`) via GitHub web UI; verify on `bachatasensual.ca/staff`.

### 6.4 Rollout & reversibility
Old workflow version archived (restorable via `restore_workflow_version`). Dashboard change is a manual upload — old file recoverable from git history. **Sequencing risk:** once the new workflow is live, the *old* dashboard sends `checkin` without `classId` → every popup check-in 400s until the new `index.html` is uploaded. Publish backend and hand off frontend in the same sitting; treat the gap as planned downtime for check-ins (minutes).

## 7. Decisions (resolved with Georgi, 2026-07-10)
- **Q1 (D1) → Add `Event` relation to Check-ins DB** (→ Events & Workshops, collection `9d6495fd…`). `checkin`/`roster`/`bulkcheckin` support `itemType` = `class`|`event`; `class` writes `Class`, `event` writes `Event`.
- **Q2 (D3) → Roster = all bookings for that class/event with status ≠ Cancelled**, regardless of date.
- **Q3 (D2) → Dedupe per student + class**: same student + same class/event within 45 min = blocked; a different class within 45 min = allowed, and members earn a stamp per class attended.

## 8. Acceptance tests
1. `checkin` no class → 400 "Select a class", no row.
2. `checkin` member + class → row with Class relation, +1 stamp, Toronto timestamp.
3. Same student <45 min (same class) → blocked, no dupe/stamp.
4. `checkin` non-member + class → logged, 0 stamps.
5. `roster` for class with ≥2 booked students → correct list + `checkedInToday` flags.
6. `bulkcheckin` → per-student class-linked check-ins, members stamped, dupes skipped, results array correct.
7. Front end: popup asks for class then checks in; attendance card end-to-end; SW cache bumped; verified on `/staff`.
8. *(per Q3)* Back-to-back second class behaves per decision.
9. *(per Q1, if events in)* Event check-in links correctly.
10. Regression: `catalog`, `enroll`, `today`, `student`, `search`, `payment`, `membership`, `renew`, `refund`, `reward`, `intake` all still respond correctly after rebuild.

## 9. Do NOT touch
Stripe, live cutover, reports API, catalog data. Preserve owner record **EM-0004 (Jorge Ortiz)**.
