import { Router } from 'express';
import { execute, query } from '../db';
import { currentUser, requireRole } from '../middleware/auth';
import { matchWaitingStudents } from '../services/matching';
import { HttpError, MatchStatus } from '../types';
import { idParam, requireModuleCode } from '../validation';

// ---------------------------------------------------------------------
// /api/matches: peer-mentorship matches
// ---------------------------------------------------------------------
export const matchesRouter = Router();

interface MatchRow {
  match_id: number;
  module_code: string;
  match_status: MatchStatus;
  student_id: number;
  student_name: string;
  student_email: string;
  mentor_id: number;
  mentor_name: string;
  mentor_email: string;
}

const toMatch = (r: MatchRow) => ({
  matchId: r.match_id,
  moduleCode: r.module_code,
  status: r.match_status,
  student: { userId: r.student_id, fullName: r.student_name, email: r.student_email },
  mentor: { userId: r.mentor_id, fullName: r.mentor_name, email: r.mentor_email },
});

const MATCH_SELECT = `
  SELECT pm.match_id, pm.module_code, pm.match_status,
         s.user_id AS student_id, s.full_name AS student_name, s.institutional_email AS student_email,
         m.user_id AS mentor_id,  m.full_name AS mentor_name,  m.institutional_email AS mentor_email
    FROM peer_matches pm
    JOIN users s ON s.user_id = pm.student_id
    JOIN users m ON m.user_id = pm.mentor_id`;
const MATCH_ORDER = `ORDER BY FIELD(pm.match_status, 'pending', 'active', 'completed'), pm.match_id DESC`;

// GET /api/matches: students see their own, mentors see theirs, faculty see all
matchesRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  let rows: MatchRow[];
  if (user.role === 'student') {
    rows = await query<MatchRow>(`${MATCH_SELECT} WHERE pm.student_id = ? ${MATCH_ORDER}`, [user.userId]);
  } else if (user.role === 'mentor') {
    rows = await query<MatchRow>(`${MATCH_SELECT} WHERE pm.mentor_id = ? ${MATCH_ORDER}`, [user.userId]);
  } else {
    rows = await query<MatchRow>(`${MATCH_SELECT} ${MATCH_ORDER}`);
  }
  res.json({ matches: rows.map(toMatch) });
});

// Allowed status changes, made by the assigned mentor
const NEXT_STATUS: Record<MatchStatus, MatchStatus | null> = {
  pending: 'active',      // mentor accepts
  active: 'completed',    // mentor marks the support as finished
  completed: null,
};

// PATCH /api/matches/:id { status }
matchesRouter.patch('/:id', requireRole('mentor'), async (req, res) => {
  const matchId = idParam(req.params.id);
  const [match] = await query<MatchRow>(`${MATCH_SELECT} WHERE pm.match_id = ?`, [matchId]);
  if (!match) throw new HttpError(404, 'This match no longer exists.');
  if (match.mentor_id !== currentUser(req).userId) {
    throw new HttpError(403, 'Only the assigned mentor can update this match.');
  }

  const requested = req.body?.status as MatchStatus;
  if (NEXT_STATUS[match.match_status] !== requested) {
    const article = match.match_status === 'active' ? 'An' : 'A';
    throw new HttpError(400, `${article} ${match.match_status} match can't be changed to ${requested}.`);
  }

  await execute(`UPDATE peer_matches SET match_status = ? WHERE match_id = ?`, [requested, matchId]);
  // Finishing a match frees capacity, so check for students waiting in this module
  if (requested === 'completed') await matchWaitingStudents(match.module_code);

  const [updated] = await query<MatchRow>(`${MATCH_SELECT} WHERE pm.match_id = ?`, [matchId]);
  res.json({ match: toMatch(updated) });
});

// ---------------------------------------------------------------------
// /api/mentor-modules: the modules a mentor can support
// ---------------------------------------------------------------------
export const mentorModulesRouter = Router();
mentorModulesRouter.use(requireRole('mentor'));

const MAX_CAPACITY = 10;

async function listModules(mentorId: number) {
  const rows = await query<{ module_code: string; max_active_matches: number }>(
    `SELECT module_code, max_active_matches FROM mentor_modules WHERE mentor_id = ? ORDER BY module_code`,
    [mentorId],
  );
  return rows.map((r) => ({ moduleCode: r.module_code, maxActiveMatches: r.max_active_matches }));
}

mentorModulesRouter.get('/', async (req, res) => {
  res.json({ modules: await listModules(currentUser(req).userId) });
});

// POST /api/mentor-modules { moduleCode, maxActiveMatches }
mentorModulesRouter.post('/', async (req, res) => {
  const moduleCode = requireModuleCode(req.body);
  const capacity = Number(req.body?.maxActiveMatches ?? 3);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) {
    throw new HttpError(400, `Capacity must be a whole number from 1 to ${MAX_CAPACITY}.`);
  }

  await execute(
    `INSERT INTO mentor_modules (mentor_id, module_code, max_active_matches) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE max_active_matches = ?`,
    [currentUser(req).userId, moduleCode, capacity, capacity],
  );
  const newMatches = await matchWaitingStudents(moduleCode);
  res.status(201).json({ modules: await listModules(currentUser(req).userId), newMatches });
});

mentorModulesRouter.delete('/:moduleCode', async (req, res) => {
  await execute(
    `DELETE FROM mentor_modules WHERE mentor_id = ? AND module_code = ?`,
    [currentUser(req).userId, String(req.params.moduleCode).toUpperCase()],
  );
  res.json({ modules: await listModules(currentUser(req).userId) });
});
