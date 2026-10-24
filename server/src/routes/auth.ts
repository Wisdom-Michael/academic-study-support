import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { config } from '../config';
import { execute, query } from '../db';
import { currentUser, requireAuth, signToken } from '../middleware/auth';
import { HttpError, Role } from '../types';
import { requireText } from '../validation';

const router = Router();
const BCRYPT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;

interface UserRow {
  user_id: number;
  full_name: string;
  institutional_email: string;
  password_hash: string;
  role: Role;
}

function publicUser(row: UserRow) {
  return { userId: row.user_id, fullName: row.full_name, email: row.institutional_email, role: row.role };
}

async function startSession(row: UserRow) {
  // Each login is recorded for the login-frequency factor of the risk index
  await execute(`INSERT INTO login_events (user_id) VALUES (?)`, [row.user_id]);
  const token = signToken({ userId: row.user_id, fullName: row.full_name, role: row.role });
  return { token, user: publicUser(row) };
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const fullName = requireText(req.body, 'fullName', 'Full name', 120);
  const email = requireText(req.body, 'email', 'Institutional email', 190).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const role = req.body?.role ?? 'student';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Enter a valid email address.');
  }
  if (config.institutionEmailDomain && !email.endsWith(`@${config.institutionEmailDomain}`)) {
    throw new HttpError(400, `Use your @${config.institutionEmailDomain} email address.`);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  // Lecturer (faculty_admin) accounts cannot be self-registered; the department creates them.
  if (role !== 'student' && role !== 'mentor') {
    throw new HttpError(400, 'You can register as a student or a peer mentor. Lecturer accounts are set up by the department.');
  }

  const existing = await query<{ user_id: number }>(
    `SELECT user_id FROM users WHERE institutional_email = ?`, [email],
  );
  if (existing.length > 0) {
    throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const result = await execute(
    `INSERT INTO users (full_name, institutional_email, password_hash, role) VALUES (?, ?, ?, ?)`,
    [fullName, email, passwordHash, role],
  );

  const session = await startSession({
    user_id: result.insertId, full_name: fullName, institutional_email: email, password_hash: passwordHash, role,
  });
  res.status(201).json(session);
});

// Account types as the sign-in screen names them (lecturers are stored as 'faculty_admin')
const roleNames: Record<Role, string> = { student: 'Student', mentor: 'Peer mentor', faculty_admin: 'Lecturer' };

// POST /api/auth/login { email, password, role? }
// `role` is the account type picked on the sign-in screen (student, mentor or lecturer).
router.post('/login', async (req, res) => {
  const email = requireText(req.body, 'email', 'Email', 190).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const role = req.body?.role as Role | undefined;

  const [row] = await query<UserRow>(`SELECT * FROM users WHERE institutional_email = ?`, [email]);
  // Same message whether the email or the password is wrong, so accounts can't be probed
  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    throw new HttpError(401, 'Email or password is incorrect.');
  }
  // Only checked after the password, so it reveals nothing to someone without it
  if (role && role !== row.role) {
    throw new HttpError(403, `This is a ${roleNames[row.role].toLowerCase()} account. Select “${roleNames[row.role]}” above and sign in again.`);
  }

  res.json(await startSession(row));
});

// GET /api/auth/me: who is signed in (used when the app reloads)
router.get('/me', requireAuth, async (req, res) => {
  const [row] = await query<UserRow>(`SELECT * FROM users WHERE user_id = ?`, [currentUser(req).userId]);
  if (!row) throw new HttpError(401, 'This account no longer exists.');
  res.json({ user: publicUser(row) });
});

export default router;
