import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, BookOpen, ChevronDown, GraduationCap, LayoutDashboard, LogOut, Search, Users,
} from 'lucide-react';
import { api } from '../api';
import { homePathFor, roleLabel, useAuth, useUser } from '../auth';
import { RiskAlert, Role } from '../types';
import NotificationsMenu from './NotificationsMenu';
import { Avatar } from './ui';

interface NavItem {
  to: string;
  label: string;
  short: string; // label in the phone/tablet drop-down
  icon: typeof LayoutDashboard;
}

const navItems: Record<Role, NavItem[]> = {
  student: [
    { to: '/student', label: 'Dashboard', short: 'Home', icon: LayoutDashboard },
    { to: '/materials', label: 'Course materials', short: 'Materials', icon: BookOpen },
  ],
  mentor: [
    { to: '/mentor', label: 'Mentoring', short: 'Mentoring', icon: Users },
    { to: '/materials', label: 'Course materials', short: 'Materials', icon: BookOpen },
  ],
  faculty_admin: [
    { to: '/lecturer', label: 'Student risk', short: 'Student risk', icon: Activity },
    { to: '/materials', label: 'Course materials', short: 'Materials', icon: BookOpen },
  ],
};

/** Lecturers: how many early-warning alerts haven't been reviewed (shown on the Student risk link). */
function useAlertCount(role: Role) {
  const [count, setCount] = useState(0);
  const location = useLocation();
  useEffect(() => {
    if (role !== 'faculty_admin') return;
    let cancelled = false;
    api<{ alerts: RiskAlert[] }>('/analytics/alerts')
      .then((r) => { if (!cancelled) setCount(r.alerts.filter((a) => a.resolutionStatus === 'unresolved').length); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [role, location.pathname]);
  return count;
}

/** Scroll to #section links (e.g. /student#peer-help) once the section has loaded. */
function useHashScroll() {
  const location = useLocation();
  useEffect(() => {
    if (!location.hash) return;
    const id = decodeURIComponent(location.hash.slice(1));
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.getElementById(id);
      if (el || ++tries > 30) {
        window.clearInterval(timer);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [location.pathname, location.hash, location.key]);
}

export default function Layout({ children }: { children: ReactNode }) {
  const user = useUser();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);     // phone/tablet drop-down
  const [searchOpen, setSearchOpen] = useState(false); // phone: expanded search field
  const [search, setSearch] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const notifications = useAlertCount(user.role);
  useHashScroll();
  const home = homePathFor(user.role);
  const items = navItems[user.role];

  useEffect(() => {
    setMenuOpen(false);
    setSearchOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);

  // The drop-down closes on a tap outside it or on Escape
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    const q = search.trim();
    navigate(q ? `/materials?q=${encodeURIComponent(q)}` : '/materials');
  }

  function signOut() {
    logout();
    navigate('/login');
  }

  const notificationLabel = `${notifications} unreviewed alert${notifications === 1 ? '' : 's'}`;

  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to content</a>

      {/* Desktop navigation */}
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-brand">
          <Link to={home} className="brand">
            <span className="brand-mark"><GraduationCap size={18} strokeWidth={2.4} aria-hidden="true" /></span>
            Study Support
          </Link>
        </div>

        <div className="profile">
          <Avatar name={user.fullName} size="lg" />
          <p className="profile-name">{user.fullName}</p>
          <p className="profile-email">{user.email}</p>
          <span className="profile-role">{roleLabel[user.role]}</span>
        </div>

        <nav className="sidenav">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to}>
              <Icon size={18} strokeWidth={2} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>

        <button type="button" className="sidenav-signout" onClick={signOut}>
          <LogOut size={18} aria-hidden="true" />
          Sign out
        </button>
      </aside>

      <div className="main">
        <header className={`topbar${searchOpen ? ' topbar-searching' : ''}`}>
          <Link to={home} className="brand topbar-brand">
            <span className="brand-mark"><GraduationCap size={16} strokeWidth={2.4} aria-hidden="true" /></span>
            <span className="topbar-brand-name">Study Support</span>
          </Link>
          <form className="topbar-search" role="search" onSubmit={handleSearch}>
            <Search size={16} aria-hidden="true" />
            <input
              ref={searchInput}
              type="search"
              placeholder="Search course materials"
              aria-label="Search course materials"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="button" className="search-cancel" onClick={() => setSearchOpen(false)}>Cancel</button>
          </form>
          <div className="topbar-right">
            <button type="button" className="icon-button search-toggle" onClick={() => setSearchOpen(true)} aria-label="Search course materials">
              <Search size={19} />
            </button>
            <NotificationsMenu />
            <span className="topbar-user">
              <Avatar name={user.fullName} size="sm" />
              <span className="topbar-name">{user.fullName}</span>
            </span>

            {/* Phone and tablet navigation: a drop-down with the account, pages and sign-out */}
            <div className="nav-menu" ref={menuRef}>
              <button
                type="button"
                className="nav-menu-toggle"
                aria-expanded={menuOpen}
                aria-controls="nav-menu-panel"
                onClick={() => setMenuOpen(!menuOpen)}
              >
                <Avatar name={user.fullName} size="sm" />
                <span className="sr-only">Menu</span>
                <ChevronDown size={16} aria-hidden="true" className="nav-menu-chevron" />
              </button>
              {menuOpen && (
                <div id="nav-menu-panel" className="nav-menu-panel">
                  <div className="nav-menu-account">
                    <Avatar name={user.fullName} />
                    <div>
                      <p className="person-name">{user.fullName}</p>
                      <p className="person-meta">{user.email}</p>
                      <span className="pill pill-active">{roleLabel[user.role]}</span>
                    </div>
                  </div>
                  <nav className="nav-menu-links" aria-label="Main navigation">
                    {items.map(({ to, short, icon: Icon }, index) => (
                      <NavLink key={to} to={to} onClick={() => setMenuOpen(false)}>
                        <Icon size={19} strokeWidth={2} aria-hidden="true" />
                        <span>{short}</span>
                        {index === 0 && notifications > 0 && (
                          <span className="nav-menu-count" aria-label={notificationLabel}>{notifications}</span>
                        )}
                      </NavLink>
                    ))}
                  </nav>
                  <button type="button" className="nav-menu-signout" onClick={signOut}>
                    <LogOut size={19} aria-hidden="true" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main" className="content">
          {children}
        </main>
      </div>
    </div>
  );
}
