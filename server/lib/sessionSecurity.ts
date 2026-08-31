import type { NextFunction, Request, Response } from "express";
import type { Session } from "express-session";
import { pool } from "../db";

export const SESSION_POLICY_VERSION = 1;
export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
export const RECENT_AUTH_MS = 10 * 60 * 1000;
export const HEARTBEAT_THROTTLE_MS = 5 * 60 * 1000;

export type SecuritySession = {
  userId?: string;
  loginAt?: number;
  lastActivityAt?: number;
  lastStrongAuthAt?: number;
  strongAuthMethod?: "password" | "webauthn" | "legacy";
  sessionPolicyVersion?: number;
};

type CanonicalSession = {
  kind: "cookie" | "bearer";
  sid: string;
  data: SecuritySession;
  // The raw connect-pg-simple JSON document, including cookie and unrelated
  // application state. Never replace it with policy fields alone.
  document?: Record<string, unknown>;
};

export function authContext(req: Request): CanonicalSession | undefined {
  return (req as any).canonicalAuthSession;
}

export function setBearerAuthContext(req: Request, sid: string, document: Record<string, unknown>): void {
  (req as any).canonicalAuthSession = {
    kind: "bearer",
    sid,
    document,
    data: document as SecuritySession,
  } satisfies CanonicalSession;
}

/** Production bearer compatibility hydrator. It intentionally exposes only a
 * non-enumerable userId on the transient cookie session; writes use canonicalAuthSession. */
export async function bearerHydrationMiddleware(req: Request, _res: Response, next: NextFunction) {
  const sess = req.session as Session & { userId?: string };
  if (sess?.userId || req.path === "/api/auth/signin" || req.path === "/api/auth/signup") return next();
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return next();
  const sid = authorization.slice(7).trim();
  if (!sid) return next();
  try {
    const result = await pool.query(
      "SELECT sess FROM user_sessions WHERE sid = $1 AND expire > NOW()",
      [sid],
    );
    const document = result.rows[0]?.sess as Record<string, unknown> | undefined;
    const userId = document?.userId;
    if (typeof userId === "string" && document) {
      setBearerAuthContext(req, sid, document);
      Object.defineProperty(req.session, "userId", {
        value: userId, writable: true, enumerable: false, configurable: true,
      });
    }
  } catch {
    // Route-level authentication remains fail-closed.
  }
  next();
}

class CanonicalSessionRevokedError extends Error {
  code = "SESSION_REVOKED";
}

export function mergePolicyIntoSessionDocument(
  document: Record<string, unknown>,
  policy: SecuritySession,
): Record<string, unknown> {
  return { ...document, ...policy };
}

export function canonicalUpdateSucceeded(rowCount: number | null): boolean {
  return rowCount === 1;
}

async function persist(req: Request, context: CanonicalSession): Promise<void> {
  if (context.kind === "bearer") {
    const policyPatch = JSON.stringify({
      userId: context.data.userId,
      loginAt: context.data.loginAt,
      lastActivityAt: context.data.lastActivityAt,
      lastStrongAuthAt: context.data.lastStrongAuthAt,
      strongAuthMethod: context.data.strongAuthMethod,
      sessionPolicyVersion: context.data.sessionPolicyVersion,
    });
    const result = await pool.query(
      `UPDATE user_sessions
          SET sess = (sess::jsonb || $1::jsonb)::json,
              expire = to_timestamp(($3::double precision + $4::double precision) / 1000.0)
        WHERE sid = $2 AND expire > NOW()`,
      [policyPatch, context.sid, context.data.loginAt, SESSION_ABSOLUTE_MS],
    );
    if (!canonicalUpdateSucceeded(result.rowCount)) throw new CanonicalSessionRevokedError();
    return;
  }
  Object.assign(req.session as any, context.data);
  await new Promise<void>((resolve, reject) =>
    req.session.save(error => error ? reject(error) : resolve()),
  );
}

export async function revokeCanonicalSession(req: Request, context = authContext(req)): Promise<void> {
  if (!context) throw new CanonicalSessionRevokedError();
  if (context.kind === "bearer") {
    const result = await pool.query("DELETE FROM user_sessions WHERE sid = $1", [context.sid]);
    if (!canonicalUpdateSucceeded(result.rowCount)) throw new CanonicalSessionRevokedError();
    return;
  }
  await new Promise<void>(resolve => req.session.destroy(() => resolve()));
}

