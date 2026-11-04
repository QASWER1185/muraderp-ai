import assert from 'node:assert/strict';
import {execSync} from 'node:child_process';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);process.env.NODE_ENV='test';
// One verification entry point. Compile production code; do not run legacy suites.
try{execSync('npm run build --prefix backend',{stdio:'pipe'});}catch(e){process.stderr.write(e.stdout??'');process.stderr.write(e.stderr??'');throw Error('Production build failed');}
const load=p=>import(new URL('../backend/dist/'+p,import.meta.url));
const [{V2ToolConnector,V2_SCHEMAS,v2Definitions,readNames},{ERP_ACTION_SCHEMAS},{calculateTradeMargin,customerDocument},
  {DefaultEstimateProfitService},{DefaultErpOperations},{CustomerMemoryStore},{ANALYTICS_SCHEMAS},{ERP_TOOLS},{BUSINESS_READ_SCHEMAS}]=await Promise.all([
  load('ai-copilot/v2/tools.js'),load('ai-copilot/tools/registry.js'),load('ai-copilot/trade-math.js'),load('services/estimate-profit.service.js'),
  load('ai-copilot/tools/operations.js'),load('ai-copilot/customerMemoryStore.js'),load('ai-copilot/analytics.js'),load('ai-copilot/agent/erp-tools.js'),load('ai-copilot/agent/business-tools.js')]);
const {z}=await import('../backend/node_modules/zod/index.js');
const scope={userId:'user',organizationId:'org',branchId:'branch'};
const added=new Set(['convert_estimate_to_invoice','manage_credit_memo','manage_vendor_bill','manage_vendor_payment','manage_customer_payment','manage_customer','manage_inventory','manage_rate_list','analyze_profit_margin','query_erp_analytics']);
const audits=[...Object.keys(V2_SCHEMAS).map(name=>({name,registry:'v2',status:added.has(name)?'added adapter to native engine':'reused/extended'})),
  ...Object.keys(ERP_ACTION_SCHEMAS).map(name=>({name,registry:'native actions',status:name==='erp_record_vendor_bill'?'added connector to recordPurchase':'reused'})),
  ...ERP_TOOLS.map(t=>({name:t.name,registry:'legacy ERP',status:'reused'})),
  ...Object.keys(BUSINESS_READ_SCHEMAS).map(name=>({name,registry:'business reads',status:'reused'})),
  ...Object.keys(ANALYTICS_SCHEMAS).map(name=>({name,registry:'analytics',status:'reused'}))];
