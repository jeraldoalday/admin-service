import { describe, expect, it } from 'vitest';
import { audit, getDatabase, lockout, sessions, users, type BulkUserAction } from '@/domain';
import { adminActor, danaActor, miraActor, rajActor } from '../helpers';

function userIdFor(email: string): string {
  const user = getDatabase().users.find((candidate) => candidate.email === email);
  if (!user) throw new Error(`No seeded user with email ${email}`);
  return user.id;
}

function namesIn(outcomes: { displayName: string }[]): string[] {
  return outcomes.map((outcome) => outcome.displayName).sort();
}

/** Puts an address over the throttle the way a run of mistyped passwords would. */
function lockOut(email: string): void {
  const userId = userIdFor(email);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    lockout.recordSignInAttempt({ email, userId, outcome: 'FAILED' });
  }
}

function auditActionsFor(userId: string): string[] {
  return audit
    .listAllAuditLogs()
    .filter((log) => log.targetId === userId)
    .map((log) => log.action);
}

function apply(action: BulkUserAction, emails: string[]) {
  return users.bulkUpdateUsers(adminActor(), {
    action,
    userIds: emails.map(userIdFor),
  });
}

describe('acting on a batch of accounts', () => {
  it('deactivates every account it was given', () => {
    const result = apply('deactivate', ['dana@example.com', 'raj@example.com']);

    expect(result.action).toBe('deactivate');
    expect(result.requested).toBe(2);
    expect(namesIn(result.changed)).toEqual(['Dana Diaz', 'Raj Patel']);
    expect(result.failed).toHaveLength(0);
    expect(users.getUser(adminActor(), userIdFor('dana@example.com')).isActive).toBe(false);
    expect(users.getUser(adminActor(), userIdFor('raj@example.com')).isActive).toBe(false);
  });

  it('reports an account already in that state as unchanged rather than failed', () => {
    const sam = userIdFor('sam@example.com');
    const before = auditActionsFor(sam).length;

    const result = apply('deactivate', ['sam@example.com', 'dana@example.com']);

    expect(namesIn(result.unchanged)).toEqual(['Sam Lee']);
    expect(result.unchanged[0]?.message).toBe('Already deactivated');
    expect(result.failed).toHaveLength(0);
    // Nothing was written for it, so nothing about it reached the log either.
    expect(auditActionsFor(sam)).toHaveLength(before);
  });

  it('activates the accounts that were switched off', () => {
    const result = apply('activate', ['sam@example.com', 'mira@example.com']);

    expect(namesIn(result.changed)).toEqual(['Sam Lee']);
    expect(namesIn(result.unchanged)).toEqual(['Mira Okafor']);
    expect(users.getUser(adminActor(), userIdFor('sam@example.com')).isActive).toBe(true);
  });

  it('refuses the actor’s own account without abandoning the rest of the batch', () => {
    const result = apply('deactivate', [
      'dana@example.com',
      'admin@example.com',
      'mira@example.com',
    ]);

    expect(namesIn(result.changed)).toEqual(['Dana Diaz', 'Mira Okafor']);
    expect(namesIn(result.failed)).toEqual(['Avery Admin']);
    expect(result.failed[0]?.message).toBe(
      'Admins cannot change their own role or deactivate their own account',
    );
    expect(users.getUser(adminActor(), adminActor().id).isActive).toBe(true);
  });

  it('names an account that no longer exists rather than throwing', () => {
    const result = users.bulkUpdateUsers(adminActor(), {
      action: 'deactivate',
      userIds: [userIdFor('dana@example.com'), 'nobody'],
    });

    expect(result.changed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({ userId: 'nobody', message: 'User not found' });
  });

  it('counts an account named twice only once', () => {
    const dana = userIdFor('dana@example.com');

    const result = users.bulkUpdateUsers(adminActor(), {
      action: 'delete',
      userIds: [dana, dana],
    });

    expect(result.requested).toBe(1);
    expect(result.changed).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
  });
});

describe('bulk deletion', () => {
  it('takes the accounts and their memberships with it', () => {
    const mira = userIdFor('mira@example.com');

    const result = apply('delete', ['mira@example.com', 'sam@example.com']);

    expect(namesIn(result.changed)).toEqual(['Mira Okafor', 'Sam Lee']);
    expect(getDatabase().users.some((user) => user.id === mira)).toBe(false);
    expect(getDatabase().memberships.some((membership) => membership.userId === mira)).toBe(false);
  });

  it('still hands over a team whose only owner is in the batch', () => {
    const dana = userIdFor('dana@example.com');
    const growth = getDatabase().teams.find((team) => team.slug === 'growth');

    apply('delete', ['dana@example.com']);

    const owners = getDatabase().memberships.filter(
      (membership) => membership.teamId === growth?.id && membership.role === 'OWNER',
    );
    expect(owners).toHaveLength(1);
    expect(owners[0]?.userId).not.toBe(dana);
  });

  it('refuses to delete the actor’s own account', () => {
    const result = apply('delete', ['admin@example.com']);

    expect(result.failed[0]?.message).toBe('Admins cannot delete their own account');
    expect(getDatabase().users.some((user) => user.id === adminActor().id)).toBe(true);
  });
});

describe('bulk unlocking', () => {
  it('opens the locked accounts and leaves the rest alone', () => {
    lockOut('raj@example.com');
    const raj = userIdFor('raj@example.com');
    const before = auditActionsFor(userIdFor('mira@example.com')).length;

    const result = apply('unlock', ['raj@example.com', 'mira@example.com']);

    expect(namesIn(result.changed)).toEqual(['Raj Patel']);
    expect(result.unchanged[0]?.message).toBe('Not locked out');
    expect(lockout.lockStateForUser(raj)?.isLocked).toBe(false);
    // An unlock nobody needed must not stamp the log with an entry describing nothing.
    expect(auditActionsFor(userIdFor('mira@example.com'))).toHaveLength(before);
  });
});

describe('bulk actions and the sessions behind them', () => {
  it('signs out the devices of every account it deactivates', () => {
    const dana = danaActor();
    const session = sessions.startSession(dana.id, 'Chrome on macOS');

    apply('deactivate', ['dana@example.com']);

    expect(sessions.resolveSession(session.id)).toBeNull();
  });
});

describe('who may act on a batch', () => {
  it('refuses a member', () => {
    expect(() =>
      users.bulkUpdateUsers(rajActor(), {
        action: 'deactivate',
        userIds: [userIdFor('mira@example.com')],
      }),
    ).toThrow('You do not have permission to perform this action');
  });

  it('refuses an empty selection', () => {
    expect(() =>
      users.bulkUpdateUsers(adminActor(), { action: 'deactivate', userIds: [] }),
    ).toThrow('Select at least one account');
  });

  it('refuses a selection larger than the cap', () => {
    const ids = Array.from({ length: 101 }, (_, index) => `user-${index}`);

    expect(() =>
      users.bulkUpdateUsers(adminActor(), { action: 'deactivate', userIds: ids }),
    ).toThrow('Select no more than 100 accounts at a time');
  });
});

describe('what a batch leaves in the audit log', () => {
  it('records the batch as well as each account it touched', () => {
    apply('deactivate', ['dana@example.com', 'admin@example.com']);

    const summary = audit.listAllAuditLogs({ action: 'user.bulk_deactivate' });
    expect(summary).toHaveLength(1);
    expect(summary[0]?.metadata).toMatchObject({
      requested: 2,
      changed: 1,
      unchanged: 0,
      failed: 1,
    });
    expect(auditActionsFor(userIdFor('dana@example.com'))).toContain('user.updated');
  });

  it('records a batch in which nothing succeeded', () => {
    apply('delete', ['admin@example.com']);

    expect(audit.listAllAuditLogs({ action: 'user.bulk_delete' })).toHaveLength(1);
  });

  it('leaves one entry per action rather than one per account', () => {
    apply('deactivate', ['dana@example.com', 'raj@example.com', 'mira@example.com']);

    expect(audit.listAllAuditLogs({ search: 'bulk' })).toHaveLength(1);
  });
});

describe('the batch report', () => {
  it('names a deleted account by the name it had', () => {
    const result = apply('delete', ['mira@example.com']);

    expect(result.changed[0]).toMatchObject({
      displayName: 'Mira Okafor',
      email: 'mira@example.com',
      status: 'CHANGED',
      message: null,
    });
  });

  it('reports every account it was asked about exactly once', () => {
    const emails = ['dana@example.com', 'sam@example.com', 'admin@example.com'];

    const result = apply('deactivate', emails);
    const reported = [...result.changed, ...result.unchanged, ...result.failed];

    expect(reported).toHaveLength(emails.length);
    expect(new Set(reported.map((outcome) => outcome.userId)).size).toBe(emails.length);
  });
});

describe('an unused actor', () => {
  it('does not touch accounts outside the batch', () => {
    apply('deactivate', ['dana@example.com']);

    expect(users.getUser(adminActor(), miraActor().id).isActive).toBe(true);
  });
});
