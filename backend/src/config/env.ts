import { z } from "zod";

const FORBIDDEN_SERVICE_PRINCIPALS = new Set([
  "backend",
  "default",
  "internal-system",
  "service-role",
  "service_role",
  "system",
]);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    OPENAI_API_KEY: z.string().trim().min(20).optional(),
    AI_MODEL: z.string().trim().min(1).default("gpt-6-astra"),
    AI_SPEECH_MODEL: z.string().trim().min(1).default("gpt-transcribe"),
    SUPABASE_URL: z.url().optional(),
    SUPABASE_SECRET_KEY: z.string().startsWith("sb_secret_").min(32).optional(),
    INTERNAL_API_TOKEN: z.string().min(32).optional(),
    INTERNAL_API_PRINCIPAL_ID: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/)
      .optional(),
  })
  .superRefine((configuration, context) => {
    const erpValues = [
      configuration.SUPABASE_URL,
      configuration.SUPABASE_SECRET_KEY,
      configuration.INTERNAL_API_TOKEN,
      configuration.INTERNAL_API_PRINCIPAL_ID,
    ];
    const configuredValues = erpValues.filter((value) => value !== undefined).length;

    if (configuredValues > 0 && configuredValues < erpValues.length) {
      context.addIssue({
        code: "custom",
        message:
          "SUPABASE_URL, SUPABASE_SECRET_KEY, INTERNAL_API_TOKEN, and INTERNAL_API_PRINCIPAL_ID must be configured together",
      });
    }

    if (
      configuration.INTERNAL_API_PRINCIPAL_ID &&
      FORBIDDEN_SERVICE_PRINCIPALS.has(configuration.INTERNAL_API_PRINCIPAL_ID.toLowerCase())
    ) {
      context.addIssue({
        code: "custom",
        path: ["INTERNAL_API_PRINCIPAL_ID"],
        message: "INTERNAL_API_PRINCIPAL_ID must be an explicit named service identity",
      });
    }

    if (configuration.NODE_ENV === "production") {
      if (!configuration.OPENAI_API_KEY) {
        context.addIssue({ code: "custom", path: ["OPENAI_API_KEY"], message: "Production AI Copilot requires OPENAI_API_KEY" });
      }
      if (configuration.OPENAI_API_KEY?.toLowerCase().includes("replace_me")) {
        context.addIssue({ code: "custom", path: ["OPENAI_API_KEY"], message: "Production OPENAI_API_KEY cannot use a placeholder value" });
      }
      if (configuredValues !== erpValues.length) {
        context.addIssue({
          code: "custom",
          message:
            "Production requires SUPABASE_URL, SUPABASE_SECRET_KEY, INTERNAL_API_TOKEN, and INTERNAL_API_PRINCIPAL_ID",
        });
      }
      if (configuration.SUPABASE_URL && !configuration.SUPABASE_URL.startsWith("https://")) {
        context.addIssue({ code: "custom", message: "Production SUPABASE_URL must use HTTPS" });
      }
      if (configuration.SUPABASE_SECRET_KEY?.toLowerCase().includes("replace_me")) {
        context.addIssue({ code: "custom", message: "Production SUPABASE_SECRET_KEY cannot use a placeholder value" });
      }
      if (configuration.INTERNAL_API_TOKEN?.toLowerCase().includes("replace_with")) {
        context.addIssue({ code: "custom", message: "Production INTERNAL_API_TOKEN cannot use a placeholder value" });
      }
      if (configuration.INTERNAL_API_PRINCIPAL_ID?.toLowerCase().includes("replace_with")) {
        context.addIssue({ code: "custom", message: "Production INTERNAL_API_PRINCIPAL_ID cannot use a placeholder value" });
      }
    }
  });

export function parseEnv(input: NodeJS.ProcessEnv) {
  return envSchema.safeParse(input);
}

const parsedEnv = parseEnv(process.env);
if (!parsedEnv.success) {
  console.error("Invalid environment configuration", parsedEnv.error.flatten().fieldErrors);
  process.exit(1);
}
export const env = parsedEnv.data;