export async function sessionPolicyMiddleware(req: Request, res: Response, next: NextFunction) {
  if ([
    "/api/auth/signin",
    "/api/auth/signup",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
    "/api/auth/webauthn/authenticate",
  ].includes(req.path)) return next();
  const cookieData = req.session as Session & SecuritySession;
  let context = authContext(req);
  if (!context && cookieData?.userId) {
    context = { kind: "cookie", sid: req.sessionID, data: cookieData };
    (req as any).canonicalAuthSession = context;
  }
  if (!context?.data.userId) return next();

  const now = Date.now();
  const migrating = !context.data.loginAt || !context.data.lastActivityAt
    || context.data.sessionPolicyVersion !== SESSION_POLICY_VERSION;
  if (migrating) {
    context.data.loginAt = context.data.loginAt || now;
    context.data.lastActivityAt = context.data.lastActivityAt || now;
    context.data.lastStrongAuthAt = context.data.lastStrongAuthAt || 0;
    context.data.strongAuthMethod = context.data.strongAuthMethod || "legacy";
    context.data.sessionPolicyVersion = SESSION_POLICY_VERSION;
    if (context.kind === "cookie") req.session.cookie.maxAge = SESSION_ABSOLUTE_MS;
    try {
      await persist(req, context);
    } catch (error: any) {
      if (error?.code === "SESSION_REVOKED") {
        return res.status(401).json({ error: "Session expired", code: "SESSION_REVOKED" });
      }
      return res.status(503).json({ error: "Session unavailable", code: "SESSION_STORE_ERROR" });
    }
    return next();
  }

  const loginAt = context.data.loginAt!;
  const lastActivityAt = context.data.lastActivityAt!;
  const code = now - loginAt >= SESSION_ABSOLUTE_MS
    ? "SESSION_MAX_AGE"
    : now - lastActivityAt >= SESSION_IDLE_MS
      ? "SESSION_IDLE_EXPIRED"
      : null;
  if (code) {
    try { await revokeCanonicalSession(req, context); } catch { /* expiry remains fail-closed */ }
    return res.status(401).json({ error: "Session expired", code });
  }
  next();
}

export function initializeAuthenticatedSession(session: SecuritySession, userId: string, now = Date.now()): void {
  session.userId = userId;
  session.loginAt = now;
  session.lastActivityAt = now;
  session.lastStrongAuthAt = now;
  session.strongAuthMethod = "password";
  session.sessionPolicyVersion = SESSION_POLICY_VERSION;
}

export async function updateSessionActivity(req: Request): Promise<SecuritySession> {
  const context = authContext(req);
  if (!context?.data.userId) throw new Error("UNAUTHENTICATED");
  const now = Date.now();
  if (!context.data.lastActivityAt || now - context.data.lastActivityAt >= HEARTBEAT_THROTTLE_MS) {
    context.data.lastActivityAt = now;
    await persist(req, context);
  }
  return context.data;
}

export function sessionStatus(req: Request) {
  const data = authContext(req)?.data;
  if (!data?.userId || !data.loginAt || !data.lastActivityAt) return null;
  return {
    authenticated: true,
    idleExpiresAt: data.lastActivityAt + SESSION_IDLE_MS,
    absoluteExpiresAt: data.loginAt + SESSION_ABSOLUTE_MS,
    sessionPolicyVersion: data.sessionPolicyVersion,
  };
}

export async function markStrongPasswordAuth(req: Request): Promise<void> {
  const context = authContext(req);
  if (!context?.data.userId) throw new Error("UNAUTHENTICATED");
  context.data.lastStrongAuthAt = Date.now();
  context.data.strongAuthMethod = "password";
  await persist(req, context);
}

export function requireRecentAuth(maxAgeMs = RECENT_AUTH_MS) {
  return (req: Request, res: Response, next: NextFunction) => {
    const data = authContext(req)?.data;
    if (!data?.userId) return res.status(401).json({ error: "Authentication required", code: "UNAUTHENTICATED" });
    if (!data.lastStrongAuthAt || Date.now() - data.lastStrongAuthAt > maxAgeMs) {
      return res.status(403).json({ error: "Recent authentication required", code: "REAUTH_REQUIRED" });
    }
    next();
  };
}