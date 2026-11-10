import { timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { createServicePrincipal } from "../security/service-principal.js";
function tokensMatch(providedToken, expectedToken) {
    const provided = Buffer.from(providedToken);
    const expected = Buffer.from(expectedToken);
    return provided.length === expected.length && timingSafeEqual(provided, expected);
}
export function createInternalApiAuth(expectedToken, servicePrincipalId) {
    const servicePrincipal = createServicePrincipal(servicePrincipalId ?? env.INTERNAL_API_PRINCIPAL_ID);
    return (request, response, next) => {
        if (!servicePrincipal) {
            response.status(503).json({
                error: { code: "ERP_NOT_CONFIGURED", message: "Privileged backend service principal is not configured" },
            });
            return;
        }
        if (request.apiKeyAuth === true) {
            request.servicePrincipal = servicePrincipal;
            const requestLog = request.log;
            requestLog?.info({ servicePrincipalId: servicePrincipal.id }, "Backend service principal authenticated");
            next();
            return;
        }
        if (!expectedToken) {
            response.status(503).json({
                error: { code: "ERP_NOT_CONFIGURED", message: "Privileged backend service principal is not configured" },
            });
            return;
        }
        const authorization = request.header("authorization");
        const [scheme, providedToken] = authorization?.split(" ", 2) ?? [];
        if (scheme !== "Bearer" || !providedToken || !tokensMatch(providedToken, expectedToken)) {
            response.status(401).json({ error: { code: "UNAUTHORIZED", message: "A valid internal API token is required" } });
            return;
        }
        request.servicePrincipal = servicePrincipal;
        const requestLog = request.log;
        requestLog?.info({ servicePrincipalId: servicePrincipal.id }, "Backend service principal authenticated");
        next();
    };
}
//# sourceMappingURL=internal-api-auth.js.map