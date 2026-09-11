import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  UPLOADS_DIR,
  UPLOADS_URL_PREFIX,
} from '../lib/uploads';

export const uploadsRouter = Router();

// Teacher-only — this exists for problem-statement authoring
// (TaskEditorPage's "画像を挿入"), not a general-purpose file host.
uploadsRouter.use(requireAuth, requireRole('TEACHER'));

const UNSUPPORTED_TYPE = 'unsupported_type';

// memoryStorage (not diskStorage): the file is small (capped at
// MAX_UPLOAD_BYTES) and this lets fileFilter reject a bad mimetype before
// anything touches disk — multer's diskStorage would otherwise partially
// write the file before the filter's rejection unwinds it.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype in ALLOWED_IMAGE_TYPES) {
      cb(null, true);
    } else {
      cb(new Error(UNSUPPORTED_TYPE));
    }
  },
});

uploadsRouter.post('/', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res
          .status(400)
          .json({ error: `画像は${MAX_UPLOAD_BYTES / (1024 * 1024)}MB以下にしてください。` });
        return;
      }
      if (err instanceof Error && err.message === UNSUPPORTED_TYPE) {
        res.status(400).json({ error: 'PNG / JPEG / GIF / WebP 画像のみアップロードできます。' });
        return;
      }
      res.status(400).json({ error: 'アップロードに失敗しました。' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: '画像ファイルを選択してください。' });
      return;
    }

    const ext = ALLOWED_IMAGE_TYPES[req.file.mimetype];
    // Server-generated filename — never derived from the client-supplied
    // original name, so there's no path-traversal or extension-spoofing
    // surface from it.
    const filename = `${crypto.randomUUID()}${ext}`;
    await fs.writeFile(path.join(UPLOADS_DIR, filename), req.file.buffer);
    res.status(201).json({ url: `${UPLOADS_URL_PREFIX}/${filename}` });
  });
});
