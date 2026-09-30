import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const HEADER_NAME = "x-correlation-id";
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const correlation: RequestHandler = (request, response, next) => {
  const proposed = request.header(HEADER_NAME);
  const correlationId =
    proposed && SAFE_ID.test(proposed) ? proposed : randomUUID();

  response.locals.correlationId = correlationId;
  response.setHeader(HEADER_NAME, correlationId);
  next();
};
