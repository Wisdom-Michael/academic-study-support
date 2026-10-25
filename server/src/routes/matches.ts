import { Router } from 'express';
import { execute, pool, query } from '../db';
import { currentUser, requireRole } from '../middleware/auth';
import { matchWaitingStudents, recommendHelper } from '../services/matching';
import { notify, peerHelpLink } from '../services/notifications';
import { HttpError, MatchStatus, Role } from '../types';
import { idParam, requireModuleCode } from '../validation';
import { normalisePhone } from './profile';

// ---------------------------------------------------------------------
// /api/matches: peer help between a struggling student and a helper
//
// A match starts 'pending'. Each side accepts or declines from their dashboard.
// Only when BOTH accept does it become 'active', and only then can each side see
// the other's name, email and phone number. Either side can later mark it finished.
// ---------------------------------------------------------------------
export const matchesRouter = Router();

interface MatchRow {
  match_id: number;
  module_code: string;
  match_status: MatchStatus;
  reason: string | null;
  helper_summary: string | null;
  student_accepted_at: Date | null;
  helper_accepted_at: Date | null;
  created_at: Date | null;
  student_id: number;
  student_name: string;
  student_email: string;
  student_phone: string | null;
  helper_id: number;
  helper_name: string;
  helper_email: string;
  helper_phone: string | null;
  helper_role: Role;
  paired_by_id: number | null;
  paired_by_name: string | null;
  lecturer_note: string | null;
}

const MATCH_SELECT = `
  SELECT pm.match_id, pm.module_code, pm.match_status,
         md.reason, md.helper_summary, md.student_accepted_at, md.helper_accepted_at, md.created_at,
         s.user_id AS student_id, s.full_name AS student_name, s.institutional_email AS student_email,
         sp.phone_number AS student_phone,
         h.user_id AS helper_id, h.full_name AS helper_name, h.institutional_email AS helper_email,
         hp.phone_number AS helper_phone, h.role AS helper_role,
         md.paired_by_id, pb.full_name AS paired_by_name, md.lecturer_note
    FROM peer_matches pm
    LEFT JOIN match_details md ON md.match_id = pm.match_id
    JOIN users s ON s.user_id = pm.student_id
    JOIN users h ON h.user_id = pm.mentor_id
    LEFT JOIN user_profiles sp ON sp.user_id = s.user_id
    LEFT JOIN user_profiles hp ON hp.user_id = h.user_id
    LEFT JOIN users pb ON pb.user_id = md.paired_by_id`;
const MATCH_ORDER = `ORDER BY FIELD(pm.match_status, 'pending', 'active', 'completed'), pm.match_id DESC`;

/**
 * The match as one participant sees it. Both names are visible from the start;
 * phone numbers and emails only once both have accepted.
 */
function forViewer(r: MatchRow, viewerId: number) {
  const myRole = r.student_id === viewerId ? 'student' : 'helper';
  const iAccepted = Boolean(myRole === 'student' ? r.student_accepted_at : r.helper_accepted_at);
  const theyAccepted = Boolean(myRole === 'student' ? r.helper_accepted_at : r.student_accepted_at);
  const revealed = r.match_status !== 'pending';
  const other = myRole === 'student'
    ? { fullName: r.helper_name, email: r.helper_email, phoneNumber: r.helper_phone }
    : { fullName: r.student_name, email: r.student_email, phoneNumber: r.student_phone };
  return {
    matchId: r.match_id,
    moduleCode: r.module_code,
    status: r.match_status,
    myRole,
    iAccepted,
    theyAccepted,
    otherName: other.fullName,
    // Why this pairing: the tutor's record for the student, the student's score for the tutor
    summary: myRole === 'student'
      ? r.helper_summary ?? `Can tutor you in ${r.module_code}`
      : r.reason ?? `Needs help with ${r.module_code}`,
    contact: revealed ? other : null,
    pairedBy: r.paired_by_name,      // set when a lecturer made the pairing
    lecturerNote: r.lecturer_note,
    createdAt: r.created_at,
  };
}

