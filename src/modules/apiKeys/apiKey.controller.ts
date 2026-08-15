import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../common/errors.js';
import { recordAuditLog } from '../audit/audit.service.js';
import { teamIdParamsSchema } from '../teams/team.validation.js';
import {
  createApiKey,
  getApiKeyById,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
} from './apiKey.service.js';
import { apiKeyIdParamsSchema, createApiKeySchema, listApiKeysQuerySchema } from './apiKey.validation.js';

function requireUser(req: Request): { id: string } {
  if (!req.user) {
    throw new UnauthorizedError();
  }
  return req.user;
}

export async function create(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { teamId } = teamIdParamsSchema.parse(req.params);
  const input = createApiKeySchema.parse(req.body);

  const { apiKey, secret } = await createApiKey(teamId, user.id, input);

  await recordAuditLog({
    actorId: user.id,
    action: 'api_key.created',
    targetType: 'api_key',
    targetId: apiKey.id,
    metadata: { name: apiKey.name, permissions: apiKey.permissions },
  });

  res.status(201).json({ apiKey, secret });
}

export async function list(req: Request, res: Response): Promise<void> {
  const { teamId } = teamIdParamsSchema.parse(req.params);
  const query = listApiKeysQuerySchema.parse(req.query);
  const result = await listApiKeys(teamId, query);
  res.status(200).json(result);
}

export async function get(req: Request, res: Response): Promise<void> {
  const { teamId, keyId } = apiKeyIdParamsSchema.parse(req.params);
  const apiKey = await getApiKeyById(teamId, keyId);
  res.status(200).json({ apiKey });
}

export async function revoke(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { teamId, keyId } = apiKeyIdParamsSchema.parse(req.params);

  const apiKey = await revokeApiKey(teamId, keyId);

  await recordAuditLog({
    actorId: user.id,
    action: 'api_key.revoked',
    targetType: 'api_key',
    targetId: keyId,
  });

  res.status(200).json({ apiKey });
}

export async function rotate(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { teamId, keyId } = apiKeyIdParamsSchema.parse(req.params);

  const { apiKey, secret } = await rotateApiKey(teamId, keyId, user.id);

  await recordAuditLog({
    actorId: user.id,
    action: 'api_key.rotated',
    targetType: 'api_key',
    targetId: apiKey.id,
    metadata: { previousKeyId: keyId },
  });

  res.status(200).json({ apiKey, secret });
}
