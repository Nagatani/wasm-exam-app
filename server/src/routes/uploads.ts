import express, { Router } from 'express';
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

// Buffers the raw image in memory (capped at MAX_UPLOAD_BYTES) so disallowed
// MIME types and oversized payloads are rejected before anything touches disk.
const rawImageParser = express.raw({
  type: Object.keys(ALLOWED_IMAGE_TYPES),
  limit: MAX_UPLOAD_BYTES,
});

uploadsRouter.post('/', (req, res) => {
  const contentType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!contentType) {
    res.status(400).json({ error: '画像ファイルを選択してください。' });
    return;
  }
  const ext = ALLOWED_IMAGE_TYPES[contentType];
  if (!ext) {
    res.status(400).json({ error: 'PNG / JPEG / GIF / WebP 画像のみアップロードできます。' });
    return;
  }

  rawImageParser(req, res, async (err) => {
    if (err) {
      const bodyErr = err as { type?: string; status?: number };
      if (bodyErr.type === 'entity.too.large' || bodyErr.status === 413) {
        res
          .status(400)
          .json({ error: `画像は${MAX_UPLOAD_BYTES / (1024 * 1024)}MB以下にしてください。` });
        return;
      }
      res.status(400).json({ error: 'アップロードに失敗しました。' });
      return;
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: '画像ファイルを選択してください。' });
      return;
    }

    // Server-generated filename — never derived from any client-supplied
    // filename, so there's no path-traversal or extension-spoofing surface.
    const filename = `${crypto.randomUUID()}${ext}`;
    try {
      await fs.writeFile(path.join(UPLOADS_DIR, filename), req.body);
      res.status(201).json({ url: `${UPLOADS_URL_PREFIX}/${filename}` });
    } catch {
      res.status(500).json({ error: 'アップロードに失敗しました。' });
    }
  });
});
