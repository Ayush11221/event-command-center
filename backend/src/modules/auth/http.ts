import { ContactType, PrismaClient, ProofPurpose } from "@prisma/client";
import type { Request, Response } from "express";
import { Router } from "express";
import type { FoundationConfig } from "../../config/foundation.js";
import { recordAudit, accountActor } from "./audit.js";
import { ApiError, unavailable } from "./errors.js";
import { OtpService } from "./otp.js";
import { otpRequestSource } from "./otp-source.js";
import {
  ACCESS_MS,
  idleExpiry,
  liveSession,
  parseRenewal,
  requireCurrentRenewal,
  rotateSession,
} from "./sessions.js";
import {
  csrfToken,
  signAccountToken,
  signGuestProof,
  validCsrfToken,
  verifyAccountToken,
  verifyGuestProof,
} from "./tokens.js";

const ACCOUNT_COOKIE = "eoc_session";
const RENEWAL_COOKIE = "eoc_renewal";
const GUEST_COOKIE = "eoc_guest_proof";

export interface AuthContext {
  userId: string;
  sessionId: string;
}

export interface AuthDependencies {
  db: PrismaClient;
  config: FoundationConfig;
  otp: OtpService;
  frontendOrigin: string;
}

export function cookie(request: Request, name: string): string | undefined {
  const header = request.header("cookie") ?? "";
  for (const item of header.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return parts.join("=");
  }
  return undefined;
}

function setAuthCookie(
  response: Response,
  name: string,
  value: string,
  secure: boolean,
  maxAge = ACCESS_MS,
) {
  response.cookie(name, value, {
    httpOnly: true,
    secure,
    sameSite: name === GUEST_COOKIE ? "lax" : "none",
    path: name === RENEWAL_COOKIE ? "/api/v1/auth" : "/api/v1",
    maxAge,
  });
}

function clearAuthCookie(response: Response, name: string, secure: boolean) {
  response.clearCookie(name, {
    httpOnly: true,
    secure,
    sameSite: name === GUEST_COOKIE ? "lax" : "none",
    path: name === RENEWAL_COOKIE ? "/api/v1/auth" : "/api/v1",
  });
}

export function requireOrigin(request: Request, expected: string) {
  if (request.header("origin") !== expected) {
    throw new ApiError(403, "FORBIDDEN", "Request origin not allowed");
  }
}

function input(request: Request): Record<string, unknown> {
  if (
    !request.body ||
    typeof request.body !== "object" ||
    Array.isArray(request.body)
  ) {
    throw new ApiError(400, "VALIDATION", "Invalid request body");
  }
  return request.body as Record<string, unknown>;
}

function proofInput(request: Request) {
  const body = input(request);
  if (
    (body.type !== ContactType.EMAIL && body.type !== ContactType.PHONE) ||
    typeof body.contact !== "string" ||
    body.contact.length > 320
  ) {
    throw new ApiError(400, "VALIDATION", "Invalid verification input");
  }
  return { type: body.type, contact: body.contact, body };
}

function accountInput(request: Request, verifying = false) {
  const result = proofInput(request);
  const allowed = verifying ? ["type", "contact", "code"] : ["type", "contact"];
  if (Object.keys(result.body).some((key) => !allowed.includes(key))) {
    throw new ApiError(400, "VALIDATION", "Invalid verification input");
  }
  return result;
}

async function issueAccountCookies(
  response: Response,
  deps: AuthDependencies,
  result: {
    userId: string;
    sessionId: string;
    renewal: string;
    absoluteExpiresAt: Date;
  },
) {
  const token = await signAccountToken(
    result.userId,
    result.sessionId,
    deps.config.jwtSecret,
  );
  setAuthCookie(response, ACCOUNT_COOKIE, token, deps.config.cookieSecure);
  setAuthCookie(
    response,
    RENEWAL_COOKIE,
    result.renewal,
    deps.config.cookieSecure,
    Math.max(0, result.absoluteExpiresAt.getTime() - Date.now()),
  );
}

async function renewalAuthority(
  request: Request,
  deps: AuthDependencies,
  bootstrap = false,
) {
  const proof = parseRenewal(
    cookie(request, RENEWAL_COOKIE),
    deps.config.jwtSecret,
  );
  try {
    const stored = await deps.db.session.findUnique({
      where: { id: proof.sessionId },
    });
    // A MAC-authenticated historical credential can obtain only the session's
    // CSRF token, allowing POST refresh to detect and revoke a stale replay.
    // This read grants no access and never extends the logical session.
    const session =
      bootstrap &&
      liveSession(stored, new Date()) &&
      stored.renewalHash &&
      stored.absoluteExpiresAt
        ? stored
        : requireCurrentRenewal(
            stored,
            proof,
            deps.config.jwtSecret,
            new Date(),
          );
    return { userId: session.userId, sessionId: session.id };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unavailable();
  }
}

function safeUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export async function authenticate(
  request: Request,
  deps: AuthDependencies,
): Promise<AuthContext> {
  const token = cookie(request, ACCOUNT_COOKIE);
  if (!token)
    throw new ApiError(401, "UNAUTHENTICATED", "Authentication required");
  let claims;
  try {
    claims = await verifyAccountToken(token, deps.config.jwtSecret);
  } catch {
    throw new ApiError(401, "UNAUTHENTICATED", "Authentication required");
  }
  if (!safeUuid(claims.userId) || !safeUuid(claims.sessionId)) {
    throw new ApiError(401, "UNAUTHENTICATED", "Authentication required");
  }
  let session;
  try {
    session = await deps.db.session.findUnique({
      where: { id: claims.sessionId },
    });
  } catch {
    throw unavailable();
  }
  const now = new Date();
  if (!liveSession(session, now) || session.userId !== claims.userId) {
    throw new ApiError(401, "UNAUTHENTICATED", "Authentication required");
  }
  // Touch only renewable sessions, at most once per minute. Guard the write so
  // an expiry/revocation racing this read cannot revive authority.
  if (
    session.absoluteExpiresAt &&
    session.expiresAt.getTime() <
      idleExpiry(now, session.absoluteExpiresAt).getTime() - 60_000
  ) {
    try {
      const touched = await deps.db.session.updateMany({
        where: {
          id: session.id,
          userId: claims.userId,
          revokedAt: null,
          expiresAt: { gt: now },
          absoluteExpiresAt: { gt: now },
        },
        data: { expiresAt: idleExpiry(now, session.absoluteExpiresAt) },
      });
      if (!touched.count)
        throw new ApiError(401, "UNAUTHENTICATED", "Authentication required");
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw unavailable();
    }
  }
  return { userId: claims.userId, sessionId: claims.sessionId };
}

export function requireCsrf(
  request: Request,
  actor: AuthContext,
  deps: AuthDependencies,
) {
  requireOrigin(request, deps.frontendOrigin);
  if (
    !validCsrfToken(
      request.header("x-csrf-token"),
      actor.sessionId,
      deps.config.jwtSecret,
    )
  ) {
    throw new ApiError(403, "CSRF_INVALID", "Request verification failed");
  }
}

