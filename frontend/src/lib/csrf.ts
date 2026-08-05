// Patches the global fetch once so every mutating request automatically
// carries the CSRF double-submit header. This covers every call site in the
// app — raw fetch, the api.ts client, React Query — without each one needing
// to remember to add it. Import for its side effect only, as early as possible
// (before any component can fire a request).
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"])

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"))
  return match ? decodeURIComponent(match[1]) : null
}

const originalFetch = window.fetch.bind(window)

window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase()
  if (!MUTATING.has(method)) return originalFetch(input, init)

  const token = readCookie("csrf_token")
  if (!token) return originalFetch(input, init)

  const headers = new Headers(init?.headers)
  headers.set("X-CSRF-Token", token)
  return originalFetch(input, { ...init, headers })
}
