import { getSupabaseAdminClient } from "../../config/supabase.js";
import { ApiError } from "../../errors/api-error.js";

export type ReversalRpc = (args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
export class ReversalService {
  constructor(private readonly rpc: ReversalRpc = args => (getSupabaseAdminClient() as any).rpc("reverse_record_atomic", args)) {}
  async execute(identity: { userId: string; organizationId: string; branchId: string }, entity: string, id: number, action: "DELETE" | "VOID", dryRun = false, fingerprint?: string) {
    const result = await this.rpc({ p_entity: entity, p_id: id, p_organization_id: identity.organizationId, p_branch_id: identity.branchId, p_actor_user_id: identity.userId, p_action: action, p_dry_run: dryRun, p_expected_fingerprint: fingerprint ?? null });
    if (result.error) {
      const status = result.error.code === "42501" ? 403 : ["23503", "23514", "40001", "40P01"].includes(result.error.code ?? "") ? 409 : 502;
      throw new ApiError(status, action === "VOID" ? "VOID_REFUSED" : "DELETE_REFUSED", status === 502 ? "Atomic reversal could not be completed" : result.error.message ?? "Linked records prevent reversal");
    }
    if (!result.data) throw new ApiError(404, "NOT_FOUND", "Record was not found in this workspace");
    return result.data;
  }
}
