import { ApiError } from './client';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

// Teacher-only image upload for problem-statement Markdown (TaskEditorPage's
// "画像を挿入"). Bypasses apiFetch's JSON body — this is a multipart upload,
// not JSON — mirroring downloadExamResultsCsv's own raw `fetch` for the same
// reason.
export async function uploadTaskImage(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append('file', file);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/uploads`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
  } catch {
    // Same reasoning as apiFetch's own network-failure handling: don't leak
    // the browser's raw "Failed to fetch" text.
    throw new ApiError(
      'サーバーに接続できませんでした。ネットワーク環境を確認し、しばらくしてから再度お試しください。',
      0,
    );
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body.error ?? '画像のアップロードに失敗しました。', res.status);
  }
  return body as { url: string };
}
