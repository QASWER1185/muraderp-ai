import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("Phase 23 authentication/session security", () => {
  const app = createApp({ internalApiToken: "phase23-test-internal-token-1234567890" });

  it("rejects protected session access without a browser session", async () => {
    const response = await request(app).get("/api/v1/auth/session");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a tampered browser session cookie", async () => {
    const response = await request(app)
      .get("/api/v1/auth/session")
      .set("Cookie", "muraderp_session=invalid.invalid");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("accepts logout without requiring an active session", async () => {
    const response = await request(app).delete("/api/v1/auth/session");
    expect(response.status).toBe(204);
  });
});