export function authRouter(deps: AuthDependencies) {
  const router = Router();
  router.use((_request, response, next) => {
    response.set("Cache-Control", "private, no-store");
    response.set("Pragma", "no-cache");
    next();
  });

  // Safe CSRF bootstrap after the access cookie has expired. No access
  // credential or account facts are returned; renewal authority is unchanged.
  router.get("/account/session", async (request, response) => {
    const actor = await renewalAuthority(request, deps, true);
    response.json({
      csrf_token: csrfToken(actor.sessionId, deps.config.jwtSecret),
    });
  });

  router.post("/account/refresh", async (request, response) => {
    requireOrigin(request, deps.frontendOrigin);
    const proof = parseRenewal(
      cookie(request, RENEWAL_COOKIE),
      deps.config.jwtSecret,
    );
    requireCsrf(request, { userId: "", sessionId: proof.sessionId }, deps);
    let result;
    try {
      result = await deps.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Session" WHERE "id" = ${proof.sessionId}::uuid FOR UPDATE`;
        const session = await tx.session.findUnique({
          where: { id: proof.sessionId },
        });
        return rotateSession(
          tx,
          session,
          proof,
          deps.config,
          response.locals.correlationId as string,
        );
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw unavailable();
    }
    if ("error" in result) throw result.error;
    await issueAccountCookies(response, deps, result);
    response.json({
      status: "authenticated",
      correlation_id: response.locals.correlationId,
    });
  });

  router.post("/account/challenge", async (request, response) => {
    requireOrigin(request, deps.frontendOrigin);
    const { type, contact } = accountInput(request);
    const source = otpRequestSource(request, deps.config.otpAbuse);
    const deliver = await deps.otp.request(
      ProofPurpose.ACCOUNT,
      type,
      contact,
      response.locals.correlationId as string,
      null,
      source,
    );
    if (deliver)
      response.once("finish", () => {
        void deliver();
      });
    response.status(202).json({
      status: "pending",
      correlation_id: response.locals.correlationId,
    });
  });

  router.post("/account/verify", async (request, response) => {
    requireOrigin(request, deps.frontendOrigin);
    const { type, contact, body } = accountInput(request, true);
    if (typeof body.code !== "string") {
      throw new ApiError(400, "VALIDATION", "Invalid verification input");
    }
    const result = await deps.otp.verify(
      ProofPurpose.ACCOUNT,
      type,
      contact,
      body.code,
      response.locals.correlationId as string,
    );
    if (result.kind !== "account") throw unavailable();
    await issueAccountCookies(response, deps, result);
    response.json({
      status: "authenticated",
      correlation_id: response.locals.correlationId,
    });
  });

  router.post("/guest/challenge", async (request, response) => {
    requireOrigin(request, deps.frontendOrigin);
    const { type, contact } = proofInput(request);
    const source = otpRequestSource(request, deps.config.otpAbuse);
    const deliver = await deps.otp.request(
      ProofPurpose.GUEST_OWNERSHIP,
      type,
      contact,
      response.locals.correlationId as string,
      null,
      source,
    );
    if (deliver)
      response.once("finish", () => {
        void deliver();
      });
    response.status(202).json({
      status: "pending",
      correlation_id: response.locals.correlationId,
    });
  });

  router.post("/guest/verify", async (request, response) => {
    requireOrigin(request, deps.frontendOrigin);
    const { type, contact, body } = proofInput(request);
    if (typeof body.code !== "string") {
      throw new ApiError(400, "VALIDATION", "Invalid verification input");
    }
    const result = await deps.otp.verify(
      ProofPurpose.GUEST_OWNERSHIP,
      type,
      contact,
      body.code,
      response.locals.correlationId as string,
    );
    if (result.kind !== "guest") throw unavailable();
    const token = await signGuestProof(
      result.lookupHash,
      "guest_ownership",
      result.contextEventId,
      deps.config.jwtSecret,
    );
    setAuthCookie(response, GUEST_COOKIE, token, deps.config.cookieSecure);
    response.json({
      status: "verified",
      correlation_id: response.locals.correlationId,
    });
  });

  router.get("/guest/self", async (request, response) => {
    const token = cookie(request, GUEST_COOKIE);
    if (!token)
      throw new ApiError(401, "UNAUTHENTICATED", "Verification required");
    try {
      const proof = await verifyGuestProof(token, deps.config.jwtSecret);
      response.json({
        status: "verified",
        purpose: proof.purpose,
        context_event_id: proof.contextEventId,
        csrf_token: csrfToken(token, deps.config.jwtSecret),
        correlation_id: response.locals.correlationId,
      });
    } catch {
      throw new ApiError(401, "UNAUTHENTICATED", "Verification required");
    }
  });

  router.get("/me", async (request, response) => {
    const actor = await authenticate(request, deps);
    let user;
    let assignments;
    try {
      user = await deps.db.user.findUnique({
        where: { id: actor.userId },
        select: { id: true, organizerCapable: true },
      });
      assignments = await deps.db.eventRoleAssignment.findMany({
        where: { userId: actor.userId, revokedAt: null },
        select: { id: true, eventId: true, role: true, gateId: true },
      });
    } catch {
      throw unavailable();
    }
    if (!user)
      throw new ApiError(401, "UNAUTHENTICATED", "Authentication required");
    response.json({
      user_id: user.id,
      organizer_capable: user.organizerCapable,
      assignments: assignments.map((item) => ({
        id: item.id,
        event_id: item.eventId,
        role: item.role,
        gate_id: item.gateId,
      })),
      csrf_token: csrfToken(actor.sessionId, deps.config.jwtSecret),
      correlation_id: response.locals.correlationId,
    });
  });

  router.post("/logout", async (request, response) => {
    let actor;
    try {
      actor = await authenticate(request, deps);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      actor = await renewalAuthority(request, deps);
    }
    requireCsrf(request, actor, deps);
    try {
      await deps.db.$transaction(async (tx) => {
        await tx.session.update({
          where: { id: actor.sessionId },
          data: { revokedAt: new Date(), renewalHash: null },
        });
        await recordAudit(tx, {
          actorKind: accountActor,
          actorUserId: actor.userId,
          action: "SESSION_REVOKED",
          outcome: "ACCEPTED",
          correlationId: response.locals.correlationId as string,
        });
      });
    } catch {
      throw unavailable();
    }
    clearAuthCookie(response, ACCOUNT_COOKIE, deps.config.cookieSecure);
    clearAuthCookie(response, RENEWAL_COOKIE, deps.config.cookieSecure);
    response.json({
      status: "logged_out",
      correlation_id: response.locals.correlationId,
    });
  });

  return router;
}
