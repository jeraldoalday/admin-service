import { describe, expect, it } from 'vitest';
import { apiKeys, audit, getDatabase, permissions, service, teams } from '@/domain';
import { adminActor, danaActor, rajActor, teamIdBySlug } from '../helpers';

function createKey(
  scopes: Parameters<typeof apiKeys.createApiKey>[2]['permissions'] = ['MANAGE_MEMBERS'],
) {
  return apiKeys.createApiKey(adminActor(), teamIdBySlug('platform'), {
    name: 'ci',
    permissions: scopes,
  });
}

describe('issuing an API key', () => {
  it('returns the secret once and stores only a hash and a prefix', () => {
    const { apiKey, secret } = createKey();

    expect(secret).toMatch(/^sk_[0-9a-f]{48}$/);
    expect(apiKey).not.toHaveProperty('keyHash');
    expect(apiKey.keyPrefix).toBe(secret.slice(0, 11));

    const stored = getDatabase().apiKeys.find((candidate) => candidate.id === apiKey.id);
    expect(stored?.keyHash).toBeDefined();
    expect(stored?.keyHash).not.toContain(secret);
    expect(apiKeys.getApiKey(adminActor(), teamIdBySlug('platform'), apiKey.id)).not.toHaveProperty(
      'keyHash',
    );
  });

  it('records the creation in the audit log', () => {
    const { apiKey } = createKey();
    expect(
      audit.listAuditLogs(adminActor(), { action: 'api_key.created' }).items[0]?.targetId,
    ).toBe(apiKey.id);
  });

  it('deduplicates scopes and accepts a key with none', () => {
    const withDuplicates = createKey(['MANAGE_MEMBERS', 'MANAGE_MEMBERS']);
    expect(withDuplicates.apiKey.permissions).toEqual(['MANAGE_MEMBERS']);
    expect(createKey([]).apiKey.permissions).toEqual([]);
  });

  it('refuses an expiry in the past', () => {
    expect(() =>
      apiKeys.createApiKey(adminActor(), teamIdBySlug('platform'), {
        name: 'stale',
        permissions: [],
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    ).toThrow('expiresAt must be in the future');
  });

  /**
   * The "Expires" field sends a bare date, exactly as a date picker gives it. Read literally
   * that names midnight UTC, which for most of the world has already passed by the time anyone
   * is choosing today's date — so it must be treated as naming the whole day, the same way an
   * audit log date range is, rather than rejected as already in the past.
   */
  it('accepts a bare date for expiresAt, treating it as the end of that day', () => {
    const today = new Date().toISOString().slice(0, 10);

    const { apiKey } = apiKeys.createApiKey(adminActor(), teamIdBySlug('platform'), {
      name: 'expires-today',
      permissions: [],
      expiresAt: today,
    });

    expect(apiKey.expiresAt).toBe(`${today}T23:59:59.999Z`);
    expect(apiKey.status).toBe('ACTIVE');
  });

  it('still refuses a bare date that names a day already past', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    expect(() =>
      apiKeys.createApiKey(adminActor(), teamIdBySlug('platform'), {
        name: 'stale-date',
        permissions: [],
        expiresAt: yesterday,
      }),
    ).toThrow('expiresAt must be in the future');
  });

  it('is refused for a member without MANAGE_API_KEYS', () => {
    expect(() =>
      apiKeys.createApiKey(rajActor(), teamIdBySlug('platform'), { name: 'nope', permissions: [] }),
    ).toThrow('You do not have permission to perform this action');
  });

  it('becomes available to a plain member once the permission is granted', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const raj = rajActor();

    permissions.setMemberPermissionGrants(admin, platform, raj.id, ['MANAGE_API_KEYS']);

    expect(() =>
      apiKeys.createApiKey(raj, platform, { name: 'granted', permissions: [] }),
    ).not.toThrow();
  });

  it('refuses to scope a key with a permission the caller does not hold themselves', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const raj = rajActor();

    // MANAGE_API_KEYS alone is not enough to mint a key scoped with MANAGE_MEMBERS — the same
    // shape of guard as MANAGE_PERMISSIONS alone not being enough to grant MANAGE_MEMBERS.
    permissions.setMemberPermissionGrants(admin, platform, raj.id, ['MANAGE_API_KEYS']);
    const before = apiKeys.listApiKeys(admin, platform).total;

    expect(() =>
      apiKeys.createApiKey(raj, platform, {
        name: 'escalating',
        permissions: ['MANAGE_MEMBERS'],
      }),
    ).toThrow(
      'You cannot scope an API key with a permission you do not hold yourself: MANAGE_MEMBERS',
    );

    expect(apiKeys.listApiKeys(admin, platform).total).toBe(before);
  });

  it('lets a limited caller scope a key with a permission they hold themselves', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const raj = rajActor();

    permissions.setMemberPermissionGrants(admin, platform, raj.id, [
      'MANAGE_API_KEYS',
      'MANAGE_INVITES',
    ]);

    const { apiKey } = apiKeys.createApiKey(raj, platform, {
      name: 'in-scope',
      permissions: ['MANAGE_INVITES'],
    });
    expect(apiKey.permissions).toEqual(['MANAGE_INVITES']);
  });
});

