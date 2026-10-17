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
import { createCustomerPaymentBrowserRouter } from "./routes/customer-payment.browser.routes.js";
import { createSalesReturnRouter } from "./routes/sales-return.routes.js";
import { createSalesReturnBrowserRouter } from "./routes/sales-return.browser.routes.js";
import { createPurchaseBrowserRouter } from "./routes/purchase.browser.routes.js";
import { createStockBrowserRouter } from "./routes/stock.browser.routes.js";
import { createVendorPaymentRouter } from "./routes/vendor-payment.routes.js";
import { createVendorPaymentBrowserRouter } from "./routes/vendor-payment.browser.routes.js";
import { createAiCopilotRouter } from "./routes/ai-copilot.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { createEstimateConversionRouter } from "./routes/estimate-conversion.routes.js";
import { createCustomerRouter } from "./routes/customer.routes.js";
import { createVendorRouter } from "./routes/vendor.routes.js";
import { createProductRouter } from "./routes/product.routes.js";
import type { EstimateCloneRepriceService } from "./services/estimate-clone-reprice.service.js";
import { SupabaseCustomerPaymentService, type CustomerPaymentService } from "./services/customer-payment.service.js";
import { SupabaseVendorPaymentService, type VendorPaymentService } from "./services/vendor-payment.service.js";
import { SupabaseErpService, type ErpService } from "./services/erp.service.js";
import type { TenantAccessService } from "./auth/tenant-access.service.js";
import { createEstimateWhatsAppRouter } from "./routes/estimate-whatsapp.routes.js";
import type { EstimateWhatsAppShareService } from "./services/estimate-whatsapp-share.service.js";
import { createEstimateDraftRouter } from "./routes/estimate-draft.routes.js";
import { createDashboardRouter } from "./routes/dashboard.routes.js";
import { createWorkspaceRouter } from "./routes/workspace.routes.js";
import { createWarehouseBrowserRouter } from "./routes/warehouse.browser.routes.js";
import { createInvoiceBrowserRouter } from "./routes/invoice.browser.routes.js";
import { createRateListBrowserRouter } from "./routes/rate-list.browser.routes.js";
import { createAccountingBrowserRouter } from "./routes/accounting.browser.routes.js";
import { createReportsBrowserRouter } from "./routes/reports.browser.routes.js";
import type { WorkspaceDiscoveryService } from "./services/workspace-discovery.service.js";

export interface AppOptions { erpService?: ErpService; customerPaymentService?: CustomerPaymentService; vendorPaymentService?: VendorPaymentService; tenantAccessService?: Pick<TenantAccessService, "assertAuthorized">; workspaceDiscoveryService?: WorkspaceDiscoveryService; estimateConversionService?: EstimateCloneRepriceService; estimateWhatsAppShareService?: EstimateWhatsAppShareService; internalApiToken?: string; internalApiPrincipalId?: string; }
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
  app.use("/api/v1/workspaces", createWorkspaceRouter(options.workspaceDiscoveryService));
  app.use("/api/v1/warehouses", createWarehouseBrowserRouter({ internalApiToken, servicePrincipalId: internalApiPrincipalId, service: erpService, tenantAuthorizer: options.tenantAccessService }));

  app.use("/api/v1/customers", createCustomerRouter({ internalApiToken, servicePrincipalId: internalApiPrincipalId, service: erpService, tenantAuthorizer: options.tenantAccessService }));
  app.use("/api/v1/vendors", createVendorRouter({ internalApiToken, servicePrincipalId: internalApiPrincipalId, service: erpService, tenantAuthorizer: options.tenantAccessService }));
  app.use("/api/v1/products", createProductRouter({ internalApiToken, servicePrincipalId: internalApiPrincipalId, service: erpService, tenantAuthorizer: options.tenantAccessService }));
  app.use("/api/v1/rate-lists", createRateListBrowserRouter({ internalApiToken, servicePrincipalId: internalApiPrincipalId, references: erpService, tenantAuthorizer: options.tenantAccessService }));
  app.use("/api/v1/browser/accounting", createAccountingBrowserRouter({ internalApiToken, servicePrincipalId: internalApiPrincipalId, tenantAuthorizer: options.tenantAccessService }));
  app.use("/api/v1/browser/reports", createReportsBrowserRouter({ internalApiToken, servicePrincipalId: internalApiPrincipalId, tenantAuthorizer: options.tenantAccessService }));
  app.use("/api/v1/invoices", createInvoiceBrowserRouter({ internalApiToken, servicePrincipalId: internalApiPrincipalId, tenantAuthorizer: options.tenantAccessService }));
  app.use("/api/v1/browser/customer-payments", createCustomerPaymentBrowserRouter({ internalApiToken, servicePrincipalId: internalApiPrincipalId, service: options.customerPaymentService, tenantAuthorizer: options.tenantAccessService }));
  app.use("/api/v1/browser/vendor-payments", createVendorPaymentBrowserRouter({ internalApiToken, servicePrincipalId: internalApiPrincipalId, service: options.vendorPaymentService, tenantAuthorizer: options.tenantAccessService }));
  app.use("/api/v1/returns", createSalesReturnBrowserRouter({ internalApiToken, servicePrincipalId: internalApiPrincipalId, tenantAuthorizer: options.tenantAccessService }));
  app.use("/api/v1/browser/purchases", createPurchaseBrowserRouter({ internalApiToken, servicePrincipalId: internalApiPrincipalId, service: erpService, tenantAuthorizer: options.tenantAccessService }));
  app.use("/api/v1/browser/stock", createStockBrowserRouter({ internalApiToken, servicePrincipalId: internalApiPrincipalId, service: erpService, tenantAuthorizer: options.tenantAccessService }));
  app.use("/api/v1/dashboard", createDashboardRouter({ internalApiToken, servicePrincipalId: internalApiPrincipalId, service: erpService, tenantAuthorizer: options.tenantAccessService }));
  app.use("/api/v1/dashboard", createReportsBrowserRouter({ internalApiToken, servicePrincipalId: internalApiPrincipalId, tenantAuthorizer: options.tenantAccessService }));
  app.use("/api/v1", createErpRouter(internalApiToken, internalApiPrincipalId, erpService, options.tenantAccessService));
  app.use("/api/v1/estimates", createEstimateDraftRouter({ internalApiToken, servicePrincipalId: internalApiPrincipalId, referenceService: erpService, tenantAuthorizer: options.tenantAccessService }));
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
