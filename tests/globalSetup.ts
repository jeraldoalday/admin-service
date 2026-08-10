import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { config as loadEnv } from 'dotenv';

export default function globalSetup(): void {
  loadEnv({ path: '.env.test', quiet: true });

  const dbPath = new URL('../prisma/test.db', import.meta.url).pathname;
  if (existsSync(dbPath)) {
    rmSync(dbPath);
  }

  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: process.env,
  });
}