/** Let the lecturer who made a pairing know how it went. */
async function notifyPairingLecturer(r: MatchRow, title: string, body: string) {
  if (r.paired_by_id) await notify(r.paired_by_id, title, body, '/lecturer#pairings');
}

async function loadMatch(matchId: number): Promise<MatchRow> {
  const [row] = await query<MatchRow>(`${MATCH_SELECT} WHERE pm.match_id = ?`, [matchId]);
  if (!row) throw new HttpError(404, 'This match no longer exists.');
  return row;
}

function sideOf(row: MatchRow, user: { userId: number; fullName: string }): 'student' | 'helper' {
  if (row.student_id === user.userId) return 'student';
  if (row.helper_id === user.userId) return 'helper';
  // Usually another tab signed in to a different account
  throw new HttpError(403, `You're signed in as ${user.fullName}, who isn't part of this match. Reload the page to see your own matches.`);
}

// GET /api/matches: the signed-in user's matches (as the student needing help, as a helper, or both).
// Lecturers get every match, with names only.
matchesRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  if (user.role === 'faculty_admin') {
    const rows = await query<MatchRow>(`${MATCH_SELECT} ${MATCH_ORDER}`);
    return res.json({
      matches: rows.map((r) => ({
        matchId: r.match_id, moduleCode: r.module_code, status: r.match_status,
        studentName: r.student_name, helperName: r.helper_name,
        studentAccepted: Boolean(r.student_accepted_at), helperAccepted: Boolean(r.helper_accepted_at),
        pairedBy: r.paired_by_name, lecturerNote: r.lecturer_note, createdAt: r.created_at,
      })),
    });
  }
  const rows = await query<MatchRow>(
    `${MATCH_SELECT} WHERE pm.student_id = ? OR pm.mentor_id = ? ${MATCH_ORDER}`, [user.userId, user.userId],
  );
  res.json({ matches: rows.map((r) => forViewer(r, user.userId)) });
});

