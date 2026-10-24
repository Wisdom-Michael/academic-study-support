# Integrated Academic Study Support System

A full-stack web application that supports university Computer Science students with
conceptual learning. It does **not** include coding sandboxes, compilers, or IDEs.

| Module | What it does |
|---|---|
| **A. Authentication & RBAC** | Registration and sign-in with bcrypt-hashed passwords and JWT sessions. Users sign in as a student, peer mentor or lecturer, and each role gets its own dashboard. |
| **B. Resource repository** | Upload, browse, and filter course materials by module code. A reading tracker records chapter completion as students scroll. |
| **C. Concept checks & peer matching** | Multiple-choice and true/false checks at the end of each chapter, graded instantly. Uploading a material can generate a 5–20 question check from it automatically. A score below 50% automatically creates a pending peer-mentor match for that module. |
| **D. Risk analytics** | Lecturers see a live risk index for every student, built from login frequency, chapter completion, concept-check scores, and inactivity. Medium- and high-risk students raise early-warning alerts automatically. |

---

To put the site online for free (Render + Aiven), follow [DEPLOYMENT.md](DEPLOYMENT.md).

---

## Architecture

A strict three-tier architecture:

```
┌──────────────────────────┐     HTTP / JSON      ┌──────────────────────────┐      SQL       ┌──────────────────┐
│  Presentation tier       │  ─────────────────▶  │  Application tier        │  ───────────▶  │  Data tier       │
│  React + TypeScript      │                      │  Node.js + Express (TS)  │                │  MySQL 8         │
│  client/ (Vite, :5173)   │  ◀─────────────────  │  server/ (:4000)         │  ◀───────────  │  academic_       │
│                          │   JWT in header      │  auth, grading, matching,│                │  support_db      │
│                          │                      │  risk analytics          │                │                  │
└──────────────────────────┘                      └──────────────────────────┘                └──────────────────┘
```

All business logic (grading, matching, risk scoring) runs on the server. The browser never
receives the correct answers to a concept check until the student submits.

### Repository layout

```
academic-study-support/
├── schema.sql                  MySQL tables and seed data
├── .env.example                Template for database, port and JWT settings
├── package.json                Runs both tiers together (npm run dev)
├── server/                     Middle tier: Express REST API
│   ├── src/
│   │   ├── index.ts            App setup, route mounting, error handling
│   │   ├── config.ts           Environment variables and business-rule constants
│   │   ├── db.ts               MySQL connection pool and query helpers
│   │   ├── middleware/auth.ts  JWT verification and role checks (RBAC)
│   │   ├── routes/             auth, materials, conceptChecks, matches, analytics
│   │   ├── services/
│   │   │   ├── matching.ts     Peer-mentorship matching algorithm
│   │   │   └── risk.ts         Student risk index and alert generation
│   │   └── scripts/initDb.ts   Creates and seeds the database from schema.sql
│   └── uploads/                Uploaded course files (seed/ holds the demo chapters)
└── client/                     Presentation tier: React app
    └── src/
        ├── App.tsx             Routes and role-based route protection
        ├── auth.tsx            Sign-in state shared across the app
        ├── api.ts              fetch wrapper that attaches the JWT
        ├── pages/              Login, Register, the three dashboards, Repository, MaterialReader
        └── components/         ConceptCheck, QuestionEditor, ProgressMark, UploadForm, …
```

---

## Setup

### 1. Prerequisites