describe('listing API keys', () => {
  it('filters by status and hides other teams keys', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const { apiKey } = createKey();

    apiKeys.revokeApiKey(admin, platform, apiKey.id);

    expect(apiKeys.listApiKeys(admin, platform, { status: 'REVOKED' }).total).toBe(1);
    expect(apiKeys.listApiKeys(admin, platform, { status: 'ACTIVE' }).total).toBe(1);
    expect(apiKeys.listApiKeys(danaActor(), teamIdBySlug('growth')).total).toBe(0);
  });

  it('reports a key from another team as not found', () => {
    const { apiKey } = createKey();
    expect(() => apiKeys.getApiKey(danaActor(), teamIdBySlug('growth'), apiKey.id)).toThrow(
      'API key not found',
    );
  });
});

describe('revoking and rotating', () => {
  it('refuses to revoke twice', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const { apiKey } = createKey();

    const revoked = apiKeys.revokeApiKey(admin, platform, apiKey.id);
    expect(revoked.status).toBe('REVOKED');
    expect(revoked.revokedAt).not.toBeNull();

    expect(() => apiKeys.revokeApiKey(admin, platform, apiKey.id)).toThrow(
      'This API key is already revoked',
    );
  });

  it('rotation issues a new secret, keeps the scopes, and kills the old key', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const original = createKey(['MANAGE_MEMBERS']);

    const rotated = apiKeys.rotateApiKey(admin, platform, original.apiKey.id);

    expect(rotated.secret).not.toBe(original.secret);
    expect(rotated.apiKey.id).not.toBe(original.apiKey.id);
    expect(rotated.apiKey.name).toBe(original.apiKey.name);
    expect(rotated.apiKey.permissions).toEqual(['MANAGE_MEMBERS']);
    expect(apiKeys.getApiKey(admin, platform, original.apiKey.id).status).toBe('REVOKED');
    expect(
      audit.listAuditLogs(adminActor(), { action: 'api_key.rotated' }).items[0]?.metadata,
    ).toMatchObject({
      rotatedFrom: original.apiKey.id,
    });
  });

  it('refuses to rotate a revoked key', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const { apiKey } = createKey();

    apiKeys.revokeApiKey(admin, platform, apiKey.id);
    expect(() => apiKeys.rotateApiKey(admin, platform, apiKey.id)).toThrow(
      'This API key is already revoked; create a new one instead',
    );
  });
});

describe('authenticating as a service', () => {
  it('reads the team roster with an in-scope key', () => {
    const platform = teamIdBySlug('platform');
    const { secret } = createKey(['MANAGE_MEMBERS']);

    const members = service.serviceListTeamMembers(secret, platform);

    expect(members.total).toBe(3);
    expect(members.items.map((member) => member.email)).toContain('raj@example.com');
  });

  it('stamps the key as used', () => {
    const platform = teamIdBySlug('platform');
    const { apiKey, secret } = createKey();

    expect(apiKey.lastUsedAt).toBeNull();
    service.serviceListTeamMembers(secret, platform);
    expect(apiKeys.getApiKey(adminActor(), platform, apiKey.id).lastUsedAt).not.toBeNull();
  });

  it('refuses a key that is missing, unknown, revoked, or expired', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');

    expect(() => service.serviceListTeamMembers('   ', platform)).toThrow('Missing API key');
    expect(() => service.serviceListTeamMembers('sk_nonsense', platform)).toThrow(
      'Invalid or revoked API key',
    );

    const revoked = createKey();
    apiKeys.revokeApiKey(admin, platform, revoked.apiKey.id);
    expect(() => service.serviceListTeamMembers(revoked.secret, platform)).toThrow(
      'Invalid or revoked API key',
    );

    const expiring = apiKeys.createApiKey(admin, platform, {
      name: 'short-lived',
      permissions: ['MANAGE_MEMBERS'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const stored = getDatabase().apiKeys.find((key) => key.id === expiring.apiKey.id);
    if (stored) stored.expiresAt = new Date(Date.now() - 1000).toISOString();

    expect(() => service.serviceListTeamMembers(expiring.secret, platform)).toThrow(
      'This API key has expired',
    );
  });

  it('refuses a key minted for a different team', () => {
    const { secret } = createKey();
    const growth = teamIdBySlug('growth');

    expect(() => service.serviceListTeamMembers(secret, growth)).toThrow(
      'Invalid or revoked API key',
    );
  });

  it('refuses a key without the required scope', () => {
    const platform = teamIdBySlug('platform');
    const { secret } = createKey(['MANAGE_TEAM']);

    expect(() => service.serviceListTeamMembers(secret, platform)).toThrow(
      'This API key does not have the required scope',
    );
  });

  it('survives its issuer losing access, because it authenticates the team not the person', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const { secret } = createKey(['MANAGE_MEMBERS']);

    teams.updateMemberRole(admin, platform, danaActor().id, 'OWNER');
    teams.leaveTeam(admin, platform);

    expect(service.serviceListTeamMembers(secret, platform).total).toBe(2);
  });
});
