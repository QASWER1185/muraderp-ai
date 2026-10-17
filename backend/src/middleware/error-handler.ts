import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { ApiError } from "../errors/api-error.js";

export const notFoundHandler: RequestHandler = (request, response) => {
  const requestId = request.id;
  response.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: `Route ${request.method} ${request.path} was not found`,
      requestId,
    },
  });
};

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  const requestId = request.id;
  const log = request.log;

  if (error && typeof error === "object" && "type" in error && error.type === "entity.too.large") {
    log.warn({ errorCode: "PAYLOAD_TOO_LARGE", requestId }, "request payload exceeded the configured limit");
    response.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request payload is too large", requestId } });
    return;
  }

  if (error instanceof ZodError) {
    log.warn({ err: error, errorCode: "VALIDATION_ERROR", requestId }, "request validation failed");
    response.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: error.flatten().fieldErrors,
        requestId,
      },
    });
    return;
  }

  if (error instanceof ApiError) {
    log.warn({ err: error, errorCode: error.code, requestId }, "request failed");
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
        requestId,
      },
    });
    return;
  }

  log.error({ err: error, errorCode: "INTERNAL_SERVER_ERROR", requestId }, "unexpected request error");
  response.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred",
      requestId,
    },
  });
};
