import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/config/env.js";

const validProductionEnv = {
  NODE_ENV: "production",
  PORT: "3000",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: `sb_secret_${"x".repeat(40)}`,
  INTERNAL_API_TOKEN: "t".repeat(64),
  INTERNAL_API_PRINCIPAL_ID: "internal-system",
};

describe("production configuration guardrails", () => {
  it("accepts a complete HTTPS production configuration", () => {
    expect(parseEnv(validProductionEnv).success).toBe(true);
  });

  it("rejects partial ERP production configuration", () => {
    const result = parseEnv({
      ...validProductionEnv,
      INTERNAL_API_TOKEN: undefined,
    });

    expect(result.success).toBe(false);
  });

  it("rejects HTTP Supabase URLs in production", () => {
    const result = parseEnv({
      ...validProductionEnv,
      SUPABASE_URL: "http://example.supabase.co",
    });

    expect(result.success).toBe(false);
  });

  it("rejects placeholder production secrets", () => {
    const result = parseEnv({
      ...validProductionEnv,
      SUPABASE_SECRET_KEY:
        "sb_secret_" + "replace_me_12345678901234567890",
    });

    expect(result.success).toBe(false);
  });

  it("rejects placeholder internal tokens in production", () => {
    const result = parseEnv({
      ...validProductionEnv,
      INTERNAL_API_TOKEN: "replace_with_a_long_random_internal_token_123456789",
    });

    expect(result.success).toBe(false);
  });
});
