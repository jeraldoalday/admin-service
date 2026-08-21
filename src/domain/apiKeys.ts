import { recordAuditLog } from './audit';
import { getDatabase, mutate } from './database';
import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from './errors';
import { requireActor, requireTeamPermission, type Actor } from './guards';
import { createId, createToken, nowIso } from './ids';
import { paginate, sortNewestFirst, type PaginatedResult } from './pagination';
import { sha256Hex } from './sha256';
import type { ApiKeyRecord, ApiKeyStatus, ApiKeyView, TeamPermission } from './types';
import {
  createApiKeySchema,
  listApiKeysQuerySchema,
  parseInput,
  type CreateApiKeyInput,
  type ListApiKeysQuery,
} from './validation';

const SECRET_PREFIX = 'sk';
/** `sk_` plus 8 hex characters — enough to recognise a key, useless for authenticating. */
const PREVIEW_LENGTH = SECRET_PREFIX.length + 9;

export function hashApiKeySecret(secret: string): string {
  return sha256Hex(secret);
}

/**
 * The status a key actually has right now, rather than the one last written to it.
 *
 * A key past its expiry is already dead — `authenticateApiKey` refuses it — but nothing
 * rewrites the row to say so, so the stored status kept reading ACTIVE and every screen
 * repeated the claim: the keys tab showed a positive badge, the status filter counted it
 * among the live keys, and Rotate was still on offer. Rotation is the part that turned a
 * cosmetic lie into a real one, since it copies the old key's expiry onto the replacement
 * and would have minted a secret that was dead the moment it was issued.
 *
 * Deriving the status on read is what keeps those three honest at once, exactly as
 * `effectiveInviteStatus` does for an invite that aged out.
 */
export function effectiveApiKeyStatus(key: ApiKeyRecord, now = Date.now()): ApiKeyStatus {
  if (key.status === 'ACTIVE' && key.expiresAt && Date.parse(key.expiresAt) <= now) {
    return 'EXPIRED';
  }
  return key.status;
}

function toApiKeyView(key: ApiKeyRecord): ApiKeyView {
  const {
    id,
    teamId,
    name,
    keyPrefix,
    permissions,
    expiresAt,
    lastUsedAt,
    revokedAt,
    createdAt,
    updatedAt,
  } = key;
  return {
    id,
    teamId,
    name,
    keyPrefix,
    permissions: [...permissions],
    status: effectiveApiKeyStatus(key),
    expiresAt,
    lastUsedAt,
    revokedAt,
    createdAt,
    updatedAt,
  };
}

function generateSecret(): string {
  return `${SECRET_PREFIX}_${createToken()}`;
}

function getOwnedApiKeyOrThrow(teamId: string, keyId: string): ApiKeyRecord {
  const apiKey = getDatabase().apiKeys.find((candidate) => candidate.id === keyId);
  if (!apiKey || apiKey.teamId !== teamId) {
    throw new NotFoundError('API key not found');
  }
  return apiKey;
}

/**
 * Mints a key. The plaintext secret is returned exactly once, here — only its SHA-256 digest
 * and a display-safe prefix are ever stored, so a leaked database cannot be replayed.
 */
