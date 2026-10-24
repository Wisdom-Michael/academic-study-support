import { NextFunction, Request, Response } from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '../config';
import { AuthUser, HttpError, Role } from '../types';

// Make `req.user` available (and typed) in every route handler.
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as SignOptions['expiresIn'],
  });
}

/** Rejects the request unless it carries a valid "Authorization: Bearer <token>" header. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Sign in to continue.');

  try {
    const payload = jwt.verify(token, config.jwtSecret) as AuthUser;
    req.user = { userId: payload.userId, fullName: payload.fullName, role: payload.role };
    next();
  } catch {
    throw new HttpError(401, 'Your session has expired. Sign in again.');
  }
}

/** Role-based access control: only the listed roles may continue. Use after requireAuth. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new HttpError(403, 'Your account does not have access to this.');
    }
    next();
  };
}

/** Narrowing helper for handlers that run after requireAuth. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new HttpError(401, 'Sign in to continue.');
  return req.user;
}
