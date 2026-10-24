import { Link } from 'react-router-dom';
import { AlertTriangle, BookOpen, CheckCircle2, Clock, FileText, Target, Users } from 'lucide-react';
import { api } from '../api';
import { useUser } from '../auth';
import { daysAgo } from '../format';
import { useLoad } from '../hooks';
import { Match, Material } from '../types';
import { MeterBar } from '../components/charts';
import Notice from '../components/Notice';
import { Avatar, Card, PageHeader, Pill, StatTile } from '../components/ui';

const PASS_THRESHOLD = 50;

function MentorCard({ matches }: { matches: Match[] }) {
  if (matches.length === 0) {
    return (
      <p className="muted">
        If you score below {PASS_THRESHOLD}% on a concept check, you’ll be matched with a peer
        mentor for that module.
      </p>
    );
  }
  return (
    <ul className="people">
      {matches.map((match) => (
        <li key={match.matchId} className="person">
          <Avatar name={match.mentor.fullName} />
          <div className="person-body">
            <p className="person-name">{match.mentor.fullName}</p>
            <p className="person-meta">
              {match.status === 'active' && <a href={`mailto:${match.mentor.email}`}>{match.mentor.email}</a>}
              {match.status === 'pending' && 'Contact details appear once they accept'}
              {match.status === 'completed' && 'Mentoring finished'}
            </p>
          </div>
          <div className="person-end">
            <span className="module-tag">{match.moduleCode}</span>
            <Pill tone={match.status === 'active' ? 'active' : match.status === 'pending' ? 'pending' : 'done'}>
              {match.status === 'active' ? 'Active' : match.status === 'pending' ? 'Requested' : 'Finished'}
            </Pill>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function StudentDashboard() {
  const user = useUser();
  const materials = useLoad(() => api<{ materials: Material[] }>('/materials').then((r) => r.materials), []);
  const matches = useLoad(() => api<{ matches: Match[] }>('/matches').then((r) => r.matches), []);

  const all = materials.data ?? [];
  const started = all.filter((m) => m.progress);
  const inProgress = started
    .filter((m) => m.progress!.completionPercentage < 100)
    .sort((a, b) => new Date(b.progress!.lastUpdated).getTime() - new Date(a.progress!.lastUpdated).getTime());
  const finished = started.filter((m) => m.progress!.completionPercentage >= 100);
  const checked = started.filter((m) => m.progress!.scoreAchieved !== null);
  const notStarted = all.filter((m) => !m.progress);
  const scores = checked.map((m) => m.progress!.scoreAchieved!);
  const averageScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const activeMentor = (matches.data ?? []).find((m) => m.status === 'active');
  const pendingMentor = (matches.data ?? []).find((m) => m.status === 'pending');

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user.fullName.split(' ')[0]}`}
        lede="Here’s where you are across your modules."
        actions={<Link to="/materials" className="button-secondary hide-phone"><BookOpen size={16} aria-hidden="true" /> Browse materials</Link>}
      />

      {materials.error && <Notice tone="error">{materials.error}</Notice>}

      <div className="stat-row">
        <StatTile tone="teal" icon={Clock} label="In progress" value={inProgress.length}
          detail={inProgress.length === 1 ? 'chapter being read' : 'chapters being read'} />
        <StatTile tone="gold" icon={Target} label="Average check score"
          value={averageScore === null ? '–' : `${averageScore}%`}
          detail={scores.length ? `across ${scores.length} concept check${scores.length === 1 ? '' : 's'}` : 'no checks taken yet'} />
        <StatTile tone="navy" icon={CheckCircle2} label="Chapters finished" value={finished.length}
          detail={`of ${all.length} available`} />
        <StatTile tone="plain" icon={Users} label="Peer mentor"
          value={activeMentor ? activeMentor.mentor.fullName.split(' ')[0] : pendingMentor ? 'Requested' : 'None'}
          detail={activeMentor ? `for ${activeMentor.moduleCode}` : pendingMentor ? `for ${pendingMentor.moduleCode}` : 'not needed so far'} />
      </div>

      <div className="grid-main">
        <div className="stack">
          <Card title="Continue reading" action={<Link to="/materials" className="card-link">All materials</Link>}>
            {materials.loading && !materials.data && <p className="muted">Loading…</p>}
            {materials.data && inProgress.length === 0 && (
              <p className="muted">
                {notStarted.length ? 'Nothing in progress. Start a chapter from the list below.' : 'Everything you’ve started is finished.'}
              </p>
            )}
            <ul className="rows">
              {inProgress.map((m) => (
                <li key={m.materialId} className="row">
                  <span className="file-icon hide-phone"><FileText size={18} aria-hidden="true" /></span>
                  <div className="row-main">
                    <Link to={`/materials/${m.materialId}`} className="row-title">{m.title}</Link>
                    <p className="row-meta">{m.moduleCode}, last read {daysAgo(m.progress!.lastUpdated)}</p>
                  </div>
                  <div className="row-meter">
                    <MeterBar value={m.progress!.completionPercentage} label={`Reading progress for ${m.title}`} />
                    <span className="row-value">{Math.round(m.progress!.completionPercentage)}%</span>
                  </div>
                  <Link to={`/materials/${m.materialId}`} className="button-gold button-small">Continue</Link>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Concept check scores">
            {checked.length === 0 ? (
              <p className="muted">Finish a chapter and take its concept check to see your scores here.</p>
            ) : (
              <>
                <ul className="score-bars">
                  {checked.map((m) => {
                    const score = m.progress!.scoreAchieved!;
                    const low = score < PASS_THRESHOLD;
                    return (
                      <li key={m.materialId}>
                        <div className="score-bar-head">
                          <Link to={`/materials/${m.materialId}`}>{m.title}</Link>
                          <span className="score-value">
                            {low && <span className="score-flag"><AlertTriangle size={14} aria-hidden="true" /> Below {PASS_THRESHOLD}%</span>}
                            {score}%
                          </span>
                        </div>
                        <div className="score-track">
                          <MeterBar value={score} tone={low ? 'critical' : 'teal'} label={`Concept check score for ${m.title}`} />
                          <span className="threshold" style={{ left: `${PASS_THRESHOLD}%` }} aria-hidden="true" />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <p className="chart-note"><span className="threshold-key" aria-hidden="true" /> The line marks {PASS_THRESHOLD}%. Scores below it bring in a peer mentor.</p>
              </>
            )}
          </Card>
        </div>

        <div className="stack">
          <Card title="Peer mentoring">
            {matches.error && <Notice tone="error">{matches.error}</Notice>}
            {matches.data && <MentorCard matches={matches.data} />}
          </Card>

          <Card title="Not started yet">
            {notStarted.length === 0 ? (
              <p className="muted">You’ve opened every chapter.</p>
            ) : (
              <ul className="link-list">
                {notStarted.map((m) => (
                  <li key={m.materialId}>
                    <Link to={`/materials/${m.materialId}`}>{m.title}</Link>
                    <span className="module-tag">{m.moduleCode}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