for(const [name,schema] of Object.entries({...V2_SCHEMAS,...ERP_ACTION_SCHEMAS,...ANALYTICS_SCHEMAS}))assert.ok(z.toJSONSchema(schema),'JSON schema: '+name);
const defs=v2Definitions([...ERP_TOOLS.filter(t=>readNames.has(t.name)).map(t=>({name:t.name,parameters:z.toJSONSchema(t.schema)}))]);
assert.equal(new Set(defs.map(d=>d.name)).size,defs.length,'No duplicate registered v2 names');
assert.ok(!defs.some(d=>d.name==='erp_record_vendor_bill'),'Native writes are not accidentally exposed as read tools');
V2_SCHEMAS.manage_credit_memo.parse({action:'create',data:{customerId:3,productId:8,qty:1,reason:'Returned unused material'}});
V2_SCHEMAS.convert_estimate_to_invoice.parse({estimateId:1069});
V2_SCHEMAS.manage_customer_payment.parse({customerId:3,amount:500,paymentMethod:'CASH'});
V2_SCHEMAS.manage_customer.parse({action:'create',data:{name:'Owais'}});
const lines=Array.from({length:500},(_,i)=>({name:'Freeform '+i,qty:1,rate:null,ratePending:true}));
V2_SCHEMAS.manage_estimate.parse({action:'create',data:{customerName:'Owais',items:lines}});
const margin=calculateTradeMargin({basis:'trade_discount',list_price:10000,purchase_discount_percent:50,sale_discount_percent:48,evidence:'10000 purchase 50 sale 48',carriage:700});
assert.equal(margin.gross_profit,200);assert.equal(margin.net_profit_before_operating_expenses,200);assert.equal(margin.customer_payable,5900);
assert.equal(calculateTradeMargin({basis:'cost',sale_price:250,cost_price:200,evidence:'tape bought 200 sold 250',carriage:100}).gross_profit,50);
assert.equal(calculateTradeMargin({basis:'cost',sale_price:150,cost_price:200,evidence:'loss scenario'}).gross_profit,-50);
const existingMath=await new DefaultEstimateProfitService({resolveEstimatedCost:async()=>5000}).analyze([{line_number:1,product_id:8,quantity:1,unit_price:10000,discount_amount:4800,unit:'pcs',pricing_source:'RESOLVED_RATE'}],new Date().toISOString());
assert.equal(existingMath.expected_profit,200,'Existing estimate math must also honor sale discount');
assert.deepEqual(customerDocument({privateMargin:{grossProfit:2},lines:[{unitCost:5,merchantUnitCost:5,unit_price:10,pricing_provenance:{unit_cost:5}}]}),{lines:[{unit_price:10,pricing_provenance:{}}]});
let calls=[];const c={version:1,state:{},messages:[]};
const deps={access:{assertBranchAccess:async()=>{},assertPermission:async(_s,p)=>calls.push(['permission',p])},
  runtime:{createUnifiedDraft:async(tool,data)=>{calls.push([tool,data]);return {tool,draftId:'00000000-0000-4000-8000-000000000001',idempotencyKey:'smoke',preview:{totals:{grand_total:100},privateMargin:{cost:1}}};},confirmAndExecute:async()=>({status:'EXECUTED',invoice_id:11}),createFinancialDraft:async(data)=>{calls.push(['financial',data]);return {id:'00000000-0000-4000-8000-000000000001'};}},
  reads:{definitions:()=>[],execute:async(tool,data)=>{calls.push(['read',tool,data]);return {authoritative:true};}},store:{},estimates:{},erp:{}};
