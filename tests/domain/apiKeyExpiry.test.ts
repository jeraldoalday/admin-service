import { describe, expect, it } from 'vitest';
import { bootstrapDatabase } from '@/app/boot';
import { apiKeys, getDatabase, service, STORAGE_KEY } from '@/domain';
import { adminActor, teamIdBySlug } from '../helpers';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Mints a key that expires in an hour, then drags the stored expiry backwards. Creation
 * refuses a date already in the past, and rightly so — the only way to hold a key that has
 * lapsed is to have held one that had not.
 */
function createLapsedKey(name = 'lapsed') {
  const teamId = teamIdBySlug('platform');
  const issued = apiKeys.createApiKey(adminActor(), teamId, {
    name,
    permissions: ['MANAGE_MEMBERS'],
    expiresAt: new Date(Date.now() + HOUR_MS).toISOString(),
  });

  const stored = getDatabase().apiKeys.find((candidate) => candidate.id === issued.apiKey.id);
  if (!stored) throw new Error('the key that was just created is missing');
  stored.expiresAt = new Date(Date.now() - HOUR_MS).toISOString();

  return { teamId, id: issued.apiKey.id, secret: issued.secret };
}

describe('a key that has passed its expiry', () => {
  it('reads as EXPIRED rather than ACTIVE', () => {
    const { teamId, id } = createLapsedKey();

    expect(apiKeys.getApiKey(adminActor(), teamId, id).status).toBe('EXPIRED');
  });

  it('is counted under EXPIRED by the status filter, not under ACTIVE', () => {
    const { teamId, id } = createLapsedKey();

    const active = apiKeys.listApiKeys(adminActor(), teamId, { status: 'ACTIVE' });
    const expired = apiKeys.listApiKeys(adminActor(), teamId, { status: 'EXPIRED' });

    expect(active.items.map((key) => key.id)).not.toContain(id);
    expect(expired.items.map((key) => key.id)).toEqual([id]);
  });

  it('cannot be rotated, since rotation would copy the expiry onto the replacement', () => {
    const { teamId, id } = createLapsedKey();

    expect(() => apiKeys.rotateApiKey(adminActor(), teamId, id)).toThrow(
      'This API key has expired; create a new one instead',
    );
    expect(apiKeys.listApiKeys(adminActor(), teamId, { status: 'ACTIVE' }).total).toBe(1);
  });

  it('cannot be revoked, because there is nothing left to revoke', () => {
    const { teamId, id } = createLapsedKey();

    expect(() => apiKeys.revokeApiKey(adminActor(), teamId, id)).toThrow(
      'This API key has already expired',
    );
  });

  it('is refused at authentication with the expiry as the reason', () => {
    const { teamId, secret } = createLapsedKey();

    expect(() => service.serviceListTeamMembers(secret, teamId)).toThrow(
      'This API key has expired',
    );
  });

  it('still authenticates while it is inside its window', () => {
    const teamId = teamIdBySlug('platform');
    const { secret } = apiKeys.createApiKey(adminActor(), teamId, {
      name: 'live',
      permissions: ['MANAGE_MEMBERS'],
      expiresAt: new Date(Date.now() + HOUR_MS).toISOString(),
    });

    expect(service.serviceListTeamMembers(secret, teamId).total).toBe(3);
  });

  it('leaves a revoked key reading as revoked rather than as expired', () => {
    const teamId = teamIdBySlug('platform');
    const { apiKey } = apiKeys.createApiKey(adminActor(), teamId, {
      name: 'revoked-then-lapsed',
      permissions: [],
      expiresAt: new Date(Date.now() + HOUR_MS).toISOString(),
    });
    apiKeys.revokeApiKey(adminActor(), teamId, apiKey.id);

    const stored = getDatabase().apiKeys.find((candidate) => candidate.id === apiKey.id);
    if (stored) stored.expiresAt = new Date(Date.now() - HOUR_MS).toISOString();

    expect(apiKeys.getApiKey(adminActor(), teamId, apiKey.id).status).toBe('REVOKED');
  });
});

describe('sweeping keys that expired between sessions', () => {
  it('settles the stored row and reports how many moved', () => {
    const { id } = createLapsedKey();

    expect(apiKeys.expireStaleApiKeys()).toBe(1);
    expect(getDatabase().apiKeys.find((key) => key.id === id)?.status).toBe('EXPIRED');
  });

  it('is idempotent, so a second boot moves nothing', () => {
    createLapsedKey();

    expect(apiKeys.expireStaleApiKeys()).toBe(1);
    expect(apiKeys.expireStaleApiKeys()).toBe(0);
  });

  it('leaves keys that are still inside their window alone', () => {
    apiKeys.createApiKey(adminActor(), teamIdBySlug('platform'), {
      name: 'live',
      permissions: [],
      expiresAt: new Date(Date.now() + HOUR_MS).toISOString(),
    });

    expect(apiKeys.expireStaleApiKeys()).toBe(0);
  });

  it('runs at boot against a restored database', () => {
    createLapsedKey();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(getDatabase()));

    expect(bootstrapDatabase(window.localStorage)).toMatchObject({
      seeded: false,
      expiredApiKeys: 1,
    });
  });
});
