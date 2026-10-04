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
    AI_PROVIDER: z.enum(["groq", "openai", "compatible"]).optional(),
    AI_API_KEY: z.string().trim().min(20).optional(),
    AI_BASE_URL: z.url().optional(),
    GROQ_API_KEY: z.string().trim().min(20).optional(),
    OPENAI_API_KEY: z.string().trim().min(20).optional(),
    AI_MODEL: z.string().trim().min(1).optional(),
    AI_VISION_MODEL: z.string().trim().min(1).optional(),
    AI_SPEECH_MODEL: z.string().trim().min(1).optional(),
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
    if (configuration.AI_PROVIDER === "compatible" && !configuration.AI_BASE_URL) {
      context.addIssue({ code: "custom", path: ["AI_BASE_URL"], message: "Compatible AI providers require AI_BASE_URL" });
    }
    if (configuration.AI_PROVIDER === "compatible" && !configuration.AI_MODEL) {
      context.addIssue({ code: "custom", path: ["AI_MODEL"], message: "Compatible AI providers require AI_MODEL" });
    }
    if (configuration.AI_BASE_URL) {
      const url = new URL(configuration.AI_BASE_URL);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
        context.addIssue({ code: "custom", path: ["AI_BASE_URL"], message: "AI_BASE_URL must be an HTTPS URL without credentials, query, or fragment" });
      }
    }
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
      for (const name of ["AI_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY"] as const) {
        if (configuration[name]?.toLowerCase().includes("replace_me")) {
          context.addIssue({ code: "custom", path: [name], message: `Production ${name} cannot use a placeholder value` });
        }
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
