import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/config/env.js";

const validProductionEnv = {
  NODE_ENV: "production",
  PORT: "3000",
  OPENAI_API_KEY: `sk-${"a".repeat(48)}`,
  AI_MODEL: "gpt-6-astra",
  AI_SPEECH_MODEL: "gpt-transcribe",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: `sb_secret_${"x".repeat(40)}`,
  INTERNAL_API_TOKEN: "t".repeat(64),
  INTERNAL_API_PRINCIPAL_ID: "muraderp-api-prod-01",
};

describe("production configuration guardrails", () => {
  it("accepts a complete HTTPS production configuration", () => {
    expect(parseEnv(validProductionEnv).success).toBe(true);
  });

  it("rejects partial ERP production configuration", () => {
    expect(parseEnv({ ...validProductionEnv, INTERNAL_API_TOKEN: undefined }).success).toBe(false);
    expect(parseEnv({ ...validProductionEnv, INTERNAL_API_PRINCIPAL_ID: undefined }).success).toBe(false);
  });

  it("requires non-placeholder AI provider configuration in production", () => {
    expect(parseEnv({ ...validProductionEnv, OPENAI_API_KEY: undefined }).success).toBe(false);
    expect(parseEnv({ ...validProductionEnv, OPENAI_API_KEY: "replace_me_with_server_only_openai_api_key" }).success).toBe(false);
  });

  it("rejects generic/default service principal identities", () => {
    for (const principal of ["internal-system", "backend", "service_role", "default", "system"]) {
      expect(parseEnv({ ...validProductionEnv, INTERNAL_API_PRINCIPAL_ID: principal }).success).toBe(false);
    }
  });

  it("rejects HTTP Supabase URLs in production", () => {
    expect(parseEnv({ ...validProductionEnv, SUPABASE_URL: "http://example.supabase.co" }).success).toBe(false);
  });

  it("rejects placeholder production secrets", () => {
    expect(parseEnv({ ...validProductionEnv, SUPABASE_SECRET_KEY: "sb_secret_" + "replace_me_12345678901234567890" }).success).toBe(false);
  });

  it("rejects placeholder internal tokens in production", () => {
    expect(parseEnv({ ...validProductionEnv, INTERNAL_API_TOKEN: "replace_with_a_long_random_internal_token_123456789" }).success).toBe(false);
  });

  it("rejects placeholder service principal identifiers in production", () => {
    expect(parseEnv({ ...validProductionEnv, INTERNAL_API_PRINCIPAL_ID: "replace_with_unique_service_principal_id" }).success).toBe(false);
  });
});
