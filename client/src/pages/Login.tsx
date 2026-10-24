import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { GraduationCap, Presentation, Users } from 'lucide-react';
import { errorMessage } from '../api';
import { homePathFor, useAuth } from '../auth';
import { Role } from '../types';
import AuthShell from '../components/AuthShell';
import Notice from '../components/Notice';

const ROLE_KEY = 'study-support.sign-in-as';

const roleOptions: { role: Role; label: string; icon: typeof Users }[] = [
  { role: 'student', label: 'Student', icon: GraduationCap },
  { role: 'mentor', label: 'Peer mentor', icon: Users },
  { role: 'faculty_admin', label: 'Lecturer', icon: Presentation },
];

function rememberedRole(): Role {
  try {
    const saved = localStorage.getItem(ROLE_KEY);
    if (saved === 'student' || saved === 'mentor' || saved === 'faculty_admin') return saved;
  } catch {
    // Storage unavailable: fall back to student
  }
  return 'student';
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [role, setRole] = useState<Role>(rememberedRole);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function chooseRole(next: Role) {
    setRole(next);
    setError(null);
    try { localStorage.setItem(ROLE_KEY, next); } catch { /* not essential */ }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const user = await login(email, password, role);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/' ? from : homePathFor(user.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  const isLecturer = role === 'faculty_admin';

  return (
    <AuthShell>
      <form className="auth-card" onSubmit={handleSubmit} noValidate>
        <h2>Sign in</h2>
        <p className="muted">Choose your account type, then enter your university email.</p>

        <fieldset className="role-picker">
          <legend className="sr-only">Sign in as</legend>
          {roleOptions.map(({ role: value, label, icon: Icon }) => (
            <label key={value} className={role === value ? 'role-option role-option-on' : 'role-option'}>
              <input type="radio" name="role" checked={role === value} onChange={() => chooseRole(value)} />
              <Icon size={18} aria-hidden="true" />
              {label}
            </label>
          ))}
        </fieldset>

        {error && <Notice tone="error">{error}</Notice>}
        <label className="field">
          <span>{isLecturer ? 'Staff email' : 'Institutional email'}</span>
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button type="submit" className="button button-primary button-block" disabled={submitting}>
          {submitting ? 'Signing in…' : `Sign in as ${roleOptions.find((o) => o.role === role)!.label.toLowerCase()}`}
        </button>
        <p className="auth-switch">
          {isLecturer
            ? 'Lecturer accounts are set up by the department. Contact your administrator if you can’t sign in.'
            : <>New here? <Link to="/register">Create an account</Link></>}
        </p>
      </form>
    </AuthShell>
  );
}
