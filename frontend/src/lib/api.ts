// Single fetch wrapper for the whole app. Every page that used to hand-roll
// its own fetch + credentials + JSON parsing + error handling goes through
// this instead. Two problems this solves that raw fetch calls didn't:
//   1. A 401 (expired/invalid session) redirects to /login instead of the
//      page silently rendering stale or empty data.
//   2. Failures throw a typed ApiError with the server's actual message,
//      instead of every call site writing its own try/catch boilerplate.
// The CSRF header itself is injected lower down, by the global fetch patch
// in lib/csrf.ts — this file doesn't need to know about it.

export class ApiError extends Error {
  status: number
  // Full parsed error JSON, when the endpoint sent structured detail beyond
  // just a message (e.g. POST /api/staff's 409 includes the colliding
  // person's own details so the UI can show a same-name comparison).
  data?: unknown
  constructor(status: number, message: string, data?: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.data = data
  }
}

function isFileLike(body: unknown): body is Blob {
  return body instanceof Blob
}

function onAuthPage() {
  return location.pathname === "/login" || location.pathname === "/register"
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    if (!onAuthPage()) location.href = "/login"
    throw new ApiError(401, "Your session has expired. Please sign in again.")
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}) as { error?: string })
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data)
  }
  if (res.status === 204) return undefined as T
  const contentType = res.headers.get("content-type") || ""
  return contentType.includes("application/json") ? (res.json() as Promise<T>) : (undefined as T)
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "include" }

  if (isFileLike(body)) {
    init.headers = { "Content-Type": body.type || "application/octet-stream" }
    init.body = body
  } else if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" }
    init.body = JSON.stringify(body)
  }

  const res = await fetch(url, init)
  return handleResponse<T>(res)
}

export const api = {
  get:    <T = unknown>(url: string) => request<T>("GET", url),
  post:   <T = unknown>(url: string, body?: unknown) => request<T>("POST", url, body),
  put:    <T = unknown>(url: string, body?: unknown) => request<T>("PUT", url, body),
  patch:  <T = unknown>(url: string, body?: unknown) => request<T>("PATCH", url, body),
  // Some DELETE routes identify the target in the body rather than the path
  // (e.g. /api/exstaff/permanent takes { folderId }), so a body is allowed.
  delete: <T = unknown>(url: string, body?: unknown) => request<T>("DELETE", url, body),

  // Binary downloads (profile photos, document scans) never carry a JSON
  // body, so they get their own path — same 401 handling, no JSON parsing.
  async getBlob(url: string): Promise<Blob | null> {
    const res = await fetch(url, { credentials: "include" })
    if (res.status === 401) {
      if (!onAuthPage()) location.href = "/login"
      return null
    }
    if (!res.ok) return null
    return res.blob()
  },
}
