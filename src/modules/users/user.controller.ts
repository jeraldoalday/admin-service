import type { Request, Response } from 'express';
import { BadRequestError, UnauthorizedError } from '../../common/errors.js';
import { recordAuditLog } from '../audit/audit.service.js';
import { deleteUser, getUserById, listUsers, updateUser } from './user.service.js';
import { listUsersQuerySchema, updateUserSchema, userIdParamsSchema } from './user.validation.js';

export async function list(req: Request, res: Response): Promise<void> {
  const query = listUsersQuerySchema.parse(req.query);
  const result = await listUsers(query);
  res.status(200).json(result);
}

export async function get(req: Request, res: Response): Promise<void> {
  const { id } = userIdParamsSchema.parse(req.params);
  const user = await getUserById(id);
  res.status(200).json({ user });
}

export async function update(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError();
  }

  const { id } = userIdParamsSchema.parse(req.params);
  const input = updateUserSchema.parse(req.body);

  if (id === req.user.id && (input.role !== undefined || input.isActive === false)) {
    throw new BadRequestError(
      'Admins cannot change their own role or deactivate their own account',
    );
  }

  const user = await updateUser(id, input);

  await recordAuditLog({
    actorId: req.user.id,
    action: 'user.updated',
    targetType: 'user',
    targetId: id,
    metadata: input,
  });

  res.status(200).json({ user });
}

export async function remove(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError();
  }

  const { id } = userIdParamsSchema.parse(req.params);

  if (id === req.user.id) {
    throw new BadRequestError('Admins cannot delete their own account');
  }

  await deleteUser(id);

  await recordAuditLog({
    actorId: req.user.id,
    action: 'user.deleted',
    targetType: 'user',
    targetId: id,
  });

  res.status(204).send();
}
