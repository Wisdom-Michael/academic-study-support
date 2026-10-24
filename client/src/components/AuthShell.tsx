import { ReactNode } from 'react';
import { BookOpenCheck, GraduationCap, LineChart, Users } from 'lucide-react';

const features = [
  { icon: BookOpenCheck, title: 'Read and check', text: 'Course notes for every module, with a short concept check at the end of each chapter.' },
  { icon: Users, title: 'Get a peer mentor', text: 'Score below 50% and you’re matched with a mentor who has passed the module.' },
  { icon: LineChart, title: 'Early warning for lecturers', text: 'A live risk index shows which students need support before it’s too late.' },
];

/** Two-panel frame for the sign-in and registration pages. */
export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <section className="auth-panel">
        <span className="auth-orb" aria-hidden="true" />
        <p className="brand brand-light">
          <span className="brand-mark"><GraduationCap size={18} strokeWidth={2.4} aria-hidden="true" /></span>
          Study Support
        </p>
        <h1>Study support for Computer Science students</h1>
        <ul className="auth-features">
          {features.map(({ icon: Icon, title, text }) => (
            <li key={title}>
              <span className="auth-feature-icon"><Icon size={18} aria-hidden="true" /></span>
              <span>
                <strong>{title}</strong>
                {text}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <div className="auth-side">{children}</div>
    </div>
  );
}
