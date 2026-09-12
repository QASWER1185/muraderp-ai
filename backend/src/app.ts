import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { createErpRouter } from "./routes/erp.routes.js";
import { healthRouter } from "./routes/health.js";
import { createInventoryRouter } from "./routes/inventory.routes.js";
import { createSalesRouter } from "./routes/sales.routes.js";
import { createCustomerPaymentRouter } from "./routes/customer-payment.routes.js";
import { createSalesReturnRouter } from "./routes/sales-return.routes.js";
import { createVendorPaymentRouter } from "./routes/vendor-payment.routes.js";
import { createAiCopilotRouter } from "./routes/ai-copilot.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { createEstimateConversionRouter } from "./routes/estimate-conversion.routes.js";
import { createCustomerRouter } from "./routes/customer.routes.js";
import { createVendorRouter } from "./routes/vendor.routes.js";
import type { EstimateCloneRepriceService } from "./services/estimate-clone-reprice.service.js";
import { SupabaseCustomerPaymentService, type CustomerPaymentService } from "./services/customer-payment.service.js";
import { SupabaseVendorPaymentService, type VendorPaymentService } from "./services/vendor-payment.service.js";
import { SupabaseErpService, type ErpService } from "./services/erp.service.js";
import type { TenantAccessService } from "./auth/tenant-access.service.js";
import { createEstimateWhatsAppRouter } from "./routes/estimate-whatsapp.routes.js";
import type { EstimateWhatsAppShareService } from "./services/estimate-whatsapp-share.service.js";

export interface AppOptions { erpService?: ErpService; customerPaymentService?: CustomerPaymentService; vendorPaymentService?: VendorPaymentService; tenantAccessService?: Pick<TenantAccessService, "assertAuthorized">; estimateConversionService?: EstimateCloneRepriceService; estimateWhatsAppShareService?: EstimateWhatsAppShareService; internalApiToken?: string; internalApiPrincipalId?: string; }
const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../frontend");

export function createApp(options: AppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    pinoHttp({
      enabled: env.NODE_ENV !== "test",
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie"],
        censor: "[REDACTED]",
      },
      customProps: (request) => ({ requestId: request.id }),
    }),
  );
  const internalApiToken = options.internalApiToken ?? env.INTERNAL_API_TOKEN;
  const internalApiPrincipalId = options.internalApiPrincipalId ?? env.INTERNAL_API_PRINCIPAL_ID;
  const erpService = options.erpService ?? new SupabaseErpService();

  // AI media is capped and signature-validated at 8 MB; only this route accepts the larger base64 JSON envelope.
  app.use("/api/v1/ai/copilot", express.json({ limit: "12mb" }), createAiCopilotRouter(internalApiToken, undefined, internalApiPrincipalId));
  app.use(express.json({ limit: "1mb" }));
  app.get("/", (_request, response) => response.status(200).send("MuradERP-AI Backend"));
  app.get("/api/test", (_request, response) => response.status(200).json({ success: true, message: "API Test Working" }));
  app.use("/api/v1/health", healthRouter);
  app.use("/api/health", healthRouter);
  app.use("/api/v1/auth", authRouter);

  app.use("/api/v1/customers", createCustomerRouter({ internalApiToken, servicePrincipalId: internalApiPrincipalId, service: erpService, tenantAuthorizer: options.tenantAccessService }));
  app.use("/api/v1/vendors", createVendorRouter({ internalApiToken, servicePrincipalId: internalApiPrincipalId, service: erpService, tenantAuthorizer: options.tenantAccessService }));
  app.use("/api/v1", createErpRouter(internalApiToken, internalApiPrincipalId, erpService, options.tenantAccessService));
  app.use("/api/v1/estimates", createEstimateConversionRouter(internalApiToken, internalApiPrincipalId, options.estimateConversionService));
  app.use("/api/v1/estimates", createEstimateWhatsAppRouter(internalApiToken, internalApiPrincipalId, options.estimateWhatsAppShareService));
  app.use("/api/v1/inventory", createInventoryRouter(internalApiToken, internalApiPrincipalId, options.tenantAccessService));
  app.use("/api/v1/sales", createSalesRouter(internalApiToken, internalApiPrincipalId));
  app.use("/api/v1/customer-payments", createCustomerPaymentRouter(internalApiToken, internalApiPrincipalId, options.customerPaymentService ?? new SupabaseCustomerPaymentService()));
  app.use("/api/v1/vendor-payments", createVendorPaymentRouter(internalApiToken, internalApiPrincipalId, options.vendorPaymentService ?? new SupabaseVendorPaymentService()));
  app.use("/api/v1/sales-returns", createSalesReturnRouter(internalApiToken, internalApiPrincipalId));
  app.use("/frontend", express.static(frontendRoot, { index: "index.html", fallthrough: false }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
