import { describe, expect, it } from 'vitest';
import { teams, type Actor } from '@/domain';
import { teamIdBySlug } from '../helpers';

/**
 * requireActor is the first check every guarded domain function runs, ahead of any
 * team-scoped permission, and nothing exercises it with the one input that actually
 * reaches it in production: a session that has gone missing. Every call site in the app
 * is wrapped by ProtectedRoute, so an Actor here is cast rather than built, the same way
 * the schema tests cast a role the type system otherwise refuses to let them construct.
 */
describe('requireActor', () => {
  it('rejects a missing actor rather than proceeding as nobody', () => {
    const platform = teamIdBySlug('platform');

    expect(() => teams.getTeam(null as unknown as Actor, platform)).toThrow('Unauthorized');
    expect(() => teams.getTeam(undefined as unknown as Actor, platform)).toThrow('Unauthorized');
  });
});
