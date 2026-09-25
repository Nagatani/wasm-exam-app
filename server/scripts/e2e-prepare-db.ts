// Prepares the browser E2E suite's database (see playwright.config.ts):
// creates + migrates it via the same `_test`-name-guarded helper the vitest
// suites use, then empties every application table so each run starts from a
// blank system (the first signup becomes the teacher, like a fresh deploy).
// Run with `npx tsx scripts/e2e-prepare-db.ts` from server/.
import { PrismaClient } from '@prisma/client';
import { prepareTestDatabase } from '../test/integration/prepareTestDatabase';

async function main() {
  const url = process.env.DATABASE_URL;
  await prepareTestDatabase(url); // refuses any database not named *_test
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    if (tables.length > 0) {
      const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
