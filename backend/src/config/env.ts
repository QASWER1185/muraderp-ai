import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    SUPABASE_URL: z.url().optional(),
    SUPABASE_SECRET_KEY: z.string().startsWith("sb_secret_").min(32).optional(),
    INTERNAL_API_TOKEN: z.string().min(32).optional(),
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
  });

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("Invalid environment configuration", parsedEnv.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsedEnv.data;
