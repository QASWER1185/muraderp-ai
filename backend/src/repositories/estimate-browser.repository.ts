import { getSupabaseAdminClient } from '../config/supabase.js';
import { ApiError } from '../errors/api-error.js';

export interface EstimateFilters { search?: string | undefined; status?: string | undefined; from?: string | undefined; to?: string | undefined; limit: number; cursor?: number | undefined }
export interface EstimateBrowserRepository {
  list(org: string, branch: string, filters: EstimateFilters): Promise<{ data: any[]; next_cursor: number | null }>;
  get(org: string, branch: string, reference: string): Promise<any | null>;
  patch(org: string, branch: string, actor: string, id: number, input: any): Promise<void>;
}
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export function estimateView(record: any, items: any[]) {
  const lines = items.map(item => {
    const qty = Number(item.quantity), storedRate = Number(item.unit_price), discount = Number(item.discount_amount ?? 0);
    // Historical manual net prices have no recoverable trade discount. Never
    // substitute today's catalog price for the saved financial snapshot.
    const list = Number(item.pricing_provenance?.list_price ?? storedRate);
    const lineTotal = round(qty * storedRate - discount);
    const discountPercent=Number(item.pricing_provenance?.discount_percent ?? (list * qty ? (list * qty - lineTotal) / (list * qty) * 100 : 0));
    return { ...item, product_name: item.products?.name ?? item.description ?? `Product ${item.product_id}`,
      category: item.products?.category ?? 'Items', quantity: qty, list_price: list,
      discount_percent: Math.abs(discountPercent)<0.00001?0:discountPercent,
      unit_price: qty ? lineTotal / qty : 0, stored_unit_price: storedRate, discount_amount: discount, line_total: lineTotal };
  });
  const subtotal = round(lines.reduce((sum, item) => sum + item.quantity * item.list_price, 0));
  const grand = round(lines.reduce((sum, item) => sum + item.line_total, 0));
  return { ...record, status: record.status === 'CONVERTED' ? 'INVOICED' : record.status,
    customer: record.customers ?? null, customer_name: record.customers?.name ?? '', item_count: lines.length,
    subtotal, discount_total: round(subtotal - grand), grand_total: grand,
    customer_payable_total: round(grand + Number(record.pass_through_rent ?? 0)), lines };
}

export class SupabaseEstimateBrowserRepository implements EstimateBrowserRepository {
  constructor(private readonly factory: () => any = getSupabaseAdminClient) {}
  private async enrich(org: string, records: any[]) {
    if (!records.length) return [];
    const client = this.factory();
    const {data:customers,error:customerError}=await client.from('customers').select('id,name,phone,city').eq('organization_id',org).in('id',[...new Set(records.map(r=>r.customer_id))]);
    if(customerError)throw new ApiError(502,'ESTIMATE_READ_FAILED','Saved estimate customers could not be loaded');
    const items:any[]=[];
    // PostgREST caps a response at 1,000 rows. Page the full line set so list
    // counts/totals remain correct even when a register page contains many slips.
    for(let offset=0;;offset+=1000){
      const {data,error}=await client.from('estimate_items').select('*,products!estimate_items_product_id_fkey(name,category)').in('estimate_id',records.map(r=>r.id)).order('estimate_id').order('line_number').range(offset,offset+999);
      if(error)throw new ApiError(502,'ESTIMATE_READ_FAILED','Saved estimate details could not be loaded');
      items.push(...(data??[]));if((data??[]).length<1000)break;
    }
    return records.map(record=>estimateView({...record,customers:customers?.find((c:any)=>c.id===record.customer_id)},(items??[]).filter((item:any)=>item.estimate_id===record.id)));
  }
  async list(org: string, branch: string, filters: EstimateFilters) {
    const client=this.factory();
    let query=client.from('estimates').select('*').eq('organization_id',org).eq('branch_id',branch).order('id',{ascending:false}).limit(filters.limit+1);
    if(filters.status) query=query.eq('status',filters.status==='INVOICED'?'CONVERTED':filters.status);
    if(filters.from) query=query.gte('issue_date',filters.from);
    if(filters.to) query=query.lte('issue_date',filters.to);
    if(filters.cursor) query=query.lt('id',filters.cursor);
    if(filters.search){
      // Search customer names separately, keeping user text out of PostgREST OR grammar.
      const safe=filters.search.replace(/[%,_()\[\].\\]/g,' ').trim();
      if(safe){
        const {data: customers,error}=await client.from('customers').select('id').eq('organization_id',org).ilike('name',`%${safe}%`).limit(1000);
        if(error)throw new ApiError(502,'ESTIMATE_READ_FAILED','Customer search could not be loaded');
        const ids=(customers??[]).map((c:any)=>Number(c.id)).filter(Number.isSafeInteger);
        query=query.or(`estimate_number.ilike.%${safe}%${ids.length?`,customer_id.in.(${ids.join(',')})`:''}`);
      }
    }
    const {data,error}=await query;
    if(error)throw new ApiError(502,'ESTIMATE_READ_FAILED','Estimates could not be loaded');
    const records=data??[];
    const rows=await this.enrich(org,records.slice(0,filters.limit));
    return {data:rows.map(({lines,...header}:any)=>header),next_cursor:records.length>filters.limit?records[filters.limit-1].id:null};
  }
  async get(org: string, branch: string, reference: string) {
    let query=this.factory().from('estimates').select('*').eq('organization_id',org).eq('branch_id',branch);
    query=/^\d+$/.test(reference)?query.eq('id',Number(reference)):query.eq('estimate_number',reference);
    const {data,error}=await query.maybeSingle();
    if(error)throw new ApiError(502,'ESTIMATE_READ_FAILED','Estimate could not be loaded');
    return data?(await this.enrich(org,[data]))[0]:null;
  }
  async patch(org: string, branch: string, actor: string, id: number, input: any) {
    const {error}=await this.factory().rpc('update_estimate_scoped',{p_organization_id:org,p_branch_id:branch,p_actor_user_id:actor,p_estimate_id:id,p_changes:input});
    if(error)throw new ApiError(error.code==='42501'?403:error.code==='40001'?409:400,'ESTIMATE_UPDATE_REJECTED',error.message);
  }
}
