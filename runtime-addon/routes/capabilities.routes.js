import { Router } from 'express';
import { z } from 'zod';
import { createRecordDeletionRouter, deletionIdentity } from './record-deletion.routes.js';
import { createStockAdjustmentRouter } from './stock-adjustment.routes.js';
import { createSettingsRouter } from './settings.routes.js';
import { createCopilotAuth } from '../middleware/copilot-auth.js';
import { TenantAccessService } from '../auth/tenant-access.service.js';
import { createServiceRoleAuthorizationGateway } from '../auth/supabase-authorization.gateway.js';
import { getSupabaseAdminClient } from '../config/supabase.js';
import { env } from '../config/env.js';
import { normalizeServicePrincipalId } from '../security/service-principal.js';
import { ApiError } from '../errors/api-error.js';
import { createRegisterApiRouter } from './register-api.routes.js';
export function createCapabilitiesRouter(options = {}) {
    const router = Router();
    let authorizer = options.tenantAuthorizer;
    router.use(createRegisterApiRouter(options));
    router.use(createRecordDeletionRouter({ ...options, ...options.recordDeletion }));
    router.use('/stock', createStockAdjustmentRouter(options));
    router.use('/settings', createSettingsRouter(options));
    const authenticate = createCopilotAuth(options.internalApiToken, options.servicePrincipalId);
    async function authorize(req, permission) {
        const identity = deletionIdentity(req);
        authorizer ??= new TenantAccessService(createServiceRoleAuthorizationGateway());
        await authorizer.assertAuthorized({ userId: identity.userId, organizationId: identity.organizationId }, permission, { kind: 'branch', branchId: identity.branchId });
        return identity;
    }
    router.post('/invoices/:id/void', authenticate, async (req, res) => {
        const i = await authorize(req, 'sales.approve'), id = z.coerce.number().int().positive().parse(req.params.id), principal = normalizeServicePrincipalId(options.servicePrincipalId ?? env.INTERNAL_API_PRINCIPAL_ID);
        if (!principal)
            throw new ApiError(503, 'ERP_NOT_CONFIGURED', 'Invoice service principal is not configured');
        const { data, error } = await getSupabaseAdminClient().rpc('void_invoice_scoped', { p_id: id, p_organization_id: i.organizationId, p_branch_id: i.branchId, p_actor_user_id: i.userId, p_principal: principal });
        if (error)
            throw new ApiError(error.code === '23514' ? 409 : error.code === '42501' ? 403 : 502, 'VOID_REFUSED', error.code === '23514' ? error.message : 'Invoice could not be voided');
        if (!data)
            throw new ApiError(404, 'NOT_FOUND', 'Invoice was not found in this workspace');
        res.json({ data: { id, status: 'VOIDED' } });
    });
    router.post('/rate-lists/versions/:versionId/publish', authenticate, async (req, res) => {
        const i = await authorize(req, 'products.write'), id = z.coerce.number().int().positive().parse(req.params.versionId);
        const { data, error } = await getSupabaseAdminClient().rpc('publish_rate_list_version', { p_organization_id: i.organizationId, p_version_id: id });
        if (error)
            throw new ApiError(['22023', '23514', 'P0002'].includes(error.code) ? 400 : error.code === '42501' ? 403 : 502, 'PUBLISH_REFUSED', 'Rate List could not be published');
        res.json({ data });
    });
    return router;
}
//# sourceMappingURL=capabilities.routes.js.map