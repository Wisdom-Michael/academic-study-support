import { execute } from '../db';

/** Add an in-app notification for one user (shown under the bell in the top bar). */
export async function notify(userId: number, title: string, body: string, link: string | null = null): Promise<void> {
  await execute(
    `INSERT INTO notifications (user_id, title, body, link) VALUES (?, ?, ?, ?)`,
    [userId, title.slice(0, 200), body, link],
  );
}

/** Where a user's peer-help section lives, by role. */
export function peerHelpLink(role: string): string {
  return role === 'mentor' ? '/mentor#peer-help' : '/student#peer-help';
}
