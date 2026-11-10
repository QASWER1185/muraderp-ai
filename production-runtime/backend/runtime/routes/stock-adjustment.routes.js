import { Router } from 'express';
import { z } from 'zod';
import { deletionIdentity } from './record-deletion.routes.js';
import { createCopilotAuth } from '../middleware/copilot-auth.js';
import { TenantAccessService } from '../auth/tenant-access.service.js';
import { createServiceRoleAuthorizationGateway } from '../auth/supabase-authorization.gateway.js';
import { getSupabaseAdminClient } from '../config/supabase.js';
import { ApiError } from '../errors/api-error.js';
const body = z.strictObject({ product_id: z.number().int().positive(), warehouse_id: z.number().int().positive(), quantity_delta: z.number().finite().refine(n => n !== 0), reason: z.string().trim().min(1).max(2000), adjusted_by: z.string().trim().min(1).max(200) });
export function createStockAdjustmentRouter(options = {}) {
    const router = Router();
    let authorizer = options.tenantAuthorizer;
    router.post('/adjust', createCopilotAuth(options.internalApiToken, options.servicePrincipalId), async (req, res) => {
        const i = deletionIdentity(req), input = body.parse(req.body);
        authorizer ??= new TenantAccessService(createServiceRoleAuthorizationGateway());
        await authorizer.assertAuthorized({ userId: i.userId, organizationId: i.organizationId }, 'inventory.adjust', { kind: 'branch', branchId: i.branchId });
        const { data, error } = await getSupabaseAdminClient().rpc('adjust_stock_atomic', { p_organization_id: i.organizationId, p_branch_id: i.branchId, p_actor_user_id: i.userId, ...Object.fromEntries(Object.entries(input).map(([k, v]) => ['p_' + k, v])) });
        if (error)
            throw new ApiError(error.code === '42501' ? 403 : error.code === '23514' ? 409 : error.code === '22023' ? 400 : 502, 'STOCK_ADJUSTMENT_REFUSED', error.code === '23514' || error.code === '22023' ? error.message : 'Stock adjustment could not be completed');
        res.status(201).json({ data });
    });
    return router;
}
//# sourceMappingURL=stock-adjustment.routes.js.map