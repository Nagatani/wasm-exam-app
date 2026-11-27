// Loads server/.env in local development without overriding existing env vars.
// Docker (env_file) and E2E start without a .env file, so ENOENT is ignored.
export function loadEnvFileIfExists(filePath?: string): void {
  try {
    if (filePath !== undefined) {
      process.loadEnvFile(filePath);
    } else {
      process.loadEnvFile();
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}

loadEnvFileIfExists();
