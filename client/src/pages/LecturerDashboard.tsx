import { Fragment, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { api, errorMessage } from '../api';
import { formatDate, formatDateTime } from '../format';
import { useLoad } from '../hooks';
import { CohortOverview, ResolutionStatus, RiskAlert, RiskLevel, StudentRisk, StudentTimeline } from '../types';
import { ColumnChart, Donut, MeterBar, RingMeter } from '../components/charts';
import Notice from '../components/Notice';
import { Avatar, Card, PageHeader, Pill } from '../components/ui';

const REFRESH_MS = 30_000;
const LEVELS: RiskLevel[] = ['high', 'medium', 'low'];
const levelLabel: Record<RiskLevel, string> = { high: 'High risk', medium: 'Medium risk', low: 'Low risk' };
const levelColor: Record<RiskLevel, string> = { high: 'var(--risk-high)', medium: 'var(--risk-medium)', low: 'var(--risk-low)' };
const statusLabel: Record<ResolutionStatus, string> = {
  unresolved: 'Not yet reviewed',
  in_review: 'In review',
  resolved: 'Resolved',
};

/** A student's last 30 days of logins as a strip of day cells, plus their reading history. */
function Timeline({ studentId }: { studentId: number }) {
  const timeline = useLoad(() => api<StudentTimeline>(`/analytics/students/${studentId}`), [studentId]);
  if (timeline.error) return <Notice tone="error">{timeline.error}</Notice>;
  if (!timeline.data) return <p className="muted">Loading activity…</p>;

  const loginDays = new Set(
    timeline.data.loginsLast30Days.map((d) => Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000)),
  );
  const days = Array.from({ length: 30 }, (_, i) => 29 - i); // oldest on the left

  return (
    <div className="timeline">
      <div>
        <h3>Logins over the last 30 days</h3>
        <div className="login-strip" role="img" aria-label={`Logged in on ${loginDays.size} of the last 30 days`}>
          {days.map((daysAgo) => (
            <span
              key={daysAgo}
              className={loginDays.has(daysAgo) ? 'login-day login-day-on' : 'login-day'}
              title={daysAgo === 0 ? 'Today' : `${daysAgo} days ago`}
            />
          ))}
        </div>
        <div className="login-strip-axis"><span>30 days ago</span><span>Today</span></div>
      </div>
      <div>
        <h3>Chapter activity</h3>
        {timeline.data.progress.length === 0 ? (
          <p className="muted">Hasn’t opened any course materials.</p>
        ) : (
          <ul className="activity-list">
            {timeline.data.progress.map((p) => (
              <li key={p.materialId}>
                <span className="activity-date">{formatDate(p.lastUpdated)}</span>
                <span>
                  {p.title} <span className="module-tag">{p.moduleCode}</span>
                  <span className="muted"> read {Math.round(p.completionPercentage)}%
                    {p.scoreAchieved !== null && <>, concept check {p.scoreAchieved}%</>}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function LecturerDashboard() {
  const risk = useLoad(() => api<{ generatedAt: string; students: StudentRisk[] }>('/analytics/risk'), []);
  // Recomputing risk also raises and updates alerts on the server, so reload these after each run
  const generatedAt = risk.data?.generatedAt;
  const alerts = useLoad(() => api<{ alerts: RiskAlert[] }>('/analytics/alerts').then((r) => r.alerts), [generatedAt]);
  const overview = useLoad(() => api<CohortOverview>('/analytics/overview'), [generatedAt]);
  const [filter, setFilter] = useState<RiskLevel | 'all'>('all');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [alertError, setAlertError] = useState<string | null>(null);

  // Real-time view: recompute the risk index every 30 seconds
  const { reload: refreshNow } = risk;
  useEffect(() => {
    const timer = window.setInterval(refreshNow, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refreshNow]);

  async function setAlertStatus(alert: RiskAlert, resolutionStatus: ResolutionStatus) {
    setAlertError(null);
    try {
      await api(`/analytics/alerts/${alert.alertId}`, { method: 'PATCH', body: { resolutionStatus } });
      alerts.setData((alerts.data ?? []).map((a) => (a.alertId === alert.alertId ? { ...a, resolutionStatus } : a)));
    } catch (err) {
      setAlertError(errorMessage(err));
    }
  }

  const students = risk.data?.students ?? [];
  const counts = Object.fromEntries(LEVELS.map((l) => [l, students.filter((s) => s.riskLevel === l).length])) as Record<RiskLevel, number>;
  const flagged = counts.high + counts.medium;
  const shown = filter === 'all' ? students : students.filter((s) => s.riskLevel === filter);
  const openAlerts = (alerts.data ?? []).filter((a) => a.resolutionStatus !== 'resolved');
  const resolvedAlerts = (alerts.data ?? []).filter((a) => a.resolutionStatus === 'resolved');
  const unreviewed = openAlerts.filter((a) => a.resolutionStatus === 'unresolved').length;

  const loginColumns = (overview.data?.loginsByDay ?? []).map((d, i, all) => {
    const date = new Date(`${d.date}T12:00:00`);
    return {
      key: d.date,
      label: i % 2 === all.length % 2 ? '' : String(date.getDate()),
      fullLabel: date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
      value: d.logins,
      highlight: i === all.length - 1,
    };
  });
  const totalLogins = loginColumns.reduce((sum, c) => sum + c.value, 0);

  return (
    <>
      <PageHeader
        title="Student risk"
        lede="Concept-check scores, chapter completion, login frequency and recent activity, combined into one risk index per student."
        actions={
          <>
            {risk.data && <span className="updated hide-phone">Updated {formatDateTime(risk.data.generatedAt)}</span>}
            <button type="button" className="button-secondary refresh-button" onClick={refreshNow} aria-label="Refresh">
              <RefreshCw size={16} aria-hidden="true" /> <span className="hide-phone">Refresh</span>
            </button>
          </>
        }
      />

      {risk.error && <Notice tone="error">{risk.error}</Notice>}

      <div className="overview-grid">
        <section className="feature-card" aria-labelledby="overview-title">
          <h2 id="overview-title">Risk overview</h2>
          <p className="hero-figure">
            {risk.data ? flagged : '–'}
            <span>{flagged === 1 ? 'student needs support' : 'students need support'}</span>
          </p>
          <ul className="feature-stats">
            {LEVELS.map((level) => (
              <li key={level}>
                <strong>{counts[level]}</strong>
                <span>{levelLabel[level]}</span>
              </li>
            ))}
          </ul>
          <a href="#alerts" className="button-gold button-small">
            {unreviewed ? `Review ${unreviewed} new alert${unreviewed === 1 ? '' : 's'}` : 'View alerts'}
          </a>
        </section>

        <Card title="Risk distribution">
          {risk.data && (
            <Donut
              totalLabel="students"
              segments={LEVELS.map((level) => ({ key: level, label: levelLabel[level], value: counts[level], color: levelColor[level] }))}
            />
          )}
        </Card>

        <Card title="Average completion by module">
          <div className="ring-row">
            {(overview.data?.modules ?? []).map((m) => (
              <RingMeter
                key={m.moduleCode}
                value={m.averageCompletion}
                label={`${m.moduleCode} average completion`}
                caption={m.moduleCode}
              />
            ))}
          </div>
          <p className="chart-note">Among students who have started each module.</p>
        </Card>
      </div>

      <div className="grid-main">
        <Card title="Student logins" action={<span className="card-meta">Last 14 days, {totalLogins} in total</span>}>
          {overview.error && <Notice tone="error">{overview.error}</Notice>}
          {overview.data && (
            <ColumnChart columns={loginColumns} unit="logins" unitOne="login" caption="Student logins per day, last 14 days" />
          )}
        </Card>

        <Card title="Concept checks by module">
          <ul className="module-bars">
            {(overview.data?.modules ?? []).map((m) => (
              <li key={m.moduleCode}>
                <div className="score-bar-head">
                  <span className="module-tag">{m.moduleCode}</span>
                  <span className="score-value">{m.averageScore === null ? 'No attempts' : `${m.averageScore}%`}</span>
                </div>
                <MeterBar value={m.averageScore ?? 0} tone={m.averageScore !== null && m.averageScore < 50 ? 'critical' : 'teal'}
                  label={`${m.moduleCode} average concept-check score`} />
              </li>
            ))}
          </ul>
          {overview.data && (
            <p className="chart-note">
              Peer mentoring: {overview.data.matches.active} active, {overview.data.matches.pending} waiting for a mentor to accept.
            </p>
          )}
        </Card>
      </div>

      <Card
        title="Students"
        className="table-card"
        action={
          <div className="segmented segmented-small" role="group" aria-label="Filter students by risk level">
            <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All {students.length}</button>
            {LEVELS.map((level) => (
              <button key={level} type="button" aria-pressed={filter === level} onClick={() => setFilter(level)}>
                {level === 'high' ? 'High' : level === 'medium' ? 'Medium' : 'Low'} {counts[level]}
              </button>
            ))}
          </div>
        }
      >
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Student</th>
                <th scope="col">Risk</th>
                <th scope="col" className="num">Avg. check</th>
                <th scope="col" className="num">Completion</th>
                <th scope="col" className="num">Logins, 14 days</th>
                <th scope="col" className="num">Last active</th>
                <th scope="col">Why</th>
              </tr>
            </thead>
            <tbody>
              {risk.loading && !risk.data && <tr><td colSpan={7} className="muted">Calculating…</td></tr>}
              {risk.data && shown.length === 0 && <tr><td colSpan={7} className="muted">No students at this risk level.</td></tr>}
              {shown.map((s) => {
                const isOpen = expanded === s.studentId;
                return (
                  <Fragment key={s.studentId}>
                    <tr className={`student-row risk-row-${s.riskLevel}${isOpen ? ' student-row-open' : ''}`}>
                      <th scope="row">
                        <button
                          type="button"
                          className="row-toggle"
                          aria-expanded={isOpen}
                          onClick={() => setExpanded(isOpen ? null : s.studentId)}
                        >
                          {isOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                          <Avatar name={s.fullName} size="sm" />
                          <span>
                            <span className="person-name">{s.fullName}</span>
                            <span className="person-meta">{s.metrics.modulesStarted.join(', ') || 'No modules started'}</span>
                          </span>
                        </button>
                      </th>
                      <td data-label="Risk">
                        <span className="risk-cell">
                          <span className="risk-number">{s.riskIndex}</span>
                          <Pill tone={s.riskLevel}>{levelLabel[s.riskLevel]}</Pill>
                        </span>
                      </td>
                      {/* On phones these four stay hidden until the row is expanded */}
                      <td className="num detail" data-label="Avg. check">{s.metrics.averageScore === null ? 'None taken' : `${s.metrics.averageScore}%`}</td>
                      <td className="num detail" data-label="Completion">{s.metrics.averageCompletion === null ? 'Not started' : `${s.metrics.averageCompletion}%`}</td>
                      <td className="num detail" data-label="Logins, 14 days">{s.metrics.loginsLast14Days}</td>
                      <td className="num detail" data-label="Last active">
                        {s.metrics.daysSinceActivity === null ? 'Never'
                          : s.metrics.daysSinceActivity === 0 ? 'Today'
                          : `${s.metrics.daysSinceActivity}d ago`}
                      </td>
                      <td className="reasons" data-label="Why">{s.reasons.length ? s.reasons.join('; ') : <span className="muted">On track</span>}</td>
                    </tr>
                    {isOpen && (
                      <tr className="timeline-row">
                        <td colSpan={7}><Timeline studentId={s.studentId} /></td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <details className="method">
          <summary>How the risk index is calculated</summary>
          <p>
            Four factors are each scored from 0 (no concern) to 100 (serious concern), then weighted
            and added up. An index of 60 or more is high risk; 35 to 59 is medium.
          </p>
          <ul>
            <li><strong>Concept checks, 35%:</strong> 100 minus the student’s average score. Students who haven’t taken any score 50.</li>
            <li><strong>Completion, 25%:</strong> 100 minus average completion across every chapter in the modules they’ve started.</li>
            <li><strong>Login frequency, 20%:</strong> rises as logins in the last 14 days fall below 6.</li>
            <li><strong>Inactivity, 20%:</strong> days since their last login or reading, reaching 100 at 14 days.</li>
          </ul>
        </details>
      </Card>

      <Card title="Early-warning alerts" id="alerts" className="alerts-card"
        action={<span className="card-meta">Raised automatically at medium or high risk</span>}>
        {alertError && <Notice tone="error">{alertError}</Notice>}
        {alerts.data && openAlerts.length === 0 && <p className="muted">No open alerts.</p>}
        <ul className="alert-list">
          {openAlerts.map((alert) => (
            <li key={alert.alertId} className={`alert-item alert-${alert.riskLevel}`}>
              <Avatar name={alert.student.fullName} />
              <div className="alert-body">
                <p className="person-name">
                  {alert.student.fullName} <Pill tone={alert.riskLevel}>{levelLabel[alert.riskLevel]}</Pill>
                </p>
                <p className="alert-reason">{alert.triggerReason}</p>
                <a className="person-meta hide-phone" href={`mailto:${alert.student.email}`}>{alert.student.email}</a>
              </div>
              <label className="field alert-status">
                <span>Status</span>
                <select value={alert.resolutionStatus} onChange={(e) => setAlertStatus(alert, e.target.value as ResolutionStatus)}>
                  {(Object.keys(statusLabel) as ResolutionStatus[]).map((status) => (
                    <option key={status} value={status}>{statusLabel[status]}</option>
                  ))}
                </select>
              </label>
            </li>
          ))}
        </ul>
        {resolvedAlerts.length > 0 && (
          <details className="history">
            <summary>Resolved alerts ({resolvedAlerts.length})</summary>
            <p className="muted">Resolving an alert hides it until that student’s risk level gets worse.</p>
            <ul className="link-list">
              {resolvedAlerts.map((alert) => (
                <li key={alert.alertId}>
                  <span>{alert.student.fullName} <span className="muted">{alert.triggerReason}</span></span>
                  <button type="button" className="button-quiet" onClick={() => setAlertStatus(alert, 'unresolved')}>Reopen</button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
    </>
  );
}
