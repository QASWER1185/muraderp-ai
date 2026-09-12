import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const intentMigration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/20260911170000_copilot_approved_master_data_intents.sql"),
  "utf8",
);
const importMigration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/20260911173000_copilot_atomic_rate_list_draft_import.sql"),
  "utf8",
);

describe("Copilot Rate List migration gate", () => {
  it("allows only the approved persisted Copilot intents", () => {
    expect(intentMigration).toContain("'rate_list_update'");
    expect(intentMigration).toContain("'customer_payment'");
    expect(intentMigration).toContain("'vendor_payment'");
  });

  it("imports a confirmed Rate List proposal atomically as a tenant-scoped DRAFT", () => {
    expect(importMigration).toContain("create or replace function public.create_rate_list_draft_version");
    expect(importMigration).toContain("security definer");
    expect(importMigration).toContain("organization_id = p_organization_id");
    expect(importMigration).toContain("product.organization_id = p_organization_id");
    expect(importMigration).toContain("values (p_rate_list_id, p_version_number, 'DRAFT', p_effective_from)");
    expect(importMigration).not.toContain("'ACTIVE'");
  });

  it("keeps the import RPC service-role only", () => {
    expect(importMigration).toMatch(/revoke all on function public\.create_rate_list_draft_version[\s\S]*?from public, anon, authenticated;/);
    expect(importMigration).toMatch(/grant execute on function public\.create_rate_list_draft_version[\s\S]*?to service_role;/);
  });
});
