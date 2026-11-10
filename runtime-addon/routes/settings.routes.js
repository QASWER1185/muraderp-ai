import { Router } from 'express';
import { z } from 'zod';
import { deletionIdentity } from './record-deletion.routes.js';
import { createCopilotAuth } from '../middleware/copilot-auth.js';
import { TenantAccessService } from '../auth/tenant-access.service.js';
import { createServiceRoleAuthorizationGateway } from '../auth/supabase-authorization.gateway.js';
import { getSupabaseAdminClient } from '../config/supabase.js';
import { ApiError } from '../errors/api-error.js';
const text = z.string().trim().max(2000);
const sequence = z.strictObject({ prefix: z.string().trim().min(1).max(20), next: z.number().int().positive() });
const schemas = { company: z.strictObject({ name: text, phone: text, address: text }), numbering: z.strictObject({ estimate: sequence, invoice: sequence, purchase: sequence }), templates: z.strictObject({ estimate: z.enum(['sanitary_electric', 'COMPACT_TRADE', 'MODERN_PAKISTAN']), invoice: text, purchase: text }), 'tax-currency': z.strictObject({ currency: z.string().regex(/^[A-Z]{3}$/), tax_percent: z.number().min(0).max(100) }) };
export function createSettingsRouter(options = {}) {
    const router = Router();
    let authorizer = options.tenantAuthorizer;
    router.use(createCopilotAuth(options.internalApiToken, options.servicePrincipalId));
    router.use(async (req, _res, next) => { const i = deletionIdentity(req); authorizer ??= new TenantAccessService(createServiceRoleAuthorizationGateway()); await authorizer.assertAuthorized({ userId: i.userId, organizationId: i.organizationId }, 'organization.manage', { kind: 'branch', branchId: i.branchId }); next(); });
    router.get('/', async (req, res) => { const i = deletionIdentity(req), db = getSupabaseAdminClient(); const [settings, users] = await Promise.all([db.from('organization_settings').select('section,value').eq('organization_id', i.organizationId), db.from('organization_memberships').select('user_id,role,status').eq('organization_id', i.organizationId)]); if (settings.error || users.error)
        throw new ApiError(502, 'SETTINGS_FAILED', 'Settings could not be loaded'); res.setHeader('Cache-Control', 'no-store'); res.json({ data: { settings: Object.fromEntries(settings.data.map((r) => [r.section, r.value])), users: users.data } }); });
    router.patch('/users/:userId', async (req, res) => { const i = deletionIdentity(req), input = z.strictObject({ role: z.string() }).parse(req.body); const { error } = await getSupabaseAdminClient().rpc('update_organization_role', { p_organization_id: i.organizationId, p_actor_user_id: i.userId, p_user_id: z.string().uuid().parse(req.params.userId), p_role: input.role }); if (error)
        throw new ApiError(error.code === '23514' ? 409 : 400, 'ROLE_UPDATE_REFUSED', error.message); res.json({ data: { updated: true } }); });
    router.patch('/:section', async (req, res) => { const i = deletionIdentity(req), section = z.enum(['company', 'numbering', 'templates', 'tax-currency']).parse(req.params.section), value = schemas[section].parse(req.body); const { error } = await getSupabaseAdminClient().from('organization_settings').upsert({ organization_id: i.organizationId, section, value, updated_by: i.userId, updated_at: new Date().toISOString() }, { onConflict: 'organization_id,section' }); if (error)
        throw new ApiError(502, 'SETTINGS_FAILED', 'Settings could not be saved'); res.json({ data: value }); });
    return router;
}
//# sourceMappingURL=settings.routes.js.map