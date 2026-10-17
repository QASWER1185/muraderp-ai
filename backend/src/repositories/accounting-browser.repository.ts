import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";
import type { Database } from "../types/database.types.js";

type Client = { from(table: string): any };
type Scope = { organizationId: string; branchId: string };

export interface AccountingBrowserRepository {
  listAccounts(): Promise<unknown[]>;
  listEntries(scope: Scope, limit: number, offset: number): Promise<{ data: unknown[]; next_offset: number | null }>;
  getEntry(scope: Scope, id: string): Promise<unknown | null>;
  listLedger(scope: Scope, accountId: string, limit: number, offset: number): Promise<{ account: unknown; data: unknown[]; next_offset: number | null } | null>;
}

function failed(message: string): never {
  throw new ApiError(502, "ACCOUNTING_READ_FAILED", message);
}

export class SupabaseAccountingBrowserRepository implements AccountingBrowserRepository {
  constructor(private readonly clientFactory: () => SupabaseClient<Database> = getSupabaseServiceRoleClient) {}

  private get client(): Client {
    return this.clientFactory() as unknown as Client;
  }

  async listAccounts() {
    const { data, error } = await this.client.from("accounts")
      .select("id,code,name,account_type,normal_balance,is_active")
      .order("code", { ascending: true });
    if (error) failed("Accounts could not be loaded");
    return data ?? [];
  }

  async listEntries(scope: Scope, limit: number, offset: number) {
    const { data, error } = await this.client.from("journal_entries")
      .select("id,entry_date,description,source_type,source_record_id,posting_kind,status,created_at")
      .eq("organization_id", scope.organizationId).eq("branch_id", scope.branchId)
      .order("entry_date", { ascending: false }).order("created_at", { ascending: false })
      .range(offset, offset + limit);
    if (error) failed("Journal register could not be loaded");
    const rows = data ?? [];
    return { data: rows.slice(0, limit), next_offset: rows.length > limit ? offset + limit : null };
  }

  async getEntry(scope: Scope, id: string) {
    const { data: entry, error } = await this.client.from("journal_entries")
      .select("id,entry_date,description,source_type,source_record_id,posting_kind,status,created_at")
      .eq("organization_id", scope.organizationId).eq("branch_id", scope.branchId).eq("id", id).maybeSingle();
    if (error) failed("Journal entry could not be loaded");
    if (!entry) return null;
    const { data: lines, error: lineError } = await this.client.from("journal_lines")
      .select("id,account_id,debit,credit,memo,accounts(code,name)")
      .eq("journal_entry_id", id).order("created_at", { ascending: true });
    if (lineError) failed("Journal lines could not be loaded");
    return { ...entry, lines: lines ?? [] };
  }

  async listLedger(scope: Scope, accountId: string, limit: number, offset: number) {
    const { data: account, error: accountError } = await this.client.from("accounts")
      .select("id,code,name,account_type,normal_balance,is_active")
      .eq("id", accountId).maybeSingle();
    if (accountError) failed("Account could not be loaded");
    if (!account) return null;
    const { data, error } = await this.client.from("journal_lines")
      .select("id,debit,credit,memo,created_at,journal_entries!inner(id,entry_date,description,source_type,source_record_id,status,organization_id,branch_id)")
      .eq("account_id", accountId)
      .eq("journal_entries.organization_id", scope.organizationId)
      .eq("journal_entries.branch_id", scope.branchId)
      .eq("journal_entries.status", "POSTED")
      .order("created_at", { ascending: false }).range(offset, offset + limit);
    if (error) failed("Account ledger could not be loaded");
    const rows = data ?? [];
    return { account, data: rows.slice(0, limit), next_offset: rows.length > limit ? offset + limit : null };
  }
}
