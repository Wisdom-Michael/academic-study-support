import { config } from '../config';
import { execute, query } from '../db';
import { HttpError } from '../types';
import { notify, peerHelpLink } from './notifications';

export interface MatchOutcome {
  status: 'created' | 'already_matched' | 'no_helper_available';
  matchId?: number;
  helperName?: string;
  helperSummary?: string;
}

interface HelperCandidate {
  helper_id: number;
  full_name: string;
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
    `SELECT u.user_id AS helper_id, u.full_name, 'student' AS role,
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
        SELECT u.user_id AS helper_id, u.full_name, 'mentor' AS role, NULL AS module_score,
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
 * Peer-tutor recommendation, run when a student scores below the threshold.
 *
 * Creates a 'pending' match and notifies both people by name. Phone numbers and
 * emails are only shared once both accept (see routes/matches.ts).
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
    : `Is a volunteer peer mentor for ${moduleCode}`;

  const matchId = await insertMatch({ studentId, helperId: helper.helper_id, moduleCode, reason, helperSummary });
  const [student] = await query<{ full_name: string }>(`SELECT full_name FROM users WHERE user_id = ?`, [studentId]);

  await notify(studentId, `${helper.full_name} could be your ${moduleCode} peer tutor`,
    `${helper.full_name} ${lowerFirst(helperSummary)} and could tutor you. ` +
    'Accept to swap phone numbers and emails; they are only shared once you both agree.',
    '/student#peer-help');
  await notify(helper.helper_id, `Can you tutor ${student.full_name}?`,
    `${student.full_name} ${lowerFirst(reason)} in ${moduleCode}. ` +
    (helper.role === 'student' ? `You're one of the strongest students in ${moduleCode}. ` : '') +
    'Accept to swap phone numbers and emails; they are only shared once you both agree.',
    peerHelpLink(helper.role));

  return { status: 'created', matchId, helperName: helper.full_name, helperSummary };
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Create a 'pending' match and its details row. */
async function insertMatch(m: {
  studentId: number; helperId: number; moduleCode: string; reason: string; helperSummary: string;
  pairedById?: number; lecturerNote?: string | null;
}): Promise<number> {
  const result = await execute(
    `INSERT INTO peer_matches (student_id, mentor_id, module_code, match_status) VALUES (?, ?, ?, 'pending')`,
    [m.studentId, m.helperId, m.moduleCode],
  );
  await execute(
    `INSERT INTO match_details (match_id, reason, helper_summary, paired_by_id, lecturer_note) VALUES (?, ?, ?, ?, ?)`,
    [result.insertId, m.reason.slice(0, 255), m.helperSummary.slice(0, 255), m.pairedById ?? null, m.lecturerNote ?? null],
  );
  return result.insertId;
}

/** A user's average concept-check score in one module, or null if they haven't taken any there. */
async function moduleAverage(userId: number, moduleCode: string): Promise<number | null> {
  const [row] = await query<{ avg_score: number | null }>(
    `SELECT AVG(mp.score_achieved) AS avg_score
       FROM milestone_progress mp
       JOIN course_materials cm ON cm.material_id = mp.material_id AND cm.module_code = ?
      WHERE mp.student_id = ? AND mp.score_achieved IS NOT NULL`,
    [moduleCode, userId],
  );
  return row?.avg_score === null || row?.avg_score === undefined ? null : Math.round(Number(row.avg_score));
}

/**
 * A lecturer pairs a student who needs support with a peer tutor of their choosing.
 * It works like an automatic suggestion (a 'pending' match both must accept), but the
 * lecturer's choice overrides the automatic limits such as the tutor's capacity.
 */
export async function pairByLecturer(p: {
  lecturer: { userId: number; fullName: string };
  studentId: number;
  tutorId: number;
  moduleCode: string;
  note: string | null;
}): Promise<{ matchId: number }> {
  if (p.studentId === p.tutorId) throw new HttpError(400, 'Choose two different people.');

  const people = await query<{ user_id: number; full_name: string; role: string }>(
    `SELECT user_id, full_name, role FROM users WHERE user_id IN (?, ?)`, [p.studentId, p.tutorId],
  );
  const student = people.find((u) => u.user_id === p.studentId);
  const tutor = people.find((u) => u.user_id === p.tutorId);
  if (!student || student.role !== 'student') throw new HttpError(400, 'Choose a student who needs support.');
  if (!tutor || (tutor.role !== 'student' && tutor.role !== 'mentor')) {
    throw new HttpError(400, 'The peer tutor must be a student or a peer mentor.');
  }

  const [existing] = await query<{ tutor_name: string }>(
    `SELECT u.full_name AS tutor_name FROM peer_matches pm JOIN users u ON u.user_id = pm.mentor_id
      WHERE pm.student_id = ? AND pm.module_code = ? AND pm.match_status IN ('pending', 'active') LIMIT 1`,
    [p.studentId, p.moduleCode],
  );
  if (existing) {
    throw new HttpError(409, `${student.full_name} already has a peer tutor for ${p.moduleCode} (${existing.tutor_name}).`);
  }

  // What each side is told about the other
  const studentAverage = await moduleAverage(p.studentId, p.moduleCode);
  const tutorAverage = await moduleAverage(p.tutorId, p.moduleCode);
  const [mentorsModule] = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM mentor_modules WHERE mentor_id = ? AND module_code = ?`, [p.tutorId, p.moduleCode],
  );
  const reason = studentAverage !== null
    ? `Averages ${studentAverage}% on ${p.moduleCode} concept checks`
    : `Needs support in ${p.moduleCode}`;
  const helperSummary = tutorAverage !== null
    ? `Averages ${tutorAverage}% on ${p.moduleCode} concept checks`
    : Number(mentorsModule?.n) > 0
      ? `Is a volunteer peer mentor for ${p.moduleCode}`
      : `Was chosen by ${p.lecturer.fullName} to tutor you`;

  const matchId = await insertMatch({
    studentId: p.studentId, helperId: p.tutorId, moduleCode: p.moduleCode, reason, helperSummary,
    pairedById: p.lecturer.userId, lecturerNote: p.note,
  });

  const noteLine = p.note ? ` Note from ${p.lecturer.fullName}: “${p.note}”` : '';
  const consent = ' Accept to swap phone numbers and emails; they are only shared once you both agree.';
  await notify(p.studentId, `${p.lecturer.fullName} paired you with a peer tutor`,
    `${p.lecturer.fullName} has paired you with ${tutor.full_name} for ${p.moduleCode}. ` +
    `${tutor.full_name.split(' ')[0]} ${lowerFirst(helperSummary)}.${noteLine}${consent}`,
    '/student#peer-help');
  await notify(p.tutorId, `${p.lecturer.fullName} asked you to tutor ${student.full_name}`,
    `${p.lecturer.fullName} has paired you with ${student.full_name} for ${p.moduleCode} and would like you to be their peer tutor.` +
    `${noteLine}${consent}`,
    peerHelpLink(tutor.role));

  return { matchId };
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