const tools=new V2ToolConnector(deps);
const large=await tools.execute('manage_estimate',{action:'create',data:{customerName:'Owais',items:lines}},scope,c,'draft','draft');
assert.ok(calls.some(x=>x[0]==='erp_create_estimate'&&x[1].items.length===500));
assert.equal(large.preview.privateMargin,undefined);
await tools.execute('convert_estimate_to_invoice',{estimateId:1069},scope,c,'convert','convert');
assert.equal(calls.find(x=>x[0]==='erp_convert_estimate_to_invoice')[1].estimateId,1069);assert.equal(c.pending.financial,true);
c.version=2;const pending=c.pending.id;
const final=await tools.execute('manage_invoice',{action:'finalize',data:{previewId:pending,approvalEvidence:'approved'}},scope,c,'approved','approved',pending);
assert.equal(final.verified,true);
await tools.execute('manage_credit_memo',{action:'create',data:{customerId:3,productId:8,qty:1,reason:'unused'}},scope,c,'return','return');assert.ok(calls.some(x=>x[0]==='erp_customer_return'));
await tools.execute('manage_customer_payment',{customerId:3,amount:500,paymentMethod:'CASH'},scope,c,'receipt','receipt');assert.ok(calls.some(x=>x[0]==='erp_record_payment'));
await tools.execute('manage_vendor_payment',{vendor_id:2,payment_date:'2026-11-04',amount:100,payment_method:'CASH',allocations:[{purchase_id:5,amount:100}]},scope,c,'pay','pay');assert.equal(c.pending.financial,true);
const nativePurchase={vendor_id:2,warehouse_id:1,items:[{product_id:8,quantity:2,list_price:10000,purchase_discount_percent:50}],discount:200};
await tools.execute('manage_vendor_bill',{action:'create',data:nativePurchase},scope,c,'bill','bill');assert.ok(calls.some(x=>x[0]==='erp_record_vendor_bill'));assert.equal(c.pending.financial,true);
const ops=new DefaultErpOperations({database:()=>{throw Error('Unexpected database write in preparation');},erp:{getVendor:async()=>({id:2,name:'Supplier'}),getWarehouse:async()=>({id:1}),getProduct:async()=>({id:8,unit:'pcs'})}});
const bill=await ops.prepare('erp_record_vendor_bill',nativePurchase,scope);
assert.equal(bill.data.purchase.items[0].unit_cost,5000);assert.equal(bill.data.totals.grand_total,9800);
const customer=await ops.prepare('erp_create_customer',{name:'Owais',phone:null,address:null},scope);assert.equal(customer.input.phone,'');assert.equal(customer.input.address,'');
const history=[{document_id:1,source_item_id:10,invoice_date:'2026-11-04',net_unit_price:100,unit:'pcs',currency_code:'PKR'},{document_id:2,source_item_id:20,invoice_date:'2026-10-01',net_unit_price:100,unit:'pcs',currency_code:'PKR'}];
const memory=new CustomerMemoryStore(()=>({from:table=>{const q={};for(const m of ['select','eq','in','order','range'])q[m]=()=>q;q.then=resolve=>Promise.resolve({data:table==='invoices'?[{id:1,created_at:'2026-10-01'},{id:2,created_at:'2026-11-04'}]:history,error:null}).then(resolve);return q;}}));
assert.equal((await memory.latestSale(scope,3,8)).document_id,2,'Return source uses created_at, not issue_date');
const {CopilotOperationsRepository}=await load('repositories/copilot-operations.repository.js');
const searchCalls=[];
const repo=new CopilotOperationsRepository(()=>({from:table=>{
  const q={};for(const method of ['select','eq','in','order','range'])q[method]=(...args)=>{searchCalls.push([table,method,...args]);return q;};
  q.then=resolve=>Promise.resolve({error:null,data:table==='invoices'?[{id:2,customer_id:3,invoice_number:'INV-2',created_at:'2026-11-04',grand_total:500}]:table==='customers'?[{id:3,name:'Owais'}]:table==='invoice_items'?[{id:9,invoice_id:2,product_id:8,quantity:1,products:{name:'DURAFLOW conduit'}}]:table==='vendor_payable_ledger_entries'?[{debit:100,credit:500}]:[]}).then(resolve);return q;
}}));
const search=await repo.search(scope,{kind:'invoices',query:'Owais conduit',limit:1});
assert.equal(search.data[0].number,'INV-2');
assert.ok(searchCalls.some(x=>x[0]==='invoices'&&x[1]==='order'&&x[2]==='created_at'&&x[3].ascending===false));
assert.ok(searchCalls.some(x=>x[0]==='invoices'&&x[1]==='eq'&&x[2]==='organization_id'&&x[3]===scope.organizationId));
assert.ok(searchCalls.some(x=>x[0]==='invoices'&&x[1]==='eq'&&x[2]==='branch_id'&&x[3]===scope.branchId));
assert.equal((await repo.vendorLedger(scope,2,10)).outstanding_balance,400);
const report={registeredTools:audits,verification:{build:'passed',schemas:'passed',tradeProfitPKR:200,costProfitPKR:50,carriageExcluded:true,largeSlipLines:500,conversion:'reuses native handler',creditMemo:'reuses historical return engine',customerPayment:'reuses receipt engine',supplierBill:'reuses recordPurchase',returnOrdering:'created_at DESC',customerCostRedaction:'passed'},liveWritesPerformed:false};
fs.mkdirSync(path.join(root,'docs'),{recursive:true});fs.writeFileSync(path.join(root,'docs/copilot-full-suite-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
