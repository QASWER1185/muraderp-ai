import { ApiError } from '../../errors/api-error.js';
import { getSupabaseAdminClient } from '../../config/supabase.js';
import { SupabaseRateListRepository } from '../../repositories/rate-list.repository.js';
export class CopilotRateListActivation {
    repository;
    database;
    constructor(repository = new SupabaseRateListRepository(), database = getSupabaseAdminClient) {
        this.repository = repository;
        this.database = database;
    }
    async authorize(org, actor) { const { data, error } = await this.database().from('organization_memberships').select('role').eq('organization_id', org).eq('user_id', actor).eq('status', 'active').maybeSingle(); if (error || !data || !['owner', 'admin', 'manager'].includes(data.role))
        throw new ApiError(403, 'PERMISSION_DENIED', 'Rate-list activation requires an active owner, admin or manager.'); }
    async prepare(org, actor, listId) { await this.authorize(org, actor); const list = await this.repository.getRateList(listId, org); if (!list || !list.is_active)
        throw new ApiError(404, 'RATE_LIST_NOT_FOUND', 'Rate list is unavailable in this organization.'); const versions = await this.repository.listVersions(listId); const draft = versions.filter(v => v.status === 'DRAFT').sort((a, b) => b.version_number - a.version_number)[0]; const active = versions.find(v => v.status === 'ACTIVE'); if (!draft)
        return { rateListId: listId, name: list.name, status: active ? 'ACTIVE' : 'UNAVAILABLE', versionId: active?.id }; return { rateListId: listId, name: list.name, status: 'DRAFT', versionId: draft.id, versionNumber: draft.version_number }; }
    async activate(org, actor, listId, versionId) { const candidate = await this.prepare(org, actor, listId); if (candidate.status !== 'DRAFT' || candidate.versionId !== versionId)
        throw new ApiError(409, 'ERP_APPROVAL_CHANGED', 'Rate-list draft changed; prepare activation again.'); const result = await this.repository.publishVersion(versionId, org); if (result.status !== 'ACTIVE')
        throw new Error('Rate-list activation was not verified'); return { rateListId: listId, versionId: result.id, status: result.status }; }
}
//# sourceMappingURL=rate-list-activation.js.map