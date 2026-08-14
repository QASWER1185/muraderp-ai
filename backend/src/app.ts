import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import customerRoutes from "./routes/customer.routes.js";
import { createErpRouter } from "./routes/erp.routes.js";
import { healthRouter } from "./routes/health.js";
import { createInventoryRouter } from "./routes/inventory.routes.js";
import { createProductRouter } from "./routes/product.routes.js";
import { createSalesRouter } from "./routes/sales.routes.js";
import { SupabaseErpService, type ErpService } from "./services/erp.service.js";

export interface AppOptions {
  erpService?: ErpService;
  internalApiToken?: string;
  internalApiPrincipalId?: string;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(pinoHttp({ enabled: env.NODE_ENV !== "test" }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_request, response) => response.status(200).send("MuradERP-AI Backend"));
  app.get("/api/test", (_request, response) => response.status(200).json({ success: true, message: "API Test Working" }));

  app.use("/api/v1/health", healthRouter);
  app.use("/api/v1", createErpRouter(
    options.internalApiToken ?? env.INTERNAL_API_TOKEN,
    options.internalApiPrincipalId ?? env.INTERNAL_API_PRINCIPAL_ID,
    options.erpService ?? new SupabaseErpService(),
  ));
  const internalApiToken = options.internalApiToken ?? env.INTERNAL_API_TOKEN;
  const internalApiPrincipalId = options.internalApiPrincipalId ?? env.INTERNAL_API_PRINCIPAL_ID;
  app.use("/api/v1/products", createProductRouter(internalApiToken));
  app.use("/api/v1/inventory", createInventoryRouter(internalApiToken));
  app.use("/api/v1/sales", createSalesRouter(internalApiToken, internalApiPrincipalId));

  // Temporary, in-memory compatibility paths for the pre-versioned prototype API.
  app.use("/api/health", healthRouter);
  app.use("/api", customerRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
