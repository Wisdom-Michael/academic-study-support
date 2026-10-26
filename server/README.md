# Server (application tier)

The Express REST API that holds every business rule: sign-in and role checks, grading,
peer matching, question generation and the risk index. It is written in TypeScript and
talks to MySQL through a `mysql2` connection pool. The React app in `../client` never
reaches the database directly.

For setup, demo accounts and the full API table, see the [main README](../README.md).

## Scripts

Run these from this folder (or from the root with `--prefix server`):

| Command | What it does |
|---|---|
| `npm run dev` | Starts the API on port 4000 and restarts it when a file changes |
| `npm run build` | Compiles `src/` to `dist/` |
| `npm start` | Runs the compiled server (`dist/index.js`), as the hosted copy does |
| `npm run db:init` | Drops and recreates the database from `../schema.sql` with the demo data |
| `npm run typecheck` | Type-checks without writing any files |

## Source files

```
src/
├── index.ts            App setup: CORS, rate limits, routes, error handler, static client files
├── config.ts           Reads environment variables; holds the business-rule constants
├── db.ts               MySQL connection pool and the query/execute helpers
├── setup.ts            On start-up: seeds an empty database, adds missing tables and columns
├── types.ts            Shared types (roles, match and alert statuses) and HttpError
├── validation.ts       Input checks: required text, module codes, numeric IDs
├── uploads.ts          Reads uploaded files from the database or the seed folder
├── fileTypes.ts        Identifies uploads by their contents (so .ppsx or extension-less PowerPoints work)
├── middleware/
│   ├── auth.ts         Signs and verifies JWTs; requireAuth and requireRole (RBAC)
│   └── rateLimit.ts    Per-IP limit on sign-in and registration attempts
├── routes/
│   ├── auth.ts         Register, sign in, current user
│   ├── materials.ts    Upload, list, download and delete materials; reading progress
│   ├── conceptChecks.ts  Questions, grading, AI generation and manual questions
│   ├── matches.ts      Peer-tutoring matches (accept, decline, complete) and mentor modules
│   ├── profile.ts      Phone number, "ask me to help" setting and notifications
│   └── analytics.ts    Lecturer-only: risk index, overview, alerts, student pairing
├── services/
│   ├── matching.ts     Finds a peer tutor and creates matches (automatic and lecturer pairings)
│   ├── risk.ts         Computes the 0–100 risk index and keeps risk_alerts up to date
│   ├── questionGenerator.ts  Extracts text from uploads and asks Claude for quiz questions
│   └── notifications.ts  Writes in-app notifications
└── scripts/
    └── initDb.ts       Used by npm run db:init
```

`uploads/seed/` holds the four demo chapters loaded by `schema.sql`. New uploads are stored
in the `material_files` table, so the hosted copy keeps them across restarts.

## Business rules and where to change them

| Rule | Value | File |
|---|---|---|
| Score that triggers a peer-tutor suggestion | below 50% | `config.ts` (`matchScoreThreshold`) |
| Module average needed to be asked to tutor | 75% or more | `config.ts` (`helperScoreThreshold`) |
| Open matches a student tutor can hold | 2 | `config.ts` (`studentHelperCapacity`) |
| Largest upload | 20 MB | `config.ts` (`maxUploadBytes`) |
| Risk weights: checks, completion, logins, inactivity | 35 / 25 / 20 / 20 % | `services/risk.ts` (`WEIGHTS`) |
| Risk levels | high 60+, medium 35–59 | `services/risk.ts` |
| Login window and expected logins | 14 days, 6 logins | `services/risk.ts` |
| Questions per generated check | 5–20 | `services/questionGenerator.ts` |
| Password hashing cost, minimum password length | 10 rounds, 8 characters | `routes/auth.ts` |
| Sign-in and registration limits | 10 per 15 min, 5 per hour (per IP) | `index.ts` |
| Session length | 8 hours | `.env` (`JWT_EXPIRES_IN`) |

## Conventions

- Every SQL statement uses `?` placeholders; user input is never built into SQL text.
- Handlers throw `HttpError(status, message)` for anything the user should see. The central
  error handler in `index.ts` turns it into `{ "error": "..." }` with that status. Express 5
  catches errors thrown in async handlers, so there is no try/catch boilerplate.
- Role checks always happen here with `requireRole`, even when the client also hides a screen.
