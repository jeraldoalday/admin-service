import { recordAuditLog } from './audit';
import { getDatabase, mutate } from './database';
import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from './errors';
import { requireActor, requireTeamPermission, type Actor } from './guards';
import { createId, createToken, nowIso } from './ids';
import { paginate, sortNewestFirst, type PaginatedResult } from './pagination';
import { sha256Hex } from './sha256';
import type { ApiKeyRecord, ApiKeyView, TeamPermission } from './types';
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

function toApiKeyView(key: ApiKeyRecord): ApiKeyView {
  const {
    id,
    teamId,
    name,
    keyPrefix,
    permissions,
    status,
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
    status,
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
    (key) => key.teamId === teamId && (!query.status || key.status === query.status),
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
  if (apiKey.status === 'REVOKED') {
    throw new BadRequestError('This API key is already revoked');
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
  if (apiKey.status === 'REVOKED') {
    throw new BadRequestError('This API key is already revoked; create a new one instead');
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
    metadata: { rotatedFrom: keyId },
  });

  return { apiKey: toApiKeyView(issued), secret };
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

  if (!apiKey || apiKey.teamId !== teamId || apiKey.status !== 'ACTIVE') {
    throw new UnauthorizedError('Invalid or revoked API key');
  }
  if (apiKey.expiresAt && Date.parse(apiKey.expiresAt) < Date.now()) {
    throw new UnauthorizedError('This API key has expired');
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
