import { describe, expect, it } from 'vitest';
import { audit, auth, getDatabase, sessions, users, type Actor } from '@/domain';
import { DEMO_PASSWORD, adminActor, danaActor, miraActor } from '../helpers';

/** An actor standing behind a freshly opened session, the way the provider builds one. */
function signedIn(actor: Actor, label = 'Chrome on macOS'): Actor & { sessionId: string } {
  const session = sessions.startSession(actor.id, label);
  return { ...actor, sessionId: session.id };
}

describe('opening a session', () => {
  it('resolves while it is live', () => {
    const session = sessions.startSession(miraActor().id, 'Firefox on Linux');

    expect(sessions.resolveSession(session.id)?.userId).toBe(miraActor().id);
    expect(sessions.effectiveSessionStatus(session)).toBe('ACTIVE');
    expect(session.label).toBe('Firefox on Linux');
  });

  it('gives every session an unguessable id', () => {
    const first = sessions.startSession(miraActor().id);
    const second = sessions.startSession(miraActor().id);

    expect(first.id).not.toBe(second.id);
    expect(first.id).toMatch(/^[0-9a-f]{36}$/);
  });

  it('falls back to a neutral label rather than a blank one', () => {
    expect(sessions.startSession(miraActor().id, '   ').label).toBe('Unknown device');
    expect(sessions.startSession(miraActor().id).label).toBe('Unknown device');
  });

  it('strips control characters out of a label the browser supplied', () => {
    const session = sessions.startSession(miraActor().id, 'Chrome\n\ton macOS');

    expect(session.label).toBe('Chrome on macOS');
  });
});

describe('the life of a session', () => {
  it('stops resolving once it is revoked', () => {
    const mira = signedIn(miraActor());
    const other = sessions.startSession(mira.id, 'Safari on iOS');

    sessions.revokeSession(mira, other.id);

    expect(sessions.resolveSession(other.id)).toBeNull();
    expect(sessions.effectiveSessionStatus(other)).toBe('REVOKED');
  });

  it('reads as expired the moment its window closes, without a sweep', () => {
    const session = sessions.startSession(miraActor().id);
    const later = Date.now() + sessions.SESSION_TTL_MS + 1000;

    expect(sessions.effectiveSessionStatus(session, later)).toBe('EXPIRED');
    expect(sessions.resolveSession(session.id, later)).toBeNull();
  });

  it('records that a session is in use, at most once a minute', () => {
    const session = sessions.startSession(miraActor().id);
    const before = session.lastSeenAt;

    expect(sessions.touchSession(session.id)).toBe(false);
    expect(session.lastSeenAt).toBe(before);

    expect(sessions.touchSession(session.id, Date.now() + 2 * 60 * 1000)).toBe(true);
    expect(session.lastSeenAt).not.toBe(before);
  });

  it('does not touch a session that no longer resolves', () => {
    const mira = signedIn(miraActor());
    sessions.endSession(mira.sessionId);

    expect(sessions.touchSession(mira.sessionId, Date.now() + 2 * 60 * 1000)).toBe(false);
  });

  it('leaves an already-ended session saying when it actually ended', () => {
    const mira = signedIn(miraActor());
    const other = sessions.startSession(mira.id);
    sessions.revokeSession(mira, other.id);
    const endedAt = other.revokedAt;

    sessions.revokeSession(mira, other.id);

    expect(other.revokedAt).toBe(endedAt);
    expect(audit.listAllAuditLogs({ action: 'user.session_revoked' })).toHaveLength(1);
  });
});

describe('who may end a session', () => {
  it('lets its own owner end it', () => {
    const mira = signedIn(miraActor());
    const other = sessions.startSession(mira.id);

    expect(sessions.revokeSession(mira, other.id).status).toBe('REVOKED');
  });

  it('refuses another member entirely', () => {
    const mira = signedIn(miraActor());
    const dana = signedIn(danaActor());

    expect(() => sessions.revokeSession(dana, mira.sessionId)).toThrow(
      'You do not have permission to perform this action',
    );
  });

  it('lets a platform admin end somebody else’s', () => {
    const mira = signedIn(miraActor());

    expect(sessions.revokeSession(adminActor(), mira.sessionId).status).toBe('REVOKED');
  });

  it('reports an unknown session as not found', () => {
    expect(() => sessions.revokeSession(adminActor(), 'nope')).toThrow('Session not found');
  });
});

