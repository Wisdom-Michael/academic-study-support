import { execute, query } from '../db';
import { RiskLevel } from '../types';

/**
 * Predictive student risk index.
 *
 * Each student gets four factor scores from 0 (no concern) to 100 (serious concern).
 * The risk index is their weighted sum, also 0-100:
 *
 *   Factor          Weight  How it is measured
 *   --------------  ------  ------------------------------------------------------------
 *   Concept checks   35%    100 minus the average concept-check score
 *   Completion       25%    100 minus average chapter completion in the modules they've started
 *   Login frequency  20%    Fewer than EXPECTED_LOGINS logins in the last 14 days raises it
 *   Inactivity       20%    Days since last login or reading activity, reaching 100 at 14 days
 *
 * A student with no data for a factor gets a neutral-to-concerned default, since a
 * student with no recorded activity is exactly the one faculty should look at.
 */
const WEIGHTS = { conceptScore: 0.35, completion: 0.25, logins: 0.2, inactivity: 0.2 };
const WINDOW_DAYS = 14;
const EXPECTED_LOGINS = 6;           // per 14-day window
const NO_SCORE_DEFAULT_RISK = 50;    // never attempted a concept check
const HIGH_THRESHOLD = 60;
const MEDIUM_THRESHOLD = 35;
const FACTOR_CONCERN = 50;           // factor scores at or above this are named in the alert reason

