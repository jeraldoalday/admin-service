import { prisma } from '../../db/prisma.js';
import { NotFoundError } from '../../common/errors.js';
import {
  buildPaginatedResult,
  paginationToSkipTake,
  type PaginatedResult,
} from '../../common/pagination.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { UserRole } from '../../generated/prisma/enums.js';
import type { ListUsersQuery, UpdateUserInput } from './user.validation.js';

export interface AdminUserView {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toAdminUserView(user: {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): AdminUserView {
  const { id, email, displayName, role, isActive, createdAt, updatedAt } = user;
  return { id, email, displayName, role, isActive, createdAt, updatedAt };
}

export async function listUsers(query: ListUsersQuery): Promise<PaginatedResult<AdminUserView>> {
  const where = {
    ...(query.role ? { role: query.role } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    ...(query.search
      ? {
          OR: [{ email: { contains: query.search } }, { displayName: { contains: query.search } }],
        }
      : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...paginationToSkipTake(query),
    }),
    prisma.user.count({ where }),
  ]);

  return buildPaginatedResult(users.map(toAdminUserView), total, query);
}

export async function getUserById(id: string): Promise<AdminUserView> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new NotFoundError('User not found');
  }
  return toAdminUserView(user);
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<AdminUserView> {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError('User not found');
  }

  const data: Prisma.UserUpdateInput = {};
  if (input.displayName !== undefined) data.displayName = input.displayName;
  if (input.role !== undefined) data.role = input.role;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  const user = await prisma.user.update({ where: { id }, data });
  return toAdminUserView(user);
}

export async function deleteUser(id: string): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError('User not found');
  }
  await prisma.user.delete({ where: { id } });
}
