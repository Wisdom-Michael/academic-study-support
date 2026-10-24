import { FormEvent, useState } from 'react';
import { BookMarked, CheckCircle2, Inbox, Plus, UserCheck, X } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useLoad } from '../hooks';
import { Match, MatchStatus, MentorModule } from '../types';
import Notice from '../components/Notice';
import { Avatar, Card, PageHeader, Pill, StatTile } from '../components/ui';

export default function MentorDashboard() {
  const matches = useLoad(() => api<{ matches: Match[] }>('/matches').then((r) => r.matches), []);
  const myModules = useLoad(() => api<{ modules: MentorModule[] }>('/mentor-modules').then((r) => r.modules), []);
  const knownModules = useLoad(() => api<{ modules: string[] }>('/materials/modules').then((r) => r.modules), []);

  const [newCode, setNewCode] = useState('');
  const [capacity, setCapacity] = useState(3);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const byStatus = (status: MatchStatus) => (matches.data ?? []).filter((m) => m.status === status);
  const pending = byStatus('pending');
  const active = byStatus('active');
  const completed = byStatus('completed');
  // Until matches arrive, show placeholders rather than zeros that read as real results
  const loaded = matches.data !== null;

  async function updateMatch(match: Match, status: MatchStatus) {
    setBusyId(match.matchId);
    setMessage(null);
    try {
      await api(`/matches/${match.matchId}`, { method: 'PATCH', body: { status } });
      setMessage({
        tone: 'success',
        text: status === 'active'
          ? `Accepted. ${match.student.fullName} can now see your contact details.`
          : `Marked mentoring with ${match.student.fullName} as finished.`,
      });
      matches.reload();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusyId(null);
    }
  }

  async function addModule(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      const code = newCode.toUpperCase();
      const result = await api<{ modules: MentorModule[]; newMatches: number }>('/mentor-modules', {
        method: 'POST',
        body: { moduleCode: code, maxActiveMatches: capacity },
      });
      myModules.setData(result.modules);
      setNewCode('');
      setMessage({
        tone: 'success',
        text: result.newMatches > 0
          ? `Added ${code}. ${result.newMatches} student${result.newMatches === 1 ? ' who needed' : 's who needed'} help in it ${result.newMatches === 1 ? 'has' : 'have'} been matched with you.`
          : `Added ${code}. You’ll be matched with students who need help in it.`,
      });
      matches.reload();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    }
  }

  async function removeModule(moduleCode: string) {
    setMessage(null);
    try {
      const result = await api<{ modules: MentorModule[] }>(`/mentor-modules/${moduleCode}`, { method: 'DELETE' });
      myModules.setData(result.modules);
      setMessage({ tone: 'success', text: `Removed ${moduleCode}. Your current students in it stay matched with you.` });
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    }
  }

  return (
    <>
      <PageHeader
        title="Mentoring"
        lede="Students are matched with you automatically when they score below 50% on a concept check in a module you support."
      />

      <div className="stat-row">
        <StatTile tone="gold" icon={Inbox} label="Waiting for you" value={loaded ? pending.length : '–'}
          detail={!loaded ? 'Loading…' : pending.length === 1 ? 'request to accept' : 'requests to accept'} />
        <StatTile tone="teal" icon={UserCheck} label="Supporting now" value={loaded ? active.length : '–'}
          detail={!loaded ? 'Loading…' : active.length === 1 ? 'student in an active match' : 'students in active matches'} />
        <StatTile tone="navy" icon={CheckCircle2} label="Finished" value={loaded ? completed.length : '–'}
          detail={loaded ? 'students mentored' : 'Loading…'} />
        <StatTile tone="plain" icon={BookMarked} label="Modules" value={myModules.data?.length ?? '–'}
          detail={!myModules.data ? 'Loading…' : myModules.data.map((m) => m.moduleCode).join(', ') || 'none yet'} />
      </div>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {matches.error && <Notice tone="error">{matches.error}</Notice>}

      <div className="grid-main">
        <div className="stack">
          <Card title="Waiting for you to accept">
            {matches.data && pending.length === 0 && <p className="muted">No new requests.</p>}
            <ul className="people">
              {pending.map((match) => (
                <li key={match.matchId} className="person">
                  <Avatar name={match.student.fullName} />
                  <div className="person-body">
                    <p className="person-name">{match.student.fullName}</p>
                    <p className="person-meta">Scored below 50% in a {match.moduleCode} concept check</p>
                  </div>
                  <div className="person-end">
                    <span className="module-tag">{match.moduleCode}</span>
                    <button type="button" className="button-gold button-small" disabled={busyId === match.matchId}
                      onClick={() => updateMatch(match, 'active')}>
                      Accept
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Students you’re supporting">
            {matches.data && active.length === 0 && <p className="muted">Accept a request to start mentoring.</p>}
            <ul className="people">
              {active.map((match) => (
                <li key={match.matchId} className="person">
                  <Avatar name={match.student.fullName} />
                  <div className="person-body">
                    <p className="person-name">{match.student.fullName}</p>
                    <p className="person-meta"><a href={`mailto:${match.student.email}`}>{match.student.email}</a></p>
                  </div>
                  <div className="person-end">
                    <span className="module-tag">{match.moduleCode}</span>
                    <button type="button" className="button-secondary button-small" disabled={busyId === match.matchId}
                      onClick={() => updateMatch(match, 'completed')}>
                      Mark as finished
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {completed.length > 0 && (
            <Card title="Finished">
              <ul className="people">
                {completed.map((match) => (
                  <li key={match.matchId} className="person">
                    <Avatar name={match.student.fullName} size="sm" />
                    <div className="person-body"><p className="person-name">{match.student.fullName}</p></div>
                    <div className="person-end">
                      <span className="module-tag">{match.moduleCode}</span>
                      <Pill tone="done">Finished</Pill>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <Card title="Modules you support">
          {myModules.data && myModules.data.length === 0 && (
            <p className="muted">Add a module you’ve passed so students in it can be matched with you.</p>
          )}
          <ul className="module-list">
            {(myModules.data ?? []).map((mod) => (
              <li key={mod.moduleCode}>
                <span className="module-tag module-tag-lg">{mod.moduleCode}</span>
                <span className="muted">up to {mod.maxActiveMatches} at once</span>
                <button type="button" className="icon-button" onClick={() => removeModule(mod.moduleCode)} aria-label={`Stop supporting ${mod.moduleCode}`}>
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>

          <form className="add-module" onSubmit={addModule}>
            <h3>Add a module</h3>
            <div className="form-row">
              <label className="field field-grow">
                <span>Module code</span>
                <input
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                  list="mentor-known-modules"
                  placeholder="CS201"
                  required
                />
                <datalist id="mentor-known-modules">
                  {(knownModules.data ?? []).map((code) => <option key={code} value={code} />)}
                </datalist>
              </label>
              <label className="field field-small">
                <span>Students</span>
                <input type="number" min={1} max={10} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
              </label>
            </div>
            <button type="submit" className="button-primary button-small"><Plus size={16} aria-hidden="true" /> Add module</button>
          </form>
        </Card>
      </div>
    </>
  );
}