export interface StudentRisk {
  studentId: number;
  fullName: string;
  email: string;
  riskIndex: number;
  riskLevel: RiskLevel;
  factors: {
    conceptScore: number;
    completion: number;
    logins: number;
    inactivity: number;
  };
  metrics: {
    averageScore: number | null;
    averageCompletion: number | null;
    loginsLast14Days: number;
    daysSinceActivity: number | null;
    modulesStarted: string[];
  };
  reasons: string[];
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const average = (values: number[]) =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;

export function levelFor(index: number): RiskLevel {
  if (index >= HIGH_THRESHOLD) return 'high';
  if (index >= MEDIUM_THRESHOLD) return 'medium';
  return 'low';
}

/** Compute the risk index for every student. */
export async function computeStudentRisks(): Promise<StudentRisk[]> {
  const students = await query<{ user_id: number; full_name: string; institutional_email: string }>(
    `SELECT user_id, full_name, institutional_email FROM users WHERE role = 'student' ORDER BY full_name`,
  );

  const logins = await query<{ user_id: number; recent: number; last_login: Date | null }>(
    `SELECT user_id,
            SUM(logged_in_at >= NOW() - INTERVAL ? DAY) AS recent,
            MAX(logged_in_at) AS last_login
       FROM login_events GROUP BY user_id`,
    [WINDOW_DAYS],
  );

  const progress = await query<{
    student_id: number; material_id: number; module_code: string;
    completion_percentage: number; score_achieved: number | null; last_updated: Date;
  }>(
    `SELECT mp.student_id, mp.material_id, cm.module_code,
            mp.completion_percentage, mp.score_achieved, mp.last_updated
       FROM milestone_progress mp
       JOIN course_materials cm ON cm.material_id = mp.material_id`,
  );

  const materials = await query<{ material_id: number; module_code: string }>(
    `SELECT material_id, module_code FROM course_materials`,
  );

  const now = Date.now();
  const loginsByStudent = new Map(logins.map((l) => [l.user_id, l]));

  return students.map((student) => {
    const rows = progress.filter((p) => p.student_id === student.user_id);

    // Concept checks: average of every attempted check
    const scores = rows.filter((r) => r.score_achieved !== null).map((r) => r.score_achieved as number);
    const averageScore = average(scores);
    const conceptScore = averageScore === null ? NO_SCORE_DEFAULT_RISK : clamp(100 - averageScore);

    // Completion: across every chapter in each module the student has started,
    // so a chapter they haven't opened yet counts as 0% instead of being ignored
    const modulesStarted = [...new Set(rows.map((r) => r.module_code))];
    const completionByMaterial = new Map(rows.map((r) => [r.material_id, Number(r.completion_percentage)]));
    const expectedMaterials = materials.filter((m) => modulesStarted.includes(m.module_code));
    const averageCompletion = average(expectedMaterials.map((m) => completionByMaterial.get(m.material_id) ?? 0));
    const completion = averageCompletion === null ? 100 : clamp(100 - averageCompletion);

    // Login frequency in the last 14 days
    const loginInfo = loginsByStudent.get(student.user_id);
    const loginsLast14Days = Number(loginInfo?.recent ?? 0);
    const loginRisk = clamp(100 - (loginsLast14Days / EXPECTED_LOGINS) * 100);

    // Inactivity: most recent of last login and last reading activity
    const activityTimes = [
      ...rows.map((r) => new Date(r.last_updated).getTime()),
      ...(loginInfo?.last_login ? [new Date(loginInfo.last_login).getTime()] : []),
    ];
    const daysSinceActivity = activityTimes.length
      ? Math.floor((now - Math.max(...activityTimes)) / 86_400_000)
      : null;
    const inactivity = daysSinceActivity === null ? 100 : clamp((daysSinceActivity / WINDOW_DAYS) * 100);

    const riskIndex = Math.round(
      conceptScore * WEIGHTS.conceptScore +
      completion * WEIGHTS.completion +
      loginRisk * WEIGHTS.logins +
      inactivity * WEIGHTS.inactivity,
    );

    // Plain-language reasons for any factor that is a concern
    const reasons: string[] = [];
    if (conceptScore >= FACTOR_CONCERN) {
      reasons.push(averageScore === null
        ? 'Has not attempted any concept checks'
        : `Average concept-check score ${Math.round(averageScore)}%`);
    }
    if (completion >= FACTOR_CONCERN) {
      reasons.push(averageCompletion === null
        ? 'Has not started any course materials'
        : `Average chapter completion ${Math.round(averageCompletion)}%`);
    }
    if (loginRisk >= FACTOR_CONCERN) {
      reasons.push(loginsLast14Days === 0
        ? 'No logins in the last 14 days'
        : `Only ${loginsLast14Days} login${loginsLast14Days === 1 ? '' : 's'} in the last 14 days`);
    }
    if (inactivity >= FACTOR_CONCERN) {
      reasons.push(daysSinceActivity === null
        ? 'No recorded activity'
        : `No study activity for ${daysSinceActivity} days`);
    }

    return {
      studentId: student.user_id,
      fullName: student.full_name,
      email: student.institutional_email,
      riskIndex,
      riskLevel: levelFor(riskIndex),
      factors: {
        conceptScore: Math.round(conceptScore),
        completion: Math.round(completion),
        logins: Math.round(loginRisk),
        inactivity: Math.round(inactivity),
      },
      metrics: {
        averageScore: averageScore === null ? null : Math.round(averageScore),
        averageCompletion: averageCompletion === null ? null : Math.round(averageCompletion),
        loginsLast14Days,
        daysSinceActivity,
        modulesStarted,
      },
      reasons,
    };
  });
}

/**
 * Keep risk_alerts in step with the latest risk index.
 * - Medium/high student with no open alert: raise a new 'unresolved' alert.
 * - Student with an open alert (unresolved or in review): refresh its level and reason,
 *   so faculty always see current figures. Faculty resolve alerts themselves.
 * - Resolving an alert silences that student until their risk level gets worse
 *   than it was when the alert was resolved.
 */
const LEVEL_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export async function syncRiskAlerts(risks: StudentRisk[]): Promise<void> {
  const alerts = await query<{ alert_id: number; student_id: number; risk_level: RiskLevel; resolution_status: string }>(
    `SELECT alert_id, student_id, risk_level, resolution_status FROM risk_alerts ORDER BY alert_id`,
  );
  const openByStudent = new Map<number, number>();
  const lastResolvedLevel = new Map<number, RiskLevel>();
  for (const alert of alerts) {
    if (alert.resolution_status === 'resolved') lastResolvedLevel.set(alert.student_id, alert.risk_level);
    else openByStudent.set(alert.student_id, alert.alert_id);
  }

  for (const risk of risks) {
    const reason = risk.reasons.join('; ') || 'Risk index has returned to a low level';
    const openAlertId = openByStudent.get(risk.studentId);
    const resolvedLevel = lastResolvedLevel.get(risk.studentId);
    const worseThanLastResolved =
      resolvedLevel === undefined || LEVEL_RANK[risk.riskLevel] > LEVEL_RANK[resolvedLevel];

    if (openAlertId !== undefined) {
      await execute(
        `UPDATE risk_alerts SET risk_level = ?, trigger_reason = ? WHERE alert_id = ?`,
        [risk.riskLevel, reason, openAlertId],
      );
    } else if (risk.riskLevel !== 'low' && worseThanLastResolved) {
      await execute(
        `INSERT INTO risk_alerts (student_id, risk_level, trigger_reason, resolution_status)
         VALUES (?, ?, ?, 'unresolved')`,
        [risk.studentId, risk.riskLevel, reason],
      );
    }
  }
}
