import { FormEvent, useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useLoad } from '../hooks';
import { LecturerMatch, PairingPerson } from '../types';
import Notice from './Notice';
import { Pill } from './ui';

const NEEDS_SUPPORT = 50;   // below this average, a student is listed as needing support
const DOING_WELL = 75;      // at or above this, a student is suggested as a peer tutor

const score = (p: PairingPerson) => (p.averageScore === null ? 'no checks yet' : `${p.averageScore}%`);

/** Status of a pairing in plain words, from the lecturer's point of view. */
function pairingStatus(m: LecturerMatch) {
  if (m.status === 'active') return <Pill tone="active">Matched</Pill>;
  if (m.status === 'completed') return <Pill tone="done">Finished</Pill>;
  if (!m.studentAccepted && !m.helperAccepted) return <Pill tone="pending">Waiting for both</Pill>;
  return <Pill tone="pending">Waiting for {(m.studentAccepted ? m.helperName : m.studentName).split(' ')[0]}</Pill>;
}

/**
 * Lecturer tool: pair a student who needs support with a peer tutor. Both get a
 * notification and must accept before their phone numbers and emails are shared.
 */
export default function PairStudents({ onPaired }: { onPaired?: () => void }) {
  const [moduleCode, setModuleCode] = useState('');
  const [studentId, setStudentId] = useState('');
  const [tutorId, setTutorId] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const options = useLoad(
    () => api<{ modules: string[]; people: PairingPerson[] }>(`/analytics/pairing-options?module=${encodeURIComponent(moduleCode)}`),
    [moduleCode],
  );
  const pairings = useLoad(() => api<{ matches: LecturerMatch[] }>('/matches').then((r) => r.matches), []);

  // Pick the first module once the list arrives
  useEffect(() => {
    if (!moduleCode && options.data?.modules.length) setModuleCode(options.data.modules[0]);
  }, [moduleCode, options.data]);

  const people = options.data?.people ?? [];
  const students = people.filter((p) => p.role === 'student');
  const needsSupport = students.filter((p) => p.averageScore !== null && p.averageScore < NEEDS_SUPPORT)
    .sort((a, b) => (a.averageScore ?? 0) - (b.averageScore ?? 0));
  const otherStudents = students.filter((p) => !needsSupport.includes(p));

  const candidates = people.filter((p) => String(p.userId) !== studentId);
  const doingWell = candidates.filter((p) => p.role === 'student' && p.averageScore !== null && p.averageScore >= DOING_WELL)
    .sort((a, b) => (b.averageScore ?? 0) - (a.averageScore ?? 0));
  const mentors = candidates.filter((p) => p.role === 'mentor' && p.mentorsModule);
  const otherTutors = candidates.filter((p) => !doingWell.includes(p) && !mentors.includes(p));

  const studentOption = (p: PairingPerson) => (
    <option key={p.userId} value={p.userId} disabled={Boolean(p.currentTutor)}>
      {p.fullName} ({score(p)}){p.currentTutor ? `, already has ${p.currentTutor}` : ''}
    </option>
  );
  const tutorOption = (p: PairingPerson) => (
    <option key={p.userId} value={p.userId}>
      {p.fullName} ({p.role === 'mentor' && p.averageScore === null ? 'peer mentor' : score(p)}
      {p.tutoringCount ? `, tutoring ${p.tutoringCount}` : ''})
    </option>
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setMessage(null);
    try {
      await api('/analytics/pairings', {
        method: 'POST',
        body: { moduleCode, studentId: Number(studentId), tutorId: Number(tutorId), note },
      });
      const student = people.find((p) => String(p.userId) === studentId)?.fullName;
      const tutor = people.find((p) => String(p.userId) === tutorId)?.fullName;
      setMessage({ tone: 'success', text: `Sent. ${student} and ${tutor} have been notified. Their details are swapped once both accept.` });
      setStudentId('');
      setTutorId('');
      setNote('');
      options.reload();
      pairings.reload();
      onPaired?.();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="pairing">
      <form className="pairing-form" onSubmit={handleSubmit}>
        <div className="form-row">
          <label className="field field-small">
            <span>Module</span>
            <select value={moduleCode} onChange={(e) => { setModuleCode(e.target.value); setStudentId(''); setTutorId(''); }}>
              {(options.data?.modules ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="field field-grow">
            <span>Student who needs support</span>
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)} required>
              <option value="">Choose a student</option>
              {needsSupport.length > 0 && <optgroup label={`Below ${NEEDS_SUPPORT}% in ${moduleCode}`}>{needsSupport.map(studentOption)}</optgroup>}
              {otherStudents.length > 0 && <optgroup label="Other students">{otherStudents.map(studentOption)}</optgroup>}
            </select>
          </label>
          <label className="field field-grow">
            <span>Peer tutor</span>
            <select value={tutorId} onChange={(e) => setTutorId(e.target.value)} required>
              <option value="">Choose a peer tutor</option>
              {doingWell.length > 0 && <optgroup label={`${DOING_WELL}% or more in ${moduleCode}`}>{doingWell.map(tutorOption)}</optgroup>}
              {mentors.length > 0 && <optgroup label={`Peer mentors for ${moduleCode}`}>{mentors.map(tutorOption)}</optgroup>}
              {otherTutors.length > 0 && <optgroup label="Everyone else">{otherTutors.map(tutorOption)}</optgroup>}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Note to both students <span className="muted">(optional)</span></span>
          <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Please go over recursion before the next quiz." />
        </label>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={sending || !studentId || !tutorId}>
            <Send size={16} aria-hidden="true" /> {sending ? 'Sending…' : 'Send pairing'}
          </button>
          <span className="muted pairing-hint">Both students get a notification and must accept before their phone numbers and emails are shared.</span>
        </div>
      </form>

      <h3 className="pairing-list-title">Peer tutoring pairs</h3>
      {pairings.data && pairings.data.length === 0 && <p className="muted">No pairs yet.</p>}
      <ul className="pairing-list">
        {(pairings.data ?? []).slice(0, 12).map((m) => (
          <li key={m.matchId}>
            <div className="pairing-row-main">
              <span className="module-tag">{m.moduleCode}</span>
              <span><strong>{m.studentName}</strong> with peer tutor <strong>{m.helperName}</strong></span>
            </div>
            <div className="pairing-row-meta">
              <span className="muted">{m.pairedBy ? `Paired by ${m.pairedBy}` : 'Suggested automatically'}</span>
              {pairingStatus(m)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
