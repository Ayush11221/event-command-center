import express, { Router, type Request, type Response } from "express";
import {
  authenticate,
  requireCsrf,
  type AuthDependencies,
  type AuthContext,
} from "../auth/http.js";
import { ApiError, unavailable } from "../auth/errors.js";
import { recordAudit } from "../auth/audit.js";
import {
  auditActor,
  registrationIdentity,
  type Identity,
} from "../registrations/identity.js";
import { parseIdempotencyKey } from "../events/command-safety.js";
import { validateManagementEventId } from "../events/management-command.js";
import { staffScope } from "./access.js";
import {
  fonts,
  templates,
  normalizeName,
  selection,
  revokeReason,
} from "./contract.js";
import { CertificateService } from "./service.js";

export function certificateRouter(
  deps: AuthDependencies,
  service: CertificateService,
) {
  const router = Router();
  const run =
    (
      owner: boolean,
      action: (
        req: Request,
        res: Response,
        identity?: Identity,
        actor?: AuthContext,
      ) => Promise<void>,
    ) =>
    async (req: Request, res: Response) => {
      res.set({
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      });
      let identity: Identity | undefined, actor: AuthContext | undefined;
      try {
        if (owner)
          identity = await registrationIdentity(
            req,
            deps,
            req.method === "POST",
          );
        else {
          actor = await authenticate(req, deps);
          if (req.method === "POST") requireCsrf(req, actor, deps);
        }
        if (
          Object.keys(req.query).length ||
          (req.method === "GET" &&
            (req.headers["transfer-encoding"] ||
              Number(req.headers["content-length"] ?? 0) > 0))
        )
          throw new ApiError(
            400,
            "VALIDATION",
            "Query and read body fields are not supported",
          );
        if (req.method === "POST")
          await new Promise<void>((resolve, reject) =>
            express.json({ limit: "16kb", strict: true })(
              req,
              res,
              (error?: unknown) =>
                error
                  ? reject(new ApiError(400, "VALIDATION", "Invalid JSON body"))
                  : resolve(),
            ),
          );
        await action(req, res, identity, actor);
      } catch (error) {
        const known = error instanceof ApiError ? error : unavailable();
        try {
          await deps.db.$transaction((tx) =>
            recordAudit(tx, {
              ...(identity
                ? auditActor(identity)
                : {
                    actorKind: actor
                      ? ("ACCOUNT" as const)
                      : ("SYSTEM" as const),
                    actorUserId: actor?.userId,
                  }),
              action: "CERTIFICATE_ACTION_DENIED",
              outcome: "DENIED",
              correlationId: res.locals.correlationId,
              metadata: { code: known.code },
            }),
          );
        } catch {
          throw unavailable();
        }
        throw known;
      }
    };
  const regId = (req: Request) => {
    const id = String(req.params.registrationId);
    try {
      validateManagementEventId(id);
    } catch {
      throw new ApiError(
        404,
        "REGISTRATION_NOT_FOUND",
        "Registration not found",
      );
    }
    return id;
  };
  const ownerPath = "/registrations/:registrationId/certificate",
    staffPath = "/events/:eventId/registrations/:registrationId/certificate";
  const corr = (res: Response) => res.locals.correlationId as string;
  router.get(
    "/events/:eventId/certificate-templates",
    run(false, async (req, res, _identity, actor) => {
      const eventId = String(req.params.eventId);
      await deps.db.$transaction((tx) => staffScope(tx, actor!, eventId));
      res.json({
        event_id: eventId,
        templates: templates.map((template_id) => ({
          template_id,
          template_version: 1,
        })),
        fonts: fonts.map((font_id) => ({ font_id })),
        correlation_id: corr(res),
      });
    }),
  );
  router.get(
    ownerPath,
    run(true, async (req, res, identity) => {
      res.json({
        ...(await service.ownerStatus(identity!, regId(req), corr(res))),
        correlation_id: corr(res),
      });
    }),
  );
  router.post(
    ownerPath + "/recipient-name",
    run(true, async (req, res, identity) => {
      const result = await service.setName(
        identity!,
        regId(req),
        await normalizeName(req.body),
        parseIdempotencyKey(req.header("Idempotency-Key")),
        corr(res),
      );
      res
        .status(result.status)
        .json({ ...result.body, correlation_id: corr(res) });
    }),
  );
  router.get(
    ownerPath + "/artifact",
    run(true, async (req, res, identity) => {
      const artifact = await service.artifact(identity!, regId(req), corr(res));
      res
        .set(
          "Content-Disposition",
          `attachment; filename="certificate-${artifact.number}.pdf"`,
        )
        .type("application/pdf")
        .send(Buffer.from(artifact.bytes));
    }),
  );
  router.get(
    staffPath,
    run(false, async (req, res, _identity, actor) => {
      res.json({
        ...(await service.staffStatus(
          actor!,
          String(req.params.eventId),
          regId(req),
          corr(res),
        )),
        correlation_id: corr(res),
      });
    }),
  );
  router.post(
    staffPath + "/preview",
    run(false, async (req, res, _identity, actor) => {
      const bytes = await service.preview(
        actor!,
        String(req.params.eventId),
        regId(req),
        selection(req.body),
      );
      res
        .set(
          "Content-Disposition",
          'inline; filename="certificate-preview.pdf"',
        )
        .type("application/pdf")
        .send(Buffer.from(bytes));
    }),
  );
  router.post(
    staffPath,
    run(false, async (req, res, _identity, actor) => {
      const result = await service.issue(
        actor!,
        String(req.params.eventId),
        regId(req),
        selection(req.body),
        parseIdempotencyKey(req.header("Idempotency-Key")),
        corr(res),
      );
      res
        .status(result.status)
        .json({ ...result.body, correlation_id: corr(res) });
    }),
  );
  router.post(
    staffPath + "/revoke",
    run(false, async (req, res, _identity, actor) => {
      const result = await service.revoke(
        actor!,
        String(req.params.eventId),
        regId(req),
        revokeReason(req.body),
        parseIdempotencyKey(req.header("Idempotency-Key")),
        corr(res),
      );
      res
        .status(result.status)
        .json({ ...result.body, correlation_id: corr(res) });
    }),
  );
  return router;
}
