import { FormEvent, useState } from 'react';
import { BookMarked, CheckCircle2, Inbox, Plus, UserCheck, X } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useLoad } from '../hooks';
import { MentorModule, PeerMatch, Profile } from '../types';
import Notice from '../components/Notice';
import PeerHelp from '../components/PeerHelp';
import { Card, PageHeader, StatTile } from '../components/ui';

export default function MentorDashboard() {
  const matches = useLoad(() => api<{ matches: PeerMatch[] }>('/matches').then((r) => r.matches), []);
  const profile = useLoad(() => api<{ profile: Profile }>('/profile').then((r) => r.profile), []);
  const myModules = useLoad(() => api<{ modules: MentorModule[] }>('/mentor-modules').then((r) => r.modules), []);
  const knownModules = useLoad(() => api<{ modules: string[] }>('/materials/modules').then((r) => r.modules), []);

  const [newCode, setNewCode] = useState('');
  const [capacity, setCapacity] = useState(3);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const all = matches.data ?? [];
  const waitingForMe = all.filter((m) => m.status === 'pending' && !m.iAccepted);
  const active = all.filter((m) => m.status === 'active');
  const completed = all.filter((m) => m.status === 'completed');
  // Until matches arrive, show placeholders rather than zeros that read as real results
  const loaded = matches.data !== null;

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
          ? `Added ${code}. ${result.newMatches} student${result.newMatches === 1 ? ' who needs' : 's who need'} help in it ${result.newMatches === 1 ? 'is' : 'are'} waiting for your answer.`
          : `Added ${code}. Students who need help in it may be offered your support.`,
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
        lede="Students who score below 50% in a module you support may be asked whether they’d like your help. Contact details are swapped only once you both accept."
      />

      <div className="stat-row">
        <StatTile tone="gold" icon={Inbox} label="Waiting for you" value={loaded ? waitingForMe.length : '–'}
          detail={!loaded ? 'Loading…' : waitingForMe.length === 1 ? 'request to answer' : 'requests to answer'} />
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
        <Card title="Peer help" id="peer-help">
          {!loaded && !matches.error && <p className="muted">Loading…</p>}
          {matches.data && (
            <PeerHelp
              matches={matches.data}
              profile={profile.data}
              onChanged={() => { matches.reload(); profile.reload(); }}
              showGettingHelp={false}
            />
          )}
        </Card>

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
