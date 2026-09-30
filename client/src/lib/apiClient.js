// Same-origin API client.  This is deliberately not a fetch monkey-patch:
// third-party APIs and static assets must retain their normal fetch behavior.
const SESSION_EXPIRY_CODES = new Set(["SESSION_IDLE_EXPIRED", "SESSION_MAX_AGE"]);
const REAUTH_REPLAY_PATHS = new Set([
  "/api/auth/change-password", "/api/account", "/api/stripe/portal",
  "/api/stripe/pause", "/api/stripe/resume", "/api/stripe/cancel", "/api/stripe/downgrade",
]);
let handlers = { onSessionExpired: null, requestReauth: null };
let reauthPromise = null;
export function createReauthCoordinator(request) {
  let pending = null;
  return () => {
    if (!pending) pending = Promise.resolve(request()).finally(() => { pending = null; });
    return pending;
  };
}

export class ApiError extends Error {
  constructor(message, response, code) {
    super(message);
    this.name = "ApiError";
    this.response = response;
    this.status = response?.status;
    this.code = code;
  }
}

export function configureApiClient(nextHandlers) {
  handlers = { ...handlers, ...nextHandlers };
  return () => {
    for (const key of Object.keys(nextHandlers)) handlers[key] = null;
  };
}

export async function responseCode(response) {
  if (response.status !== 401 && response.status !== 403) return null;
  try {
    const payload = await response.clone().json();
    return payload?.code || payload?.error?.code || null;
  } catch { return null; }
}

export function isReplaySafe(method = "GET", options = {}) {
  return ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}
export function isReauthReplayAllowed(input, method) {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
  const verb = method.toUpperCase();
  return (verb === "POST" && REAUTH_REPLAY_PATHS.has(url.pathname))
    || (verb === "DELETE" && url.pathname === "/api/account");
}

function sameOrigin(input) {
  const url = input instanceof Request ? input.url : String(input);
  try { return new URL(url, window.location.origin).origin === window.location.origin; }
  catch { return false; }
}

async function getReauthApproval() {
  if (!reauthPromise) reauthPromise = Promise.resolve(handlers.requestReauth?.()).finally(() => { reauthPromise = null; });
  return reauthPromise;
}

/**
 * Fetch a same-origin API endpoint with cookie and legacy bearer compatibility.
 * A REAUTH_REQUIRED response is retried only after one shared approval and only
 * for reads or an explicitly approved/idempotent mutation.
 */
export async function apiFetch(input, init = {}, options = {}) {
  if (!sameOrigin(input)) return fetch(input, init);
  const method = (init.method || (input instanceof Request && input.method) || "GET").toUpperCase();
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
  try {
    const token = localStorage.getItem("clvr_auth_token");
    if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  } catch {}
  if (options.idempotencyKey && !headers.has("Idempotency-Key")) headers.set("Idempotency-Key", options.idempotencyKey);
  const requestInit = { ...init, method, headers, credentials: init.credentials || "include" };
  const response = await fetch(input, requestInit);
  const code = await responseCode(response);

  if (SESSION_EXPIRY_CODES.has(code)) {
    handlers.onSessionExpired?.(code);
    return response;
  }
  if (code === "REAUTH_REQUIRED" && !options.skipReauth) {
    const approved = await getReauthApproval();
    if (approved && !options._retried && (isReplaySafe(method) || isReauthReplayAllowed(input, method))) {
      return apiFetch(input, init, { ...options, _retried: true });
    }
  }
  return response;
}

export async function apiJson(input, init, options) {
  const response = await apiFetch(input, init, options);
  if (!response.ok) {
    const code = await responseCode(response);
    let message = response.statusText;
    try { message = (await response.clone().json())?.error || message; } catch {}
    throw new ApiError(message || `Request failed (${response.status})`, response, code);
  }
  return response.json();
}

// A failed session check is not proof that the visitor signed out. Only an
// explicit 401 or a successful { user: null } response means unauthenticated.
export async function readAuthSession(response) {
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`Account status unavailable (${response.status})`);
  const data = await response.json();
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid account status response");
  if (Object.hasOwn(data, "user")) {
    if (data.user === null) return null;
    if (data.user && typeof data.user === "object" && data.user.id) return data.user;
  } else if (data.id) {
    // Older servers returned the user fields at the top level.
    return data;
  }
  throw new Error("Invalid account status response");
}