import { describe, expect, it, vi } from "vitest";
import { SupabaseRateListRepository } from "./rate-list.repository.js";
import type { PriceResolutionContext } from "../types/pricing.types.js";

class FakeQuery {
  constructor(private readonly rows: unknown[]) {}
  select() { return this; }
  eq() { return this; }
  in() { return this; }
  lte() { return this; }
  order() { return this; }
  then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
    return Promise.resolve(resolve({ data: this.rows, error: null }));
  }
}

describe("SupabaseRateListRepository price resolution", () => {
  it.each(["separate catalogs","same product conflict","future version","quantity threshold"])("checks ambiguity only after product eligibility: %s",async mode=>{
    const org="11111111-1111-4111-8111-111111111111";
    const tables:Record<string,Array<Record<string,any>>>={
      rate_lists:[1,2].map(id=>({id,organization_id:org,price_type:"SALE",scope_type:"GLOBAL",is_active:true,currency_code:"PKR"})),
      rate_list_versions:[1,2].map(id=>({id,rate_list_id:id,status:"ACTIVE",version_number:1,effective_from:mode==="future version"&&id===2?"2027-01-01T00:00:00Z":"2026-01-01T00:00:00Z",effective_to:null})),
      rate_list_items:[{id:1,rate_list_version_id:1,product_id:10,minimum_quantity:1,unit_price:1558,unit:"pcs"},{id:2,rate_list_version_id:2,product_id:mode==="separate catalogs"?20:10,minimum_quantity:mode==="quantity threshold"?100:1,unit_price:999,unit:"pcs"}],
    };
    const client={from(table:string){let rows=tables[table]!;const q:any={select:()=>q,eq:(key:string,value:unknown)=>{rows=rows.filter(row=>row[key]===value);return q;},in:(key:string,values:unknown[])=>{rows=rows.filter(row=>values.includes(row[key]));return q;},lte:(key:string,value:number)=>{rows=rows.filter(row=>row[key]<=value);return q;},then:(resolve:any,reject:any)=>Promise.resolve({data:rows,error:null}).then(resolve,reject)};return q;}};
    const repository=new SupabaseRateListRepository(()=>client as never);
    const read=repository.findBestRateListItem({organization_id:org,price_type:"SALE",product_id:10,quantity:1,as_of:"2026-10-22T00:00:00Z"});
    if(mode==="same product conflict")await expect(read).rejects.toThrow("Ambiguous pricing");
    else await expect(read).resolves.toMatchObject({rate_list_id:1,product_id:10,unit_price:1558});
  });
  it("uses the atomic draft-version import RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { version: { id: 7, status: "DRAFT" }, items: [] }, error: null });
    const repository = new SupabaseRateListRepository(() => ({ rpc }) as never);

    await expect(repository.createDraftVersion({
      organization_id: "11111111-1111-4111-8111-111111111111",
      rate_list_id: 2,
      version_number: 3,
      effective_from: "2026-09-15T00:00:00Z",
      items: [{ product_id: 10, minimum_quantity: 1, unit_price: 120, unit: "pcs" }],
    })).resolves.toMatchObject({ version: { status: "DRAFT" } });
    expect(rpc).toHaveBeenCalledWith("create_rate_list_draft_version", expect.objectContaining({
      p_organization_id: "11111111-1111-4111-8111-111111111111",
      p_rate_list_id: 2,
      p_version_number: 3,
    }));
  });
  it("prefers customer scope, then quantity tier, then effective date", async () => {
    const client = {
      from(table: string) {
        if (table === "rate_lists") {
          return new FakeQuery([
            { id: 1, name: "Global", code: "G", price_type: "SALE", scope_type: "GLOBAL", vendor_id: null, customer_id: null, currency_code: "PKR", is_active: true },
            { id: 2, name: "Vendor", code: "V", price_type: "SALE", scope_type: "VENDOR", vendor_id: 9, customer_id: null, currency_code: "PKR", is_active: true },
            { id: 3, name: "Customer", code: "C", price_type: "SALE", scope_type: "CUSTOMER", vendor_id: null, customer_id: 7, currency_code: "PKR", is_active: true },
          ]);
        }
        if (table === "rate_list_versions") {
          return new FakeQuery([
            { id: 11, rate_list_id: 1, version_number: 1, status: "ACTIVE", effective_from: "2026-01-01T00:00:00Z", effective_to: null },
            { id: 22, rate_list_id: 2, version_number: 1, status: "ACTIVE", effective_from: "2026-01-01T00:00:00Z", effective_to: null },
            { id: 31, rate_list_id: 3, version_number: 1, status: "ACTIVE", effective_from: "2026-01-01T00:00:00Z", effective_to: null },
          ]);
        }
        return new FakeQuery([
          { id: 101, rate_list_version_id: 11, product_id: 10, minimum_quantity: 1, unit_price: 1500, unit: "bag" },
          { id: 201, rate_list_version_id: 22, product_id: 10, minimum_quantity: 1, unit_price: 1400, unit: "bag" },
          { id: 301, rate_list_version_id: 31, product_id: 10, minimum_quantity: 1, unit_price: 1300, unit: "bag" },
          { id: 302, rate_list_version_id: 31, product_id: 10, minimum_quantity: 10, unit_price: 1250, unit: "bag" },
        ]);
      },
    };

    const repository = new SupabaseRateListRepository(() => client as never);
    const context: PriceResolutionContext = {
      organization_id: "11111111-1111-4111-8111-111111111111",
      price_type: "SALE",
      product_id: 10,
      quantity: 10,
      as_of: "2026-08-14T10:00:00Z",
      vendor_id: 9,
      customer_id: 7,
    };

    await expect(repository.findBestRateListItem(context)).resolves.toMatchObject({
      rate_list_id: 3,
      rate_list_version_id: 31,
      rate_list_item_id: 302,
      unit_price: 1250,
      minimum_quantity: 10,
      scope_type: "CUSTOMER",
    });
  });

  it("honors an explicit rate_list_id and never substitutes another list", async () => {
    const client = {
      from(table: string) {
        if (table === "rate_lists") return new FakeQuery([{ id: 2, name: "Vendor", code: "V", price_type: "SALE", scope_type: "VENDOR", vendor_id: 9, customer_id: null, currency_code: "PKR", is_active: true }]);
        if (table === "rate_list_versions") return new FakeQuery([{ id: 22, rate_list_id: 2, version_number: 1, status: "ACTIVE", effective_from: "2026-01-01T00:00:00Z", effective_to: null }]);
        return new FakeQuery([{ id: 201, rate_list_version_id: 22, product_id: 10, minimum_quantity: 1, unit_price: 1400, unit: "bag" }]);
      },
    };
    const repository = new SupabaseRateListRepository(() => client as never);
    await expect(repository.findBestRateListItem({ organization_id: "11111111-1111-4111-8111-111111111111", price_type: "SALE", product_id: 10, quantity: 1, as_of: "2026-08-14T10:00:00Z", customer_id: 7, rate_list_id: 2 })).resolves.toMatchObject({ rate_list_id: 2, unit_price: 1400 });
  });

  it("returns null when the effective window is not active", async () => {
    const client = {
      from(table: string) {
        if (table === "rate_lists") return new FakeQuery([{ id: 1, name: "Global", code: "G", price_type: "SALE", scope_type: "GLOBAL", vendor_id: null, customer_id: null, currency_code: "PKR", is_active: true }]);
        if (table === "rate_list_versions") return new FakeQuery([{ id: 11, rate_list_id: 1, version_number: 1, status: "ACTIVE", effective_from: "2026-09-01T00:00:00Z", effective_to: null }]);
        return new FakeQuery([]);
      },
    };
    const repository = new SupabaseRateListRepository(() => client as never);
    await expect(repository.findBestRateListItem({ organization_id: "11111111-1111-4111-8111-111111111111", price_type: "SALE", product_id: 10, quantity: 1, as_of: "2026-08-14T10:00:00Z" })).resolves.toBeNull();
  });
});
