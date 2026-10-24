import { config } from '../config';
import { execute, query } from '../db';
import { notify, peerHelpLink } from './notifications';

export interface MatchOutcome {
  status: 'created' | 'already_matched' | 'no_helper_available';
  matchId?: number;
  helperSummary?: string;
}

interface HelperCandidate {
  helper_id: number;
  role: 'student' | 'mentor';
  module_score: number | null;
  open_matches: number;
}

/**
 * Find the best person to help `studentId` in `moduleCode`.
 *
 *   1. Students doing well in the module: an average concept-check score of at least
 *      helperScoreThreshold (75%) there. Highest average first, then the least busy.
 *   2. If none is free, a volunteer peer mentor registered for the module, least busy first.
 *
 * Everyone skips: the student themself, people who have switched off being asked,
 * anyone already at capacity, and anyone this student and helper have declined before.
 */
async function findHelper(studentId: number, moduleCode: string): Promise<HelperCandidate | null> {
  const notDeclined = `NOT EXISTS (SELECT 1 FROM declined_matches d
                        WHERE d.student_id = ? AND d.helper_id = u.user_id AND d.module_code = ?)`;
  const openMatches = `(SELECT COUNT(*) FROM peer_matches pm
                         WHERE pm.mentor_id = u.user_id AND pm.match_status IN ('pending', 'active'))`;

  const [student] = await query<HelperCandidate>(
    `SELECT u.user_id AS helper_id, 'student' AS role,
            AVG(mp.score_achieved) AS module_score, ${openMatches} AS open_matches
       FROM users u
       JOIN milestone_progress mp ON mp.student_id = u.user_id AND mp.score_achieved IS NOT NULL
       JOIN course_materials cm ON cm.material_id = mp.material_id AND cm.module_code = ?
       LEFT JOIN user_profiles up ON up.user_id = u.user_id
      WHERE u.role = 'student' AND u.user_id <> ?
        AND COALESCE(up.available_to_help, 1) = 1
        AND ${notDeclined}
      GROUP BY u.user_id
     HAVING module_score >= ? AND open_matches < ?
      ORDER BY module_score DESC, open_matches ASC, u.user_id ASC
      LIMIT 1`,
    [moduleCode, studentId, studentId, moduleCode, config.helperScoreThreshold, config.studentHelperCapacity],
  );
  if (student) return student;

  const [mentor] = await query<HelperCandidate & { max_active_matches: number }>(
    `SELECT * FROM (
        SELECT u.user_id AS helper_id, 'mentor' AS role, NULL AS module_score,
               ${openMatches} AS open_matches, mm.max_active_matches
          FROM mentor_modules mm
          JOIN users u ON u.user_id = mm.mentor_id
          LEFT JOIN user_profiles up ON up.user_id = u.user_id
         WHERE mm.module_code = ? AND u.role = 'mentor' AND u.user_id <> ?
           AND COALESCE(up.available_to_help, 1) = 1
           AND ${notDeclined}
      ) AS mentors
      WHERE open_matches < max_active_matches
      ORDER BY open_matches ASC, helper_id ASC
      LIMIT 1`,
    [moduleCode, studentId, studentId, moduleCode],
  );
  return mentor ?? null;
}

/**
 * Peer-help recommendation, run when a student scores below the threshold.
 *
 * Creates a 'pending' match and notifies both people. Neither sees the other's
 * name or phone number until both accept (see routes/matches.ts).
 */
export async function recommendHelper(studentId: number, moduleCode: string, reason: string): Promise<MatchOutcome> {
  const [existing] = await query<{ match_id: number }>(
    `SELECT match_id FROM peer_matches
      WHERE student_id = ? AND module_code = ? AND match_status IN ('pending', 'active') LIMIT 1`,
    [studentId, moduleCode],
  );
  if (existing) return { status: 'already_matched', matchId: existing.match_id };

  const helper = await findHelper(studentId, moduleCode);
  if (!helper) return { status: 'no_helper_available' };

  const helperSummary = helper.role === 'student'
    ? `Averages ${Math.round(Number(helper.module_score))}% on ${moduleCode} concept checks`
    : `Volunteer peer mentor for ${moduleCode}`;

  const result = await execute(
    `INSERT INTO peer_matches (student_id, mentor_id, module_code, match_status) VALUES (?, ?, ?, 'pending')`,
    [studentId, helper.helper_id, moduleCode],
  );
  await execute(
    `INSERT INTO match_details (match_id, reason, helper_summary) VALUES (?, ?, ?)`,
    [result.insertId, reason.slice(0, 255), helperSummary],
  );

  await notify(studentId, `Peer help for ${moduleCode}`,
    `${helper.role === 'student' ? 'A student who is doing well in' : 'A volunteer peer mentor for'} ${moduleCode} can help you. ` +
    'Accept to swap names and phone numbers. Nothing is shared until you both agree.',
    '/student#peer-help');
  await notify(helper.helper_id, `Can you help a ${moduleCode} student?`,
    `A ${moduleCode} student ${reason.charAt(0).toLowerCase()}${reason.slice(1)}. ` +
    (helper.role === 'student' ? `You're one of the strongest students in ${moduleCode}. ` : '') +
    'Accept to swap names and phone numbers. Nothing is shared until you both agree.',
    peerHelpLink(helper.role));

  return { status: 'created', matchId: result.insertId, helperSummary };
}

/**
 * Backfill: when a new helper may be free for a module (a student scores well, a mentor
 * signs up for it, or a match finishes or is declined), recommend helpers to students who
 * are struggling in that module and don't have an open match for it.
 */
export async function matchWaitingStudents(moduleCode: string): Promise<number> {
  const waiting = await query<{ student_id: number; title: string; score: number }>(
    `SELECT mp.student_id, cm.title, mp.score_achieved AS score
       FROM milestone_progress mp
       JOIN course_materials cm ON cm.material_id = mp.material_id
       JOIN users u ON u.user_id = mp.student_id AND u.role = 'student'
      WHERE cm.module_code = ?
        AND mp.score_achieved < ?
        AND NOT EXISTS (SELECT 1 FROM peer_matches pm
                         WHERE pm.student_id = mp.student_id AND pm.module_code = cm.module_code
                           AND pm.match_status IN ('pending', 'active', 'completed'))
        -- A student who turned help down isn't offered it again until they struggle again
        AND NOT EXISTS (SELECT 1 FROM declined_matches d
                         WHERE d.student_id = mp.student_id AND d.module_code = cm.module_code
                           AND d.declined_by = 'student')
      ORDER BY mp.score_achieved ASC, mp.student_id ASC`,
    [moduleCode, config.matchScoreThreshold],
  );

  let created = 0;
  const seen = new Set<number>();
  for (const w of waiting) {
    if (seen.has(w.student_id)) continue; // one recommendation per student per module
    seen.add(w.student_id);
    const outcome = await recommendHelper(w.student_id, moduleCode, `Scored ${w.score}% on “${w.title}”`);
    if (outcome.status === 'no_helper_available') break;
    if (outcome.status === 'created') created++;
  }
  return created;
}
