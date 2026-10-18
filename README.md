# Plus — Teacher App

Timetable, one-tap attendance, fee tracking and automatic parent updates for
private tuition teachers. One system, three views: **Teacher**, **Parent** and
**Student**.

Built from the *Plus Teacher App* build guide. This is the working version: a
real PostgreSQL database, server-checked logins, a money ledger, real WhatsApp
sending and a scheduled job for fee reminders.

**Live:** <https://plus-teacher-app.vercel.app>

| Sign in as | Code | Opens |
| --- | --- | --- |
| Teacher | `1234` | Nimal Sir — 17 students, 11 classes, 8 weeks of history |
| Parent / Student | `3333` | Kasun Perera — owes 4 classes, LKR 6,000 |
| Parent / Student | `4444` | Amaya Jayasinghe — all paid, top of the leaderboard |
| Parent / Student | `5555` | Dilini **and** Nimali Silva — one code, two children |
| Parent / Student | `6666` | Ravi Fernando — a bank slip waiting to be confirmed |

The same code opens both the Parent and the Student view; switch with the pill
at the top right. The sign-up form is at
[`/join?t=nimal`](https://plus-teacher-app.vercel.app/join?t=nimal).

Those codes are printed on the login screen because `DEMO_HINT=1` is set. Turn
it off, and raise `CODE_LENGTH` to 6, before a real teacher uses this.

```
Browser (PWA)  ──►  /api/* on Vercel  ──►  Supabase PostgreSQL + Storage
   static files        serverless            row level security on,
   no build step       service role          anon key can read nothing
```

---

> The data behind that deployment is demo data. `npm run seed:fresh` rebuilds
> it at any time.

## Table of contents

1. [What works](#1-what-works)
2. [Set it up (30 minutes)](#2-set-it-up-30-minutes)
3. [Deploy to Vercel](#3-deploy-to-vercel)
4. [Run it locally](#4-run-it-locally)
5. [How it is put together](#5-how-it-is-put-together)
6. [The database](#6-the-database)
7. [Security](#7-security)
8. [WhatsApp](#8-whatsapp)
9. [The scheduled job](#9-the-scheduled-job)
10. [Tests](#10-tests)
11. [Environment variables](#11-environment-variables)
12. [Decisions and known limits](#12-decisions-and-known-limits)

---

## 1. What works

**Teacher** — Today's classes · Google-style calendar: Month with an agenda
under it, Day and Week on an hour grid with a now-line, side-by-side
overlapping classes, a tappable empty slot and a "+" button · recurring and
one-off classes, individual or group, at an institute or your own place ·
a time-slot picker with a clash check · edit one day or all days · press and
hold a class to drag it to another time or day, which asks before it tells the
parents · cancel a single day · Start class / End class with a live timer, real clock times and
an absent message to each parent · fee ledger with FIFO allocation, days late,
part payments, cash / bank transfer / online, receipts, Undo, bank-slip
confirmation · marks and progress reports · income dashboard by day/week/month
with per-class breakdown · test-paper shop with profit · sign-up links and
family codes · English/Tamil · Night/Day/Auto.

**Parent** — next class · attendance with the last eight results · average mark ·
rank · progress chart · leaderboard (masked) · amount due with days late · send
a bank-slip photo · payment history · ask to reschedule · the teacher's updates
feed · switch between children on one code · switch to the Student view.

**Student** — up next · streak, average, present % · 90 % attendance goal ·
this week's classes · every mark with a chart · practice papers via signed links.

**Income (teacher)** — a fifth tab for the teacher's Plus income, which is a
different thing from the fee ledger beside it: how fast Plus is growing
against tuition, students on Plus month by month, the next goal and who is
left to invite, class by class. A QR code the class scans off the teacher's
phone, with the same invite as a WhatsApp message in English, Tamil or
Sinhala. No rupee amounts anywhere on it, by design.

**Plus team** — a six-screen onboarding wizard at `/onboard?k=<key>` that
creates a teacher, their subjects and their classes in one sitting, and shows
their login code once at the end.

**Public** — a sign-up form at `/join?t=<key>` that needs no login: four short
steps with a progress bar, Back and Submit fixed at the bottom, a check page,
and an optional photo shrunk on the phone before it is sent.

**Everywhere** — the app is locked at one zoom level and installs full screen ·
one spacing scale and one height for every field and button · a full-screen
code keypad · phone numbers are entered as `77 123 4567` beside a fixed `+94`
and stored as `94771234567`.

Everything a teacher does writes an event, which is what the family sees and
what gets sent to WhatsApp.

---

## 2. Set it up (30 minutes)

You need a free [Supabase](https://supabase.com) project and a free
[Vercel](https://vercel.com) account. Nothing else — the app has **no npm
dependencies** and no build step.

### Step 1 · Create the Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Pick a region near your users (for Sri Lanka, Singapore or Mumbai).
3. Wait for it to finish starting.

### Step 2 · Create the tables

Either paste it in, or push it from the command line.

**By hand:** open **SQL Editor** → **New query**, paste the whole of
[`supabase/schema.sql`](supabase/schema.sql) and press **Run**.

**From the command line:** put the **Session pooler** URL from
**Connect → Session pooler** into `.env` as `DATABASE_URL`, then:

```bash
npm run db:push       # applies schema.sql as one transaction
npm run db:verify     # checks the rules against the real database
```

Use the *session pooler* URL, not the direct one: `db.<ref>.supabase.co` has
only an AAAA record, so a network without IPv6 cannot reach it at all.

Either way you get every table, the views that hold the business rules, the two
transactional functions, the two private storage buckets, and row level
security switched on. Both are safe to run again later — `db:push` sends the
file as a single implicit transaction, so a failure changes nothing.

### Step 2a · Upgrading a database from v1

If the tables are already there from an earlier release, you do **not** need to
start again. `supabase/schema.sql` brings an old database up to date on its
own — every change is written so that running it twice is safe — so
`npm run db:push` is all it takes.

To apply only the new part, run `supabase/migrations/002-app-v2.sql` in the
Supabase SQL editor instead. It adds:

| Table      | What is new                                                        |
| ---------- | ------------------------------------------------------------------ |
| `teachers` | `own_place_name`, `own_place_area` — your own teaching place        |
| `students` | `call_name`, `ambition`, `parent_occupation`, `photo_path`          |
| `classes`  | `kind`, `venue_type`, `venue_name`, `area` — individual or group    |
| `sessions` | `started_at`, `ended_at` — when the class really ran                |
| `payments` | `receipt_no`, `reversed_at`, and `Online` as a method               |

plus `start_class()` and `reverse_payment()`, a `photos` bucket, and a wider
`record_payment()` that answers with the receipt. Existing rows are filled in:
a class with one student becomes `individual`, everything else `group`, and
old payments are numbered in the order they were taken.

**Run it before you deploy the new code.** The app reads these columns, so the
old schema with the new code shows blank venues and a broken Paid button.
`npm run db:verify` names anything that is missing.

### Step 3 · Collect your keys

**Project Settings → API**:

| You need | Where |
| --- | --- |
| Project URL | *Project URL* |
| `service_role` key | *Project API keys* → `service_role`, **secret** |

> The `service_role` key bypasses every access rule. It belongs only in your
> `.env` and in Vercel's environment variables — never in the browser, never in
> a commit.

### Step 4 · Write your `.env`

```bash
cp .env.example .env
```

Fill in `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`, then generate the two
secrets:

```bash
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('LOGIN_PEPPER='   + require('crypto').randomBytes(32).toString('hex'))"
```

`LOGIN_PEPPER` is part of how login codes are hashed. **If you change it, every
existing code stops working** — keep the same value for the life of the
deployment.

### Step 5 · Add the demo data

```bash
npm run seed
```

It prints the login codes it created:

```
  Teacher          1234   (Nimal Sir)
  Parent/Student   3333   (Perera family: Kasun Perera)
  Parent/Student   4444   (Jayasinghe family: Amaya Jayasinghe)
  Parent/Student   5555   (Silva family: Dilini Silva, Nimali Silva)
  ...
```

`npm run seed:fresh` rebuilds it from scratch.

The seed is not a set of pretty numbers: it generates eight weeks of real
history — one session row per past class, one attendance row per student, one
charge per student who was present, then payments on top. Every total you see
is calculated from that ledger, exactly as it will be with real students.

### Step 6 · Your own teacher account

When you are ready to stop using the demo:

```sql
-- in the Supabase SQL editor
insert into teachers (name, title, phone, join_key, subjects, curricula)
values ('Your Name', 'Sir', '9477xxxxxxx', 'yourkey',
        '{Maths,Science}', '{Local,Cambridge}');
```

Then give yourself a code:

```bash
npm run set-code -- teacher yourkey 1234
```

Use the same command when a family loses their code:

```bash
npm run set-code -- family "Kasun Perera" 482915
```

---

## 3. Deploy to Vercel

```bash
npm i -g vercel        # if you do not have it
vercel login
```

### Add the environment variables

```bash
for k in SUPABASE_URL SUPABASE_SERVICE_KEY SESSION_SECRET LOGIN_PEPPER \
         APP_TIMEZONE CODE_LENGTH CRON_SECRET; do
  vercel env add "$k" production
done
```

Or paste them in the dashboard: **Project → Settings → Environment Variables**.
Add them to **Production**, **Preview** and **Development**.

| Variable | Needed? |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | yes — nothing works without them |
| `SESSION_SECRET`, `LOGIN_PEPPER` | yes — logins fail without them |
| `APP_URL` | yes, for the sign-up link (set it to your deployment URL) |
| `APP_TIMEZONE` | recommended (`Asia/Colombo`) |
| `CRON_SECRET` | recommended — stops anyone calling `/api/cron` |
| `CODE_LENGTH` | set to `6` for real use (see §12) |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` | optional (see §8) |
| `DEMO_HINT` | only while demoing — shows the codes on the login screen |

### Ship it

```bash
vercel          # preview deployment
vercel --prod   # production
```

There is no build step, so a deploy takes seconds. Then open the URL, tap
**Teacher**, and type your code.

**Install it on a phone:** open the URL in Chrome or Safari and choose *Add to
Home Screen*. It then opens full-screen and works offline for the shell.

---

## 4. Run it locally

```bash
node --env-file=.env scripts/dev-server.mjs
# → http://localhost:3000
```

A small Node server that serves the static files and routes `/api/*` to the
same handlers Vercel runs. `vercel dev` works too, if you prefer.

---

## 5. How it is put together

```
index.html            the app shell
join.html             the public sign-up form
style.css             the design system: colours, type, components
sw.js                 service worker (offline shell; never caches /api)
manifest.json         installable PWA

app/                  the browser (ES modules, no bundler)
  main.js             boot, routing, one render(), one click listener
  api.js              the only place that talks to /api
  state.js            client state; language and theme persist, nothing else
  rules.js            section 7 business rules, for the screens
  i18n.js             en + ta dictionaries
  ui.js               the components of section 5.3
  join.js             the sign-up form
  screens/
    login.js          role picker + PIN pad
    teacher.js        Today, calendar, students, fees, dashboard, papers
    teacher-forms.js  every teacher sheet and write
    family.js         Parent and Student views

api/                  5 serverless functions, routed by ?r=<resource>
  auth.js             login, logout, me, switch child, switch view
  teacher.js          everything the teacher's tabs read and write
  family.js           everything the parent and student read; slip upload
  join.js             public sign-up
  cron.js             the daily jobs
  _lib/
    db.js             PostgREST + Storage over fetch (holds the service key)
    session.js        code hashing, HMAC session cookies
    rules.js          the same business rules, server side
    templates.js      message wording (en + ta)
    whatsapp.js       Cloud API, with a wa.me fallback
    http.js           json, body parsing, error guard

supabase/schema.sql   tables, views, functions, RLS, buckets
scripts/
  pg.mjs              a 300-line PostgreSQL client (migrations only)
  db-push.mjs         applies supabase/schema.sql
  db-verify.mjs       asserts the SQL rules against a real database
  seed.mjs            demo teacher, students and eight weeks of history
  set-code.mjs        sets or resets a login code
  dev-server.mjs      runs the app locally without Vercel
tests/                140 tests, no database needed
```

**Why five functions, not thirty.** Vercel's free plan allows 12 serverless
functions per deployment. Each file routes internally on `?r=`, which keeps the
whole API inside the budget with room to spare. A test asserts this.

**Why no framework.** There is nothing to install, nothing to build and nothing
to upgrade; a deploy is a file copy. The screens are small functions that
return HTML, so the structure of the build guide maps straight onto the code.
If you later want React, `app/rules.js` and the API are already independent of
the rendering.

### How a write works

Every write goes to the server, and the browser then reloads its data rather
than guessing:

```
tap "Done" on attendance
   → POST /api/teacher?r=attendance.finish   { class_id, date, absent[] }
       → finish_class(...)        one statement: session + attendance + charges
       → one WhatsApp per absent student, with the result on the event row
   → GET /api/teacher?r=bootstrap            fresh numbers
   → render()
```

So the amount owed on screen is the amount the database would calculate — the
teacher's phone, the parent's phone and the dashboard cannot drift apart.

---

## 6. The database

### The money ledger

The prototype stored `owed = number of unpaid classes` and multiplied by the
current fee. That breaks the moment a fee changes or a class is cancelled. Here
money is a ledger:

* **`charges`** — one row per class a student actually attended, with the fee
  **as it was on that day**.
* **`payments`** — one row per payment.
* **Amount owed** = `sum(charges) − sum(payments)`.

Payments are allocated to charges oldest-first, which is what gives both the
number of pending classes and "32 days late" (the date of the oldest charge
still not covered). The `student_dues` view does this in SQL with a window
function, so every screen reads the same answer.

### Generated sessions

A class is stored once — its weekdays, start time and start date. The dated
sessions are generated on demand by `sessionsOn(date)`, so nothing has to be
created every week and a class added today immediately appears on every view.
A `sessions` row is written **only when something happens**: the class was
marked, or the parents were reminded. `class_exceptions` holds a single
cancelled day.

### Views carry the rules

| View | What it answers |
| --- | --- |
| `student_dues` | amount due, pending classes, days late |
| `student_history` | the last 8 results as `PPAPPAPA` |
| `student_attendance_totals` | lifetime attended / total |
| `student_marks_summary` | average, best, first and latest percentage |
| `v_students` | one row per student with all of the above |
| `teacher_months` | collected vs charged per month, from the ledger |

### Transactional writes

| Function | Why it is in the database |
| --- | --- |
| `finish_class` | the session, every attendance row and every charge must land together, or not at all |
| `record_payment` | works out the amount from the oldest unpaid charges, caps it at what is owed, and clears the slip when nothing is left |

---

## 7. Security

**The browser cannot reach the database.** Row level security is on for every
table and **no policy grants the anon key anything**, plus the grants are
revoked outright. Only the serverless functions hold the `service_role` key.
A test asserts that nothing under `app/` imports the database client.

**Every query is scoped by the session, never by the request.** The signed
cookie carries the teacher id, or the exact list of child ids a family may
read. Changing an id in the address bar reaches nothing.

**Login codes are never stored.** Each account keeps a random salt and
`scrypt(code, salt + LOGIN_PEPPER)`, plus an HMAC digest for an indexed lookup.
A code cannot be read back — which is why a lost code is *replaced*, not looked
up, and why the teacher's screen shows "Send a new family code" rather than the
code itself. A new code is shown once, on screen, and sent on WhatsApp.

**Logins are rate limited.** Failed attempts are counted per IP and the
endpoint refuses after `LOGIN_MAX_ATTEMPTS` (8) within
`LOGIN_WINDOW_MINUTES` (15). The sign-up form is capped per IP per hour.

**Sessions** are HMAC-SHA256 signed, stored in an `HttpOnly`, `SameSite=Lax`,
`Secure` cookie, and expire after 30 days. There is no token in JavaScript.

**A parent never receives another child's surname.** The leaderboard is masked
on the server — `Amaya Jayasinghe` leaves as `Amaya J.`, and other children's
ids are stripped. A test checks the payload.

**Files are private.** Bank slips and papers live in private Storage buckets
and are served through signed URLs that expire in minutes.

**Headers.** A Content-Security-Policy that allows scripts only from the app's
own origin, plus `nosniff`, `X-Frame-Options: DENY` and a strict referrer
policy — see [`vercel.json`](vercel.json).

**Children's data.** This holds names, phone numbers and exam results of
minors. Collect consent, keep access to the family and their teacher, and check
Sri Lanka's Personal Data Protection Act before going live.

---

### Moving a class by dragging it

Press and hold a class on the Day or Week grid, then drag it. The hold matters:
the calendar scrolls, and a finger that starts moving straight away is almost
always trying to scroll rather than to reschedule a lesson. Dropped times land
on the quarter hour, and a class that has already been taught cannot be dragged
at all.

The drop saves nothing. It opens a sheet that shows where the class came from
and where it is going, names anything it would now clash with, and asks two
questions:

* **This day only**, or **All days**. One session becomes a one-off on the new
  date and the repeating class is cancelled for the day it left, so nobody is
  booked twice. The whole class instead swaps that weekday for the new one and
  leaves its other days alone.
* **Tell the parents on WhatsApp.** On by default, and it says how many people
  that is. A drag to tidy up next month's timetable is not always news, so it
  can be turned off.

Only then does anything move, and the move and the messages go out in the same
request — a class can never be rescheduled with the message quietly lost. The
wording is in Appendix B as `moved`, and names the class, the old slot and the
new one. Without the WhatsApp Cloud API configured the server hands back
`wa.me` links and the teacher sends them from their own WhatsApp, one tap each,
exactly as the absent messages work.

What the browser sends is only *where it was dropped*. What that means — which
days change, what clashes, whether it is even allowed — is worked out again on
the server before anything is written.

---

## 7a. Plus subscriptions

Two different kinds of money live in this app and never mix:

* **Fees** are what a parent pays the teacher for lessons. They are the ledger
  of section 6 — charges, payments, receipts — and they are the teacher's.
* **Plus** is a monthly subscription the parent pays for the app itself. The
  teacher keeps a share of it (`teachers.plus_share`, 50% by default).

A subscription is **recorded by hand**. There is no payment provider in this
build: the teacher or an admin marks that a parent has paid, exactly the way a
bank slip is confirmed, and the `subscriptions` row is the record. Swapping in
real billing later means filling that table from a webhook and changing
nothing else — the screens read the table, not the provider.

Ending a subscription marks it `ended` and keeps the row, so the month that
was paid for still counts in `teacher_plus_months`.

### The subscriber rule

The handoff puts it plainly: *there are no free parents in the app.* A family
whose subscription is not active sees one screen asking them to subscribe —
no attendance, no marks, no fees — and cannot write either. They still get the
WhatsApp fee reminder, which is the one thing that reaches them without the
app, and that reminder carries a line about Plus (handoff draft 1).

**Families already using the app were not locked out by this.** The migration
grandfathers every student who had a family code at the moment subscriptions
were switched on, and marks the teacher so a second run cannot re-subscribe a
family that has since stopped paying. Turning a rule like this on is a
decision, not a deploy.

### The goal ladder

The handoff asks for a goal of "25% more students". Worked out from the
current count, that target would move every time somebody joined and the ring
could never fill, so the rungs are fixed in advance and the teacher climbs
them: 5, 7, 9, 12, 15, 19, 24, 30, 38 … At 24 students the next rung is 30 —
"add 6 more" — and at 28 the ring reads 4 of 6 with "just 2 more to go",
which is exactly what the design draws.

### "N× faster than tuition"

Growth since the teacher joined Plus, both sides, last month against the
first. It is only claimed when it can be claimed honestly: two months of
history either side, something to grow from, and tuition that actually grew.
Plus starts from almost nothing, so the raw ratio runs into the hundreds — a
true number and a useless one — so the headline is capped at 20×.

### The QR code

Drawn in the app, in `app/qr.js`. The Content-Security-Policy is
`script-src 'self'`, which rules out a library from a CDN, and an image
service would mean sending every teacher's join link to a third party. It is
byte mode at error-correction level M, versions 1–10, output as an SVG.

`tests/qr.test.js` decodes its own output — unmasking, walking the zig-zag,
de-interleaving the blocks — and checks the finder patterns, timing lines,
dark module and format bits against the standard. **It has not been held up
to a real phone camera**, which is the one test worth doing before a class
relies on it.

---

## 7b. Setting a teacher up

`/onboard?k=<ONBOARD_KEY>` is the six-screen wizard the Plus team fills in
sitting next to a teacher. It asks who they are, what they teach, their
classes, and how they run things today; then it creates the teacher, their
classes and their login code, and offers a welcome message on WhatsApp.

It is English only on purpose. The teacher app is English and Tamil because
teachers and families use it every day; this is used once, by the team.

**It creates accounts, so it is shut by default.** `ONBOARD_KEY` must be set
in the environment and presented on every request. Without it — or with the
wrong one — the endpoint answers 404 and says nothing that a missing key
would not. Leave `ONBOARD_KEY` unset in any environment where the tool is not
wanted and the page is simply not there.

The wizard does not ask what time a class starts; that would be a sixth
screen for something that takes ten seconds in the app. Classes it creates
are flagged `setup_pending` with a placeholder time, along with the expected
student count and fee band it did ask for.

The teacher's code is shown **once**, at the end. Like a family code it is
stored hashed and cannot be read back.

---

## 8. WhatsApp

**Without any configuration** the app still works end to end: the server builds
the message, records the event, and hands back a `wa.me` link. The teacher taps
once and their own WhatsApp opens with the text ready. Nothing is silently
lost — the event row says `manual`.

**With the Cloud API** (`WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID`) the message is
sent from the server and the event row says `sent`, or `failed` with the reason.

Meta requires an **approved template** for a message that starts a conversation
outside the 24-hour customer-service window. Free text only works as a reply.
So: get your templates approved for class reminders, absence alerts and fee
reminders; until then the `wa.me` fallback covers everything. Check Meta's
current pricing and rules — they change.

Wording for every message is in [`api/_lib/templates.js`](api/_lib/templates.js),
in English and Tamil.

---

## 9. The scheduled job

`vercel.json` runs `/api/cron` once a day at 02:00 UTC:

1. **Auto fee reminders** — for each teacher who has them switched on, every
   student later than that teacher's "remind after" setting (7, 14 or 30 days)
   gets one reminder, and not another until the period passes again.
2. **Tomorrow's class reminders** — one message per family per class, recorded
   on the session so it is never sent twice.
3. Old rate-limit rows are cleared.

Set `CRON_SECRET` and Vercel sends it as `Authorization: Bearer …`; the function
refuses anything else. You can run the jobs by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/cron
curl -H "Authorization: Bearer $CRON_SECRET" "https://your-app.vercel.app/api/cron?job=fees"
```

Vercel's free plan allows one cron run per day. For reminders that go out at a
set local hour, move to a paid plan or trigger it from any external scheduler.

---

## 10. Tests

There are three suites. The first needs nothing; the other two drive the real
database and a running deployment.

```bash
npm test          # 377 tests · no database, no network
npm run check:db  # the SQL rules, against your real database
npm run check:live # the whole API and everything the browser loads
```

`check:db` and `check:live` each build their own throwaway teacher, students,
classes and family code, drive everything through that, and delete it when they
finish — your real data is never touched. If a run dies before it can tidy up,
it says so, and `npm run check:clean` removes the leftovers (it only ever
touches rows named `Live <digits>` or `Check <digits>`).

`check:live` takes a URL, defaulting to `APP_URL`:

```bash
npm run check:live                             # production
npm run check:live -- http://localhost:3077    # a local server
```

Run it against a local server while developing. It paces its requests, because
a few hundred calls in a few seconds from one address looks exactly like an
attack — on Vercel, Attack Challenge Mode will start answering with a
JavaScript challenge that no command-line client can pass. If that happens the
check says so instead of reporting sixty misleading failures; turn it off under
**Project → Firewall**, or point the check at a local server.

### What `npm test` covers

377 tests, no database and no network. They cover the checklist in section 11
of the build guide, plus the handlers, every screen, and the improvement plan
point by point:

* **Calendar** — weekly classes on the right days only, not before the start
  date; one-off classes once; a cancelled day gone and the others intact;
  Monday-first weeks and month grids; overlapping classes in side-by-side
  columns.
* **Money** — 4 × LKR 1,500 = LKR 6,000, and paying 2 leaves 3,000; income
  ignores absent students; a planned class counts as "still to teach"; paper
  profit = revenue − cost.
* **Attendance** — attendance % over the last eight results; streaks; "at risk"
  = two absences in the last four.
* **Marks** — 74 % teal, 75 % green, 49 % pink; percentages of any maximum;
  progress = latest − first.
* **Leaderboard** — ties broken by streak then alphabetically; only students
  with marks on the marks board; **no other child's surname or id in the
  payload**.
* **Login** — codes hashed and salted; the same code gives different hashes;
  the lookup digest does not contain the code.
* **Dates** — month ends and leap days; the server and the browser agree.
* **Wiring** — every button has a handler; every `t()` key exists in English
  *and* Tamil; Tamil labels are short enough for a pill; the service worker
  caches every module the page loads; the API stays inside Vercel's function
  budget; nothing in `app/` can reach the service key.
* **Screens** (`render.test.js`) — every screen of all three views renders from
  fixture data, in English and Tamil, and the HTML carries no `undefined`,
  `NaN` or `[object Object]`. A student called `O'Brien <script>` is escaped,
  not executed. Checks the real numbers too: the week view draws seven columns,
  the month view 42 days, a cancelled day is gone, attendance starts with
  everyone present, fees sort by days late, the dashboard adds up.
* **API** (`api.test.js`) — the handlers run against a stubbed Supabase that
  records every request: wrong codes refused and rate-limited, a parent cookie
  rejected by the teacher API and vice versa, a tampered cookie rejected,
  **every bootstrap query asserted to be scoped to the signed-in teacher**,
  another family's child unreachable, the leaderboard masked before it leaves,
  a slip rejected unless it is really an image, `finish_class` called with the
  teacher id from the session, one absence event per absent student, payments
  capped at what is owed, the fee-reminder preview byte-identical to what is
  sent, and the cron job refusing a caller without `CRON_SECRET`.

* **The improvement plan** (`plan.test.js`) — each of the fifteen points, named
  after the point it checks and asserting that point's own "Done when" line.
  Where a point is about the page rather than a function, the test reads the
  stylesheet or the HTML: that the viewport is locked and every input is 16px
  (point 4), that there is one spacing scale and one height per control
  (point 6), that nothing render-blocking waits on Google Fonts (point 1).
* **The sign-up form, clicked through** (`flow-join.test.js`) — the real
  `join.js` boots against a small DOM and a stubbed `/api`, and the test walks
  the four steps the way a family would: Next on an empty step explains what is
  missing, a bad number is refused with the right reason, Back keeps every
  answer, a failed Submit offers Try again with nothing lost, and the request
  that finally goes out carries `94771234567`.
* **The teacher's app, clicked through** (`flow-app.test.js`) — the real
  `main.js` boots the same way. Nothing calls a screen function directly: every
  step is a tap, so the action table, the state changes and the redraw are all
  exercised. It signs in on the lock screen (including a wrong code), opens the
  month agenda, builds a class that clashes and one that only touches, starts
  and ends a class with an absent student, and records a part payment then
  undoes it. It also fires two taps on Confirm payment in the same tick and
  checks that only one payment is made.

Those last two run on a hand-written DOM in `tests/dom.js`, not jsdom — this
project has no dependencies. It keeps `innerHTML` as a string and finds buttons
with a regular expression, which is enough to drive what the app is made of: a
tap dispatches an action, the action changes state, the state is drawn as HTML.
It does no layout and no CSS, so anything that needs those is checked by
reading the stylesheet instead.

### What `check:db` covers

`npm test` covers the JavaScript. The money rules also live in SQL views and
functions, and only PostgreSQL can judge those. `npm run check:db` reaches the
real database with the same keys the app uses, so it runs anywhere the app
runs. (`npm run db:verify` does the same over a direct Postgres connection
inside a transaction it rolls back; that needs `DATABASE_URL`.) Between them
they check:

* every table, view, function and storage bucket exists;
* RLS is on for every table, there are no policies, and `anon` /
  `authenticated` hold no grants at all;
* 4 × LKR 1,500 with a LKR 3,000 payment leaves 2 pending classes, LKR 3,000
  owed, and dates "days late" from the third charge — in the teacher's
  timezone;
* a student with no charges still appears, owing nothing;
* `finish_class` charges only the students who were present, at each one's own
  fee, and running it twice does not double the money;
* `record_payment` takes the oldest unpaid classes at the fee they were charged
  at, clips an over-payment to the balance, raises when nothing is owed, and
  clears the slip and the reminder note once the balance is clear;
* both functions refuse another teacher's class or student;
* the attendance window is the last eight *marked* classes, oldest first, with
  planned sessions excluded;
* a mark is a percentage of its own maximum (34/50 counts as 68 %);
* the monthly totals come from the ledger;
* a class cannot be charged to the same student twice, a class must either
  repeat or have a single date, and deleting a teacher cascades.

…and that deleting a teacher cascades through every table.

`db:verify` needs `DATABASE_URL`; [`scripts/pg.mjs`](scripts/pg.mjs) is a small
PostgreSQL client (TLS, SCRAM-SHA-256, simple queries) written for this, so
there is still no npm dependency anywhere in the project.

### What `check:live` covers

**The frontend** — every file the browser asks for is served and is
byte-for-byte the file in the repository; the whole module graph is followed
from `app/main.js` and `app/join.js` with no dead imports; the HTML really
loads `app/main.js` as a module and has the containers to render into; the
manifest is installable; the stylesheet carries the night tokens, the day
overrides and a reduced-motion block; `script-src` is `'self'` with no
`unsafe-eval`, `frame-ancestors` is `none`, and the fonts and signed Supabase
images the app needs are allowed; and `.env`, `schema.sql`, `scripts/`,
`tests/`, `package.json` and `api/_lib/db.js` are all unreachable.

**The backend** — every endpoint and every refusal: wrong, malformed and
wrong-role codes; the lock-out after repeated wrong codes (including that the
right code is refused while locked); the cookie's `HttpOnly`, `SameSite` and
`Secure` flags, and that the code is not in it; a tampered cookie and a forged
signature; a parent cookie on the teacher API and the reverse; attendance
charging only those present, at each student's own fee, with one WhatsApp per
absent parent; a fee preview that is byte-identical to what is sent; part
payments, slip confirmation and a reminder refused when nothing is owed; a slip
rejected unless it really is an image, then fetched by the teacher as a signed
URL; marks validated; classes created, named by size, skipped, restored and
retired; the whole sign-up path from public form to pending student to a
confirmed code that works, a replacement code that works and an old one that
does not; **a classmate from another family reduced to a first name and an
initial with no id, and their surname and phone absent from the payload**;
switching child and switching between the Parent and Student views; the cron
job refusing a caller without `CRON_SECRET`; and unknown actions answering 404
rather than crashing.

### What the tests do not reach

Nothing drives a real browser — there is no headless browser in this project,
by the same no-dependencies rule as everything else. `tests/render.test.js`
renders every screen's HTML from fixture data, and `check:live` proves the
browser can load every module, but the last mile (a tap actually opening a
sheet) is checked by hand.

---

## 11. Environment variables

| Name | Default | What it does |
| --- | --- | --- |
| `SUPABASE_URL` | — | **Required.** Project URL. |
| `SUPABASE_SERVICE_KEY` | — | **Required.** `service_role` key. Server only. |
| `SESSION_SECRET` | — | **Required.** Signs the session cookie. |
| `LOGIN_PEPPER` | `SESSION_SECRET` | Hashes login codes. Changing it invalidates every code. |
| `APP_URL` | the request host | Base URL used in the sign-up link. |
| `APP_TIMEZONE` | `Asia/Colombo` | The day the server calls "today". |
| `CODE_LENGTH` | `4` | Digits in a generated family code. Use `6`. |
| `LOGIN_MAX_ATTEMPTS` | `8` | Failed logins per IP before lock-out. |
| `LOGIN_WINDOW_MINUTES` | `15` | The lock-out window. |
| `JOIN_MAX_PER_HOUR` | `5` | Sign-up submissions per IP per hour. |
| `DEMO_HINT` | off | Shows the demo codes on the login screen. |
| `CRON_SECRET` | — | Protects `/api/cron`. |
| `WHATSAPP_TOKEN` | — | Cloud API token. Without it, the `wa.me` fallback. |
| `WHATSAPP_PHONE_ID` | — | Cloud API phone number id. |
| `WHATSAPP_API_VERSION` | `v21.0` | Graph API version. |
| `DATABASE_URL` | — | Session-pooler URL. Used **only** by `db:push` and `db:verify`; the app never opens a Postgres connection. |

---

## 12. Decisions and known limits

**A 4-digit code is weak.** 9,000 possibilities, and codes must be unique
across the whole deployment. It is the default so the demo matches the build
guide. For real use set `CODE_LENGTH=6`, and for anything sensitive move to a
WhatsApp one-time code — the login endpoint is already the only place a code is
checked, so that is a change in one file.

**Codes cannot be displayed.** The build guide's student screen shows a "family
code" card. Because codes are hashed, that card shows **"Send a new family
code"** instead. Showing a stored code would mean storing it in plain text.

**"Not marked" instead of "done".** The guide treats a past class as done. This
version shows a past unmarked class as **Not marked** and lets the teacher open
and mark it — truthful, and it means a forgotten class is visible rather than
silently counted as income.

**"Parent reminded" is real.** The guide fakes it ("today or tomorrow counts as
reminded"). Here it reflects `notified_at`, set when the teacher taps *Remind
parent* or when the nightly job sends tomorrow's reminders.

**The seeded "days late" are honest, not the guide's numbers.** The demo student
owes 4 classes × LKR 1,500 = LKR 6,000, as the checklist requires, but the days
late follow from the generated history (roughly 12 days, not 32) because that is
what two classes a week actually produces.

**The month chart holds as much history as the ledger has.** The guide's
earlier months were fixed numbers; here they come from `teacher_months`, so a
fresh database shows fewer months until it has them.

**One teacher per login, many teachers per deployment.** The schema is
multi-tenant and every query is scoped by `teacher_id`, but there is no
self-service teacher sign-up — a teacher is created in SQL and given a code with
`npm run set-code`. That is the right trade for a pilot; a sign-up flow is the
obvious next addition.

**No push notifications.** Updates reach families through WhatsApp and the
in-app feed. Web push would need a subscription table and VAPID keys.

**Reschedule requests** are saved and shown to the teacher, who can accept or
decline. The family is not yet told the outcome automatically.

**Paper files.** Papers can be sold and sent, and the storage bucket and signed
links are in place, but there is no upload screen yet — set `papers.file_path`
in SQL after uploading to the `papers` bucket, and the Open button works.

**The hour grid starts at the earliest class.** It expands to fit whatever is
on screen rather than always showing 00:00–24:00.

### From the Income handoff

**The handoff disagrees with itself on screen 2.** Its README calls the
by-class label "7 parents to subscribe" with a **Remind** button sending
draft 1 (the fee reminder); the mock-up says "7 not on Plus" with an
**Invite** button, which is draft 2. Draft 1 is a *fee* reminder, and sending
it to a parent just because they are not on Plus would be wrong when their
fees are paid. So: the button is **Invite** and sends draft 2, and draft 1's
Plus line lives where it belongs — on the fee reminder, for parents who are
not subscribed. Say the word if the other reading was meant.

**The Sinhala is a first draft.** The app is English and Tamil; the invite
screen offers a third language because it goes to a parent who does not have
the app yet. The Sinhala wording for the two outgoing messages has not been
read by a native speaker and should be before it is used.

**No payment provider.** Subscriptions are recorded by hand, as agreed. The
Income screens are therefore honest about what is in the table, and nothing
charges anybody.

**The teacher's referral bonus is not built.** The handoff parks it, and so
does this.

**The QR code has not been scanned by a phone.** It decodes correctly against
its own decoder and matches the standard's structure; point a camera at it
before a classroom does.

**The onboarding wizard's key is a shared secret, not an account.** That is
the right weight for a small team tool, but it means anyone with the link can
create teachers. Rotate `ONBOARD_KEY` if it leaks, and unset it when the team
is not onboarding.

### From the improvement plan

**Point 14 was never finished.** The note stops after the letter "G". Nothing
has been built for it; say what it was and it can be.

**Zoom is locked, which costs something.** Point 4 asked for a fixed screen, so
the viewport is locked and every input is 16px. Someone who relies on pinch
zoom has lost it. Safari ignores `user-scalable=no` in a browser tab, so the
lock is only reliable in the installed app — which is the other half of point 4.
If this turns out to matter, the fix is a "Larger text" setting rather than
unlocking the page, and nothing here stands in the way of adding one.

**The fonts are still Google's.** Point 1 asked for self-hosted, subset fonts.
They are no longer render-blocking — the page paints in the system font and
swaps when Manrope arrives, which is the part that was costing a blank screen —
but the files still come from `fonts.gstatic.com`. Downloading and subsetting
them is a build step this repository does not have yet.

**Drag-to-resize is still not there.** A class can be press-and-held and
dragged to another time or another day, which was the half of point 9's phase
2 that matters. Dragging the bottom edge to change how long a class runs is
not built; change the length from the class sheet instead.

**Long lists are not virtualised.** Point 1 suggested drawing only the rows on
screen. With a few dozen students that costs more complexity than it saves, so
the student list renders in full. It is worth doing above a few hundred.

**The timings in point 1 are not measured here.** "First screen under two
seconds on 4G" and "any tap under 0.1 second" need a real phone. What the tests
check is the work that makes them possible: nothing render-blocking, a skeleton
instead of a blank page, a debounced search, memoised sessions, and the login
screen split from the rest of the app. Measure the rest with Chrome DevTools →
Performance at 4× CPU and Fast 3G, as the plan says.

**The photo is stored but never shown.** Point 8's photo is optional, shrunk to
a 320px square on the phone, and kept in a private `photos` bucket. No screen
displays it yet, and the student screen does not offer to change it.

**"This day only" makes a copy.** Editing one day of a repeating class creates
a one-off class on that date and cancels the repeat for that day. The effect is
right and the history stays honest, but the new class is a separate row, so
editing the repeat afterwards does not touch it.

**Receipt numbers are per teacher and count up.** They are allocated as
`max + 1` inside `record_payment`, which is fine at this scale. Two payments
recorded in the same instant would collide on the unique index and the second
would fail rather than be mis-numbered; a sequence per teacher is the fix if
that ever happens.

---

## Licence and credit

The design, screen structure and business rules follow the *Plus Teacher App*
build guide. The code here is an independent implementation. "Nimal Sir" and the
seeded students are demo data — replace them, and the brand, with your own.
