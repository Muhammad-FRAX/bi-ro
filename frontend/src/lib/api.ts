const BASE = '/api'

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly data: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(hasBody && { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
    credentials: 'same-origin',
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }))
    throw new ApiError(
      (data as { error?: string }).error ?? res.statusText,
      res.status,
      data,
    )
  }

  // 204 No Content and empty bodies have no JSON to parse
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T
  }

  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string, init?: RequestInit) =>
    request<T>(path, { method: 'GET', ...init }),

  post: <T>(path: string, body: unknown, init?: RequestInit) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body), ...init }),

  patch: <T>(path: string, body: unknown, init?: RequestInit) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body), ...init }),

  delete: <T>(path: string, init?: RequestInit) =>
    request<T>(path, { method: 'DELETE', ...init }),
}
