import { afterAll, beforeEach } from 'vitest';
import { prisma } from '../src/db/prisma.js';

beforeEach(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});
