import {
  auth,
  getDatabase,
  teams,
  type Actor,
  type PublicUser,
  type TeamPermission,
  type UserRole,
} from '@/domain';
import { permissions } from '@/domain';

export const DEMO_PASSWORD = 'password123';

/**
 * Signs in and insists the sign-in finished, which is what a test that is not about
 * two-factor authentication means by "sign in". A challenge coming back here is a real
 * failure rather than something to null-check around.
 */
export function signInFully(email: string, password = DEMO_PASSWORD): PublicUser {
  const result = auth.loginUser({ email, password });
  if (result.kind !== 'COMPLETE') {
    throw new Error(`Signing in as ${email} asked for a second factor`);
  }
  return result.user;
}

/** Looks up a seeded account by email and returns it as an actor. */
export function actorFor(email: string): Actor {
  const user = getDatabase().users.find((candidate) => candidate.email === email);
  if (!user) {
    throw new Error(`No seeded user with email ${email}`);
  }
  return { id: user.id, role: user.role };
}

export const adminActor = (): Actor => actorFor('admin@example.com');
export const danaActor = (): Actor => actorFor('dana@example.com');
export const rajActor = (): Actor => actorFor('raj@example.com');
export const miraActor = (): Actor => actorFor('mira@example.com');

export function teamIdBySlug(slug: string): string {
  const team = getDatabase().teams.find((candidate) => candidate.slug === slug);
  if (!team) {
    throw new Error(`No seeded team with slug ${slug}`);
  }
  return team.id;
}

/** Registers an extra account for tests that need a user outside the seed. */
export function createUser(
  email: string,
  displayName = 'Test User',
  role: UserRole = 'MEMBER',
): Actor {
  const user = auth.registerUser({ email, password: DEMO_PASSWORD, displayName });
  return { id: user.id, role };
}

/** Puts a user on a team by issuing and accepting an invite, the way the UI would. */
export function joinTeam(
  inviter: Actor,
  teamId: string,
  invitee: Actor,
  inviteeEmail: string,
): void {
  const invite = teams.createInvite(inviter, teamId, { email: inviteeEmail, role: 'MEMBER' });
  teams.acceptInvite(invitee, invite.token);
}

export function grant(
  granter: Actor,
  teamId: string,
  userId: string,
  granted: TeamPermission[],
): void {
  permissions.setMemberPermissionGrants(granter, teamId, userId, granted);
}
