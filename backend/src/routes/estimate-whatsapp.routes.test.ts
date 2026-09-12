import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createEstimateWhatsAppRouter } from "./estimate-whatsapp.routes.js";
import { errorHandler } from "../middleware/error-handler.js";

const token = "whatsapp-share-test-token-12345678901234567890";
const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

describe("Estimate WhatsApp share route", () => {
  it("returns a no-store prepared link under explicit tenant context", async () => {
    const prepare = vi.fn().mockResolvedValue({ channel: "WHATSAPP", mode: "WEB_LINK", phone: "923001234567", message: "Estimate EST-50", share_url: "https://wa.me/923001234567?text=Estimate%20EST-50", document_name: "EST-50.pdf", document_format: "PDF" });
    const app = express();
    app.use("/estimates", createEstimateWhatsAppRouter(token, "whatsapp-share-test", { prepare }));
    app.use(errorHandler);

    const response = await request(app).get("/estimates/50/whatsapp-share")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Organization-Id", organizationId)
      .set("X-Branch-Id", branchId)
      .set("X-Actor-User-Id", userId);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.data.share_url).toContain("wa.me");
    expect(prepare).toHaveBeenCalledWith({ estimateId: 50, organizationId, branchId, userId });
  });

  it("does not expose the share preparation without authentication", async () => {
    const app = express();
    app.use("/estimates", createEstimateWhatsAppRouter(token, "whatsapp-share-test", { prepare: vi.fn() }));
    app.use(errorHandler);
    expect((await request(app).get("/estimates/50/whatsapp-share")).status).toBe(401);
  });
});
