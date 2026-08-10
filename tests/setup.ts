import { afterAll, beforeEach } from 'vitest';
import { prisma } from '../src/db/prisma.js';

beforeEach(async () => {
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});
