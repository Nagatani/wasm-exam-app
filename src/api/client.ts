const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
  } catch {
    // `fetch` itself rejected (offline, DNS failure, server unreachable, CORS
    // block, ...) — the browser's own message here (e.g. "Failed to fetch")
    // is technical and often in English, so every caller that already
    // branches on `err instanceof ApiError` (the norm across this app) gets
    // this one consistent, localized message instead of leaking that text to
    // students/teachers. status 0 marks it as "no HTTP response at all",
    // distinct from any real server status code.
    throw new ApiError(
      'サーバーに接続できませんでした。ネットワーク環境を確認し、しばらくしてから再度お試しください。',
      0,
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(body.error ?? 'リクエストに失敗しました。', res.status);
  }

  return body as T;
}
