# Client (presentation tier)

The React app that students, peer mentors and lecturers use. It is written in TypeScript and
built with Vite. It holds no business rules: every action is a call to the REST API in
`../server`, which checks permissions and does the work.

For setup and demo accounts, see the [main README](../README.md).

## Scripts

Run these from this folder (or from the root with `--prefix client`):

| Command | What it does |
|---|---|
| `npm run dev` | Starts the app at http://localhost:5173. Calls to `/api` go to the server on port 4000 (see `vite.config.ts`) |
| `npm run build` | Type-checks, then builds the production files into `dist/`, which the server delivers when hosted |
| `npm run preview` | Serves the built files locally |
| `npm run typecheck` | Type-checks without building |

## Source files

```
src/
├── main.tsx            Entry point: mounts the app
├── App.tsx             Routes, and which role may open each page
├── auth.tsx            Signed-in user state: sign in, register, sign out
├── api.ts              fetch wrapper that adds the JWT and turns errors into messages
├── hooks.ts            useLoad: loads data and tracks loading and error states
├── format.ts           Date, "days ago" and plural formatting
├── types.ts            Types for the API's responses (users, materials, matches, risk…)
├── styles.css          All styling: colour tokens, layout, breakpoints for tablet and phone
├── pages/
│   ├── Login.tsx       Sign-in with the Student / Peer mentor / Lecturer choice
│   ├── Register.tsx    Sign-up for students and peer mentors
│   ├── StudentDashboard.tsx   Progress, concept-check scores and peer help
│   ├── MentorDashboard.tsx    Tutoring requests and the modules a mentor supports
│   ├── LecturerDashboard.tsx  Risk overview, charts, students table, pairing, alerts
│   ├── Repository.tsx  Course materials: search, filter by module, upload
│   └── MaterialReader.tsx     Reads a material, tracks progress, shows its concept check
└── components/
    ├── Layout.tsx      Sidebar on desktop, drop-down menu on tablet and phone
    ├── NotificationsMenu.tsx  The bell: unread count and latest notifications
    ├── ConceptCheck.tsx       Takes the quiz and shows results and the tutor suggestion
    ├── QuestionEditor.tsx     Adds a question by hand
    ├── GenerateQuestions.tsx  Asks the server to generate 5–20 questions with AI
    ├── UploadForm.tsx  Uploads a material, optionally creating a test
    ├── PeerHelp.tsx    Match cards: accept with a phone number, decline, mark finished
    ├── PairStudents.tsx       Lecturer form for pairing two students
    ├── charts.tsx      Meter bars, rings, donut and column charts (plain SVG)
    ├── ui.tsx          Card, StatTile, Pill, Avatar and PageHeader
    ├── Notice.tsx      Info, success and error messages
    └── AuthShell.tsx   Layout shared by the sign-in and sign-up pages
```

## Screen sizes

The layout changes at these widths in `styles.css`: 1200 px (overview grid to two columns),
1024 px (sidebar becomes a drop-down menu, the reading tracker is pinned to the bottom),
720 px, 640 px (phone layout) and 380 px. Below 500 px of height, such as a phone held
sideways, the top bar and tracker stop being pinned.
