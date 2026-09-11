import fs from 'node:fs';
import path from 'node:path';

// Where uploaded task-statement images are written on disk. Overridable via
// UPLOADS_DIR specifically so the containerized operational deployment
// (docker-compose.prod.yml) can point this at a mounted volume — without one,
// uploads live only in that container's writable layer and are lost the next
// time it's recreated (rebuild/redeploy). See docs/operations.md.
export const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve(__dirname, '../../uploads');

// Where those files are served from — server/src/index.ts mounts
// express.static(UPLOADS_DIR) at this path, publicly (no auth): a task
// statement's illustrative images aren't the personal/graded data this app's
// "self-hosted, institution-controlled infra" constraint is about, and a
// student needs to load them from the exam page without a fetch-with-cookie
// dance, same as any other static asset.
export const UPLOADS_URL_PREFIX = '/uploads';

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Allow-list, not a denylist — deliberately narrow to what a Markdown problem
// statement actually needs (illustrative images), not "any file". The
// extension is derived from this map (server-decided), never taken from the
// client-supplied original filename.
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB
