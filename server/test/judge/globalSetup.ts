import { prepareTestDatabase } from '../integration/prepareTestDatabase';

// `judge` project: its own *_test database plus a reachable judge container
// (`docker compose up -d judge`, published on 127.0.0.1:4001 by default).
export default async function setup(): Promise<void> {
  const judgeUrl = process.env.TEST_JUDGE_URL!;
  try {
    const res = await fetch(`${judgeUrl.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    throw new Error(
      `The judge container isn't reachable at ${judgeUrl}. Start it with ` +
        '`docker compose up -d judge` from the repo root, or set TEST_JUDGE_URL.\n' +
        String(err),
    );
  }
  await prepareTestDatabase(process.env.TEST_JUDGE_DATABASE_URL);
}
