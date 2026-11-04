import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execSync} from 'node:child_process';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);process.env.NODE_ENV='test';
try{execSync('npm run build --prefix backend',{stdio:'pipe'});}catch(e){process.stderr.write(e.stdout??'');process.stderr.write(e.stderr??'');throw Error('Production build failed');}
const load=p=>import(new URL('../backend/dist/'+p,import.meta.url));
const [{V2ToolConnector,V2_SCHEMAS,v2Definitions},{CopilotRuntime},{DefaultErpOperations},{estimateView},{CopilotOperationsRepository},{calculateTradeMargin}]=await Promise.all([
  load('ai-copilot/v2/tools.js'),load('ai-copilot/copilot.runtime.js'),load('ai-copilot/tools/operations.js'),load('repositories/estimate-browser.repository.js'),load('repositories/copilot-operations.repository.js'),load('ai-copilot/trade-math.js')]);
const {z}=await import('../backend/node_modules/zod/index.js');
for(const schema of Object.values(V2_SCHEMAS))assert.ok(z.toJSONSchema(schema));
assert.equal(new Set(v2Definitions([]).map(t=>t.name)).size,v2Definitions([]).length);
V2_SCHEMAS.record_customer_payment.parse({customerId:1,amount:100,paymentMethod:'CASH'});
V2_SCHEMAS.record_vendor_payment.parse({vendor_id:1,payment_date:'2026-11-04',amount:100,payment_method:'CASH',allocations:[{purchase_id:1,amount:100}]});
V2_SCHEMAS.manage_vendor_bill.parse({action:'draft',data:{vendor_id:1,warehouse_id:1,items:[{product_id:1,quantity:1,unit_cost:100}]}});
assert.equal(calculateTradeMargin({basis:'trade_discount',list_price:10000,purchase_discount_percent:50,sale_discount_percent:48,carriage:500,evidence:'10000 purchase 50 sale 48'}).gross_profit,200);
// Permanent receipts retain two-phase approval; their input schemas need no preview fields.
let posts=0;const paymentConversation={version:1,state:{},messages:[]};
const paymentTools=new V2ToolConnector({access:{assertPermission:async()=>{},assertBranchAccess:async()=>{}},runtime:{createUnifiedDraft:async(tool)=>({tool,draftId:'00000000-0000-4000-8000-000000000001',idempotencyKey:'receipt-smoke',preview:{totals:{grand_total:100}}}),confirmAndExecute:async()=>{posts++;return {status:'EXECUTED'};}},reads:{definitions:()=>[]}});
const receipt=await paymentTools.execute('record_customer_payment',{customerId:1,amount:100,paymentMethod:'CASH'},{userId:'test',organizationId:'test',branchId:'test'},paymentConversation,'Record receipt','Record receipt');
assert.equal(receipt.requiresConfirmation,true);assert.equal(posts,0);
const sameTurn=await paymentTools.execute('execute_prepared_action',{previewId:receipt.previewId,approvalEvidence:'approve'}, {},paymentConversation,'approve','approve');assert.equal(sameTurn.executed,false);assert.equal(posts,0);
paymentConversation.version=2;await paymentTools.execute('execute_prepared_action',{previewId:receipt.previewId,approvalEvidence:'approve'}, {},paymentConversation,'approve','approve',receipt.previewId);assert.equal(posts,1);
if(!process.env.ERP_SMOKE_ENV_FILE||!process.env.ERP_SMOKE_PG_MODULE||!process.env.ERP_SMOKE_CA_FILE)throw Error('Set ERP_SMOKE_ENV_FILE, ERP_SMOKE_PG_MODULE and ERP_SMOKE_CA_FILE for the rollback-only database smoke.');
const cfg=parseEnv(fs.readFileSync(process.env.ERP_SMOKE_ENV_FILE,'utf8'));
const dbUrl=new URL(cfg.DATABASE_URL),ref=new URL(cfg.SUPABASE_URL).hostname.split('.')[0];
assert.ok(decodeURIComponent(dbUrl.username).endsWith('.'+ref),'Database/API project identity');
const {Client,types}=(await import(pathToFileURL(process.env.ERP_SMOKE_PG_MODULE).href)).default;
types.setTypeParser(20,value=>{const n=Number(value);assert.ok(Number.isSafeInteger(n));return n;});
// Match PostgREST's exact timestamp strings; JS Date loses CAS microseconds.
types.setTypeParser(1184,value=>value);types.setTypeParser(1082,value=>value);
const client=new Client({connectionString:cfg.DATABASE_URL,connectionTimeoutMillis:30000,ssl:{rejectUnauthorized:true,ca:fs.readFileSync(process.env.ERP_SMOKE_CA_FILE,'utf8')}});
const migrationPath='supabase/migrations/20261104160000_copilot_direct_draft_save.sql';
const migration=fs.readFileSync(migrationPath,'utf8');
let rpcCalls=0;
// Adapt only the runtime's persisted action queries. All values are SQL parameters.
const database=()=>({from(table){
  assert.equal(table,'ai_copilot_actions');let fields='*',mode='select',payload,filters=[];
  const q={select(value='*'){fields=value;return q;},eq(key,value){assert.match(key,/^[a-z_]+$/);filters.push([key,value]);return q;},insert(value){mode='insert';payload=value;return q;},update(value){mode='update';payload=value;return q;}};
  const run=async()=>{try{
    assert.match(fields,/^(?:\*|[a-z_,]+)$/);const args=[];
    const param=value=>{args.push(value);return '$'+args.length;};
    let sql;
    if(mode==='insert'){const keys=Object.keys(payload);assert.ok(keys.every(k=>/^[a-z_]+$/.test(k)));sql=`insert into public.ai_copilot_actions (${keys.join(',')}) values (${keys.map(k=>param(payload[k])).join(',')}) returning ${fields}`;}
    else {const assignments=mode==='update'?Object.entries(payload).map(([k,v])=>{assert.match(k,/^[a-z_]+$/);return k+'='+param(v);}).join(','):'';const where=filters.map(([k,v])=>k+'='+param(v)).join(' and ');sql=mode==='update'?`update public.ai_copilot_actions set ${assignments} where ${where} returning ${fields}`:`select ${fields} from public.ai_copilot_actions where ${where||'true'}`;}
    const result=await client.query(sql,args);return {data:result.rows[0]??null,error:null};
  }catch(error){return {data:null,error};}};
  return Object.assign(q,{single:run,maybeSingle:run,then:(resolve,reject)=>run().then(resolve,reject)});
},async rpc(name,args){assert.equal(name,'save_copilot_demand_estimate');rpcCalls++;try{const {rows}=await client.query('select public.save_copilot_demand_estimate($1,$2,$3,$4) data',[args.p_organization_id,args.p_branch_id,args.p_actor_user_id,args.p_action_id]);return {data:rows[0].data,error:null};}catch(error){console.error(JSON.stringify({rpc:name,code:error.code,message:error.message}));return {data:null,error};}}});
try{
  await client.connect();await client.query("begin; set local lock_timeout='5s'; set local statement_timeout='90s'; select pg_advisory_xact_lock(hashtext('muraderp-copilot-direct-draft-save'))");
  const applied=await client.query("select 1 from supabase_migrations.schema_migrations where version='20261104160000'");
  if(!applied.rowCount){
    const live=await client.query("select pg_get_functiondef('public.save_copilot_demand_estimate(uuid,uuid,uuid,uuid)'::regprocedure) sql");
    const expected=migration.match(/previous SHA-256: ([a-f0-9]+)/)[1];
    assert.equal(createHash('sha256').update(live.rows[0].sql).digest('hex'),expected,'Audited live function changed; do not overwrite it');
    const profile=await client.query("select pg_get_functiondef('public.commit_copilot_profile_action(uuid,uuid,uuid,text,text,text,jsonb)'::regprocedure) sql");
    assert.equal(createHash('sha256').update(profile.rows[0].sql).digest('hex'),migration.match(/Profile SHA-256: ([a-f0-9]+)/)[1],'Audited profile handler changed; do not overwrite it');
    await client.query(migration.replace(/^begin;$/gm,'').replace(/^commit;$/gm,''));
  }
  await client.query('savepoint smoke_records');
  const selected=await client.query("select m.user_id,e.organization_id,e.branch_id,e.customer_id from public.estimates e join public.organization_memberships m on m.organization_id=e.organization_id where e.estimate_number='EST-1069' and m.status='active' and public.has_permission_for_user(m.user_id,e.organization_id,'customers.write') and public.has_permission_for_user(m.user_id,e.organization_id,'sales.create') and public.has_branch_access_for_user(m.user_id,e.organization_id,e.branch_id) limit 1");
  assert.equal(selected.rowCount,1,'Authorized existing business scope');
  const {customer_id:customerId,...scope}=selected.rows[0];scope.userId=scope.user_id;scope.organizationId=scope.organization_id;scope.branchId=scope.branch_id;
  const permission=async(_scope,p)=>{const r=await client.query('select public.has_permission_for_user($1,$2,$3) ok',[scope.userId,scope.organizationId,p]);assert.equal(r.rows[0].ok,true);};
  const access={assertPermission:permission,assertBranchAccess:async()=>{}};
  const get=async(table,id)=>{assert.ok(['customers','vendors','warehouses','products'].includes(table));return (await client.query(`select * from public.${table} where id=$1 and organization_id=$2`,[id,scope.organizationId])).rows[0]??null;};
  const erp={getCustomer:id=>get('customers',id),getVendor:id=>get('vendors',id),getWarehouse:id=>get('warehouses',id),getProduct:id=>get('products',id)};
  const memory={recall:async()=>({history:[],preferredBrands:[],transactionCount:0}),assertFloor:async()=>{}};
  const operations=new DefaultErpOperations({database,erp,verifiedPreferencesOnly:true,principal:cfg.INTERNAL_API_PRINCIPAL_ID,memory,search:{searchCustomers:async()=>({resolution:'no_match',items:[]})}});
  const runtime=new CopilotRuntime(erp,{database,operations,authorization:{assertPermission:async(_user,_org,p)=>permission(scope,p)},branchAccess:access,references:{assertOwnedReferences:async()=>{}}},undefined,{verifiedPreferencesOnly:true});
  const estimates={async get(_org,_branch,reference){const h=(await client.query('select e.*,c.name customer_name,c.name from public.estimates e join public.customers c on c.id=e.customer_id where e.id=$1 and e.organization_id=$2 and e.branch_id=$3',[Number(reference),scope.organizationId,scope.branchId])).rows[0];if(!h)return null;const lines=(await client.query('select * from public.estimate_items where estimate_id=$1 order by line_number',[h.id])).rows;return estimateView({...h,customers:{name:h.customer_name}},lines);},async patch(_org,_branch,_actor,id,changes){await client.query('select public.update_estimate_scoped($1,$2,$3,$4,$5)',[scope.organizationId,scope.branchId,scope.userId,id,changes]);}};
  const connector=new V2ToolConnector({runtime,estimates,access,erp,store:{},reads:{definitions:()=>[]},pricing:{resolvePrice:async()=>null}});
  const conversation={version:1,state:{},messages:[]};
  const items=[...Array.from({length:13},(_,i)=>({name:'Rollback smoke item '+i,qty:1,rate:100+i})),{name:'Solution',qty:1,rate:1100},{name:'Tape',qty:1,rate:30},{name:'Blade',qty:1,rate:100}];
  const expectedTotal=items.reduce((sum,item)=>sum+item.qty*item.rate,0);
  const beforeRpc=rpcCalls;
  const created=await connector.execute('manage_estimate',{action:'create',data:{customerId,items,carriageCharges:75}},scope,conversation,'Create all sixteen draft items: Solution 1100, Tape 30, Blade 100.','Create all sixteen draft items: Solution 1100, Tape 30, Blade 100.');
  assert.equal(rpcCalls-beforeRpc,1,'One atomic draft-save RPC in one tool call');assert.equal(created.saved,true);assert.equal(created.requiresConfirmation,false);assert.ok(created.estimate_id);assert.ok(created.estimate_number);assert.equal(created.item_count,16);assert.equal(created.grand_total,expectedTotal);assert.equal(created.customer_payable_total,expectedTotal+75);assert.equal(conversation.pending,undefined);
  const appended=await connector.execute('manage_estimate',{action:'update',data:{changes:{appendLines:[{name:'Pending adapter',quantity:2,unit:'pcs',list_price:null}]}}},scope,conversation,'Append two adapters, rate pending','Append two adapters, rate pending');assert.equal(appended.item_count,17);assert.equal(appended.pending_count,1);
  const updated=await connector.execute('manage_estimate',{action:'update',data:{changes:{updateLines:[{lineNumber:17,changes:{list_price:45}}]}}},scope,conversation,'Adapter rate 45','Adapter rate 45');assert.equal(updated.estimate_id,created.estimate_id);assert.equal(updated.pending_count,0);assert.equal(updated.grand_total,expectedTotal+90);
  const newCustomer=await connector.execute('manage_estimate',{action:'create',data:{customerName:'ROLLBACK ONLY autonomy customer',items:[{name:'Pending unknown',qty:1,rate:null}]}},scope,conversation,'Create a new customer estimate with one pending item','Create a new customer estimate with one pending item');assert.equal(newCustomer.saved,true);assert.equal(newCustomer.pending_count,1);
  const profile=await client.query('select count(*)::int n from public.customers where organization_id=$1 and name=$2',[scope.organizationId,'ROLLBACK ONLY autonomy customer']);assert.equal(profile.rows[0].n,1,'Customer and estimate saved in same transaction through existing profile engine');
  const nativeVendor=(await client.query('select id from public.vendors where organization_id=$1 limit 1',[scope.organizationId])).rows[0];const product=(await client.query('select id from public.products where organization_id=$1 limit 1',[scope.organizationId])).rows[0];const warehouse=(await client.query('select id from public.warehouses where organization_id=$1 limit 1',[scope.organizationId])).rows[0];
  const bill=await connector.execute('manage_vendor_bill',{action:'draft',data:{vendor_id:nativeVendor.id,warehouse_id:warehouse.id,items:[{product_id:product.id,quantity:1,unit_cost:100}]}},scope,conversation,'Save supplier bill draft','Save supplier bill draft');assert.equal(bill.saved,true);assert.equal(bill.financialPosting,false);assert.equal(bill.requiresConfirmation,false);
  // Exercise all retrieval contracts through the real Supabase query surface without reading secrets into output.
  const readCalls=[];const fakeRepo=new CopilotOperationsRepository(()=>({from(table){const q={};for(const method of ['select','eq','in','order','range'])q[method]=(...args)=>{readCalls.push([table,method,...args]);return q;};q.then=resolve=>Promise.resolve({data:[],error:null}).then(resolve);return q;}}));await fakeRepo.search(scope,{kind:'all',limit:10});for(const table of ['estimates','invoices','credit_notes','customer_payments','vendor_payments','stock_movements'])assert.ok(readCalls.some(c=>c[0]===table&&c[1]==='order'&&c[2]==='created_at'&&c[3].ascending===false));
  const report={tools:Object.keys(V2_SCHEMAS),reused:['manage_estimate','manage_invoice','manage_credit_memo','manage_customer','manage_vendor_bill','analyze_profit_margin'],aliases:['record_customer_payment','record_vendor_payment','query_erp_records'],directSave:{passed:true,toolCalls:1,atomicSaveCalls:1,itemCount:16,returnedAssignedId:true,total:expectedTotal,manualRates:{Solution:1100,Tape:30,Blade:100},sameEstimateAppendAndRateUpdate:true,pendingDraftSaved:true,newCustomerAtomic:true},paymentAndVendorBillSchemas:'passed',nonpostedBillDraft:'saved without confirmation',finalFinancialApproval:'retained',build:'passed',databaseFixtures:'rolled back',migration:'20261104160000'};
  await client.query('rollback to savepoint smoke_records');
  if(!applied.rowCount)await client.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)',['20261104160000','copilot_direct_draft_save',[migration]]);
  await client.query('commit');fs.writeFileSync(path.join(root,'docs/copilot-autonomy-audit.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){await client.query('rollback').catch(()=>{});throw error;}finally{await client.end();}

