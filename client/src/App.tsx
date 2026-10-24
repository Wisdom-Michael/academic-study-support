import { ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { homePathFor, useAuth } from './auth';
import { Role } from './types';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import StudentDashboard from './pages/StudentDashboard';
import MentorDashboard from './pages/MentorDashboard';
import LecturerDashboard from './pages/LecturerDashboard';
import Repository from './pages/Repository';
import MaterialReader from './pages/MaterialReader';

/**
 * Role-based routing: signed-out users go to /login, and users who open
 * another role's dashboard are sent to their own.
 */
function Protected({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <p className="page-status">Loading…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homePathFor(user.role)} replace />;
  return <Layout>{children}</Layout>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="page-status">Loading…</p>;
  if (user) return <Navigate to={homePathFor(user.role)} replace />;
  return <>{children}</>;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <p className="page-status">Loading…</p>;
  return <Navigate to={user ? homePathFor(user.role) : '/login'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />

      <Route path="/student" element={<Protected roles={['student']}><StudentDashboard /></Protected>} />
      <Route path="/mentor" element={<Protected roles={['mentor']}><MentorDashboard /></Protected>} />
      <Route path="/lecturer" element={<Protected roles={['faculty_admin']}><LecturerDashboard /></Protected>} />
      <Route path="/faculty" element={<Navigate to="/lecturer" replace />} />

      <Route path="/materials" element={<Protected><Repository /></Protected>} />
      <Route path="/materials/:materialId" element={<Protected><MaterialReader /></Protected>} />

      <Route
        path="*"
        element={
          <main className="page-status">
            <h1>Page not found</h1>
            <p><Link to="/">Go to your dashboard</Link></p>
          </main>
        }
      />
    </Routes>
  );
}
