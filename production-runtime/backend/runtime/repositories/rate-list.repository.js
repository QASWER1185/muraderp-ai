import { getSupabaseAdminClient } from "../config/supabase.js";
const scopePriority = { CUSTOMER: 3, VENDOR: 2, GLOBAL: 1 };
const brandKey = (value) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const recognizedBrands = ["Dura Max", "Dura Flow", "Popular", "Turk Plast", "HE China"];
export function isOpenBrandRateList(list, brand) {
    if (list.scope_type !== "CUSTOMER")
        return false;
    const text = brandKey(`${list.name} ${list.code}`);
    const listedBrand = recognizedBrands.find((candidate) => text.includes(brandKey(candidate)));
    if (!brand?.trim())
        return listedBrand !== undefined;
    const expected = brandKey(brand);
    return listedBrand ? brandKey(listedBrand) === expected : text.includes(expected);
}
export class SupabaseRateListRepository {
    clientFactory;
    constructor(clientFactory = getSupabaseAdminClient) {
        this.clientFactory = clientFactory;
    }
    async importRateList(input) {
        const { organization_id, idempotency_key, ...catalog } = input;
        const { data, error } = await this.clientFactory().rpc("import_rate_list_catalog", {
            p_organization_id: organization_id, p_idempotency_key: idempotency_key, p_catalog: catalog,
        });
        if (error)
            throw error;
        return data;
    }
    async listRateLists(organizationId) { const client = this.clientFactory(); const { data, error } = await client.from("rate_lists").select("*").eq("organization_id", organizationId).order("id", { ascending: false }); if (error)
        throw error; return (data ?? []); }
    async getRateList(rateListId, organizationId) { const client = this.clientFactory(); const { data, error } = await client.from("rate_lists").select("*").eq("organization_id", organizationId).eq("id", rateListId).maybeSingle(); if (error)
        throw error; return data; }
    async listVersions(rateListId) { const client = this.clientFactory(); const { data, error } = await client.from("rate_list_versions").select("*").eq("rate_list_id", rateListId).order("version_number", { ascending: false }); if (error)
        throw error; return (data ?? []); }
    async listItems(versionIds) { if (!versionIds.length)
        return []; const client = this.clientFactory(); const { data, error } = await client.from("rate_list_items").select("*").in("rate_list_version_id", versionIds).order("id"); if (error)
        throw error; return (data ?? []); }
    async publishVersion(versionId, organizationId) { const client = this.clientFactory(); const { data, error } = await client.rpc("publish_rate_list_version", { p_organization_id: organizationId, p_version_id: versionId }); if (error)
        throw error; return data; }
    async createRateList(input) { const client = this.clientFactory(); const { data, error } = await client.from("rate_lists").insert({ organization_id: input.organization_id, name: input.name, code: input.code, price_type: input.price_type, scope_type: input.scope_type, vendor_id: input.vendor_id ?? null, customer_id: input.customer_id ?? null, currency_code: input.currency_code, is_active: input.is_active ?? true }).select().single(); if (error)
        throw error; return data; }
    async createVersion(input) { const client = this.clientFactory(); const { data, error } = await client.from("rate_list_versions").insert({ rate_list_id: input.rate_list_id, version_number: input.version_number, status: input.status ?? "DRAFT", effective_from: input.effective_from, effective_to: input.effective_to ?? null }).select().single(); if (error)
        throw error; return data; }
    async createItem(input) { const client = this.clientFactory(); const { data, error } = await client.from("rate_list_items").insert({ rate_list_version_id: input.rate_list_version_id, product_id: input.product_id, minimum_quantity: input.minimum_quantity ?? 1, unit_price: input.unit_price, unit: input.unit }).select().single(); if (error)
        throw error; return data; }
    async createDraftVersion(input) {
        const client = this.clientFactory();
        const { data, error } = await client.rpc("create_rate_list_draft_version", {
            p_organization_id: input.organization_id,
            p_rate_list_id: input.rate_list_id,
            p_version_number: input.version_number,
            p_effective_from: input.effective_from,
            p_items: input.items,
        });
        if (error)
            throw error;
        return data;
    }
    async listActiveSaleRateLists(organizationId) { const client = this.clientFactory(); const { data, error } = await client.from("rate_lists").select("id, organization_id, name, code, price_type, scope_type, vendor_id, customer_id, currency_code, is_active, created_at, updated_at").eq("organization_id", organizationId).eq("price_type", "SALE").eq("is_active", true).order("name", { ascending: true }); if (error)
        throw error; return (data ?? []); }
    async findRateListsByHint(hint, context) {
        const client = this.clientFactory();
        const normalized = hint.trim().toLowerCase();
        if (!normalized)
            return [];
        const { data, error } = await client.from("rate_lists").select("id, organization_id, name, code, price_type, scope_type, vendor_id, customer_id, currency_code, is_active, created_at, updated_at").eq("organization_id", context.organization_id).eq("price_type", context.price_type).eq("is_active", true);
        if (error)
            throw error;
        return (data ?? []).filter((list) => {
            const textMatch = list.name.toLowerCase() === normalized || list.code.toLowerCase() === normalized;
            if (!textMatch)
                return false;
            if (list.scope_type === "CUSTOMER")
                return list.customer_id === context.customer_id || isOpenBrandRateList(list, context.rate_list_brand);
            if (list.scope_type === "VENDOR")
                return list.vendor_id === context.vendor_id;
            return true;
        });
    }
    async findBestRateListItem(context) {
        const client = this.clientFactory();
        const asOf = Date.parse(context.as_of);
        let rateListQuery = client.from("rate_lists").select("id, organization_id, name, code, price_type, scope_type, vendor_id, customer_id, currency_code, is_active, created_at, updated_at").eq("organization_id", context.organization_id).eq("price_type", context.price_type).eq("is_active", true);
        if (context.rate_list_id != null)
            rateListQuery = rateListQuery.eq("id", context.rate_list_id);
        const { data: rawRateLists, error: rateListError } = await rateListQuery;
        if (rateListError)
            throw rateListError;
        const rateLists = (rawRateLists ?? []);
        const applicableRateLists = rateLists.filter((rateList) => { if (context.rate_list_id != null)
            return rateList.id === context.rate_list_id && (rateList.scope_type !== "CUSTOMER" || rateList.customer_id === context.customer_id || isOpenBrandRateList(rateList, context.rate_list_brand)); if (rateList.scope_type === "CUSTOMER")
            return rateList.customer_id === context.customer_id || isOpenBrandRateList(rateList, context.rate_list_brand); if (rateList.scope_type === "VENDOR")
            return rateList.vendor_id === context.vendor_id; return rateList.scope_type === "GLOBAL"; });
        if (applicableRateLists.length === 0)
            return null;
        const { data: rawVersions, error: versionError } = await client.from("rate_list_versions").select("id, rate_list_id, version_number, status, effective_from, effective_to, created_at, updated_at").in("rate_list_id", applicableRateLists.map((r) => r.id)).eq("status", "ACTIVE");
        if (versionError)
            throw versionError;
        const versions = (rawVersions ?? []);
        const applicableVersions = versions.filter((version) => { const from = Date.parse(version.effective_from); const to = version.effective_to ? Date.parse(version.effective_to) : Number.POSITIVE_INFINITY; return version.status === 'ACTIVE' && from <= asOf && asOf < to; });
        if (applicableVersions.length === 0)
            return null;
        const { data: rawItems, error: itemError } = await client.from("rate_list_items").select("id, rate_list_version_id, product_id, minimum_quantity, unit_price, unit, created_at, updated_at").in("rate_list_version_id", applicableVersions.map((v) => v.id)).eq("product_id", context.product_id).lte("minimum_quantity", context.quantity);
        if (itemError)
            throw itemError;
        const candidates = (rawItems ?? []).map((item) => { const version = applicableVersions.find((v) => v.id === item.rate_list_version_id); const rateList = version ? applicableRateLists.find((r) => r.id === version.rate_list_id) : undefined; return version && rateList ? { item, version, rateList } : null; }).filter((x) => x !== null);
        // Different catalogs may coexist (U-PVC, PPR-C, other brands). Only lists
        // containing an eligible rate for this product can create ambiguity.
        if (context.rate_list_id == null && candidates.length) {
            const priority = Math.max(...candidates.map(candidate => scopePriority[candidate.rateList.scope_type]));
            const ids = new Set(candidates.filter(candidate => scopePriority[candidate.rateList.scope_type] === priority).map(candidate => candidate.rateList.id));
            if (ids.size > 1)
                throw new Error("Ambiguous pricing: multiple active rate lists match the winning scope");
        }
        candidates.sort((a, b) => { const scope = scopePriority[b.rateList.scope_type] - scopePriority[a.rateList.scope_type]; if (scope)
            return scope; const quantity = b.item.minimum_quantity - a.item.minimum_quantity; if (quantity)
            return quantity; const effective = Date.parse(b.version.effective_from) - Date.parse(a.version.effective_from); if (effective)
            return effective; return b.version.version_number - a.version.version_number; });
        const best = candidates[0];
        if (!best)
            return null;
        return { rate_list_id: best.rateList.id, rate_list_version_id: best.version.id, rate_list_item_id: best.item.id, product_id: best.item.product_id, unit_price: best.item.unit_price, unit: best.item.unit, currency_code: best.rateList.currency_code, minimum_quantity: best.item.minimum_quantity, scope_type: best.rateList.scope_type, effective_from: best.version.effective_from };
    }
    async getVersion(versionId) { const client = this.clientFactory(); const { data, error } = await client.from("rate_list_versions").select("id, rate_list_id, version_number, status, effective_from, effective_to, created_at, updated_at").eq("id", versionId).single(); if (error)
        throw error; return data; }
    async activateVersion(versionId) { const client = this.clientFactory(); const { data, error } = await client.from("rate_list_versions").update({ status: "ACTIVE", updated_at: new Date().toISOString() }).eq("id", versionId).eq("status", "DRAFT").select("id, rate_list_id, version_number, status, effective_from, effective_to, created_at, updated_at").single(); if (error)
        throw error; return data; }
    async archiveVersion(versionId) { const client = this.clientFactory(); const { data, error } = await client.from("rate_list_versions").update({ status: "ARCHIVED", updated_at: new Date().toISOString() }).eq("id", versionId).eq("status", "ACTIVE").select("id, rate_list_id, version_number, status, effective_from, effective_to, created_at, updated_at").single(); if (error)
        throw error; return data; }
}
//# sourceMappingURL=rate-list.repository.js.map