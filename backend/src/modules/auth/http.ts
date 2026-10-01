import { ContactType, PrismaClient, ProofPurpose } from "@prisma/client";
import type { Request, Response } from "express";
import { Router } from "express";
import type { FoundationConfig } from "../../config/foundation.js";
import { recordAudit, accountActor } from "./audit.js";
import { ApiError, unavailable } from "./errors.js";
import { OtpService } from "./otp.js";
import {
  csrfToken,
  signAccountToken,
  signGuestProof,
  validCsrfToken,
  verifyAccountToken,
  verifyGuestProof,
} from "./tokens.js";

const ACCOUNT_COOKIE = "eoc_session";
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

function cookie(request: Request, name: string): string | undefined {
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
) {
  response.cookie(name, value, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/api/v1",
    maxAge: 15 * 60_000,
  });
}

function clearAuthCookie(response: Response, name: string, secure: boolean) {
  response.clearCookie(name, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/api/v1",
  });
}

function requireOrigin(request: Request, expected: string) {
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
  if (
    !session ||
    session.userId !== claims.userId ||
    session.revokedAt ||
    session.expiresAt <= new Date()
  ) {
    throw new ApiError(401, "UNAUTHENTICATED", "Authentication required");
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
    throw new ApiError(403, "CSRF", "Request verification failed");
  }
}

export function authRouter(deps: AuthDependencies) {
  const router = Router();

  router.post("/account/challenge", async (request, response) => {
    requireOrigin(request, deps.frontendOrigin);
    const { type, contact } = proofInput(request);
    const deliver = await deps.otp.request(
      ProofPurpose.ACCOUNT,
      type,
      contact,
      response.locals.correlationId as string,
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
    const { type, contact, body } = proofInput(request);
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
    const token = await signAccountToken(
      result.userId,
      result.sessionId,
      deps.config.jwtSecret,
    );
    setAuthCookie(response, ACCOUNT_COOKIE, token, deps.config.cookieSecure);
    response.json({
      status: "authenticated",
      correlation_id: response.locals.correlationId,
    });
  });

  router.post("/guest/challenge", async (request, response) => {
    requireOrigin(request, deps.frontendOrigin);
    const { type, contact } = proofInput(request);
    const deliver = await deps.otp.request(
      ProofPurpose.GUEST_OWNERSHIP,
      type,
      contact,
      response.locals.correlationId as string,
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
    const actor = await authenticate(request, deps);
    requireCsrf(request, actor, deps);
    try {
      await deps.db.$transaction(async (tx) => {
        await tx.session.update({
          where: { id: actor.sessionId },
          data: { revokedAt: new Date() },
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
    response.json({
      status: "logged_out",
      correlation_id: response.locals.correlationId,
    });
  });

  return router;
}
