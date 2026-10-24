import { FormEvent, useState } from 'react';
import { Check, HandHelping, LifeBuoy, Mail, Phone, ShieldCheck, X } from 'lucide-react';
import { api, errorMessage } from '../api';
import { PeerMatch, Profile } from '../types';
import Notice from './Notice';
import { Avatar, Pill } from './ui';

/**
 * Peer help: students who are struggling in a module are offered help from a classmate
 * who is doing well in it. Both get a notification; names, emails and phone numbers are
 * only exchanged once BOTH accept.
 */
interface PeerHelpProps {
  matches: PeerMatch[];
  profile: Profile | null;
  onChanged: () => void;
  /** Students can be helped and can help; mentors only help. */
  showGettingHelp?: boolean;
  /** Offer the "ask me to help others" switch (students only). */
  showAvailability?: boolean;
  onProfileChanged?: (profile: Profile) => void;
}

function statusPill(m: PeerMatch) {
  if (m.status === 'active') return <Pill tone="active">Matched</Pill>;
  if (m.status === 'completed') return <Pill tone="done">Finished</Pill>;
  return m.iAccepted ? <Pill tone="neutral">Waiting for them</Pill> : <Pill tone="pending">Waiting for you</Pill>;
}

function ContactCard({ contact }: { contact: NonNullable<PeerMatch['contact']> }) {
  return (
    <div className="contact-card">
      <Avatar name={contact.fullName} />
      <div className="contact-body">
        <p className="person-name">{contact.fullName}</p>
        {contact.phoneNumber && (
          <a href={`tel:${contact.phoneNumber.replace(/[^\d+]/g, '')}`} className="contact-line">
            <Phone size={15} aria-hidden="true" /> {contact.phoneNumber}
          </a>
        )}
        <a href={`mailto:${contact.email}`} className="contact-line">
          <Mail size={15} aria-hidden="true" /> {contact.email}
        </a>
      </div>
    </div>
  );
}

