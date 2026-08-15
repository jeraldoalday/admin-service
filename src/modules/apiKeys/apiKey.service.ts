import { randomBytes } from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import { BadRequestError, NotFoundError } from '../../common/errors.js';
import {
  buildPaginatedResult,
  paginationToSkipTake,
  type PaginatedResult,
} from '../../common/pagination.js';
import type { ApiKeyStatus, TeamPermission } from '../../generated/prisma/enums.js';
import { hashApiKeySecret } from './apiKey.middleware.js';
import type { CreateApiKeyInput, ListApiKeysQuery } from './apiKey.validation.js';

const SECRET_PREFIX = 'sk';
const PREVIEW_LENGTH = SECRET_PREFIX.length + 9; // "sk_" + 8 hex chars, safe to display

export interface ApiKeyView {
  id: string;
  teamId: string;
  name: string;
  keyPrefix: string;
  permissions: TeamPermission[];
  status: ApiKeyStatus;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ApiKeyRecord {
  id: string;
  teamId: string;
  name: string;
  keyPrefix: string;
  permissions: string;
  status: ApiKeyStatus;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toApiKeyView(key: ApiKeyRecord): ApiKeyView {
  const { id, teamId, name, keyPrefix, status, expiresAt, lastUsedAt, revokedAt, createdAt, updatedAt } =
    key;
  return {
    id,
    teamId,
    name,
    keyPrefix,
    permissions: JSON.parse(key.permissions) as TeamPermission[],
    status,
    expiresAt,
    lastUsedAt,
    revokedAt,
    createdAt,
    updatedAt,
  };
}

function generateSecret(): string {
  return `${SECRET_PREFIX}_${randomBytes(24).toString('hex')}`;
}

export async function createApiKey(
  teamId: string,
  createdById: string,
  input: CreateApiKeyInput,
): Promise<{ apiKey: ApiKeyView; secret: string }> {
  const secret = generateSecret();

  const created = await prisma.apiKey.create({
    data: {
      teamId,
      name: input.name,
      keyPrefix: secret.slice(0, PREVIEW_LENGTH),
      keyHash: hashApiKeySecret(secret),
      permissions: JSON.stringify([...new Set(input.permissions)]),
      createdById,
      expiresAt: input.expiresAt ?? null,
    },
  });

  return { apiKey: toApiKeyView(created), secret };
}

export async function listApiKeys(
  teamId: string,
  query: ListApiKeysQuery,
): Promise<PaginatedResult<ApiKeyView>> {
  const where = {
    teamId,
    ...(query.status ? { status: query.status } : {}),
  };

  const [keys, total] = await Promise.all([
    prisma.apiKey.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...paginationToSkipTake(query),
    }),
    prisma.apiKey.count({ where }),
  ]);

  return buildPaginatedResult(keys.map(toApiKeyView), total, query);
}

async function getOwnedApiKeyOrThrow(teamId: string, keyId: string): Promise<ApiKeyRecord> {
  const apiKey = await prisma.apiKey.findUnique({ where: { id: keyId } });
  if (!apiKey || apiKey.teamId !== teamId) {
    throw new NotFoundError('API key not found');
  }
  return apiKey;
}

export async function getApiKeyById(teamId: string, keyId: string): Promise<ApiKeyView> {
  return toApiKeyView(await getOwnedApiKeyOrThrow(teamId, keyId));
}

export async function revokeApiKey(teamId: string, keyId: string): Promise<ApiKeyView> {
  const apiKey = await getOwnedApiKeyOrThrow(teamId, keyId);
  if (apiKey.status === 'REVOKED') {
    throw new BadRequestError('This API key is already revoked');
  }

  const updated = await prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { status: 'REVOKED', revokedAt: new Date() },
  });

  return toApiKeyView(updated);
}

export async function rotateApiKey(
  teamId: string,
  keyId: string,
  actorId: string,
): Promise<{ apiKey: ApiKeyView; secret: string }> {
  const apiKey = await getOwnedApiKeyOrThrow(teamId, keyId);
  if (apiKey.status === 'REVOKED') {
    throw new BadRequestError('This API key is already revoked; create a new one instead');
  }

  const secret = generateSecret();

  const [, issued] = await prisma.$transaction([
    prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    }),
    prisma.apiKey.create({
      data: {
        teamId,
        name: apiKey.name,
        keyPrefix: secret.slice(0, PREVIEW_LENGTH),
        keyHash: hashApiKeySecret(secret),
        permissions: apiKey.permissions,
        createdById: actorId,
        expiresAt: apiKey.expiresAt,
      },
    }),
  ]);

  return { apiKey: toApiKeyView(issued), secret };
}
