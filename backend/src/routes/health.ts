import { Router } from "express";

export function healthRouter() {
  const router = Router();

  router.get("/live", (_request, response) => {
    response.json({
      status: "alive",
      correlation_id: response.locals.correlationId as string,
    });
  });

  return router;
}