export function createApiKey(
  actor: Actor,
  teamId: string,
  rawInput: CreateApiKeyInput,
): { apiKey: ApiKeyView; secret: string } {
  const current = requireActor(actor);
  requireTeamPermission(actor, teamId, 'MANAGE_API_KEYS');
  const input = parseInput(createApiKeySchema, rawInput);

  const secret = generateSecret();

  const created = mutate((db) => {
    const timestamp = nowIso();
    const record: ApiKeyRecord = {
      id: createId(),
      teamId,
      name: input.name,
      keyPrefix: secret.slice(0, PREVIEW_LENGTH),
      keyHash: hashApiKeySecret(secret),
      permissions: [...new Set(input.permissions)],
      status: 'ACTIVE',
      createdById: current.id,
      expiresAt: input.expiresAt ? new Date(input.expiresAt).toISOString() : null,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.apiKeys.push(record);
    return record;
  });

  recordAuditLog({
    actorId: current.id,
    action: 'api_key.created',
    targetType: 'api_key',
    targetId: created.id,
    teamId,
    metadata: { name: created.name, permissions: created.permissions },
  });

  return { apiKey: toApiKeyView(created), secret };
}

export function listApiKeys(
  actor: Actor,
  teamId: string,
  rawQuery: ListApiKeysQuery = {},
): PaginatedResult<ApiKeyView> {
  requireTeamPermission(actor, teamId, 'MANAGE_API_KEYS');
  const query = parseInput(listApiKeysQuerySchema, rawQuery);

  const matching = getDatabase().apiKeys.filter(
    (key) =>
      key.teamId === teamId && (!query.status || effectiveApiKeyStatus(key) === query.status),
  );

  return paginate(sortNewestFirst(matching).map(toApiKeyView), query);
}

export function getApiKey(actor: Actor, teamId: string, keyId: string): ApiKeyView {
  requireTeamPermission(actor, teamId, 'MANAGE_API_KEYS');
  return toApiKeyView(getOwnedApiKeyOrThrow(teamId, keyId));
}

export function revokeApiKey(actor: Actor, teamId: string, keyId: string): ApiKeyView {
  const current = requireActor(actor);
  requireTeamPermission(actor, teamId, 'MANAGE_API_KEYS');

  const apiKey = getOwnedApiKeyOrThrow(teamId, keyId);
  const status = effectiveApiKeyStatus(apiKey);
  if (status === 'REVOKED') {
    throw new BadRequestError('This API key is already revoked');
  }
  if (status === 'EXPIRED') {
    throw new BadRequestError('This API key has already expired');
  }

  const updated = mutate(() => {
    const timestamp = nowIso();
    apiKey.status = 'REVOKED';
    apiKey.revokedAt = timestamp;
    apiKey.updatedAt = timestamp;
    return toApiKeyView(apiKey);
  });

  recordAuditLog({
    actorId: current.id,
    action: 'api_key.revoked',
    targetType: 'api_key',
    targetId: keyId,
    teamId,
  });

  return updated;
}

/**
 * Revokes a key and issues a replacement carrying the same name, scopes, and expiry. The old
 * secret stops working the moment this returns — there is no overlap window.
 */
export function rotateApiKey(
  actor: Actor,
  teamId: string,
  keyId: string,
): { apiKey: ApiKeyView; secret: string } {
  const current = requireActor(actor);
  requireTeamPermission(actor, teamId, 'MANAGE_API_KEYS');

  const apiKey = getOwnedApiKeyOrThrow(teamId, keyId);
  const status = effectiveApiKeyStatus(apiKey);
  if (status === 'REVOKED') {
    throw new BadRequestError('This API key is already revoked; create a new one instead');
  }
  // Rotation carries the expiry across, so rotating a dead key would only mint another one.
  if (status === 'EXPIRED') {
    throw new BadRequestError('This API key has expired; create a new one instead');
  }

  const secret = generateSecret();

  const issued = mutate((db) => {
    const timestamp = nowIso();
    apiKey.status = 'REVOKED';
    apiKey.revokedAt = timestamp;
    apiKey.updatedAt = timestamp;

    const record: ApiKeyRecord = {
      id: createId(),
      teamId,
      name: apiKey.name,
      keyPrefix: secret.slice(0, PREVIEW_LENGTH),
      keyHash: hashApiKeySecret(secret),
      permissions: [...apiKey.permissions],
      status: 'ACTIVE',
      createdById: current.id,
      expiresAt: apiKey.expiresAt,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.apiKeys.push(record);
    return record;
  });

  recordAuditLog({
    actorId: current.id,
    action: 'api_key.rotated',
    targetType: 'api_key',
    targetId: issued.id,
    teamId,
    metadata: { rotatedFrom: keyId },
  });

  return { apiKey: toApiKeyView(issued), secret };
}

/**
 * Settles every stored key whose expiry has passed, and reports how many moved.
 *
 * Reads derive this already, so nothing on screen waits for the sweep. What it fixes is the
 * stored rows drifting from what the screens show: the tables outlive the session that wrote
 * them, and a key still claiming to be ACTIVE months after it lapsed misleads anything that
 * reads the database without going through the domain. A revoked key is left alone — it was
 * killed deliberately, and the expiry it never reached is not the interesting fact about it.
 */
export function expireStaleApiKeys(now = Date.now()): number {
  const stale = getDatabase().apiKeys.filter(
    (key) => effectiveApiKeyStatus(key, now) === 'EXPIRED' && key.status !== 'EXPIRED',
  );
  if (stale.length === 0) return 0;

  mutate(() => {
    const timestamp = nowIso();
    stale.forEach((key) => {
      key.status = 'EXPIRED';
      key.updatedAt = timestamp;
    });
  });

  return stale.length;
}

export interface ApiKeyPrincipal {
  id: string;
  teamId: string;
  permissions: TeamPermission[];
}

/**
 * Authenticates a machine caller presenting a secret, standing in for the `X-API-Key` header
 * the `/service/*` routes used to read. The key is scoped to one team, so a secret minted for
 * one team is rejected against another's data.
 */
export function authenticateApiKey(secret: string, teamId: string): ApiKeyPrincipal {
  const trimmed = secret.trim();
  if (!trimmed) {
    throw new UnauthorizedError('Missing API key');
  }

  const hash = hashApiKeySecret(trimmed);
  const apiKey = getDatabase().apiKeys.find((candidate) => candidate.keyHash === hash);

  if (!apiKey || apiKey.teamId !== teamId) {
    throw new UnauthorizedError('Invalid or revoked API key');
  }

  const status = effectiveApiKeyStatus(apiKey);
  if (status === 'EXPIRED') {
    throw new UnauthorizedError('This API key has expired');
  }
  if (status !== 'ACTIVE') {
    throw new UnauthorizedError('Invalid or revoked API key');
  }

  mutate(() => {
    apiKey.lastUsedAt = nowIso();
  });

  return { id: apiKey.id, teamId: apiKey.teamId, permissions: [...apiKey.permissions] };
}

export function requireApiKeyScope(principal: ApiKeyPrincipal, permission: TeamPermission): void {
  if (!principal.permissions.includes(permission)) {
    throw new ForbiddenError('This API key does not have the required scope');
  }
}