- **Node.js 20 or newer** (check with `node -v`)
- **MySQL 8.0 or newer**, running locally. On Windows, the
  [MySQL Installer](https://dev.mysql.com/downloads/installer/) sets up the server; note the
  root password you choose. On macOS: `brew install mysql && brew services start mysql`.

### 2. Install dependencies

From the `academic-study-support` folder:

```bash
npm run install:all
```

This installs the root, `server`, and `client` packages.

### 3. Configure the environment

Copy the template and fill in your MySQL password and a JWT secret:

```bash
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
```

| Variable | Purpose |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` | How the server connects to MySQL |
| `DB_NAME` | Leave as `academic_support_db` |
| `DATABASE_URL`, `DB_SSL_CA` | For hosted MySQL: the connection URI and the provider's CA certificate, instead of the `DB_*` values |
| `SEED_ON_EMPTY` | `true` (default): an empty database gets the tables and demo data on first start |
| `DEMO_PASSWORD` | Optional password given to every demo account when seeding, instead of `Study@2026` |
| `PORT` | API server port (default `4000`) |
| `CLIENT_ORIGIN` | React dev server URL, allowed through CORS |
| `JWT_SECRET` | Long random string used to sign login tokens. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN` | How long a sign-in lasts (default `8h`) |
| `ANTHROPIC_API_KEY` | Claude API key for generating concept checks from uploads ([create one](https://platform.claude.com/settings/keys)). Optional: without it, everything else works and questions are added by hand. |
| `INSTITUTION_EMAIL_DOMAIN` | Optional, e.g. `university.edu`, to restrict registration |

### 4. Create and seed the database

```bash
npm run db:init
```

This runs `schema.sql` using the credentials in `.env`, so you don't need the `mysql`
command-line tool. If you prefer it, `mysql -u root -p < schema.sql` does the same.

> Running this again **drops and recreates** the database, resetting everything to the seed data.
> That's useful before a demo.

### 5. Run the app

```bash
npm run dev
```

This starts both tiers:

- API server: <http://localhost:4000> (health check: `/api/health`)
- React app: **<http://localhost:5173>** (open this one)

To run them separately, use `npm run dev --prefix server` and `npm run dev --prefix client` in two terminals.

---

## Demo accounts

Every seeded account uses the password **`Study@2026`**. On the sign-in page, pick the
account type first (**Student**, **Peer mentor** or **Lecturer**). If it doesn't match the
account, the page says which type to choose.

| Role | Email | What to look at |
|---|---|---|
| Lecturer | `h.okafor@university.edu` | Risk dashboard: Tom is high risk, Fatima and Grace are medium. Expand a row to see their activity timeline. |
| Peer mentor | `p.raman@university.edu` | A pending request from Fatima (CS201) and an active match with Grace (CS220) |
| Peer mentor | `d.mensah@university.edu` | Supports CS240 and CS201, no students yet |
| Student | `c.eze@university.edu` | Steady progress and good scores |
| Student | `f.bello@university.edu` | Scored 25% on the Big-O check and is waiting for a mentor |
| Student | `t.hughes@university.edu` | Hasn't studied for over two weeks |
| Student | `g.nwosu@university.edu` | Being mentored in CS220 |
| Student | `l.weber@university.edu` | Strong in CS220 and CS240 |

### A walkthrough that exercises every module

1. Sign in as **Lukas** and open *Recursion and the call stack* (CS201). Scroll through it and
   watch the progress ring fill. Then answer the concept check badly on purpose (under 50%).
   The result explains each answer and says he's been matched with a CS201 mentor.
2. Sign in as **Daniel Mensah**. Lukas's request is waiting, because Daniel had the fewest open
   matches among CS201 mentors. Accept it.
3. Sign back in as **Lukas**. His dashboard now shows Daniel's contact details.
4. Sign in as **Dr. Okafor** with **Lecturer** selected. The risk table updates within 30 seconds. Open
   *Course materials*, open a chapter, and add a question with the editor under the concept check.

---

## How the key algorithms work

### Peer-mentorship matching (`server/src/services/matching.ts`)

Runs whenever a student submits a concept check scoring **below 50%**:

1. If the student already has a pending or active match for that module, stop.
2. Find every mentor registered for the module (`mentor_modules`).
3. Exclude mentors already at capacity (pending + active ≥ `max_active_matches`).
4. Choose the mentor with the fewest open matches, so work is shared evenly.
5. Insert a `pending` row in `peer_matches`. The mentor accepts it (`active`) and later
   marks it finished (`completed`).

If no mentor has space, the student is matched automatically later, when a mentor adds that
module or finishes a match.

### Concept checks from uploaded material (`server/src/services/questionGenerator.ts`)

When someone uploads a material with **Create a concept check** ticked (or presses
**Generate questions** on a material's page), the server:

1. Reads the file. Markdown and text are used as-is, Word (`.docx`) and PowerPoint (`.pptx`) text
   is extracted, and PDFs are sent whole, because Claude reads PDFs directly, including tables.
2. Asks Claude (`claude-opus-5-5`) for 5–20 questions, about two thirds multiple choice and the
   rest true/false, each with an explanation. The reply is forced into a JSON schema
   (structured outputs), so there is no free text to parse.
3. Checks every question (option count, distinct options, a valid answer index), drops any that
   fail, and saves the rest in one database transaction.

Only lecturers and the person who uploaded a material can generate or edit its questions.
Correct answers stay on the server until a student submits. Each generation is one API call,
roughly US$0.05–0.25 depending on the file's length.

### Risk index (`server/src/services/risk.ts`)

Each factor is scored 0 (no concern) to 100 (serious concern), then weighted:

| Factor | Weight | Measure |
|---|---|---|
| Concept checks | 35% | 100 − average concept-check score (50 if none attempted) |
| Completion | 25% | 100 − average completion across every chapter in the modules the student has started |
| Login frequency | 20% | Rises as logins in the last 14 days fall below 6 |
| Inactivity | 20% | Days since last login or reading, reaching 100 at 14 days |

An index of **60+ is high risk** and **35–59 is medium**. The lecturer dashboard recomputes the
index every 30 seconds. Each run raises an `unresolved` alert in `risk_alerts` for any medium- or
high-risk student who doesn't already have an open one, and refreshes the figures on open
alerts. Resolving an alert silences that student until their risk level gets worse.

---

## Database

`schema.sql` creates the five tables from the project specification, unchanged:
`users`, `course_materials`, `milestone_progress`, `peer_matches` and `risk_alerts`.

Four supporting tables were added so the modules work end to end:

| Table | Why it's needed |
|---|---|
| `concept_checks` | One concept check per chapter (`course_materials` row) |
| `quiz_questions` | The questions, answer options (JSON), correct answer and explanation |
| `login_events` | One row per sign-in, for the login-frequency risk factor |
| `mentor_modules` | Which modules each mentor supports, and how many students they'll take at once |

`milestone_progress` also has a `UNIQUE (student_id, material_id)` constraint, so progress
can be upserted with a single `INSERT … ON DUPLICATE KEY UPDATE`.

---

## REST API

All endpoints except `/api/auth/*` and `/api/health` need an `Authorization: Bearer <token>` header.

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | Anyone | Create a student or mentor account |
| POST | `/api/auth/login` | Anyone | Sign in; records a login event |
| GET | `/api/auth/me` | Signed in | Current user |
| GET | `/api/materials?module=&q=` | Signed in | List and filter materials (with the student's own progress) |
| GET | `/api/materials/modules` | Signed in | Module codes that have materials |
| POST | `/api/materials` | Signed in | Upload (multipart: `title`, `moduleCode`, `file`) |
| GET | `/api/materials/:id` / `:id/file` | Signed in | Material details / the file itself |
| DELETE | `/api/materials/:id` | Lecturer or uploader | Delete a material |
| PUT | `/api/materials/:id/progress` | Student | Record reading completion |
| GET | `/api/materials/:id/concept-check` | Signed in | Questions, without answers |
| POST | `/api/materials/:id/concept-check/submit` | Student | Grade answers; triggers matching below 50% |
| POST | `/api/materials/:id/concept-check/questions` | Lecturer or uploader | Add a question by hand |
| POST | `/api/materials/:id/concept-check/generate` | Lecturer or uploader | Generate `count` (5–20) questions from the file; `replaceExisting` swaps out the current ones |
| GET | `/api/matches` | Signed in | Own matches (all matches for lecturers) |
| PATCH | `/api/matches/:id` | Assigned mentor | Accept (`active`) or finish (`completed`) |
| GET / POST / DELETE | `/api/mentor-modules` | Mentor | Modules the mentor supports |
| GET | `/api/analytics/risk` | Lecturer | Recompute risk index for all students |
| GET | `/api/analytics/students/:id` | Lecturer | One student's activity timeline |
| GET / PATCH | `/api/analytics/alerts` | Lecturer | List alerts / change their status |

---

## Security notes

- Passwords are hashed with bcrypt (10 rounds); plain-text passwords are never stored or logged.
- Every SQL query uses `?` placeholders, which prevents SQL injection.
- Role checks happen on the **server** (`requireRole`). The React route guards only decide
  which screens to show.
- Lecturer accounts can't be self-registered. Create them in the database with `role = 'faculty_admin'`
  (the role name from the specification; the interface calls these users lecturers).
- Sign-in checks the chosen account type only after the password is verified, so it reveals
  nothing about an account to someone without its password.
- Uploads are limited to PDF, Markdown, text, Word and PowerPoint files up to 20 MB, and are
  saved under random names inside `server/uploads`.
- Concept-check answers stay on the server until submission.
- For simplicity the JWT is kept in `localStorage`. A production deployment would use an
  HTTP-only cookie and add rate limiting on the sign-in endpoint.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Could not connect to MySQL` | Make sure MySQL is running and the `DB_*` values in `.env` are right. |
| `Missing required environment variable JWT_SECRET` | You haven't created `.env` yet. See step 3. |
| `Access denied for user 'root'@'localhost'` | `DB_USER` / `DB_PASSWORD` in `.env` don't match your MySQL account. |
| The React app shows "Can't reach the server" | The API server isn't running on port 4000. Check the server terminal for errors. |
| Port 5173 or 4000 is already in use | Stop the other process, or change `PORT` in `.env` and the proxy target in `client/vite.config.ts`. |
