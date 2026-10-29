import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { ApiError } from '../../errors/api-error.js';
import type { AiProviderContract } from '../../ai/providers/contracts.js';
import { ERP_TOOLS, type AgentScope } from '../agent/erp-tools.js';
import { newBusinessState } from '../agent/business-state.js';
import { ANALYTICS_SCHEMAS } from '../analytics.js';
import { ERP_ACTION_SCHEMAS } from '../tools/registry.js';
import { AutonomousV2Agent } from './agent.js';
import { V2_SCHEMAS, readNames, v2Definitions } from './tools.js';
import type { Conversation, Memory, V2Store } from './store.js';

const readSchemas: Record<string,z.ZodType> = {
  ...Object.fromEntries(ERP_TOOLS.map(t=>[t.name,t.schema])), ...ANALYTICS_SCHEMAS, ...ERP_ACTION_SCHEMAS,
};
// Payment-document reads are defined by the legacy business registry.
import { BUSINESS_READ_SCHEMAS } from '../agent/business-tools.js';
Object.assign(readSchemas, BUSINESS_READ_SCHEMAS);
// Legacy whitelist alias: preserve a demo-only, period/limit read contract.
readSchemas.erp_get_top_products = ANALYTICS_SCHEMAS.erp_get_top_customers;
const resultSchema = z.object({demo:z.literal(true), databaseConfigured:z.literal(false), executed:z.literal(false),
  message:z.string(), data:z.array(z.unknown()), count:z.number().int().nonnegative()}).passthrough();
const message='Local demo dataset only; database is disconnected. No real ERP records or balances were read or changed. Unknown items and rates need owner clarification.';
const result=(extra:Record<string,unknown>={})=>resultSchema.parse({demo:true,databaseConfigured:false,realBusinessVerified:false,dataStatus:'unavailable',dataset:'empty_local_demo',executed:false,message,data:[],count:Array.isArray(extra.data)?extra.data.length:0,...extra});
function guard() {
  if(env.NODE_ENV!=='development'||env.SUPABASE_URL||env.SUPABASE_SECRET_KEY)
    throw new ApiError(403,'LOCAL_DEMO_DISABLED','Local demo requires development mode and no configured database.');
}
const key=(s:AgentScope)=>JSON.stringify([s.userId,s.organizationId,s.branchId]);
class LocalStore implements V2Store {
  private conversations=new Map<string,Conversation>();
  private leases=new Map<string,string>();
  private memory=new Map<string,Memory[]>();
  async open(scope:AgentScope,id?:string) {
    guard(); const state=newBusinessState(scope), c:Conversation={id:state.conversationId,version:0,messages:[],state};
    const k=key(scope)+':'+(id??c.id);
    if(id&&!this.conversations.has(k))throw new ApiError(404,'V2_CONVERSATION_NOT_FOUND','Demo conversation is not available in this scope.');
    if(!id)this.conversations.set(k,c);
    return structuredClone(this.conversations.get(k)!);
  }
  async claim(scope:AgentScope,c:Conversation) {
    guard();const k=key(scope)+':'+c.id;
    if(this.leases.has(k))throw new ApiError(409,'V2_TURN_BUSY','Demo conversation is busy.');
    const lease=randomUUID();this.leases.set(k,lease);return lease;
  }
  async save(scope:AgentScope,c:Conversation,lease:string) {
    guard();const k=key(scope)+':'+c.id;
    if(this.leases.get(k)!==lease)throw new ApiError(409,'V2_TURN_BUSY','Demo conversation lease changed.');
    c.version++;this.conversations.set(k,structuredClone(c));this.leases.delete(k);
  }
  async memories(scope:AgentScope){guard();return structuredClone(this.memory.get(key(scope))??[]);}
  async writeMemory(scope:AgentScope,entry:Memory,remove:boolean){
    guard();const normalized={...entry,key:entry.key.normalize('NFKC').trim().toLocaleLowerCase('en')};
    const rows=(await this.memories(scope)).filter(m=>m.key!==normalized.key||m.category!==entry.category);
    if(!remove)rows.push(normalized);this.memory.set(key(scope),rows);
  }
}
export const localDemoStore=new LocalStore();
export class LocalDemoTools {
  async authorize(scope:AgentScope){guard();for(const value of [scope.userId,scope.organizationId,scope.branchId])z.string().uuid().parse(value);}
  definitions(){guard();return v2Definitions(Object.entries(readSchemas).filter(([name])=>readNames.has(name)).map(([name,schema])=>({type:'function',name,parameters:z.toJSONSchema(schema)})));}
  async execute(name:string,raw:unknown,scope:AgentScope,c:Conversation,userMessage:string,_evidence?:string,_eligible?:string):Promise<any>{
    await this.authorize(scope);
    if(name==='read_erp') {
      const p=z.strictObject({tool:z.string(),data:z.record(z.string(),z.unknown())}).parse(raw);
      if(!readNames.has(p.tool)||!readSchemas[p.tool])return result({supported:false});
      readSchemas[p.tool]!.parse(p.data);
      return result({tool:p.tool,items:[],rows:[],candidates:[],bestCandidate:null,resolved:false,total:0,record:null});
    }
    const schema=V2_SCHEMAS[name as keyof typeof V2_SCHEMAS];
    if(!schema)return result({supported:false});
    const p:any=schema.parse(raw);
    if(name==='manage_shop_memory') {
      if(p.action==='retrieve')return result({data:(await localDemoStore.memories(scope)).filter(m=>m.category===p.category&&m.key===p.key.normalize('NFKC').trim().toLocaleLowerCase('en'))});
      if(!p.confirmedByUser||!p.evidence||!userMessage.includes(p.evidence))return result({supported:false,requiresClarification:true});
      await localDemoStore.writeMemory(scope,{category:p.category,key:p.key,value:p.value,evidence:p.evidence,verified_by:scope.userId},p.action==='delete');
      return result({savedInDemoMemory:p.action!=='delete',deletedFromDemoMemory:p.action==='delete'});
    }
    if(name==='execute_prepared_action')return result({supported:false,requiresClarification:true,message:message+' Demo previews cannot post records.'});
    if(name==='manage_invoice'&&p.action==='list')return result({items:[],hasMore:false,authoritative:false,period:{startDate:p.data.startDate??null,endDate:p.data.endDate??null}});
    if(p.action==='get'||p.action==='get_ledger'||p.action==='search_rates'||p.action==='check_stock')
      return result({items:[],rows:[],record:null,rates:[],activeRate:null,requiresClarification:p.action==='search_rates'});
    // Preview payloads are retained for clarification only, never financial posting.
    const preview={demo:true,incomplete:true,summary:'Local demo preview — no catalog rates or authoritative records available.',input:p};
    c.pending={id:randomUUID(),kind:'local_demo',input:p,preview,financial:true,turn:c.version,expires:Date.now()+600000};
    return result({previewId:c.pending.id,preview,requiresClarification:true,requiresConfirmation:false});
  }
}
export function createLocalDemoAgent(provider:AiProviderContract){guard();return new AutonomousV2Agent(provider,new LocalDemoTools(),localDemoStore);}
