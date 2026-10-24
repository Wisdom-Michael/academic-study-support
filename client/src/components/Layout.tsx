import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, Bell, BookOpen, CircleUserRound, GraduationCap, LayoutDashboard, LogOut, Menu, Search, Users, X,
} from 'lucide-react';
import { api } from '../api';
import { homePathFor, roleLabel, useAuth, useUser } from '../auth';
import { Match, RiskAlert, Role } from '../types';
import { Avatar } from './ui';

interface NavItem {
  to: string;
  label: string;
  short: string; // label in the phone tab bar
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
    { to: '/lecturer', label: 'Student risk', short: 'Risk', icon: Activity },
    { to: '/materials', label: 'Course materials', short: 'Materials', icon: BookOpen },
  ],
};

/** Things waiting for this user: new mentor requests, or unreviewed risk alerts. */
function useNotifications(role: Role) {
  const [count, setCount] = useState(0);
  const location = useLocation();
  useEffect(() => {
    let cancelled = false;
    const load = role === 'mentor'
      ? api<{ matches: Match[] }>('/matches').then((r) => r.matches.filter((m) => m.status === 'pending').length)
      : role === 'faculty_admin'
        ? api<{ alerts: RiskAlert[] }>('/analytics/alerts').then((r) => r.alerts.filter((a) => a.resolutionStatus === 'unresolved').length)
        : Promise.resolve(0);
    load.then((n) => { if (!cancelled) setCount(n); }).catch(() => {});
    return () => { cancelled = true; };
  }, [role, location.pathname]);
  return count;
}

export default function Layout({ children }: { children: ReactNode }) {
  const user = useUser();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);        // tablet: slide-out sidebar
  const [accountOpen, setAccountOpen] = useState(false);  // phone: account sheet
  const [searchOpen, setSearchOpen] = useState(false);    // phone: expanded search field
  const [search, setSearch] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const sheetClose = useRef<HTMLButtonElement>(null);
  const notifications = useNotifications(user.role);
  const home = homePathFor(user.role);
  const items = navItems[user.role];

  useEffect(() => {
    setMenuOpen(false);
    setAccountOpen(false);
    setSearchOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);

  // The account sheet behaves like a dialog: focus moves in, Escape closes it
  useEffect(() => {
    if (!accountOpen) return;
    sheetClose.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAccountOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [accountOpen]);

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    const q = search.trim();
    navigate(q ? `/materials?q=${encodeURIComponent(q)}` : '/materials');
  }

  function signOut() {
    logout();
    navigate('/login');
  }

  const notificationLabel = user.role === 'mentor'
    ? `${notifications} new mentoring request${notifications === 1 ? '' : 's'}`
    : `${notifications} unreviewed alert${notifications === 1 ? '' : 's'}`;

  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to content</a>

      {/* Desktop and tablet navigation */}
      <aside className={`sidebar${menuOpen ? ' sidebar-open' : ''}`} aria-label="Main navigation">
        <div className="sidebar-brand">
          <Link to={home} className="brand">
            <span className="brand-mark"><GraduationCap size={18} strokeWidth={2.4} aria-hidden="true" /></span>
            Study Support
          </Link>
          <button type="button" className="icon-button sidebar-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">
            <X size={20} />
          </button>
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
      {menuOpen && <div className="scrim scrim-menu" onClick={() => setMenuOpen(false)} aria-hidden="true" />}

      <div className="main">
        <header className={`topbar${searchOpen ? ' topbar-searching' : ''}`}>
          <button type="button" className="icon-button menu-button" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu size={22} />
          </button>
          <Link to={home} className="brand topbar-brand" aria-label="Study Support home">
            <span className="brand-mark"><GraduationCap size={16} strokeWidth={2.4} aria-hidden="true" /></span>
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
            {user.role !== 'student' && (
              <Link to={user.role === 'mentor' ? '/mentor' : '/lecturer#alerts'} className="icon-button bell" aria-label={notificationLabel}>
                <Bell size={20} aria-hidden="true" />
                {notifications > 0 && <span className="bell-count" aria-hidden="true">{notifications}</span>}
              </Link>
            )}
            <span className="topbar-user">
              <Avatar name={user.fullName} size="sm" />
              <span className="topbar-name">{user.fullName}</span>
            </span>
          </div>
        </header>
        <main id="main" className="content">
          {children}
        </main>
      </div>

      {/* Phone navigation: a tab bar within thumb reach */}
      <nav className="tabbar" aria-label="Main navigation">
        {items.map(({ to, short, icon: Icon }, index) => (
          <NavLink key={to} to={to} className="tab">
            <span className="tab-icon">
              <Icon size={21} strokeWidth={2} aria-hidden="true" />
              {index === 0 && notifications > 0 && <span className="tab-badge" aria-label={notificationLabel}>{notifications}</span>}
            </span>
            {short}
          </NavLink>
        ))}
        <button
          type="button"
          className={`tab${accountOpen ? ' active' : ''}`}
          onClick={() => setAccountOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={accountOpen}
        >
          <span className="tab-icon"><CircleUserRound size={21} strokeWidth={2} aria-hidden="true" /></span>
          Account
        </button>
      </nav>

      {accountOpen && (
        <>
          <div className="scrim scrim-sheet" onClick={() => setAccountOpen(false)} aria-hidden="true" />
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="account-sheet-title">
            <span className="sheet-handle" aria-hidden="true" />
            <div className="sheet-profile">
              <Avatar name={user.fullName} size="lg" />
              <div>
                <p className="person-name" id="account-sheet-title">{user.fullName}</p>
                <p className="person-meta">{user.email}</p>
                <span className="pill pill-active">{roleLabel[user.role]}</span>
              </div>
            </div>
            <button type="button" className="button-secondary button-block" onClick={signOut}>
              <LogOut size={17} aria-hidden="true" /> Sign out
            </button>
            <button type="button" ref={sheetClose} className="button-quiet sheet-close" onClick={() => setAccountOpen(false)}>
              Close
            </button>
          </div>
        </>
      )}
    </div>
  );
}
