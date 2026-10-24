import { config } from '../config';
import { execute, query } from '../db';

export interface MatchOutcome {
  status: 'created' | 'already_matched' | 'no_mentor_available';
  matchId?: number;
  mentorName?: string;
}

interface MentorCandidate {
  mentor_id: number;
  full_name: string;
  open_matches: number;
  max_active_matches: number;
}

/**
 * Peer-mentorship matching algorithm.
 *
 * Called when a student scores below the threshold on a concept check.
 *   1. If the student already has a pending or active match for this module, do nothing.
 *   2. Find every mentor who has signed up to support this module.
 *   3. Drop mentors who are already at their capacity (pending + active matches).
 *   4. Pick the mentor with the fewest open matches, so work is spread evenly.
 *   5. Create a 'pending' match. The mentor accepts it from their dashboard.
 */
export async function matchStudentWithMentor(studentId: number, moduleCode: string): Promise<MatchOutcome> {
  // Step 1: avoid duplicate matches for the same module
  const existing = await query<{ match_id: number }>(
    `SELECT match_id FROM peer_matches
      WHERE student_id = ? AND module_code = ? AND match_status IN ('pending', 'active')
      LIMIT 1`,
    [studentId, moduleCode],
  );
  if (existing.length > 0) {
    return { status: 'already_matched', matchId: existing[0].match_id };
  }

  // Steps 2-4: mentors for this module, least busy first, excluding anyone at capacity
  const candidates = await query<MentorCandidate>(
    `SELECT * FROM (
        SELECT u.user_id AS mentor_id,
               u.full_name,
               mm.max_active_matches,
               (SELECT COUNT(*) FROM peer_matches pm
                 WHERE pm.mentor_id = u.user_id AND pm.match_status IN ('pending', 'active')) AS open_matches
          FROM mentor_modules mm
          JOIN users u ON u.user_id = mm.mentor_id
         WHERE mm.module_code = ?
           AND u.role = 'mentor'
           AND u.user_id <> ?
      ) AS candidates
      WHERE open_matches < max_active_matches
      ORDER BY open_matches ASC, mentor_id ASC
      LIMIT 1`,
    [moduleCode, studentId],
  );
  if (candidates.length === 0) {
    return { status: 'no_mentor_available' };
  }

  // Step 5: record the pending match
  const mentor = candidates[0];
  const result = await execute(
    `INSERT INTO peer_matches (student_id, mentor_id, module_code, match_status)
     VALUES (?, ?, ?, 'pending')`,
    [studentId, mentor.mentor_id, moduleCode],
  );
  return { status: 'created', matchId: result.insertId, mentorName: mentor.full_name };
}

/**
 * Backfill: when mentor capacity opens up for a module (a mentor signs up for it,
 * or finishes a match), match students who scored below the threshold in that
 * module but have never been matched for it, e.g. because no mentor was free.
 */
export async function matchWaitingStudents(moduleCode: string): Promise<number> {
  const waiting = await query<{ student_id: number }>(
    `SELECT DISTINCT mp.student_id
       FROM milestone_progress mp
       JOIN course_materials cm ON cm.material_id = mp.material_id
      WHERE cm.module_code = ?
        AND mp.score_achieved < ?
        AND NOT EXISTS (SELECT 1 FROM peer_matches pm
                         WHERE pm.student_id = mp.student_id AND pm.module_code = cm.module_code)
      ORDER BY mp.student_id`,
    [moduleCode, config.matchScoreThreshold],
  );

  let created = 0;
  for (const { student_id } of waiting) {
    const outcome = await matchStudentWithMentor(student_id, moduleCode);
    if (outcome.status === 'no_mentor_available') break;
    if (outcome.status === 'created') created++;
  }
  return created;
}
