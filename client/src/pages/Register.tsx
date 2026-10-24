import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GraduationCap, Users } from 'lucide-react';
import { errorMessage } from '../api';
import { homePathFor, useAuth } from '../auth';
import AuthShell from '../components/AuthShell';
import Notice from '../components/Notice';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'student' | 'mentor'>('student');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const user = await register({ fullName, email, password, role });
      navigate(homePathFor(user.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <form className="auth-card" onSubmit={handleSubmit} noValidate>
        <h2>Create your account</h2>
        <p className="muted">Lecturer accounts are set up by the department.</p>

        <fieldset className="role-picker role-picker-two">
          <legend className="sr-only">I’m joining as</legend>
          <label className={role === 'student' ? 'role-option role-option-on' : 'role-option'}>
            <input type="radio" name="role" checked={role === 'student'} onChange={() => setRole('student')} />
            <GraduationCap size={18} aria-hidden="true" />
            Student
          </label>
          <label className={role === 'mentor' ? 'role-option role-option-on' : 'role-option'}>
            <input type="radio" name="role" checked={role === 'mentor'} onChange={() => setRole('mentor')} />
            <Users size={18} aria-hidden="true" />
            Peer mentor
          </label>
        </fieldset>

        {error && <Notice tone="error">{error}</Notice>}
        <label className="field">
          <span>Full name</span>
          <input autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </label>
        <label className="field">
          <span>Institutional email</span>
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="password-hint"
            required
          />
          <small id="password-hint">At least 8 characters.</small>
        </label>

        <button type="submit" className="button button-primary button-block" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
        <p className="auth-switch">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </AuthShell>
  );
}
