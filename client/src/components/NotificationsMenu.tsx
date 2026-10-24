import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { api } from '../api';
import { formatDateTime } from '../format';
import { AppNotification } from '../types';

const REFRESH_MS = 60_000;

/** The bell in the top bar: peer-help recommendations, matches, and (for lecturers) new alerts. */
export default function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const load = useCallback(() => {
    api<{ notifications: AppNotification[]; unreadCount: number }>('/notifications')
      .then((r) => { setItems(r.notifications); setUnread(r.unreadCount); })
      .catch(() => {});
  }, []);

  // Refresh on every page change and once a minute
  useEffect(() => { load(); }, [load, location.pathname]);
  useEffect(() => {
    const timer = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function markRead(ids?: number[]) {
    await api('/notifications/read', { method: 'POST', body: ids ? { ids } : {} }).catch(() => {});
    load();
  }

  function openItem(item: AppNotification) {
    setOpen(false);
    if (!item.isRead) markRead([item.notificationId]);
    if (item.link) navigate(item.link);
  }

  return (
    <div className="notif-menu" ref={ref}>
      <button
        type="button"
        className="icon-button bell"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-controls="notif-panel"
        onClick={() => setOpen(!open)}
      >
        <Bell size={20} aria-hidden="true" />
        {unread > 0 && <span className="bell-count" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div id="notif-panel" className="notif-panel" role="region" aria-label="Notifications">
          <div className="notif-head">
            <h2>Notifications</h2>
            {unread > 0 && <button type="button" className="button-quiet" onClick={() => markRead()}>Mark all as read</button>}
          </div>
          {items.length === 0 ? (
            <p className="muted notif-empty">Nothing yet. Peer-help offers and matches will appear here.</p>
          ) : (
            <ul className="notif-list">
              {items.map((item) => (
                <li key={item.notificationId}>
                  <button type="button" className={item.isRead ? 'notif-item' : 'notif-item notif-unread'} onClick={() => openItem(item)}>
                    <span className="notif-title">{item.title}</span>
                    <span className="notif-body">{item.body}</span>
                    <span className="notif-time">{formatDateTime(item.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
