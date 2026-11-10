import { ApiError } from "../errors/api-error.js";
/** Co-purchase events are written by the estimate trigger, never by the model. */
export class CompanionLearningStore {
    database;
    constructor(database) {
        this.database = database;
    }
    async suggestions(scope, productIds, brand) {
        const { data, error } = await this.database().rpc("depot_companion_suggestions", {
            p_organization_id: scope.organizationId, p_branch_id: scope.branchId, p_actor_user_id: scope.userId, p_product_ids: productIds, p_brand: brand ?? null,
        });
        if (error)
            throw new ApiError(502, "COMPANION_MEMORY_UNAVAILABLE", "ساتھ لگنے والے سامان کی یادداشت نہیں پڑھی جا سکی۔");
        if (!Array.isArray(data))
            throw new ApiError(502, "COMPANION_MEMORY_UNAVAILABLE", "ساتھ لگنے والے سامان کا نتیجہ درست نہیں۔");
        return data.map((row) => ({ key: "learned:" + row.product_id, name: row.name, query: row.name, quantity: 1,
            source: "learned", reason: row.usage_count + " سابقہ ایسٹیمیٹس میں یہ سامان ساتھ شامل تھا۔", optional: true }));
    }
}
//# sourceMappingURL=companionLearningStore.js.map