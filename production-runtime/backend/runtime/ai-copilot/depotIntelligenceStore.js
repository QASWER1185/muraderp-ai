import { ApiError } from "../errors/api-error.js";
export class DepotIntelligenceStore {
    database;
    constructor(database) {
        this.database = database;
    }
    async creditWarnings(scope, customerId) {
        const { data, error } = await this.database().rpc("depot_intelligence_report", {
            p_organization_id: scope.organizationId, p_branch_id: scope.branchId, p_actor_user_id: scope.userId, p_request: { report: "credit_guard", customerId },
        });
        if (error?.code === "42501")
            return []; // Do not expose private balances to sales-only users.
        if (error)
            throw new ApiError(502, "CREDIT_GUARD_UNAVAILABLE", "گاہک کی ادائیگی کی تفصیل نہیں پڑھی جا سکی۔");
        const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
        if (Number.isFinite(Number(data?.outstanding)) && data?.outstanding != null)
            return [`${data.customer ?? "گاہک"} کا موجودہ بقایا ${data.currency ?? "PKR"} ${Number(data.outstanding)} ہے؛ مقررہ کریڈٹ حد ${data.currency ?? "PKR"} ${Number(data.creditLimit ?? 0)} ہے۔`, ...warnings];
        return warnings;
    }
    async purchaseFloor(scope, productId, price, unit, currency) {
        const { data, error } = await this.database().rpc("depot_private_purchase_floor", { p_organization_id: scope.organizationId, p_branch_id: scope.branchId, p_actor_user_id: scope.userId, p_product_id: productId, p_list_price: price, p_unit: unit, p_currency: currency });
        if (error?.code === "42501")
            return null;
        if (error)
            throw new ApiError(502, "PURCHASE_MEMORY_UNAVAILABLE", "خرید لاگت کی تصدیق نہیں ہو سکی۔");
        return data == null ? null : Number(data);
    }
}
//# sourceMappingURL=depotIntelligenceStore.js.map