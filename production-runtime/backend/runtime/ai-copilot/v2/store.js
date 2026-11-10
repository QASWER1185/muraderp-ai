import { randomUUID } from 'node:crypto';
import { ApiError } from '../../errors/api-error.js';
import { getSupabaseAdminClient } from '../../config/supabase.js';
import { newBusinessState } from '../agent/business-state.js';
/** Server-only, user/organization/branch-scoped chat, including uploaded visual parts.
 * Provider keys and auth tokens are never stored in conversation messages. */
export class SupabaseV2Store {
    database;
    constructor(database = getSupabaseAdminClient) {
        this.database = database;
    }
    scoped(table, scope) {
        return this.database().from(table).select('*').eq('organization_id', scope.organizationId).eq('branch_id', scope.branchId);
    }
    async open(scope, id) {
        if (id) {
            const { data, error } = await this.scoped('copilot_v2_conversations', scope).eq('user_id', scope.userId).eq('id', id).maybeSingle();
            if (error)
                throw new ApiError(503, 'V2_STORE_UNAVAILABLE', 'گفتگو کا محفوظ ریکارڈ نہیں پڑھا جا سکا۔');
            if (!data)
                throw new ApiError(404, 'V2_CONVERSATION_NOT_FOUND', 'یہ گفتگو اس صارف اور برانچ میں دستیاب نہیں۔');
            return { id, version: data.version, messages: data.messages, state: data.state, pending: data.pending ?? undefined, executions: data.executions ?? [] };
        }
        const state = newBusinessState(scope);
        const conversation = { id: state.conversationId, version: 0, messages: [], state };
        const { error } = await this.database().from('copilot_v2_conversations').insert({ id: conversation.id, user_id: scope.userId,
            organization_id: scope.organizationId, branch_id: scope.branchId, state, messages: [], version: 0 });
        if (error)
            throw new ApiError(503, 'V2_STORE_UNAVAILABLE', 'نئی گفتگو محفوظ نہیں ہو سکی؛ branch کی memory migration چیک کریں۔');
        return conversation;
    }
    async claim(scope, conversation) {
        const lease = randomUUID();
        const { data, error } = await this.database().from('copilot_v2_conversations')
            .update({ lease, lease_until: new Date(Date.now() + 240_000).toISOString() })
            .eq('id', conversation.id).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).eq('branch_id', scope.branchId)
            .eq('version', conversation.version).or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`).select('id').maybeSingle();
        if (error || !data)
            throw new ApiError(409, 'V2_TURN_BUSY', 'اسی گفتگو کا پچھلا جواب تیار ہو رہا ہے؛ مکمل ہونے پر دوبارہ بھیجیں۔');
        return lease;
    }
    async save(scope, c, lease) {
        const { data, error } = await this.database().from('copilot_v2_conversations').update({ messages: c.messages, state: c.state,
            pending: c.pending ?? null, executions: c.executions ?? [], version: c.version + 1, lease: null, lease_until: null, updated_at: new Date().toISOString() })
            .eq('id', c.id).eq('user_id', scope.userId).eq('organization_id', scope.organizationId).eq('branch_id', scope.branchId)
            .eq('version', c.version).eq('lease', lease).select('id').maybeSingle();
        if (error || !data)
            throw new ApiError(503, 'V2_STORE_UNAVAILABLE', 'جواب محفوظ نہیں ہو سکا؛ کارروائی دہرانے سے پہلے اصل ریکارڈ پڑھ لیں۔');
    }
    async memories(scope) {
        const rows = [];
        for (let offset = 0;; offset += 500) {
            const { data, error } = await this.scoped('copilot_memories', scope).order('updated_at', { ascending: false }).order('id').range(offset, offset + 499);
            if (error)
                throw new ApiError(503, 'V2_MEMORY_UNAVAILABLE', 'دکان کی تصدیق شدہ یادداشت نہیں پڑھی جا سکی۔');
            rows.push(...(data ?? []));
            if ((data ?? []).length < 500)
                return rows;
        }
    }
    async writeMemory(scope, entry, remove) {
        const key = entry.key.normalize('NFKC').trim().toLocaleLowerCase('en');
        const result = remove ? await this.database().from('copilot_memories').delete().eq('organization_id', scope.organizationId)
            .eq('branch_id', scope.branchId).eq('category', entry.category).eq('key', key)
            : await this.database().from('copilot_memories').upsert({ ...entry, key, organization_id: scope.organizationId,
                branch_id: scope.branchId, updated_at: new Date().toISOString() }, { onConflict: 'organization_id,branch_id,category,key' });
        if (result.error)
            throw new ApiError(503, 'V2_MEMORY_UNAVAILABLE', 'یادداشت کی تبدیلی محفوظ نہیں ہوئی۔');
    }
}
//# sourceMappingURL=store.js.map