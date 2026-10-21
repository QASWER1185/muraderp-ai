import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { healthRouter } from "../src/routes/health.js";

const app = express();
app.use("/health", healthRouter);

describe("Stage 7 operational readiness", () => {
  it("exposes a liveness check without dependency on ERP configuration", async () => {
    const response = await request(app).get("/health/live");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.service).toBe("muraderp-api");
    expect(response.body.nodeVersion).toMatch(/^v\d+/);
    expect(response.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it("exposes readiness as a deterministic configuration check", async () => {
    const response = await request(app).get("/health/ready");

    expect([200, 503]).toContain(response.status);
    expect(["ready", "not_ready"]).toContain(response.body.status);
    expect(["ok", "missing"]).toContain(response.body.checks.configuration);
  });

  it("exposes safe diagnostics without secret material", async () => {
    const response = await request(app).get("/health/diagnostics");

    expect(response.status).toBe(200);
    expect(response.body.diagnostics.configuration).toEqual({
      environment: expect.any(String),
      supabaseConfigured: expect.any(Boolean),
      internalApiConfigured: expect.any(Boolean),
    });
    expect(JSON.stringify(response.body)).not.toContain("sb_secret_");
    expect(JSON.stringify(response.body)).not.toContain("INTERNAL_API_TOKEN");
    expect(JSON.stringify(response.body)).not.toContain("SUPABASE_SECRET_KEY");
  });
});
