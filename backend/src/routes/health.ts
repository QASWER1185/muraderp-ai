import { Router } from "express";
import { env } from "../config/env.js";

export const healthRouter = Router();

const buildHealthPayload = (requestId: unknown) => ({
  service: "muraderp-api",
  version: "0.1.0",
  timestamp: new Date().toISOString(),
  uptimeSeconds: Math.floor(process.uptime()),
  nodeVersion: process.version,
  environment: env.NODE_ENV,
  ...(requestId === undefined ? {} : { requestId: String(requestId) }),
});

healthRouter.get("/", (request, response) => {
  response.status(200).json({
    status: "ok",
    ...buildHealthPayload(request.id),
  });
});

healthRouter.get("/live", (request, response) => {
  response.status(200).json({
    status: "ok",
    ...buildHealthPayload(request.id),
  });
});

healthRouter.get("/ready", (request, response) => {
  const erpConfigurationComplete = Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY && env.INTERNAL_API_TOKEN);
  const ready = env.NODE_ENV !== "production" || erpConfigurationComplete;

  response.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    checks: {
      configuration: erpConfigurationComplete ? "ok" : "missing",
    },
    ...buildHealthPayload(request.id),
  });
});

healthRouter.get("/diagnostics", (request, response) => {
  response.status(200).json({
    status: "ok",
    diagnostics: {
      process: {
        pid: process.pid,
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        platform: process.platform,
      },
      configuration: {
        environment: env.NODE_ENV,
        supabaseConfigured: Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY),
        internalApiConfigured: Boolean(env.INTERNAL_API_TOKEN),
      },
    },
    timestamp: new Date().toISOString(),
    requestId: String(request.id),
  });
});
