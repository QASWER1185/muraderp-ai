import {describe,it,expect,vi} from 'vitest';
import {DefaultErpOperations} from './tools/operations.js';
import {resolveCandidates} from '../services/entity-search.service.js';
import {estimateCaptionChoices} from './agent/multimodal-input.js';
import {hardwareInstructions,DEMAND_SLIP_ESTIMATE,demandDiscounts} from './demand-slip.js';
import {ErpToolRegistry} from './agent/erp-tools.js';
import {UnifiedCopilotAgent} from './agent/agent.js';
import {newBusinessState,writeBusinessState} from './agent/business-state.js';
import {CopilotRuntime} from './copilot.runtime.js';
import {canonicalSlipWords} from './conversationalMunshi.js';
import {hardwareKind} from './demand-slip.js';
const scope={userId:'a3000000-0000-4000-8000-000000000001',organizationId:'a3000000-0000-4000-8000-000000000002',branchId:'a3000000-0000-4000-8000-000000000003'};
const prompt='خالد محمود، لیک سٹی 15 بی رائے ونڈ روڈ لاہور، فون 0315-409017، ڈیورا میکس کے ریٹ لگاؤ 50% اور 52% لیس';
function fixture(){
 const products=[{id:11,name:'Dura Max PPR-C Pipe PN-16 25mm',category:'Pipes',unit:'pcs',brand_id:5},{id:12,name:'Dura Max PPR-C Elbow 25mm',category:'Fittings',unit:'pcs',brand_id:5},{id:13,name:'Cloth',category:'Hardware',unit:'gaz',brand_id:null}];
 let saved:any,customer:any;
 const query:any={select:()=>query,eq:()=>query,order:()=>query,range:()=>query,then:(resolve:any)=>Promise.resolve({data:saved?[saved]:[],error:null}).then(resolve)};
 const rpc=vi.fn(async(_name,args)=>{customer={id:77,name:args.p_payload.name,city:args.p_payload.address,phone:args.p_payload.phone};return {data:{id:77},error:null};});
 const deps:any={principal:'test',database:()=>({from:()=>query,rpc}),erp:{getProduct:vi.fn(async(id:number)=>products.find(p=>p.id===id)),getCustomer:vi.fn(async()=>customer)},search:{searchCustomers:vi.fn(async()=>resolveCandidates(customer?[{...customer,confidence:1,match_kind:'exact_name'}]:[],5)),getProductBrand:vi.fn(async()=> 'Dura Max'),searchProducts:vi.fn(async(q:string)=>resolveCandidates(/cloth|ململ/i.test(q)?[{...products[2]!,confidence:1,match_kind:'exact_name'}]:[],5))},pricing:{resolvePrice:vi.fn(async(x:any)=>({product_id:x.product_id,unit_price:x.product_id===11?100:x.product_id===12?200:45,unit:x.product_id===13?'gaz':'pcs',currency_code:'PKR',rate_list_id:4,rate_list_version_id:8}))},memory:{assertFloor:vi.fn(async()=>{}),recall:vi.fn(async()=>({history:[],preferredBrands:[],transactionCount:0}))}};
 const ops=new DefaultErpOperations(deps);
 const persist=(a:any)=>{saved={id:'a3000000-0000-4000-8000-000000000009',status:'DRAFT',user_id:scope.userId,action_plan:{branchId:scope.branchId,unifiedAction:a}};};
 const items=[...Array.from({length:52},(_,i)=>({productId:i%2?12:11,name:products[i%2]!.name,qty:2,unit:'pcs'})),{name:'ململ',qty:4,unit:'gaz'},{name:'دھاگہ',qty:8,unit:'pcs'},{name:'ٹیفلون ٹیپ',qty:40,unit:'pcs'},{name:'کنکشن پائپ',size:'24 inch',qty:4,unit:'pcs'},{name:'آری بلیڈ',qty:2,unit:'pcs'},{name:'Blade',size:'7 inch',qty:2,unit:'pcs'}];
 const input={mode:DEMAND_SLIP_ESTIMATE,...estimateCaptionChoices(prompt),brand:'Dura Max',pricingRules:demandDiscounts(prompt),items};
 return {ops,deps,rpc,persist,input};
}
describe('demand slip accounting integrity',()=>{
 it('normalizes the observed solvent misspelling and recognizes non-Dura brass/handle hardware',()=>{
  expect(canonicalSlipWords('Solutation 500g')).toBe('Solvent 500 g');expect(hardwareKind('G.I. Brass Nipple')).toBe('brass_nipple');expect(hardwareKind('Handle Valve')).toBe('handle_valve');
 });
 it('applies the requested Medium default to an unheaded Dura inch pipe while using its active ERP price',async()=>{
  const f=fixture();const candidate={id:11,name:'Dura Max U-PVC Medium 5 inch',brandName:'Dura Max',confidence:1,match_kind:'exact_name'};f.deps.search.searchProducts.mockResolvedValue(resolveCandidates([candidate],5));
  f.deps.erp.getProduct.mockResolvedValue({id:11,name:'Dura Max U-PVC Medium 5 inch',unit:'length',category:'Pipes',brand_id:5});
  f.deps.pricing.resolvePrice.mockResolvedValue({product_id:11,unit_price:1000,unit:'length',currency_code:'PKR',rate_list_id:4,rate_list_version_id:8});
  const result=await f.ops.prepare('erp_create_estimate',{...f.input,items:[{name:'Pipe',size:'5 inch',qty:1,unit:'length'}]},scope);
  expect(f.deps.search.searchProducts).toHaveBeenCalledWith('Pipe U-PVC Medium 5 inch',5,scope,'Dura Max');expect(result.data.lines[0]).toMatchObject({unit_price:1000,discountPercent:50});
 });
 it('rounds accumulated PKR totals to cents without floating-point tails',async()=>{
  const f=fixture();f.deps.pricing.resolvePrice.mockImplementation(async(x:any)=>({product_id:x.product_id,unit_price:x.product_id===11?100.01:200.01,unit:'pcs',currency_code:'PKR',rate_list_id:4,rate_list_version_id:8}));
  const result=await f.ops.prepare('erp_create_estimate',f.input,scope);expect((result.preview.partialTotals as any).grand_total).toBe(7592.52);expect(result.preview.summary).not.toContain('999999');
 });
 it('cannot bypass hardware price permission through the generic revision tool',async()=>{
  const revise=vi.fn();const tools=new ErpToolRegistry({tenant:{assertPermission:vi.fn(),assertBranchAccess:vi.fn()},runtime:{reviseUnifiedDraft:revise}} as any);
  const state=newBusinessState(scope);state.workingActionId='a3000000-0000-4000-8000-000000000009';state.workingActionTool='erp_create_estimate';
  await expect(tools.execute('revise_pending_action',{changes:{hardwareRates:[{kind:'cloth',rate:999}],hardwarePricing:'catalog'}},scope,state,'اسی ڈرافٹ کی تفصیل دکھاؤ')).rejects.toMatchObject({code:'ERP_ACTION_CLARIFICATION'});
  expect(revise).not.toHaveBeenCalled();
 });
 it('does not treat a declined hardware price or a rate question as permission',()=>{
  expect(hardwareInstructions('ململ 50 روپے مت لگاؤ')).toEqual({hardwareRates:[]});expect(hardwareInstructions('سافٹ ویئر والے ریٹ مت لگاؤ')).not.toHaveProperty('hardwarePricing');expect(hardwareInstructions('ململ 50 روپے ہے؟')).toEqual({hardwareRates:[]});
 });
 it('applies a hardware follow-up directly to the retained draft without a provider round trip',async()=>{
  const f=fixture(),first=await f.ops.prepare('erp_create_estimate',f.input,scope);f.persist(first);
  const runtime={createUnifiedDraft:vi.fn(async(tool:any,input:any)=>{const action=await f.ops.prepare(tool,input,scope);return {draftId:'a3000000-0000-4000-8000-000000000009',preview:action.preview,requiresConfirmation:false};})};
  const tools=new ErpToolRegistry({tenant:{assertPermission:vi.fn(),assertBranchAccess:vi.fn()},runtime} as any);
  const model={respond:vi.fn(async()=>{throw Error('No model should be needed for supplied hardware prices');})};
  const state=newBusinessState(scope);state.workingActionId='a3000000-0000-4000-8000-000000000009';state.workingActionTool='erp_create_estimate';state.workingActionMode=DEMAND_SLIP_ESTIMATE;
  const result=await new UnifiedCopilotAgent(model,tools).run({message:'ململ 50 روپے اور دھاگہ 30 روپے لگا دو',conversationToken:writeBusinessState(state)},scope);
  expect(model.respond).not.toHaveBeenCalled();expect((result.review as any).preview.lines).toHaveLength(58);expect((result.review as any).preview.partialTotals.grand_total).toBe(8032);expect(result.requiresConfirmation).toBe(false);
 });
 it('saves the complete pending source draft through the scoped durable store, without executing a financial action',async()=>{
  const runtime=new CopilotRuntime({} as any,{} as any),inspect=vi.spyOn(runtime,'inspectUnifiedDraft').mockResolvedValue({tool:'erp_create_estimate',draftId:'draft',items:Array.from({length:58},()=>({name:'source row'}))} as any);
  const execute=vi.spyOn(runtime,'confirmAndExecute');
  const result=await runtime.saveDemandDraft('draft',scope);
  expect(inspect).toHaveBeenCalledWith('draft',scope);expect(result).toMatchObject({lineCount:58,saved:true,storage:'ai_copilot_actions',financialPosting:false});expect(execute).not.toHaveBeenCalled();
 });
 it('finishes the same 58-row estimate when the owner supplies all six hardware rates',async()=>{
  const f=fixture(),first=await f.ops.prepare('erp_create_estimate',f.input,scope);f.persist(first);
  const next=await f.ops.prepare('erp_amend_estimate',{draftId:'a3000000-0000-4000-8000-000000000009',...hardwareInstructions('ململ 50 روپے، دھاگہ 30 روپے، ٹیفلون ٹیپ 10 روپے، کنکشن پائپ 100 روپے، آری بلیڈ 20 روپے، بلیڈ 25 روپے لگا دو')},scope);
  expect(next.data.lines).toHaveLength(58);expect(next.data.unmatched_hardware_items).toHaveLength(0);expect(next.preview.incomplete).toBeUndefined();expect((next.preview.totals as any).grand_total).toBe(8922);
  await expect(f.ops.execute(next,scope,'not-a-financial-approval')).rejects.toMatchObject({code:'ERP_ACTION_CLARIFICATION'});
 });
 it('extracts the exact supplied name, full address and phone, with separate category discounts',()=>{
  expect(estimateCaptionChoices(prompt)).toEqual({customerName:'خالد محمود',customerAddress:'لیک سٹی 15 بی رائے ونڈ روڈ لاہور',customerPhone:'0315-409017'});
  expect(demandDiscounts(prompt)).toEqual([{match:'pipe',discount:50},{match:'fittings',discount:52}]);
 });
 it('prices 52 catalog rows and retains six hardware rows without searching/pricing them or halting',async()=>{
  const f=fixture(),a=await f.ops.prepare('erp_create_estimate',f.input,scope);
  expect(a.data.lines).toHaveLength(58);expect(a.data.unmatched_hardware_items).toHaveLength(6);expect(a.preview).toMatchObject({mode:DEMAND_SLIP_ESTIMATE,incomplete:true,partialTotals:{grand_total:7592}});
  expect(a.data.lines[0]).toMatchObject({unit_price:100,discountPercent:50});expect(a.data.lines[1]).toMatchObject({unit_price:200,discountPercent:52});
  expect(f.deps.search.searchProducts).not.toHaveBeenCalled();expect(f.deps.pricing.resolvePrice).toHaveBeenCalledTimes(52);
  expect(f.rpc).toHaveBeenCalledWith('commit_copilot_profile_action',expect.objectContaining({p_actor_user_id:scope.userId,p_tool:'erp_create_customer',p_payload:{name:'خالد محمود',address:'لیک سٹی 15 بی رائے ونڈ روڈ لاہور',phone:'0315-409017'}}));
  expect(a.preview.summary).toContain('کیا ان پر ہمارے سافٹ ویئر');expect(a.preview.summary).not.toContain('قیمتوں والی');
 });
 it('applies owner rates to exact hardware kinds, retaining all 58 quantities and keeping catalog prices unchanged',async()=>{
  const f=fixture(),first=await f.ops.prepare('erp_create_estimate',f.input,scope);f.persist(first);
  const next=await f.ops.prepare('erp_amend_estimate',{draftId:'a3000000-0000-4000-8000-000000000009',...hardwareInstructions('ململ 50 روپے اور دھاگہ 30 روپے لگا دو')},scope);
  expect(next.data.lines).toHaveLength(58);expect(next.data.lines.map((x:any)=>x.quantity)).toEqual(first.data.lines.map((x:any)=>x.quantity));
  expect(next.data.lines[52]).toMatchObject({unit_price:50,quantity:4,unit:'gaz',pricing_source:'OWNER_QUOTED',discountPercent:0});expect(next.data.lines[53]).toMatchObject({unit_price:30,quantity:8});
  expect((next.preview.partialTotals as any).grand_total).toBe(8032);expect(next.data.unmatched_hardware_items).toHaveLength(4);expect(f.rpc).toHaveBeenCalledTimes(1);
 });
 it('reads general hardware rates only after permission and keeps missing general rates pending',async()=>{
  const f=fixture(),first=await f.ops.prepare('erp_create_estimate',f.input,scope);f.persist(first);
  const next=await f.ops.prepare('erp_amend_estimate',{draftId:'a3000000-0000-4000-8000-000000000009',...hardwareInstructions('سافٹ ویئر والے ریٹ لگا دو')},scope);
  expect(next.data.lines).toHaveLength(58);expect(next.data.lines[52]).toMatchObject({unit_price:45,discountPercent:0});expect(next.data.unmatched_hardware_items).toHaveLength(5);
  expect(next.preview.summary).toContain('آپ کی اجازت سے');expect(next.preview.summary).not.toContain('کیا ان پر');
  expect(f.deps.search.searchProducts).toHaveBeenCalledWith('ململ',5,scope);
 });
 it('discards model-invented hardware permission and rates',async()=>{
  const prepare=vi.fn(async(..._args:any[])=>({}));const tools=new ErpToolRegistry({tenant:{assertPermission:vi.fn(),assertBranchAccess:vi.fn()},runtime:{createUnifiedDraft:prepare}} as any);
  await tools.execute('erp_create_estimate',{...fixture().input,hardwarePricing:'catalog',hardwareRates:[{kind:'cloth',rate:999}]},scope,undefined,prompt);
  expect(prepare.mock.calls[0]?.[1]).not.toHaveProperty('hardwareRates');expect(prepare.mock.calls[0]?.[1]).not.toHaveProperty('hardwarePricing');
 });
});
