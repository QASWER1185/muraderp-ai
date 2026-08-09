import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("MuradERP API foundation", () => {
  const app = createApp();

  it("reports that the API is healthy", async () => {
    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "ok",
      service: "muraderp-api",
      version: "0.1.0",
    });
    expect(Date.parse(response.body.timestamp)).not.toBeNaN();
  });

  it("returns a consistent error for unknown routes", async () => {
    const response = await request(app).get("/api/v1/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Route GET /api/v1/does-not-exist was not found",
      },
    });
  });

  it("adds baseline security headers", async () => {
    const response = await request(app).get("/api/v1/health");

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("keeps the existing customer module available through the versioned API", async () => {
    const response = await request(app).get("/api/v1/customers");

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });
});