// POST /api/matches/:id/respond { decision: 'accept' | 'decline', phoneNumber? }
matchesRouter.post('/:id/respond', async (req, res) => {
  const user = currentUser(req);
  const matchId = idParam(req.params.id);
  const match = await loadMatch(matchId);
  const side = sideOf(match, user);
  if (match.match_status !== 'pending') throw new HttpError(400, 'This match has already been confirmed.');

  const decision = req.body?.decision;
  if (decision === 'accept') {
    // Accepting means agreeing to share a phone number, so one must be on file
    if (req.body?.phoneNumber !== undefined) {
      await execute(
        `INSERT INTO user_profiles (user_id, phone_number) VALUES (?, ?) ON DUPLICATE KEY UPDATE phone_number = ?`,
        [user.userId, normalisePhone(req.body.phoneNumber), normalisePhone(req.body.phoneNumber)],
      );
    }
    const [profile] = await query<{ phone_number: string | null }>(
      `SELECT phone_number FROM user_profiles WHERE user_id = ?`, [user.userId],
    );
    if (!profile?.phone_number) throw new HttpError(400, 'Add your phone number so the other student can contact you.');

    const column = side === 'student' ? 'student_accepted_at' : 'helper_accepted_at';
    await execute(
      `INSERT INTO match_details (match_id, ${column}) VALUES (?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE ${column} = COALESCE(${column}, CURRENT_TIMESTAMP)`,
      [matchId],
    );

    const updated = await loadMatch(matchId);
    if (updated.student_accepted_at && updated.helper_accepted_at) {
      // Both said yes: confirm the match and tell both who the other person is
      await execute(`UPDATE peer_matches SET match_status = 'active' WHERE match_id = ?`, [matchId]);
      await notify(updated.student_id, `${updated.helper_name} is your peer tutor for ${updated.module_code}`,
        `You both accepted. ${updated.helper_name}'s phone number and email are on your dashboard.`,
        '/student#peer-help');
      await notify(updated.helper_id, `You're tutoring ${updated.student_name} in ${updated.module_code}`,
        `You both accepted. ${updated.student_name}'s phone number and email are on your dashboard.`,
        peerHelpLink(updated.helper_role));
      await notifyPairingLecturer(updated, `Pairing accepted: ${updated.module_code}`,
        `${updated.student_name} and ${updated.helper_name} both accepted your pairing and can now contact each other.`);
    } else if (side === 'student') {
      await notify(updated.helper_id, `${updated.student_name} accepted your help`,
        `${updated.student_name} would like you as their ${updated.module_code} peer tutor. Accept too to swap phone numbers and emails.`,
        peerHelpLink(updated.helper_role));
    } else {
      await notify(updated.student_id, `${updated.helper_name} has agreed to tutor you`,
        `${updated.helper_name} has accepted being your ${updated.module_code} peer tutor. Accept too to swap phone numbers and emails.`,
        '/student#peer-help');
    }
    return res.json({ match: forViewer(await loadMatch(matchId), user.userId) });
  }

  if (decision === 'decline') {
    // Forget the match, remember the pairing so it isn't suggested again
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        `INSERT INTO declined_matches (student_id, helper_id, module_code, declined_by) VALUES (?, ?, ?, ?)`,
        [match.student_id, match.helper_id, match.module_code, side],
      );
      await connection.query(`DELETE FROM peer_matches WHERE match_id = ?`, [matchId]);
      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    await notifyPairingLecturer(match, `Pairing declined: ${match.module_code}`,
      `${side === 'student' ? match.student_name : match.helper_name} declined your pairing of ` +
      `${match.student_name} with ${match.helper_name}.` +
      (side === 'helper' ? ' The student will be offered another peer tutor if one is free.' : ''));

    if (side === 'helper') {
      // Offer the student the next-best helper straight away
      const next = await recommendHelper(match.student_id, match.module_code, match.reason ?? 'Needs help');
      if (next.status === 'no_helper_available') {
        await notify(match.student_id, `Peer tutor for ${match.module_code}`,
          `${match.helper_name} isn’t available to tutor you. We’ll let you know as soon as another peer tutor is.`,
          '/student#peer-help');
      }
    } else {
      await notify(match.helper_id, `No longer needed: ${match.module_code}`,
        `${match.student_name} has decided not to go ahead with peer tutoring. Thanks for offering.`,
        peerHelpLink(match.helper_role));
    }
    // The helper may have capacity for someone else now
    await matchWaitingStudents(match.module_code);
    return res.json({ ok: true });
  }

  throw new HttpError(400, 'Choose accept or decline.');
});

// POST /api/matches/:id/complete: either side marks the help as finished
matchesRouter.post('/:id/complete', async (req, res) => {
  const user = currentUser(req);
  const matchId = idParam(req.params.id);
  const match = await loadMatch(matchId);
  const side = sideOf(match, user);
  if (match.match_status !== 'active') throw new HttpError(400, 'Only a confirmed match can be marked as finished.');

  await execute(`UPDATE peer_matches SET match_status = 'completed' WHERE match_id = ?`, [matchId]);
  const otherId = side === 'student' ? match.helper_id : match.student_id;
  const actorName = side === 'student' ? match.student_name : match.helper_name;
  await notify(otherId, `Peer tutoring finished: ${match.module_code}`,
    `${actorName} marked your ${match.module_code} peer tutoring as finished.`,
    side === 'student' ? peerHelpLink(match.helper_role) : '/student#peer-help');
  // Finishing frees the helper for another student in this module
  await matchWaitingStudents(match.module_code);
  res.json({ match: forViewer(await loadMatch(matchId), user.userId) });
});

// ---------------------------------------------------------------------
// /api/mentor-modules: the modules a volunteer peer mentor can support
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
