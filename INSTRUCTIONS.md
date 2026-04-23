# SC Tracker — How Everything Works

A plain-English tour of every section, what it's for, and how they connect.

---

## 🏠 Overview (Dashboard)
**What you see here**
- **KPI strip** — Live Activity · Open Jobs · Overdue · Floor Staff · Today's hours
- **Attention Banner** — amber bar with what needs looking at right now (overdue, stuck, long timers, duplicates)
- **Shop Flow Map** — horizontal map showing every workflow stage as a node
  - Numbers = open jobs at that stage
  - Glowing ring = workers currently clocked in on that stage
  - Flame icon = at least one job "stuck" (> 3 days at this stage)
  - Right panel = Open · Stuck · Live · Heaviest stage
  - Tap a node → drawer opens with the jobs inside, oldest first
- **Recent Moves** — ticker showing the last 8 stage transitions across the shop
- **Financial Overview** — monthly revenue / cost / profit / margin (only shows when shop rate is set)

**Connects to** → Jobs · Board · Live Floor

---

## 📋 Jobs
The master job list. Every PO / work order lives here.
- Create jobs manually or scan a PO with the camera (`Scan PO` button — uses AI to extract PO#, Part#, Qty, Due Date, Customer, Priority)
- **Mobile row** shows inline: `PartNumber · Qty N · Customer`
- **Tab bar** — Active / Completed / All · search by PO, part, or customer
- **Client Update** button — generates a status email for any customer based on their open jobs (no AI, templated)
- Tap a row → open the job detail modal with:
  - Stage pipeline (tap forward / back)
  - Part photo upload
  - Special Instructions · Notes · Attachments
  - Sub-task checklist
  - Part History (prior runs of the same part)
  - Operation-log / timesheet
  - Print Traveler button

**Connects to** → Board (same data, Kanban view) · Live Floor · Reports

---

## 🧱 Board (Kanban)
Same jobs as the Jobs list, rendered as columns per workflow stage.
- **Drag** any card between columns to advance / rewind its stage
- **Edit Stages** button in the header → jumps to Settings where columns are defined
- Filter by customer, priority, or completed-window
- Search matches PO / part / customer

**Connects to** → Jobs · Settings → Production

---

## 📅 Calendar
The Jobs list filtered to a month view of due dates. Click a day to see what's shipping.

---

## 📡 Live Floor
What's happening RIGHT NOW on the shop floor.
- Every active worker as a card with live timer, operation, PO, machine
- **TV Mode** button (top right) — goes full-screen, hides chrome, rotates through configurable slides (see Settings → TV Display)

**TV Mode slides** (configurable)
- Workers · Open Jobs · Weekly Leaderboard · Monthly Leaderboard · Goals · Weekly Stats · Weather · Flow Map · Safety · Announcement · Stats

Each slide has its own duration, sound, and visibility toggles.

---

## 📜 Logs
Historical timesheets. Every clock-in / clock-out / pause / session-quantity recorded.
- Filter by worker, operation, date range
- Edit any log (admin) if a worker forgot to clock out properly
- Export to CSV for payroll

---

## 💰 Quotes
Full quote → invoice pipeline.
- **Create quote** — line items with qty, unit price, margin calculator warnings
- **Process Library** — reusable line-item templates (Settings → Production)
- **Snippets** — saved text blocks for scope / notes / terms
- **Templates** — entire saved quote shells (most-used customers)
- **Pipeline Kanban view** — drag quotes between Draft → Sent → Accepted → Declined → Expired
- **Quantity-break pricing** — per-tier unit prices for a single line
- **Expiration countdown** — auto-lapse expired quotes to `expired`
- **Customer Portal link** — shareable URL customers visit to view + accept (engagement tracking built-in)
- **One-click Quote → Job** — accepted quote creates a job with routing stages pre-populated from Process Library tags

**Connects to** → Jobs (on accept) · Customer Portal · Settings → Documents

---

## 🖼️ Samples
Photo library of samples / first articles you've done. Search by part #, filter by customer. Workers can add from phone.

---

## ⚠️ Quality
Rework / NCR tracking.
- Report rework inline from any Job row (amber ⚠ button)
- Each entry: PO, part, customer, reason, quantity, status (open / in-rework / resolved)
- Quality report per customer / per operation

**Connects to** → Jobs · Reports

---

## 🚚 Deliveries *(new)*
GPS-tracked courier runs with auto mileage logging for taxes.
- **KPI strip** — Miles this month · Runs (30d) · Drivers (30d) · All-time miles
- **New Run**
  - Pick driver, add stops (address + customer + which jobs are on the truck)
  - **Address auto-fills** from saved customer contacts — typed addresses save back for next time
- **Active run card** (during a run)
  - Live GPS tracking starts when you hit Start
  - Mile counter updates every 30s
  - Each stop: **Open in Maps** (opens native Apple/Google Maps app — no API key needed) · **Arrived** button captures timestamp + lat/lon for proof
  - Finish → computes total miles via Haversine polyline, saves duration
- **History** — card rows with driver, date, stops, miles, duration · delete on hover
- **Export CSV** — IRS-ready mileage log with rate ($0.70/mi 2025 default) and $ amount per run

**How miles are computed** — breadcrumbs every 30s → Haversine between consecutive points → sub-30m jitter filtered → total saved to the run. Accurate enough for IRS. Driver must keep the app open (browser GPS doesn't run in the background on iOS).

**Connects to** → Jobs (stops reference jobs) · Customer contacts (addresses)

---

## 📊 Reports
Worker productivity + shop performance analytics.
- **KPI strip** — Total Hours · Sessions · Jobs Done · Revenue · Labor Cost · Margin
- **Shop Utilization** — % of weekly goal hit across all workers
- **Worker Productivity table** — hours, sessions, jobs, avg/session, cost, top operations per worker
- **Time window** — Week · Month · All · Custom

---

## 👥 Team
User management. Admins create / edit / deactivate workers. Set hourly rate per worker (drives labor-cost reports).

---

## 🔎 Work Station (kiosk)
Full-screen kiosk for shop-floor devices. Worker scans a job QR → picks their name → picks an operation → timer starts. Also the place supervisors use to manually start / stop timers for others.

---

## ⚙️ Settings (admin only)

### Shop Profile
Company name, logo, address, phone, industry packs enabled (Finishing / ISO / Assembly), charge basis.

### Schedule & Alarms
- **Break Alarms** — customizable lunch / break / shift-end alerts with audible sound + push notification
  - Each alarm: label, time, enabled, sound (School Bell / Chime / Triangle / Ship Bell / Air Horn / Siren / Silent), day-of-week chips, ring duration (1–30s), pause-timers flag, clock-out flag
  - Custom sound URL field (paste any MP3 / OGG)
  - Master on/off toggle
- **Auto-Pause Timers at Lunch** — global rule

### Production
- **Workflow Stages** — name, color, order. Drag to reorder. Mark "completed stage" for the terminus.
- **Operations → Stages mapper** — drag operations into stage columns so smart auto-routing knows "washing" = Washing stage
- **Operations** — your shop's operation list (added as you go or pre-defined)
- **Machines** — physical workstations
- **Process Library** — reusable quote line items tagged with stage (feeds auto-routing on quote → job)
- **Customers** — client list with saved contact info (name, email, phone, address). Used by Quotes + Deliveries + Client Update Generator.

### Financial
Shop rate, overhead per month, monthly work hours, default priority, weekly goal hours per worker.

### Goals
Custom shop goals (jobs/week, revenue, on-time %, rework limit). Shown on Overview + TV Goals slide.

### Documents
Sub-tabs: **Quote / Invoice** or **📋 Job Traveler**
- **Quote** — numbering, header, table columns, totals, comments, colors, watermark. Live preview on the right.
- **Traveler** — toggle every section (logo / QR / photo / instructions / notes / operation log / sign-off / due date / priority / customer), operation-log row count (4–20), optional header banner ("ITAR Controlled"), optional footer text. **Live preview on the right** shows a sample traveler with your settings applied.

### TV Display
TV slideshow editor: add / reorder / configure slides. Weather Location picker (manual city/zip overrides browser geolocation for smart TVs).

### System
Firebase status · operations count · version. (Dev-only panels: AI Status · Push Registration — hidden unless `?dev=1`)

---

## 🔗 How everything connects

```
         ┌───────────┐
         │  Customer │─── contacts, addresses ──┐
         └────┬──────┘                          │
              │                                 ▼
         ┌────▼──────┐    becomes     ┌──────────────┐
         │   Quote   │───────────────▶│     Job      │
         └───────────┘                └───┬──────────┘
                                          │
              ┌────────────┬──────────────┼────────────┬──────────────┐
              ▼            ▼              ▼            ▼              ▼
         ┌────────┐   ┌─────────┐   ┌──────────┐  ┌─────────┐   ┌────────────┐
         │ Board  │   │ Samples │   │ Time Log │  │ Quality │   │ Deliveries │
         │ stage  │   │ photos  │   │ hrs/cost │  │ rework  │   │ GPS miles  │
         └───┬────┘   └─────────┘   └────┬─────┘  └─────────┘   └────────────┘
             │                           │
             │     ┌───────────────┐     │
             └────▶│ Shop Flow Map │◀────┘
                   └───────┬───────┘
                           │
                           ▼
                  ┌──────────────┐
                  │   Reports    │  revenue · margin · utilization
                  └──────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │ Client Update Generator │  emails customer a status
              └─────────────────────────┘
```

**Key flows**

1. **Quote → Job** — An accepted quote creates a job. Process-library items on the quote set the routing stages on the new job.
2. **Clock-in → Stage advance** — When a worker clocks into an operation, if that operation is mapped to a stage (Settings → Production → Operations → Stages), the job auto-advances to that stage. Falls back to fuzzy name match (Deburring op → Deburring stage) if no explicit mapping.
3. **Job → Delivery** — When a delivery stop references a job, that job shows up in the run's "what's on the truck" list.
4. **Customer → Delivery address** — Customer contact address (saved in Settings → Customers, or auto-saved from a delivery) pre-fills future deliveries to the same customer.
5. **Job → Client Update** — The Client Update Generator in the Jobs header picks a customer, their open jobs, and a template, and produces a ready-to-send email / SMS with auto-filled status, dates, and stages.
6. **Shop rate + Hourly rate + Overhead → Cost per job** — Labor cost = worker hourly rate × logged minutes + overhead rate × logged hours. Profit = quoteAmount − cost. Shown everywhere (Reports, Overview, Job detail).

---

## 🔔 Alarms & Notifications

| Where the fire comes from | What it does | Works when app is closed? |
|---|---|---|
| **Break Alarm** (Settings → Schedule) | Audible bell + notification at a specific time | ✅ On Chrome/Android (via Notification Triggers API) · ⚠ On iOS, fires on next app open |
| **Long-running timer** (> 4hr) | Admin notification | Only while tab is open |
| **Morning clock-in** (8:15am) | Nudge workers to clock in | Only while tab is open |
| **End-of-shift** (10min before auto-clockout) | Warn before auto-clockout | Only while tab is open |
| **New urgent job** | Notifies subscribed devices | Only while tab is open |

**To get alerts when the app is closed:**
1. Install the PWA to your home screen (iOS: Share → Add to Home Screen · Android: Chrome menu → Install App)
2. Settings → Schedule → turn alarms ON — permission prompt will fire
3. Tap Allow

---

## 🏗️ Tech architecture (if you care)
- **Frontend** — React 19 + Vite + Tailwind (all dark mode)
- **Data** — Firebase Firestore when online, localStorage mirror for offline
- **Auth** — PIN-based (Team section)
- **PWA** — Service worker (`sw.js`) + manifest
- **AI** — Gemini via Netlify function proxy (key stays server-side) — used only for PO scanning
- **Print / PDF** — CSS `@media print` + browser native print (no jsPDF)
- **Maps / GPS** — `navigator.geolocation` for deliveries · Google Maps deep-link URLs (no API key)
- **Web Push** — self-hosted VAPID via Netlify function · Notification Triggers API for true offline alarms

---

## 🐛 Known limitations

- **iOS PWA alarms** — only fire on app open (catch-up within 30 min). Chrome/Edge Android + desktop fire even when app is fully closed.
- **Delivery GPS** — browser watchPosition pauses when iOS Safari is backgrounded. Driver must keep the tab open during the drive (plugged into car charger recommended).
- **Dark theme only** — light mode not implemented yet.
- **Single-tenant** — one shop per deployment. Multi-tenant (multiple shops on one instance) is planned but not built.

---

## 🆘 Common troubleshooting

**"Print Traveler shows blank"**
Was a print-CSS bug (fixed). If it happens again: open browser print preview, look for content — if the preview window shows content but the printer prints blank, it's a printer setting.

**"TV weather doesn't show"**
Smart TVs often don't share location. Settings → TV Display → Weather Location → enter your city or zip → Set. Every device on this account now uses that coordinate.

**"Alarms not firing when app is closed"**
On iOS, notifications only fire when the app is in the foreground or just after it's opened (catch-up). For true always-on alarms, use Chrome on Android or desktop.

**"Jobs missing from Flow Map"**
Legacy jobs without a `currentStage` field now fall back to their status — should show up. If they still don't, open the job and click a stage button once to set `currentStage` explicitly.

**"Client address not auto-filling on delivery"**
The address needs to be saved in the customer contact (Settings → Customers). Auto-save happens the first time you type an address for a customer on a delivery — from then on it pre-fills.
