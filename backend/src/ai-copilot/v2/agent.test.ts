import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AutonomousV2Agent } from './agent.js';
import { V2ToolConnector, V2_SCHEMAS } from './tools.js';
import type { Conversation, Memory, V2Store } from './store.js';
import { newBusinessState } from '../agent/business-state.js';
import type { AgentScope } from '../agent/erp-tools.js';

const scope={userId:randomUUID(),organizationId:randomUUID(),branchId:randomUUID()};
const say=(text:string)=>({output:[{type:'message',content:[{type:'output_text',text}]}]});
const call=(name:string,args:unknown)=>({output:[{type:'function_call',call_id:randomUUID(),name,arguments:JSON.stringify(args)}]});
class Store implements V2Store {
  rows=new Map<string,Conversation>(); memory=new Map<string,Memory>(); busy=false;
  async open(s:AgentScope,id?:string):Promise<Conversation>{if(id){const c=this.rows.get(JSON.stringify(s)+id);if(!c)throw Error('Scoped conversation missing');return structuredClone(c);}const c:Conversation={id:randomUUID(),version:0,messages:[],state:newBusinessState(s)};this.rows.set(JSON.stringify(s)+c.id,structuredClone(c));return c;}
  async claim(){if(this.busy)throw Error('busy');this.busy=true;return 'lease';}
  async save(s:AgentScope,c:Conversation){this.rows.set(JSON.stringify(s)+c.id,structuredClone({...c,version:c.version+1}));this.busy=false;}
  async memories(){return [...this.memory.values()];}
  async writeMemory(_s:AgentScope,m:Memory,remove:boolean){const key=m.category+':'+m.key;if(remove)this.memory.delete(key);else this.memory.set(key,m);}
}
function fixture(){
  const store=new Store();
  const review={draftId:randomUUID(),idempotencyKey:'server-key',tool:'erp_record_payment',preview:{title:'Receipt',totals:{grand_total:100},summary:'وصولی PKR 100'},requiresConfirmation:true};
  const deps:any={store,runtime:{createUnifiedDraft:vi.fn(async()=>review),reviseUnifiedDraft:vi.fn(async()=>({...review,draftId:randomUUID()})),
    confirmAndExecute:vi.fn(async()=>({status:'EXECUTED',result:{id:5}})),createMasterDataDraft:vi.fn(),createFinancialDraft:vi.fn()},
    reads:{definitions:()=>[],execute:vi.fn(async()=>({rate:null}))},access:{assertBranchAccess:vi.fn(async()=>{}),assertPermission:vi.fn(async()=>{})},
    estimates:{get:vi.fn(),patch:vi.fn()},erp:{getVendor:vi.fn(),updateVendor:vi.fn(),listProducts:vi.fn(async()=>({data:[]})),createProduct:vi.fn(async()=>({id:9}))},pricing:{resolvePrice:vi.fn(async()=>null)}};
  const tools=new V2ToolConnector(deps), provider={toolTurn:vi.fn()};
  return {store,deps,tools,provider,agent:new AutonomousV2Agent(provider,tools,store),review};
}
describe('Copilot v2 native reasoning and scoped ERP connector',()=>{
  it('always lets Gemini interpret greetings and incidental record references',async()=>{
    const f=fixture();f.provider.toolTurn.mockResolvedValue(say('وعلیکم السلام جناب، فرمائیے۔'));
    const r=await f.agent.run({message:'سلام، EST-1067 کی بات بعد میں کریں گے'},scope);
    expect(r.answer).toContain('وعلیکم');expect(f.provider.toolTurn).toHaveBeenCalledTimes(1);expect(f.deps.reads.execute).not.toHaveBeenCalled();
  });
  it('previews receipts and executes only the previous exact preview on a subsequent approved turn',async()=>{
    const f=fixture();f.provider.toolTurn.mockResolvedValueOnce(call('record_financial_transaction',{type:'customer_payment',data:{customerId:19,amount:100,paymentMethod:'CASH'}})).mockResolvedValueOnce(say('وصولی 100 روپے ہے، منظوری دیں۔'));
    const first=await f.agent.run({message:'گاہک 19 سے 100 روپے وصول کریں'},scope);
    expect(first.requiresConfirmation).toBe(true);expect(f.deps.runtime.confirmAndExecute).not.toHaveBeenCalled();
    f.provider.toolTurn.mockResolvedValueOnce(call('execute_prepared_action',{previewId:first.pendingPreview!.id,approvalEvidence:'جی منظور ہے'})).mockResolvedValueOnce(say('وصولی محفوظ ہوگئی۔'));
    await f.agent.run({message:'جی منظور ہے',conversationId:first.conversationId},scope);
    expect(f.deps.runtime.confirmAndExecute).toHaveBeenCalledExactlyOnceWith(f.review.draftId,scope.organizationId,scope.userId,'server-key',scope.branchId);
    expect((await f.store.open(scope,first.conversationId)).pending).toBeUndefined();
  });
  it('rejects same-turn, forged, stale and attachment-only approvals without an ERP mutation',async()=>{
    const f=fixture(),c=await f.store.open(scope);
    const preview=await f.tools.execute('record_financial_transaction',{type:'customer_payment',data:{customerId:19,amount:100,paymentMethod:'CASH'}},scope,c,'وصول کریں','وصول کریں');
    const run=(previewId:string,evidence:string,eligible?:string)=>f.tools.execute('execute_prepared_action',{previewId,approvalEvidence:evidence},scope,c,'ہاں','ہاں',eligible);
    expect((await run(preview.previewId,'ہاں',preview.previewId)).executed).toBe(false);
    c.version++;
    expect((await run(randomUUID(),'ہاں',preview.previewId)).executed).toBe(false);
    expect((await run(preview.previewId,'approve',preview.previewId)).executed).toBe(false);
    c.pending!.expires=0;expect((await run(preview.previewId,'ہاں',preview.previewId)).executed).toBe(false);
    expect(f.deps.runtime.confirmAndExecute).not.toHaveBeenCalled();
  });
  it('honors an explicit current-user direct instruction for nonfinancial work, but never for financial posting',async()=>{
    const f=fixture(),c=await f.store.open(scope),message='اس catalog item کو براہ راست شامل کریں';
    const r=await f.tools.execute('manage_inventory_and_rates',{action:'add_product',data:{sku:'QA-NEW',name:'QA New Product',category:'Hardware',unit:'pcs'}},scope,c,message,message);
    const result=await f.tools.execute('execute_prepared_action',{previewId:r.previewId,approvalEvidence:message,directInstruction:true},scope,c,message,message);
    expect(result.executed).toBe(true);expect(f.deps.erp.createProduct).toHaveBeenCalledTimes(1);
    const payment=await f.tools.execute('record_financial_transaction',{type:'customer_payment',data:{customerId:19,amount:100,paymentMethod:'CASH'}},scope,c,message,message);
    expect((await f.tools.execute('execute_prepared_action',{previewId:payment.previewId,approvalEvidence:message,directInstruction:true},scope,c,message,message)).executed).toBe(false);
    expect(f.deps.runtime.confirmAndExecute).not.toHaveBeenCalled();
  });
  it('requires quoted current-user confirmation, overwrites corrected memory, deletes it, and injects it each turn',async()=>{
    const f=fixture(),c=await f.store.open(scope);
    const args={action:'save',category:'customer_pref',key:'ikram-discount',value:'52%',evidence:'اکرام کی رعایت 52 فیصد یاد رکھیں',confirmedByUser:false};
    expect((await f.tools.execute('manage_shop_memory',args,scope,c,args.evidence,args.evidence)).supported).toBe(false);
    await f.tools.execute('manage_shop_memory',{...args,confirmedByUser:true},scope,c,args.evidence,args.evidence);
    await f.tools.execute('manage_shop_memory',{...args,action:'update',value:'50%',evidence:'اسے 50 فیصد درست کریں',confirmedByUser:true},scope,c,'اسے 50 فیصد درست کریں','اسے 50 فیصد درست کریں');
    expect([...f.store.memory.values()]).toHaveLength(1);expect([...f.store.memory.values()][0]?.value).toBe('50%');
    f.provider.toolTurn.mockResolvedValue(say('جی، تصدیق شدہ یادداشت موجود ہے۔'));
    await f.agent.run({message:'اکرام کا کیا اصول ہے؟'},scope);
    expect(JSON.stringify(f.provider.toolTurn.mock.calls[0])).toContain('50%');
    await f.tools.execute('manage_shop_memory',{...args,action:'delete',evidence:'یہ اصول بھول جائیں',confirmedByUser:true},scope,c,'یہ اصول بھول جائیں','یہ اصول بھول جائیں');
    expect(f.store.memory.size).toBe(0);
  });
  it('preserves context after a failed provider turn and resumes from durable history',async()=>{
    const f=fixture();f.provider.toolTurn.mockRejectedValueOnce(Error('no actionable step'));
    const r=await f.agent.run({message:'یہ قیمت یاد رہے ابھی محفوظ نہ کریں'},scope);
    expect(r.answer).not.toMatch(/actionable|JSON|Error/);expect((await f.store.open(scope,r.conversationId)).messages).toHaveLength(2);
    f.provider.toolTurn.mockResolvedValueOnce(say('جی، پچھلی ہدایت موجود ہے۔'));
    await f.agent.run({message:'پچھلی بات جاری رکھیں',conversationId:r.conversationId},scope);
    expect(JSON.stringify(f.provider.toolTurn.mock.calls[1])).toContain('ابھی محفوظ نہ کریں');
    await expect(f.agent.run({message:'read',conversationId:r.conversationId},{...scope,branchId:randomUUID()})).rejects.toThrow('Scoped conversation');
  });
  it('previews native estimate edits using the existing calculator and optimistic version; never patches on read or preview',async()=>{
    const f=fixture(),c=await f.store.open(scope);
    const before={id:21,estimate_number:'EST-1064',updated_at:new Date().toISOString(),grand_total:100,status:'DRAFT',lines:[{id:1,product_id:1,quantity:10,list_price:10,stored_unit_price:10,discount_percent:0,discount_amount:0,unit:'pcs'}]};
    f.deps.estimates.get.mockResolvedValue(before);
    const snapshot=JSON.stringify(before);
    const r=await f.tools.execute('manage_estimate',{action:'update',data:{reference:'EST-1064',changes:{pass_through_rent:20,lines:[{id:1,product_id:1,quantity:12,list_price:10,unit:'pcs'}]}}},scope,c,'تعداد 12 کریں','تعداد 12 کریں');
    expect(r.preview.after.grand_total).toBe(120);expect(r.preview.after.customer_payable_total).toBe(140);
    expect(JSON.stringify(before)).toBe(snapshot);expect(f.deps.estimates.patch).not.toHaveBeenCalled();
    c.version++;await f.tools.execute('execute_prepared_action',{previewId:r.previewId,approvalEvidence:'منظور'},scope,c,'منظور','منظور',r.previewId);
    expect(f.deps.estimates.patch).toHaveBeenCalledWith(scope.organizationId,scope.branchId,scope.userId,21,expect.objectContaining({expected_updated_at:before.updated_at}));
  });
  it('keeps unknown rates pending and rejects model-invented prices without user provenance',async()=>{
    const f=fixture(),c=await f.store.open(scope);
    const result=await f.tools.execute('manage_estimate',{action:'create',data:{customerId:19,items:[{name:'Unknown hardware',qty:1,rate:100}]}},scope,c,'ایسٹیمیٹ بنائیں','ایسٹیمیٹ بنائیں');
    expect(result.supported).toBe(false);expect(f.deps.runtime.createUnifiedDraft).not.toHaveBeenCalled();
    await f.tools.execute('manage_inventory_and_rates',{action:'search_rates',data:{query:'Unknown hardware'}},scope,c,'','');
    expect(f.deps.reads.execute).toHaveBeenCalledWith('erp_get_product_sale_rate',expect.anything(),scope,c.state,'');
  });
  it('applies next-turn hardware prices through native line amendments rather than rebuilding the saved slip',async()=>{
    const f=fixture(),c=await f.store.open(scope),draftId=randomUUID();c.state.workingActionId=draftId;
    f.deps.runtime.createUnifiedDraft.mockResolvedValue({...f.review,tool:'erp_create_estimate'});
    const changes={updateLines:[{lineNumber:8,changes:{rate:100,rateEvidence:'نپل کا ریٹ 100 رکھیں'}}]};
    await f.tools.execute('manage_estimate',{action:'update',data:{changes}},scope,c,'نپل کا ریٹ 100 رکھیں','نپل کا ریٹ 100 رکھیں');
    expect(f.deps.runtime.createUnifiedDraft).toHaveBeenCalledWith('erp_amend_estimate',expect.objectContaining({...changes,draftId}),scope);
    expect(f.deps.runtime.createUnifiedDraft.mock.calls[0][1]).not.toHaveProperty('items');
    expect(f.deps.runtime.reviseUnifiedDraft).not.toHaveBeenCalled();
  });
  it('retains a verified execution receipt when the provider fails after a successful posting',async()=>{
    const f=fixture();
    f.provider.toolTurn.mockResolvedValueOnce(call('record_financial_transaction',{type:'customer_payment',data:{customerId:19,amount:100,paymentMethod:'CASH'}})).mockResolvedValueOnce(say('100 روپے وصولی کا پری ویو۔'));
    const first=await f.agent.run({message:'100 روپے وصولی تیار کریں'},scope);
    f.provider.toolTurn.mockResolvedValueOnce(call('execute_prepared_action',{previewId:first.pendingPreview!.id,approvalEvidence:'منظور'})).mockRejectedValueOnce(Error('provider connection lost'));
    const r=await f.agent.run({message:'منظور',conversationId:first.conversationId},scope);
    expect(r.status).toBe('completed');expect(r.answer).toContain('محفوظ ہونے کی تصدیق');expect(r.verifiedExecutions).toHaveLength(1);
    const stored=await f.store.open(scope,first.conversationId);expect(stored.pending).toBeUndefined();expect(stored.executions).toHaveLength(1);
  });
  it('retains an omitted existing discount on native quantity edits',async()=>{
    const f=fixture(),c=await f.store.open(scope);
    f.deps.estimates.get.mockResolvedValue({id:21,status:'DRAFT',updated_at:new Date().toISOString(),grand_total:50,lines:[{id:1,product_id:1,quantity:10,list_price:10,stored_unit_price:10,discount_percent:50,discount_amount:50,unit:'pcs'}]});
    const result=await f.tools.execute('manage_estimate',{action:'update',data:{reference:'EST-TEST',changes:{lines:[{id:1,product_id:1,quantity:12,unit:'pcs',list_price:10}]}}},scope,c,'تعداد 12 کریں','تعداد 12 کریں');
    expect(result.preview.after.grand_total).toBe(60);expect(result.preview.after.lines[0].discount_percent).toBe(50);expect(f.deps.estimates.patch).not.toHaveBeenCalled();
  });
  it('reports unsupported native capabilities truthfully and does not invoke financial services',async()=>{
    const f=fixture(),c=await f.store.open(scope);
    for(const [name,args] of [
      ['manage_invoice',{action:'delete',data:{reference:'INV-1'}}],
      ['record_financial_transaction',{type:'bank_transfer',data:{amount:100,fromAccount:'A',toAccount:'B',date:'2026-10-28'}}],
      ['manage_inventory_and_rates',{action:'adjust_stock',data:{product_id:1,warehouse_id:1,quantity:2,reason:'Count'}}],
    ] as const)expect((await f.tools.execute(name,args,scope,c,'','')).supported).toBe(false);
    expect(f.deps.runtime.createUnifiedDraft).not.toHaveBeenCalled();expect(f.deps.runtime.confirmAndExecute).not.toHaveBeenCalled();
    expect(Object.keys(V2_SCHEMAS)).toEqual(expect.arrayContaining(['manage_estimate','manage_invoice','record_financial_transaction','manage_inventory_and_rates','manage_party','manage_shop_memory']));
  });
});
