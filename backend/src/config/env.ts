import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    SUPABASE_URL: z.url().optional(),
    SUPABASE_SECRET_KEY: z.string().startsWith("sb_secret_").min(32).optional(),
    INTERNAL_API_TOKEN: z.string().min(32).optional(),
    INTERNAL_API_PRINCIPAL_ID: z.string().trim().min(1).max(200).default("internal-system"),
  })
  .superRefine((configuration, context) => {
    const erpValues = [
      configuration.SUPABASE_URL,
      configuration.SUPABASE_SECRET_KEY,
      configuration.INTERNAL_API_TOKEN,
    ];

    const configuredValues = erpValues.filter((value) => value !== undefined).length;

    if (configuredValues > 0 && configuredValues < erpValues.length) {
      context.addIssue({
        code: "custom",
        message:
          "SUPABASE_URL, SUPABASE_SECRET_KEY, and INTERNAL_API_TOKEN must be configured together",
      });
    }

    if (configuration.NODE_ENV === "production") {
      if (configuredValues !== erpValues.length) {
        context.addIssue({
          code: "custom",
          message:
            "Production requires SUPABASE_URL, SUPABASE_SECRET_KEY, and INTERNAL_API_TOKEN",
        });
      }

      if (configuration.SUPABASE_URL && !configuration.SUPABASE_URL.startsWith("https://")) {
        context.addIssue({
          code: "custom",
          message: "Production SUPABASE_URL must use HTTPS",
        });
      }

      if (configuration.SUPABASE_SECRET_KEY?.toLowerCase().includes("replace_me")) {
        context.addIssue({
          code: "custom",
          message: "Production SUPABASE_SECRET_KEY cannot use a placeholder value",
        });
      }

      if (configuration.INTERNAL_API_TOKEN?.toLowerCase().includes("replace_with")) {
        context.addIssue({
          code: "custom",
          message: "Production INTERNAL_API_TOKEN cannot use a placeholder value",
        });
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
