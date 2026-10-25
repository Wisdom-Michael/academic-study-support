import { Link } from 'react-router-dom';
import { AlertTriangle, BookOpen, CheckCircle2, Clock, FileText, Target, Users } from 'lucide-react';
import { api } from '../api';
import { useUser } from '../auth';
import { daysAgo } from '../format';
import { useLoad } from '../hooks';
import { Material, PeerMatch, Profile } from '../types';
import { MeterBar } from '../components/charts';
import Notice from '../components/Notice';
import PeerHelp from '../components/PeerHelp';
import { Card, PageHeader, StatTile } from '../components/ui';

const PASS_THRESHOLD = 50;

export default function StudentDashboard() {
  const user = useUser();
  const materials = useLoad(() => api<{ materials: Material[] }>('/materials').then((r) => r.materials), []);
  const matches = useLoad(() => api<{ matches: PeerMatch[] }>('/matches').then((r) => r.matches), []);
  const profile = useLoad(() => api<{ profile: Profile }>('/profile').then((r) => r.profile), []);

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
  // Peer-help status for the tile: getting help first, then helping others
  const peer = matches.data ?? [];
  const helpedBy = peer.find((m) => m.myRole === 'student' && m.status === 'active');
  const helpOffer = peer.find((m) => m.myRole === 'student' && m.status === 'pending');
  const helpingCount = peer.filter((m) => m.myRole === 'helper' && m.status !== 'completed').length;
  const needsAnswer = peer.filter((m) => m.status === 'pending' && !m.iAccepted).length;
  // Until the data arrives, show placeholders rather than zeros that read as real results
  const loaded = materials.data !== null;
  const mentorsLoaded = matches.data !== null;
  const LOADING = '–';

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user.fullName.split(' ')[0]}`}
        lede="Here’s where you are across your modules."
        actions={<Link to="/materials" className="button-secondary hide-phone"><BookOpen size={16} aria-hidden="true" /> Browse materials</Link>}
      />

      {materials.error && <Notice tone="error">{materials.error}</Notice>}

      <div className="stat-row">
        <StatTile tone="teal" icon={Clock} label="In progress" value={loaded ? inProgress.length : LOADING}
          detail={loaded ? (inProgress.length === 1 ? 'chapter being read' : 'chapters being read') : 'Loading…'} />
        <StatTile tone="gold" icon={Target} label="Average check score"
          value={averageScore === null ? LOADING : `${averageScore}%`}
          detail={!loaded ? 'Loading…' : scores.length ? `across ${scores.length} concept check${scores.length === 1 ? '' : 's'}` : 'no checks taken yet'} />
        <StatTile tone="navy" icon={CheckCircle2} label="Chapters finished" value={loaded ? finished.length : LOADING}
          detail={loaded ? `of ${all.length} available` : 'Loading…'} />
        <StatTile tone="plain" icon={Users} label="Peer help"
          value={!mentorsLoaded ? LOADING
            : needsAnswer ? `${needsAnswer} to answer`
            : helpedBy ? helpedBy.otherName.split(' ')[0]
            : helpOffer ? 'Waiting'
            : helpingCount ? `Tutoring ${helpingCount}`
            : 'None'}
          detail={!mentorsLoaded ? 'Loading…'
            : needsAnswer ? 'see Peer help below'
            : helpedBy ? `is your ${helpedBy.moduleCode} peer tutor`
            : helpOffer ? `${helpOffer.otherName.split(' ')[0]}, ${helpOffer.moduleCode}`
            : helpingCount ? (helpingCount === 1 ? 'classmate you tutor' : 'classmates you tutor')
            : 'not needed so far'} />
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
            {!loaded ? (
              <p className="muted">Loading…</p>
            ) : checked.length === 0 ? (
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
                <p className="chart-note"><span className="threshold-key" aria-hidden="true" /> The line marks {PASS_THRESHOLD}%. Scores below it offer you a peer tutor.</p>
              </>
            )}
          </Card>
        </div>

        <div className="stack">
          <Card title="Peer help" id="peer-help">
            {matches.error && <Notice tone="error">{matches.error}</Notice>}
            {!mentorsLoaded && !matches.error && <p className="muted">Loading…</p>}
            {matches.data && (
              <PeerHelp
                matches={matches.data}
                profile={profile.data}
                onChanged={() => { matches.reload(); profile.reload(); }}
                onProfileChanged={profile.setData}
                showAvailability
              />
            )}
          </Card>

          <Card title="Not started yet">
            {!loaded ? (
              <p className="muted">Loading…</p>
            ) : notStarted.length === 0 ? (
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
