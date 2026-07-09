# EM Passport — Front-Desk Dashboard

Single-file web app for the registration desk at 20 Mod. Runs on GitHub Pages, embedded in a private page of bachatasensual.ca (Duda). Backend: n8n "Front Desk API" workflow → Notion Studio CRM.

## Deploy (once, ~10 min)

1. Create a GitHub repo (e.g. `em-frontdesk`), upload `index.html`.
2. Repo → Settings → Pages → Source: `main` branch, root. Wait for the `https://USER.github.io/em-frontdesk/` URL.
3. In Duda: create page `/staff` → Page settings → **password-protect it** → add an HTML embed widget:
   ```html
   <iframe src="https://USER.github.io/em-frontdesk/" style="width:100%;height:100vh;border:0"></iframe>
   ```
4. **Change the staff PINs** in n8n → "Front Desk API" workflow → "Auth & Route" node (one PIN per person; delete a line to revoke someone).
5. **Stripe links are generated live** — no static links to paste. The desk creates checkout links on demand via the n8n "Stripe Checkout Link Generator" (`LINK_URL`). At go-live, swap the two **TEST** price IDs in `PLAN_PRICE` (top of `index.html`) for the **LIVE** price IDs (from re-running "Stripe Setup" in live mode), and keep `LINK_SECRET` in sync with the n8n "Build Session Body" node.

## Stripe payments (how it works)

- **Record payment** (in a student popup) = log cash/e-transfer already taken → writes to the Payments DB.
- **💳 Generate Stripe link** (payment form, membership signup, and the Payments-tab "Stripe pay links" panel) = calls the n8n link generator → opens a real Stripe Checkout link. When the customer pays, the **Stripe → Notion Payment Sync** records the payment (deduped, student-matched) and the **Stripe Subscription → Memberships Sync** creates/updates the membership + Member flag — no manual entry.
- One-off presets (drop-in, assessment, workshop, course) + a custom amount, plus recurring **EM Passport / EM Family** subscription links.

## Security model

- The HTML contains **no secrets**. Staff enter a PIN per session (kept in sessionStorage, cleared on Lock).
- Every API call is validated server-side in n8n. Wrong PIN → 401 and the app locks itself.
- Two walls: Duda page password (who can see the app) + per-staff PIN (who can act).

## Layout (v2 — FitKid-style, adapted for EM Passport)

A global search bar, four tab pills with action-count badges, a card grid of quick actions per tab, and an "ask the assistant" bar (reserved for the future AI chatbot). Modelled on the FitKid Gymnastic staff dashboard, re-mapped from their credit/attendance model to EM's course + membership + passport/stamp model.

| Tab | Quick actions |
|---|---|
| 🕺 **Check-in & Classes** | Check in (★ frequent) · Today's classes · Find student · Class calendar (→ Notion) |
| 👤 **Students & Passport** | New student (★) · Passport & rewards (profile + QR + deliver reward) · Start membership · All students (→ Notion) |
| 💳 **Payments** | Record payment (★ cash/e-transfer/card) · Stripe pay links · Membership signup · Payments ledger (→ Notion) |
| 📊 **Reports** | Today's summary · Payments ledger · Active members · Win-back list (all → Notion CRM views) |

### Live vs. link
- **Live API actions** (write to the CRM via n8n): check in, today, find student, deliver reward, new student, **record payment**, **start membership**.
- **Deep-links** open the matching Notion Studio CRM view (reports, ledgers, calendars) — read/analyse in Notion, act at the desk in the dashboard.

## Backend actions (Front Desk API v2)

`checkin · intake · today · student · reward · payment · membership` — all PIN-authenticated. `payment` and `membership` take a `studentId` (obtained from a prior `student` lookup), so the desk flow is: find student → then record payment / start membership.

Reward ladder v2 (10/20/40/60/80/100/150) and all validation (member check, stamp threshold, double-claim, duplicate check-in) are enforced **server-side** in n8n. The ladder in `index.html` is display-only — change both together.

## Student popup dashboard (v3)

Recycled from the FitKid Gymnastic staff PWA (their `fichaAlumno` pattern), re-skinned to EM black & gold:

- **Live search** — type a name in the top bar (≥2 chars, debounced); a dropdown of matching students appears (avatar, passport #, member, stamps). Powered by the new `search` API action.
- **Click a student → popup dashboard** — a modal overlay with everything at a glance: name, passport #, email, member badge, **stamp progress bar**, scannable **QR of the passport #**, status, rewards-delivered count and history, and pending-reward "Deliver" buttons.
- **Quick actions in the popup** — Check in · Record payment (inline form) · Start membership (for non-members) / Open full record in CRM (for members). Actions call the live API and the popup refreshes in place (tested: check-in bumped stamps 10 → 11 live).

### Full student record (v4)

Opening a student now shows the whole record in one popup:
- **Membership status** (plan · state · renews date) and **payment status** (green = paid, red = failed/attention).
- **Upcoming classes & services** — the student's future bookings, dated.
- **Recent payments** — last 5, with amount (refunds shown negative/red) and status.
- **Quick actions:** Check in · **Sign up (class/event)** · Record payment · **Renew membership** / Start membership · **Refund** · Full record (CRM). Every action runs live and the popup refreshes in place.

**Sign up** pulls the live catalog (`catalog` action → active classes/courses/privates + events) into a picker, auto-fills the member-or-standard price, lets the desk set a date/time and method, and creates a linked booking. Backend actions added: `search`, `catalog`, `renew`, `refund`, `enroll` (plus the enriched `student`).

## v5 — "+ More actions" + weekly/monthly reports

**"+ More actions" in the student popup.** The popup shows 4 primary actions (Check in · Record payment · Sign up · Start/Renew membership) and a **＋ More actions** toggle that reveals the full toolkit, context-aware for members: 💳 Stripe pay link · 🔗 membership subscription link · 🎁 deliver reward (members) · ⭐ add/change plan (members) · ↩️ refund · 🏷️ comp membership · 🗂️ full record (CRM). Every action writes to the CRM through the existing Front Desk API / link generator.

**Billing guardrail.** "Start membership" / "Add-change plan" go straight to the **Stripe subscription link** (automatic monthly billing) — there is no comp button on that form. The **comp / no-billing** membership lives only under ＋ More actions ("🏷️ Comp membership"), behind a red warning and a confirm dialog, so staff can't accidentally create a member who is never charged. Only the Stripe subscription link sets up recurring billing; the comp path records a member in the CRM with no Stripe charge.

**Weekly & monthly reports.** The Reports tab has **Weekly report** and **Monthly report** cards. They call the new **EM Reports API** (`REPORT_URL` → `/webhook/em-report`), which aggregates the trailing 7 / 30 days: net/gross/refund revenue with a by-method split and payment list, new students (member split), attendance (check-ins, unique students, stamps), and memberships (active / cancelled / new, by plan). Includes a week/month toggle and a Print / save-as-PDF button. Read-only; PIN-authenticated. The Reports API's PIN list must be kept in sync with the Front Desk API's "Auth & Route" node.

## PWA (installable)

`manifest.webmanifest` + `sw.js` + `icon.svg` make the dashboard installable on the front-desk tablet ("Add to Home Screen") and cache the app shell for a fast, resilient load. The service worker **never caches API calls** — live data always hits the network.

## The "ask the assistant" bar
Reserved hook for the next phase: the AI customer-service chatbot will answer from the Knowledge Base DB and log to the Conversations DB. The bar is visible but inert until that workflow ships.
