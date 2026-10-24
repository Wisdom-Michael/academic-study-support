import { Router } from 'express';
import { execute, query } from '../db';
import { requireRole } from '../middleware/auth';
import { computeStudentRisks, syncRiskAlerts } from '../services/risk';
import { HttpError, ResolutionStatus, RiskLevel } from '../types';
import { idParam } from '../validation';

// /api/analytics: faculty/admin only
const router = Router();
router.use(requireRole('faculty_admin'));

// GET /api/analytics/risk: recompute every student's risk index and refresh alerts.
// The dashboard polls this, so flags update as students study.
router.get('/risk', async (_req, res) => {
  const risks = await computeStudentRisks();
  await syncRiskAlerts(risks);
  risks.sort((a, b) => b.riskIndex - a.riskIndex);
  res.json({ generatedAt: new Date().toISOString(), students: risks });
});

// GET /api/analytics/overview: cohort-level figures for the dashboard charts
router.get('/overview', async (_req, res) => {
  // Student logins per day for the last 14 days (days with no logins are filled in as 0)
  const loginRows = await query<{ day: string; logins: number }>(
    `SELECT DATE_FORMAT(le.logged_in_at, '%Y-%m-%d') AS day, COUNT(*) AS logins
       FROM login_events le
       JOIN users u ON u.user_id = le.user_id AND u.role = 'student'
      WHERE le.logged_in_at >= CURDATE() - INTERVAL 13 DAY
      GROUP BY day`,
  );
  const loginsByDay = new Map(loginRows.map((r) => [r.day, Number(r.logins)]));
  const days = Array.from({ length: 14 }, (_, i) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - (13 - i));
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return { date: key, logins: loginsByDay.get(key) ?? 0 };
  });

  // Per module: how many students have started it, their average completion and score
  const modules = await query<{
    module_code: string; students: number; avg_completion: number | null; avg_score: number | null; chapters: number;
  }>(
    `SELECT cm.module_code,
            COUNT(DISTINCT mp.student_id) AS students,
            AVG(mp.completion_percentage) AS avg_completion,
            AVG(mp.score_achieved) AS avg_score,
            COUNT(DISTINCT cm.material_id) AS chapters
       FROM course_materials cm
       LEFT JOIN milestone_progress mp ON mp.material_id = cm.material_id
      GROUP BY cm.module_code
      ORDER BY cm.module_code`,
  );

  const [matches] = await query<{ pending: number; active: number }>(
    `SELECT SUM(match_status = 'pending') AS pending, SUM(match_status = 'active') AS active FROM peer_matches`,
  );

  res.json({
    loginsByDay: days,
    modules: modules.map((m) => ({
      moduleCode: m.module_code,
      chapters: Number(m.chapters),
      students: Number(m.students),
      averageCompletion: m.avg_completion === null ? null : Math.round(Number(m.avg_completion)),
      averageScore: m.avg_score === null ? null : Math.round(Number(m.avg_score)),
    })),
    matches: { pending: Number(matches?.pending ?? 0), active: Number(matches?.active ?? 0) },
  });
});

// GET /api/analytics/students/:id: one student's activity timeline
router.get('/students/:id', async (req, res) => {
  const studentId = idParam(req.params.id, 'Student ID');
  const [student] = await query<{ full_name: string; institutional_email: string }>(
    `SELECT full_name, institutional_email FROM users WHERE user_id = ? AND role = 'student'`, [studentId],
  );
  if (!student) throw new HttpError(404, 'Student not found.');

  const progress = await query<{
    material_id: number; title: string; module_code: string;
    completion_percentage: number; score_achieved: number | null; last_updated: Date;
  }>(
    `SELECT cm.material_id, cm.title, cm.module_code, mp.completion_percentage, mp.score_achieved, mp.last_updated
       FROM milestone_progress mp
       JOIN course_materials cm ON cm.material_id = mp.material_id
      WHERE mp.student_id = ?
      ORDER BY mp.last_updated DESC`,
    [studentId],
  );
  const logins = await query<{ logged_in_at: Date }>(
    `SELECT logged_in_at FROM login_events
      WHERE user_id = ? AND logged_in_at >= NOW() - INTERVAL 30 DAY
      ORDER BY logged_in_at DESC`,
    [studentId],
  );

  res.json({
    student: { userId: studentId, fullName: student.full_name, email: student.institutional_email },
    progress: progress.map((p) => ({
      materialId: p.material_id,
      title: p.title,
      moduleCode: p.module_code,
      completionPercentage: Number(p.completion_percentage),
      scoreAchieved: p.score_achieved,
      lastUpdated: p.last_updated,
    })),
    loginsLast30Days: logins.map((l) => l.logged_in_at),
  });
});

// GET /api/analytics/alerts
router.get('/alerts', async (_req, res) => {
  const rows = await query<{
    alert_id: number; student_id: number; full_name: string; institutional_email: string;
    risk_level: RiskLevel; trigger_reason: string; resolution_status: ResolutionStatus;
  }>(
    `SELECT ra.alert_id, ra.student_id, u.full_name, u.institutional_email,
            ra.risk_level, ra.trigger_reason, ra.resolution_status
       FROM risk_alerts ra
       JOIN users u ON u.user_id = ra.student_id
      ORDER BY FIELD(ra.resolution_status, 'unresolved', 'in_review', 'resolved'),
               FIELD(ra.risk_level, 'high', 'medium', 'low'),
               ra.alert_id DESC`,
  );
  res.json({
    alerts: rows.map((r) => ({
      alertId: r.alert_id,
      student: { userId: r.student_id, fullName: r.full_name, email: r.institutional_email },
      riskLevel: r.risk_level,
      triggerReason: r.trigger_reason,
      resolutionStatus: r.resolution_status,
    })),
  });
});

// PATCH /api/analytics/alerts/:id { resolutionStatus }
router.patch('/alerts/:id', async (req, res) => {
  const status = req.body?.resolutionStatus as ResolutionStatus;
  if (!['unresolved', 'in_review', 'resolved'].includes(status)) {
    throw new HttpError(400, 'Status must be unresolved, in review, or resolved.');
  }
  const result = await execute(
    `UPDATE risk_alerts SET resolution_status = ? WHERE alert_id = ?`, [status, idParam(req.params.id)],
  );
  if (result.affectedRows === 0) throw new HttpError(404, 'Alert not found.');
  res.json({ ok: true });
});

export default router;
