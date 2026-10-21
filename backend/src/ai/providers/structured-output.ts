import type { z } from "zod";
import type { StructuredGenerationOptions } from "./contracts.js";
import { invalidOutput } from "./http.js";

export function parseStructuredOutput(schema: z.ZodType, raw: unknown, options?: StructuredGenerationOptions, incomplete = false): unknown {
  try {
    if (incomplete) {
      if (!options?.recoverIncomplete) throw invalidOutput();
      return schema.parse(options.recoverIncomplete(raw));
    }
    try { return schema.parse(typeof raw === "string" ? JSON.parse(raw) : raw); }
    catch {
      if (!options?.recoverIncomplete) throw invalidOutput();
      return schema.parse(options.recoverIncomplete(raw));
    }
  } catch { throw invalidOutput(); }
}
