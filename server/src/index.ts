import 'dotenv/config';
import { createApp } from './app';
import { startSessionCleanup } from './lib/session';
import { resumePendingGrading } from './lib/grading';

const PORT = Number(process.env.PORT ?? 4000);

createApp().listen(PORT, () => {
  console.log(`server listening on :${PORT}`);
});

startSessionCleanup();

// Attempts left in GRADING (e.g. the server restarted mid-grading) are
// re-queued; their drafts are still there to grade from.
resumePendingGrading()
  .then((n) => {
    if (n > 0) console.log(`grading: resumed ${n} pending attempt(s)`);
  })
  .catch((err) => console.error('grading: could not resume pending attempts:', err));
