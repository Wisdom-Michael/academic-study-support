import { Router } from 'express';
import { execute, query } from '../db';
import { currentUser } from '../middleware/auth';
import { HttpError } from '../types';

// /api/profile: the signed-in user's contact details and peer-help preference
export const profileRouter = Router();

/** Accept common phone formats (+44 7700 900123, (020) 7946 0958, 080-1234-5678) and tidy spacing. */
export function normalisePhone(value: unknown): string {
  const phone = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  const digits = phone.replace(/\D/g, '');
  if (!/^\+?[\d\s()\-.]+$/.test(phone) || digits.length < 7 || digits.length > 15) {
    throw new HttpError(400, 'Enter a valid phone number, for example +44 7700 900123.');
  }
  return phone;
}

async function loadProfile(userId: number) {
  const [row] = await query<{ phone_number: string | null; available_to_help: number }>(
    `SELECT phone_number, available_to_help FROM user_profiles WHERE user_id = ?`, [userId],
  );
  return { phoneNumber: row?.phone_number ?? null, availableToHelp: row ? Boolean(row.available_to_help) : true };
}

profileRouter.get('/', async (req, res) => {
  res.json({ profile: await loadProfile(currentUser(req).userId) });
});

// PUT /api/profile { phoneNumber?, availableToHelp? }
profileRouter.put('/', async (req, res) => {
  const userId = currentUser(req).userId;
  const current = await loadProfile(userId);
  const phone = req.body?.phoneNumber === undefined ? current.phoneNumber
    : req.body.phoneNumber === null || req.body.phoneNumber === '' ? null
    : normalisePhone(req.body.phoneNumber);
  const available = typeof req.body?.availableToHelp === 'boolean' ? req.body.availableToHelp : current.availableToHelp;

  await execute(
    `INSERT INTO user_profiles (user_id, phone_number, available_to_help) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE phone_number = ?, available_to_help = ?`,
    [userId, phone, available ? 1 : 0, phone, available ? 1 : 0],
  );
  res.json({ profile: await loadProfile(userId) });
});

// ---------------------------------------------------------------------
// /api/notifications: the bell in the top bar
// ---------------------------------------------------------------------
export const notificationsRouter = Router();

notificationsRouter.get('/', async (req, res) => {
  const userId = currentUser(req).userId;
  const rows = await query<{ notification_id: number; title: string; body: string; link: string | null; is_read: number; created_at: Date }>(
    `SELECT notification_id, title, body, link, is_read, created_at
       FROM notifications WHERE user_id = ? ORDER BY created_at DESC, notification_id DESC LIMIT 30`,
    [userId],
  );
  const [{ unread }] = await query<{ unread: number }>(
    `SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND is_read = 0`, [userId],
  );
  res.json({
    unreadCount: Number(unread),
    notifications: rows.map((r) => ({
      notificationId: r.notification_id, title: r.title, body: r.body, link: r.link,
      isRead: Boolean(r.is_read), createdAt: r.created_at,
    })),
  });
});

// POST /api/notifications/read { ids?: number[] }: mark some, or all, as read
notificationsRouter.post('/read', async (req, res) => {
  const userId = currentUser(req).userId;
  const ids: unknown[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const valid = ids.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100);
  if (valid.length) {
    await execute(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND notification_id IN (?)`, [userId, valid]);
  } else {
    await execute(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`, [userId]);
  }
  res.json({ ok: true });
});
