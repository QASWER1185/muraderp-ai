import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import customerRoutes from "./routes/customer.routes.js";
import { healthRouter } from "./routes/health.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    pinoHttp({
      enabled: env.NODE_ENV !== "test",
    }),
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_request, response) => {
    response.status(200).send("MuradERP-AI Backend");
  });

  app.get("/api/test", (_request, response) => {
    response.status(200).json({
      success: true,
      message: "API Test Working",
    });
  });

  app.use("/api/v1/health", healthRouter);
  app.use("/api/v1", customerRoutes);

  // Temporary compatibility paths for the pre-versioned prototype API.
  app.use("/api/health", healthRouter);
  app.use("/api", customerRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