describe('signing out other devices', () => {
  it('ends every other live session and spares the current one', () => {
    const mira = signedIn(miraActor());
    sessions.startSession(mira.id, 'Safari on iOS');
    sessions.startSession(mira.id, 'Firefox on Windows');

    expect(sessions.revokeOtherSessions(mira)).toBe(2);
    expect(sessions.resolveSession(mira.sessionId)).not.toBeNull();
    expect(sessions.listOwnSessions(mira, { status: 'ACTIVE' }).total).toBe(1);
  });

  it('reports nothing to do rather than writing an empty audit entry', () => {
    const mira = signedIn(miraActor());

    expect(sessions.revokeOtherSessions(mira)).toBe(0);
    expect(audit.listAllAuditLogs({ action: 'user.sessions_revoked' })).toHaveLength(0);
  });
});

describe('listing sessions', () => {
  it('shows an account its own, marking the one it is using', () => {
    const mira = signedIn(miraActor());
    sessions.startSession(mira.id, 'Safari on iOS');

    const listed = sessions.listOwnSessions(mira);
    expect(listed.total).toBe(2);
    expect(listed.items.filter((session) => session.isCurrent)).toHaveLength(1);
  });

  it('keeps the ended ones on the list rather than hiding them', () => {
    const mira = signedIn(miraActor());
    const other = sessions.startSession(mira.id, 'Safari on iOS');
    sessions.revokeSession(mira, other.id);

    expect(sessions.listOwnSessions(mira).total).toBe(2);
    expect(sessions.listOwnSessions(mira, { status: 'REVOKED' }).total).toBe(1);
  });

  it('lets an admin read another account’s sessions, and a member only their own', () => {
    const mira = signedIn(miraActor());

    expect(sessions.listSessionsForUser(adminActor(), mira.id).total).toBe(1);
    expect(() => sessions.listSessionsForUser(danaActor(), mira.id)).toThrow(
      'You do not have permission to perform this action',
    );
    expect(sessions.listSessionsForUser(mira, mira.id).total).toBe(1);
  });
});

describe('the sweep for expired sessions', () => {
  it('stamps the ones whose window closed while nobody was looking', () => {
    const session = sessions.startSession(miraActor().id);
    session.expiresAt = new Date(Date.now() - 1000).toISOString();

    expect(sessions.expireStaleSessions()).toBeGreaterThanOrEqual(1);
    expect(session.revokedAt).toBe(session.expiresAt);
    expect(sessions.expireStaleSessions()).toBe(0);
  });

  it('leaves a live session alone', () => {
    const session = sessions.startSession(miraActor().id);

    sessions.expireStaleSessions();

    expect(session.revokedAt).toBeNull();
  });
});

describe('sessions and the account behind them', () => {
  it('ends them when an admin deactivates the account', () => {
    const mira = signedIn(miraActor());

    users.updateUser(adminActor(), mira.id, { isActive: false });

    expect(sessions.resolveSession(mira.sessionId)).toBeNull();
  });

  it('deletes them along with the account', () => {
    const mira = signedIn(miraActor());

    users.deleteUser(adminActor(), mira.id);

    expect(getDatabase().sessions.filter((session) => session.userId === mira.id)).toHaveLength(0);
  });

  it('keeps the sign-in attempts when the account goes', () => {
    const mira = miraActor();
    expect(() => auth.loginUser({ email: 'mira@example.com', password: 'wrong' })).toThrow();

    users.deleteUser(adminActor(), mira.id);

    expect(
      getDatabase().signInAttempts.some((attempt) => attempt.email === 'mira@example.com'),
    ).toBe(true);
  });

  it('ends the others when the password changes, sparing the one making the change', () => {
    const mira = signedIn(miraActor());
    const laptop = sessions.startSession(mira.id, 'Firefox on Windows');

    auth.changePassword(mira, {
      currentPassword: DEMO_PASSWORD,
      newPassword: 'a-brand-new-password',
      confirmPassword: 'a-brand-new-password',
    });

    expect(sessions.resolveSession(laptop.id)).toBeNull();
    expect(sessions.resolveSession(mira.sessionId)).not.toBeNull();
  });

  it('records how many the password change signed out', () => {
    const mira = signedIn(miraActor());
    sessions.startSession(mira.id, 'Firefox on Windows');

    auth.changePassword(mira, {
      currentPassword: DEMO_PASSWORD,
      newPassword: 'a-brand-new-password',
      confirmPassword: 'a-brand-new-password',
    });

    expect(audit.listAllAuditLogs({ action: 'user.password_changed' })[0]?.metadata).toMatchObject({
      revokedSessions: 1,
    });
  });
});
