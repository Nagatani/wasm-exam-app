import { prepareTestDatabase } from './prepareTestDatabase';

// `integration` project: create + migrate the *_test database once before
// the suite. process.env.TEST_DATABASE_URL is set by vitest.config.mts.
export default async function setup(): Promise<void> {
  await prepareTestDatabase(process.env.TEST_DATABASE_URL);
}
