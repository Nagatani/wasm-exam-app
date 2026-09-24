import { execSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

// Makes sure a dedicated test database exists and is migrated to the current
// schema. Never touches any database whose name doesn't end in `_test`, so a
// misconfigured URL can't wipe the dev (or a real) database. Shared by the
// `integration` and `judge` vitest projects' global setups — each project has
// its own database so the two can run in parallel without truncating each
// other's rows.
export async function prepareTestDatabase(url: string | undefined): Promise<void> {
  if (!url) throw new Error('Test database URL is not set (see server/vitest.config.mts).');
  const parsed = new URL(url);
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!/^[A-Za-z0-9_]+_test$/.test(dbName)) {
    throw new Error(
      `Refusing to run integration tests against "${dbName}": the database name must end in "_test".`,
    );
  }

  // Connect to the server's maintenance database to create the test DB.
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  try {
    const rows = await admin.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${dbName}) AS "exists"`;
    if (!rows[0]?.exists) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    }
  } catch (err) {
    throw new Error(
      `Could not reach PostgreSQL for the integration tests (${parsed.host}). ` +
        'Start it with `docker compose up -d db` from the repo root, or set TEST_DATABASE_URL.\n' +
        String(err),
    );
  } finally {
    await admin.$disconnect();
  }

  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
