import 'dotenv/config';
import { createApp } from './app';
import { startSessionCleanup } from './lib/session';

const PORT = Number(process.env.PORT ?? 4000);

createApp().listen(PORT, () => {
  console.log(`server listening on :${PORT}`);
});

startSessionCleanup();
