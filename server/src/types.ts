export type Role = 'student' | 'mentor' | 'faculty_admin';
export type MatchStatus = 'pending' | 'active' | 'completed';
export type RiskLevel = 'low' | 'medium' | 'high';
export type ResolutionStatus = 'unresolved' | 'in_review' | 'resolved';

/** The user details stored inside a login token and attached to each request. */
export interface AuthUser {
  userId: number;
  fullName: string;
  role: Role;
}

/** Thrown from route handlers to send a specific HTTP status and message. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
