import { invalidOutput } from "./http.js";
export function parseStructuredOutput(schema, raw, options, incomplete = false) {
    try {
        if (incomplete) {
            if (!options?.recoverIncomplete)
                throw invalidOutput();
            return schema.parse(options.recoverIncomplete(raw));
        }
        try {
            return schema.parse(typeof raw === "string" ? JSON.parse(raw) : raw);
        }
        catch {
            if (!options?.recoverIncomplete)
                throw invalidOutput();
            return schema.parse(options.recoverIncomplete(raw));
        }
    }
    catch {
        throw invalidOutput();
    }
}
//# sourceMappingURL=structured-output.js.map