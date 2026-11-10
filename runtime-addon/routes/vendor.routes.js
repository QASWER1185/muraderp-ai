import { Router } from "express";
import { z } from "zod";
import { createServiceRoleAuthorizationGateway } from "../auth/supabase-authorization.gateway.js";
import { TenantAccessService } from "../auth/tenant-access.service.js";
import { ApiError } from "../errors/api-error.js";
import { createCopilotAuth } from "../middleware/copilot-auth.js";
import { SupabaseErpService, } from "../services/erp.service.js";
import { requireAuthoritativeTransactionIdentity } from "./authoritative-transaction-context.js";
const idSchema = z.coerce.number().int().positive();
const pageSchema = z.object({
    cursor: idSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});
const shortText = z.string().trim().min(1).max(200);
const vendorSchema = z.strictObject({
    address: z.string().trim().max(2000).nullable().optional(),
    name: shortText,
    phone: z.string().trim().min(1).max(50),
    city: z.string().trim().min(1).max(120),
});
const vendorPatchSchema = vendorSchema
    .partial()
    .refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" });
function headerValue(request, name) {
    const value = request.header(name);
    return Array.isArray(value) ? value[0] : value;
}
function vendorIdentity(request) {
    if (!request.browserPrincipal) {
        const identity = requireAuthoritativeTransactionIdentity(request);
        return {
            userId: identity.actorUserId,
            organizationId: identity.organizationId,
            branchId: identity.branchId,
        };
    }
    const requestedActor = headerValue(request, "X-Actor-User-Id")?.trim();
    if (requestedActor && requestedActor !== request.browserPrincipal.userId) {
        throw new ApiError(403, "FORBIDDEN", "Actor does not match authenticated session");
    }
    return {
        userId: request.browserPrincipal.userId,
        organizationId: z.string().uuid().parse(headerValue(request, "X-Organization-Id")),
        branchId: z.string().uuid().parse(headerValue(request, "X-Branch-Id")),
    };
}
export function createVendorRouter(options = {}) {
    const router = Router();
    const service = options.service ?? new SupabaseErpService();
    const authenticate = options.authenticate ?? createCopilotAuth(options.internalApiToken, options.servicePrincipalId);
    let tenantAuthorizer = options.tenantAuthorizer;
    router.use(authenticate);
    async function authorize(request, permission) {
        const identity = vendorIdentity(request);
        tenantAuthorizer ??= new TenantAccessService(createServiceRoleAuthorizationGateway());
        await tenantAuthorizer.assertAuthorized({ userId: identity.userId, organizationId: identity.organizationId }, permission, { kind: "branch", branchId: identity.branchId });
        return identity;
    }
    router.get("/", async (request, response) => {
        const identity = await authorize(request, "vendors.read");
        response.status(200).json(await service.listVendors(pageSchema.parse(request.query), identity.organizationId));
    });
    router.get("/:id", async (request, response) => {
        const identity = await authorize(request, "vendors.read");
        const vendor = await service.getVendor(idSchema.parse(request.params.id), identity.organizationId);
        if (!vendor)
            throw new ApiError(404, "NOT_FOUND", "Vendor was not found");
        response.status(200).json({ data: vendor });
    });
    router.post("/", async (request, response) => {
        const identity = await authorize(request, "vendors.write");
        const vendor = await service.createVendor(vendorSchema.parse(request.body), identity.organizationId);
        response.status(201).json({ data: vendor });
    });
    router.patch("/:id", async (request, response) => {
        const identity = await authorize(request, "vendors.write");
        const vendor = await service.updateVendor(idSchema.parse(request.params.id), vendorPatchSchema.parse(request.body), identity.organizationId);
        if (!vendor)
            throw new ApiError(404, "NOT_FOUND", "Vendor was not found");
        response.status(200).json({ data: vendor });
    });
    router.delete("/:id", async (request, response) => {
        const identity = await authorize(request, "vendors.write");
        const deleted = await service.deleteVendor(idSchema.parse(request.params.id), identity.organizationId);
        if (!deleted)
            throw new ApiError(404, "NOT_FOUND", "Vendor was not found");
        response.status(204).send();
    });
    return router;
}
//# sourceMappingURL=vendor.routes.js.map