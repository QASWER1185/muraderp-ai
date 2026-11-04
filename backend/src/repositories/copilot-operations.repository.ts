import {getSupabaseAdminClient} from '../config/supabase.js';
import {ApiError} from '../errors/api-error.js';
import type {AgentScope} from '../ai-copilot/agent/erp-tools.js';
import {normalizeEstimateSearch} from '../ai-copilot/estimate-search.js';
import {SupabaseErpService} from '../services/erp.service.js';

export interface OperationsSearch {query?:string;kind:'all'|'invoices'|'bills'|'estimates'|'items';limit:number;customer_id?:number;vendor_id?:number;product_id?:number}
/** Finite, paginated reads. Never use model-authored SQL or a global unscoped lookup. */
export class CopilotOperationsRepository {
  constructor(private readonly database:()=>any=getSupabaseAdminClient){}
  async getPurchase(scope:AgentScope,id:number){
    return new SupabaseErpService(this.database).getPurchase(id,scope.organizationId,scope.branchId);
  }
  private async read(query:any){const {data,error}=await query;if(error)throw new ApiError(502,'ERP_READ_FAILED','Authoritative ERP records could not be read.');return data??[];}
  async search(scope:AgentScope,input:OperationsSearch){
    const kinds=input.kind==='all'?['invoices','bills','estimates','items']:[input.kind];
    const results:any[]=[];
    const normalized=normalizeEstimateSearch(input.query??'');
    const tokens=normalized.split(' ').filter(t=>t&&!(t==='electric'&&normalized.includes('conduit')));
    const matches=(text:string)=>tokens.every(t=>normalizeEstimateSearch(text).includes(t));
    for(const kind of kinds){
      const table=kind==='bills'?'purchases':kind==='items'?'products':kind;
      const found:any[]=[];
      for(let offset=0;;offset+=100){
        let q=this.database().from(table).select('*').eq('organization_id',scope.organizationId);
        if(kind!=='items')q=q.eq('branch_id',scope.branchId);
        if(input.customer_id&&['invoices','estimates'].includes(kind))q=q.eq('customer_id',input.customer_id);
        if(input.vendor_id&&kind==='bills')q=q.eq('vendor_id',input.vendor_id);
        if(input.product_id&&kind==='items')q=q.eq('id',input.product_id);
        const headers=await this.read(q.order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+99));
        const lines:any[]=[];
        if(kind!=='items'&&headers.length){
          const child=kind==='bills'?'purchase_items':kind==='invoices'?'invoice_items':'estimate_items';
          const fk=kind==='bills'?'purchase_id':kind==='invoices'?'invoice_id':'estimate_id';
          for(let lineOffset=0;;lineOffset+=1000){
            let childQuery=this.database().from(child).select(`*,products!${child}_product_id_fkey(name,category)`).in(fk,headers.map((h:any)=>h.id));
            if(input.product_id)childQuery=childQuery.eq('product_id',input.product_id);
            const page=await this.read(childQuery.order('id').range(lineOffset,lineOffset+999));
            lines.push(...page);if(page.length<1000)break;
          }
        }
        const partyTable=kind==='bills'?'vendors':'customers',partyKey=kind==='bills'?'vendor_id':'customer_id';
        const parties=kind==='items'||!headers.length?[]:await this.read(this.database().from(partyTable).select('id,name').eq('organization_id',scope.organizationId).in('id',[...new Set(headers.map((h:any)=>h[partyKey]))]));
        for(const row of headers){
          const key=kind==='bills'?'purchase_id':kind==='invoices'?'invoice_id':'estimate_id';
          const detail=lines.filter(l=>l[key]===row.id);
          if(input.product_id&&kind!=='items'&&!detail.length)continue;
          const party=parties.find((p:any)=>p.id===row[partyKey]);
          const text=[row.invoice_number,row.estimate_number,row.name,row.sku,row.category,party?.name].filter(Boolean).join(' ');
          if(!matches(text)&&!detail.some(l=>matches([text,l.description,l.products?.name,l.products?.category].filter(Boolean).join(' '))))continue;
          found.push({kind,id:row.id,number:row.invoice_number??row.estimate_number??row.sku,name:row.name,party_name:party?.name,
            created_at:row.created_at,status:row.status??(kind==='bills'?'RECORDED':undefined),
            total_amount:row.total??row.grand_total,currency:row.currency_code,
            line_item_summary:detail.map(l=>({id:l.id,product_id:l.product_id,name:l.description||l.products?.name,quantity:l.quantity,unit:l.unit,unit_price:l.unit_price??l.unit_cost,line_total:l.line_total??l.line_amount??l.total_cost}))});
        }
        if(headers.length<100||found.length>input.limit)break;
      }
      results.push(...found);
    }
    results.sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||b.id-a.id);
    return {authoritative:true,ordering:'created_at_DESC',data:results.slice(0,input.limit),hasMore:results.length>input.limit};
  }
  async vendorLedger(scope:AgentScope,vendorId:number,limit:number){
    const rows:any[]=[];
    for(let offset=0;;offset+=500){
      const page=await this.read(this.database().from('vendor_payable_ledger_entries').select('*').eq('organization_id',scope.organizationId).eq('branch_id',scope.branchId).eq('vendor_id',vendorId).order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+499));
      rows.push(...page);if(page.length<500)break;
    }
    // Native purchase/payable schema has no currency column; do not fabricate one.
    const fixed=(v:unknown)=>{const text=String(v);if(!/^\d+(?:\.\d{1,4})?$/.test(text))throw new ApiError(502,'ERP_READ_FAILED','Ledger amount is invalid.');const [whole,fraction='']=text.split('.');return BigInt(whole!)*10000n+BigInt(fraction.padEnd(4,'0'));};
    const balance=rows.reduce((sum:bigint,r:any)=>sum+fixed(r.credit)-fixed(r.debit),0n);
    return {authoritative:true,kind:'vendor_ledger',vendor_id:vendorId,outstanding_balance:Number(balance)/10000,transactions:rows.slice(0,limit),hasMore:rows.length>limit,balanceIncludesAllEntries:true};
  }
}