function MatchItem({ match, profile, onChanged }: { match: PeerMatch; profile: Profile | null; onChanged: () => void }) {
  const [accepting, setAccepting] = useState(false);
  const [phone, setPhone] = useState(profile?.phoneNumber ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const other = match.myRole === 'student' ? 'them' : 'the student';

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setAccepting(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function accept(event: FormEvent) {
    event.preventDefault();
    run(() => api(`/matches/${match.matchId}/respond`, { method: 'POST', body: { decision: 'accept', phoneNumber: phone } }));
  }

  function decline() {
    const question = match.iAccepted
      ? 'Withdraw from this match? Nothing has been shared yet.'
      : match.myRole === 'student'
        ? 'Decline this offer of help? We won’t suggest this person again.'
        : 'Decline this request? We’ll offer the student someone else.';
    if (!window.confirm(question)) return;
    run(() => api(`/matches/${match.matchId}/respond`, { method: 'POST', body: { decision: 'decline' } }));
  }

  return (
    <li className="peer-item">
      <div className="peer-item-head">
        <span className="module-tag">{match.moduleCode}</span>
        {statusPill(match)}
      </div>

      {match.contact ? (
        <ContactCard contact={match.contact} />
      ) : (
        <p className="peer-summary">{match.summary}</p>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      {match.status === 'pending' && !match.iAccepted && !accepting && (
        <div className="peer-actions">
          <button type="button" className="button-gold button-small" onClick={() => setAccepting(true)} disabled={busy}>
            <Check size={16} aria-hidden="true" /> Accept
          </button>
          <button type="button" className="button-secondary button-small" onClick={decline} disabled={busy}>
            <X size={16} aria-hidden="true" /> Decline
          </button>
        </div>
      )}

      {accepting && (
        <form className="accept-form" onSubmit={accept}>
          <label className="field">
            <span>Your phone number</span>
            <input
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+44 7700 900123"
              required
            />
          </label>
          <p className="muted accept-note">
            <ShieldCheck size={15} aria-hidden="true" /> Your name, email and phone number are shared with {other} only
            once you have both accepted.
          </p>
          <div className="peer-actions">
            <button type="submit" className="button-primary button-small" disabled={busy || !phone.trim()}>
              {busy ? 'Accepting…' : 'Accept and share my details'}
            </button>
            <button type="button" className="button-quiet" onClick={() => setAccepting(false)}>Cancel</button>
          </div>
        </form>
      )}

      {match.status === 'pending' && match.iAccepted && (
        <div className="peer-actions">
          <span className="muted">You’ve accepted. Their details appear here once they accept too.</span>
          <button type="button" className="button-quiet" onClick={decline} disabled={busy}>Withdraw</button>
        </div>
      )}

      {match.status === 'active' && (
        <div className="peer-actions">
          <button
            type="button"
            className="button-secondary button-small"
            disabled={busy}
            onClick={() => run(() => api(`/matches/${match.matchId}/complete`, { method: 'POST' }))}
          >
            Mark as finished
          </button>
        </div>
      )}
    </li>
  );
}

export default function PeerHelp({ matches, profile, onChanged, showGettingHelp = true, showAvailability = false, onProfileChanged }: PeerHelpProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = (m: PeerMatch) => m.status !== 'completed';
  const gettingHelp = matches.filter((m) => m.myRole === 'student' && open(m));
  const helping = matches.filter((m) => m.myRole === 'helper' && open(m));
  const finished = matches.filter((m) => m.status === 'completed');

  async function toggleAvailability(availableToHelp: boolean) {
    setSaving(true);
    setError(null);
    try {
      const result = await api<{ profile: Profile }>('/profile', { method: 'PUT', body: { availableToHelp } });
      onProfileChanged?.(result.profile);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="peer-help">
      <p className="peer-privacy">
        <ShieldCheck size={16} aria-hidden="true" /> Names and phone numbers are only shared once both of you accept.
      </p>

      {showGettingHelp && (
        <div className="peer-group">
          <h3><LifeBuoy size={16} aria-hidden="true" /> Help for you</h3>
          {gettingHelp.length === 0 ? (
            <p className="muted">
              Score below 50% on a concept check and you’ll be offered help from a classmate who is doing well in that module.
            </p>
          ) : (
            <ul className="peer-list">
              {gettingHelp.map((m) => <MatchItem key={m.matchId} match={m} profile={profile} onChanged={onChanged} />)}
            </ul>
          )}
        </div>
      )}

      <div className="peer-group">
        <h3><HandHelping size={16} aria-hidden="true" /> {showGettingHelp ? 'Students you could help' : 'Requests for your help'}</h3>
        {helping.length === 0 ? (
          <p className="muted">
            {showGettingHelp
              ? 'When you’re doing well in a module (75% or more on its concept checks), you may be asked to help a classmate.'
              : 'Students who need help in the modules you support will appear here.'}
          </p>
        ) : (
          <ul className="peer-list">
            {helping.map((m) => <MatchItem key={m.matchId} match={m} profile={profile} onChanged={onChanged} />)}
          </ul>
        )}
      </div>

      {finished.length > 0 && (
        <details className="history">
          <summary>Finished ({finished.length})</summary>
          <ul className="link-list">
            {finished.map((m) => (
              <li key={m.matchId}>
                <span>{m.contact?.fullName ?? 'Peer help'} <span className="muted">{m.myRole === 'student' ? 'helped you' : 'you helped'}</span></span>
                <span className="module-tag">{m.moduleCode}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {showAvailability && profile && (
        <label className="choice availability">
          <input
            type="checkbox"
            checked={profile.availableToHelp}
            disabled={saving}
            onChange={(e) => toggleAvailability(e.target.checked)}
          />
          <span>Ask me to help classmates in modules I’m doing well in</span>
        </label>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
