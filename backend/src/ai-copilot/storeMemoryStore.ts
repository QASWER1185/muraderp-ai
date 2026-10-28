import { createHash } from 'node:crypto';
import { getSupabaseAdminClient } from '../config/supabase.js';
import { ApiError } from '../errors/api-error.js';
import type { AgentScope } from './agent/erp-tools.js';
import { hardwareKind } from './demand-slip.js';

export type StoreRate = { name:string; size?:string; unit:string; rate:number; learnedAt:string; sourceActionId?:string };
export type StoreMemory = { rates:StoreRate[]; rules:string[] };
const normalized=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}/]+/gu,' ').trim().split(/\s+/u).sort().join(' ');
const unitAliases:Record<string,string>={بوری:'bag',bags:'bag',عدد:'pcs',piece:'pcs',pieces:'pcs',گز:'gaz',yard:'gaz',yards:'gaz'};
const unitKey=(unit:string)=>unitAliases[unit.toLowerCase()]??unit.toLowerCase();
const itemKey=(name:string,size='',unit='pcs')=>[hardwareKind(name)??normalized(name),normalized(size),unitKey(unit)].join('|');

/** Durable store preferences use the existing scoped Copilot event store.
 * Each item/unit has one upserted memory entry; process restarts cannot erase it.
 * These are memory-only events, never sales, stock or accounting transactions. */
export class StoreMemoryStore {
  constructor(private readonly database:()=>any=getSupabaseAdminClient) {}
  async recall(scope:AgentScope):Promise<StoreMemory> {
    const entries:any[]=[];
    for(let offset=0;;offset+=500){
      const {data,error}=await this.database().from('ai_copilot_actions').select('action_plan,created_at')
        .eq('organization_id',scope.organizationId).eq('action_plan->>branchId',scope.branchId)
        .eq('action_plan->>memoryKind','store').eq('status','EXECUTED').order('created_at',{ascending:false}).range(offset,offset+499);
      if(error)throw new ApiError(502,'STORE_MEMORY_UNAVAILABLE','دکان کے محفوظ نرخ اور اصول نہیں پڑھے جا سکے۔');
      entries.push(...(data??[]));if((data??[]).length<500)break;
    }
    return {rates:entries.flatMap(row=>row.action_plan.storeRate?[row.action_plan.storeRate]:[]),
      rules:entries.flatMap(row=>row.action_plan.storeRule?[row.action_plan.storeRule]:[])};
  }
  findRate(memory:StoreMemory,name:string,size:string|undefined,unit:string){
    const key=itemKey(name,size,unit);
    return memory.rates.find(row=>itemKey(row.name,row.size,row.unit)===key);
  }
  private async remember(scope:AgentScope,key:string,entry:Record<string,unknown>){
    const fingerprint=createHash('sha256').update(JSON.stringify({...scope,key,entry})).digest('hex');
    const {error}=await this.database().from('ai_copilot_actions').upsert({organization_id:scope.organizationId,user_id:scope.userId,
      intent:'estimate',status:'EXECUTED',idempotency_key:'store-memory-'+createHash('sha256').update(scope.branchId+'|'+key).digest('hex'),
      request_fingerprint:fingerprint,created_at:new Date().toISOString(),executed_at:new Date().toISOString(),
      action_plan:{...scope,memoryKind:'store',...entry},result:{memoryOnly:true,financialPosting:false}},
      {onConflict:'organization_id,idempotency_key'});
    if(error)throw new ApiError(502,'STORE_MEMORY_SAVE_FAILED','مسودہ محفوظ ہے؛ دکان کی یادداشت محفوظ نہیں ہو سکی۔');
  }
  async rememberRates(scope:AgentScope,lines:any[],sourceActionId:string){
    for(const line of lines){
      if(line.pending||line.pricing_source!=='OWNER_QUOTED'||!Number.isFinite(line.unit_price)||line.unit_price<0)continue;
      const rate:StoreRate={name:line.productName,...(line.size?{size:line.size}:{}),unit:line.unit,rate:line.unit_price,learnedAt:new Date().toISOString(),sourceActionId};
      await this.remember(scope,'rate|'+itemKey(rate.name,rate.size,rate.unit),{storeRate:rate});
    }
  }
  async rememberRule(scope:AgentScope,rule:string){
    await this.remember(scope,'rule|'+normalized(rule),{storeRule:rule});
    return {remembered:true,rule,financialPosting:false};
  }
  async historicalRate(scope:AgentScope,name:string,unit:string):Promise<StoreRate|undefined>{
    const {data,error}=await this.database().from('estimate_items')
      .select('description,unit,unit_price,pricing_provenance,estimates!inner(organization_id,branch_id,status,updated_at)')
      .eq('estimates.organization_id',scope.organizationId).eq('estimates.branch_id',scope.branchId)
      .in('estimates.status',['DRAFT','READY','INVOICED']).eq('description',name).eq('unit',unit).eq('is_pending',false)
      .eq('pricing_source','MANUAL_OVERRIDE').order('id',{ascending:false}).limit(10);
    if(error)throw new ApiError(502,'STORE_HISTORY_UNAVAILABLE','پچھلے تخمینوں کے نرخ نہیں پڑھے جا سکے۔');
    const row=data?.find((row:any)=>row.pricing_provenance?.owner_rate!=null&&Number.isFinite(Number(row.unit_price)));
    return row?{name:row.description,unit:row.unit,rate:Number(row.unit_price),learnedAt:row.estimates.updated_at}:undefined;
  }
}
