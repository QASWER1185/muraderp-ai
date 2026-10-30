import { getSupabaseServiceRoleClient } from '../config/supabase.js';
import { ApiError } from '../errors/api-error.js';
import { resolveCandidates } from '../services/entity-search.service.js';

// Search spelling variants only; these are not records or inferred identities.
const aliases=[['aamir','amir','aamer','عامر'],['sial','syal','سیال'],['pprc','ppr-c','ppr c']];
const clean=(s:string)=>s.normalize('NFKC').replace(/[^\p{L}\p{N}\s./-]/gu,' ').replace(/\s+/g,' ').trim();
const variants=(s:string)=>aliases.find(group=>group.includes(s.toLowerCase()))??(/^\d+mm$/i.test(s)?[s,s.replace(/mm/i,' mm')]:[s]);
const identity=(s:string)=>clean(s).toLowerCase().split(' ').filter(t=>!['sb','sahib','صاحب','bhai','بھائی'].includes(t)).map(t=>aliases.find(g=>g.includes(t))?.[0]??t).join(' ');
const failure=(entity:string,error:unknown):never=>{
  const e=error as {code?:string;message?:string};
  throw new ApiError(502,'COPILOT_DIRECTORY_READ_FAILED',`${entity}: ${e.code??'database error'} ${e.message??''}`);
};
export class CopilotDirectoryRepository {
  constructor(private readonly clientFactory=getSupabaseServiceRoleClient){}
  async listCustomers(organizationId:string,input:{limit:number;cursor?:number}) {
    let request=this.clientFactory().from('customers').select('id,name,phone,city').eq('organization_id',organizationId).order('id').limit(input.limit+1);
    if(input.cursor!==undefined)request=request.gt('id',input.cursor);
    const {data,error}=await request;if(error)failure('Customer list',error);
    const rows=data??[],items=rows.slice(0,input.limit);
    return {items,count:items.length,hasMore:rows.length>input.limit,nextCursor:rows.length>input.limit?items.at(-1)?.id:null,authoritative:true};
  }
  async searchCustomers(organizationId:string,input:{query:string;limit:number}) {
    const terms=clean(input.query).split(' ').filter(Boolean);
    if(!terms.length)throw new ApiError(422,'VALIDATION_ERROR','Supply a customer name or phone.');
    let request=this.clientFactory().from('customers').select('id,name,phone,city').eq('organization_id',organizationId);
    for(const term of terms)request=request.or(variants(term).flatMap(v=>['name','phone','city'].map(field=>`${field}.ilike.%${v}%`)).join(','));
    const {data,error}=await request.order('id').limit(Math.max(2,input.limit)+1);if(error)failure('Customer search',error);
    const queryIdentity=identity(input.query);
    const rows=(data??[]).map(row=>({...row,confidence:identity(row.name)===queryIdentity||row.phone===input.query?1:0.7,match_kind:identity(row.name)===queryIdentity?'bilingual_exact':'partial_name_phone_city'})).sort((a,b)=>b.confidence-a.confidence);
    return {...resolveCandidates(rows,input.limit),authoritative:true};
  }
  async searchProducts(organizationId:string,input:{query?:string;product_id?:number;limit:number}) {
    const client=this.clientFactory();
    let request=client.from('products').select('id,name,sku,category,unit,brand_id,brands(name)').eq('organization_id',organizationId);
    if(input.product_id)request=request.eq('id',input.product_id);
    const terms=clean(input.query??'').split(' ').filter(Boolean);
    for(const term of terms) {
      const spellings=variants(term);
      const {data:brands,error:brandError}=await client.from('brands').select('id').eq('organization_id',organizationId).or(spellings.map(v=>`name.ilike.%${v}%`).join(',')).limit(100);
      if(brandError)failure('Brand search',brandError);
      const filters=spellings.flatMap(v=>['name','sku','category'].map(field=>`${field}.ilike.%${v}%`));
      if(brands?.length)filters.push(`brand_id.in.(${brands.map(b=>b.id).join(',')})`);
      request=request.or(filters.join(','));
    }
    if(!terms.length&&!input.product_id)throw new ApiError(422,'VALIDATION_ERROR','Supply a product query or ID.');
    const {data,error}=await request.order('id').limit(input.limit+1);if(error)failure('Product search',error);
    const items=(data??[]).slice(0,input.limit);
    return {items,count:items.length,hasMore:(data??[]).length>input.limit,authoritative:true};
  }
}
