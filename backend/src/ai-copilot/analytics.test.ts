import { describe,it,expect,vi } from "vitest";
import { CopilotAnalytics,analyticsPeriod,karachiDate,analyticsAnswer } from "./analytics.js";
import { fixture,scope,call,final } from "./agent/stateful.test-fixtures.js";
import { ErpToolRegistry } from "./agent/erp-tools.js";
import { UnifiedCopilotAgent } from "./agent/agent.js";
import { ApiError } from "../errors/api-error.js";
type Row=Record<string,any>;
function database(seed:Record<string,Row[]>){
  const calls:Row[]=[],failed=new Set<string>();
  const tables=Object.fromEntries(Object.entries(seed).map(([table,rows])=>[table,rows.map(row=>({organization_id:scope.organizationId,branch_id:scope.branchId,...row,...(table==="invoice_items"?{invoices:{organization_id:scope.organizationId,branch_id:scope.branchId}}:{})}))]));
  const from=(table:string)=>{
    const filters:Array<(row:Row)=>boolean>=[];let head=false;
    const get=(row:Row,key:string)=>key.split(".").reduce((value,key)=>value?.[key],row);
    const result=(start=0,end=999999)=>{const data=(tables[table]??[]).filter(row=>filters.every(filter=>filter(row)));return {data:head?null:data.slice(start,end+1),count:data.length,error:failed.has(table)?{message:"unavailable"}:null};};
    const query:any={select:(_s:string,options?:{head?:boolean})=>{head=options?.head??false;return query;},
      eq:(key:string,value:unknown)=>{calls.push({table,key,value});filters.push(row=>get(row,key)===value);return query;},
      gt:(key:string,value:unknown)=>{filters.push(row=>get(row,key)>value!);return query;},
      gte:(key:string,value:unknown)=>{filters.push(row=>get(row,key)>=value!);return query;},
      lte:(key:string,value:unknown)=>{filters.push(row=>get(row,key)<=value!);return query;},
      in:(key:string,values:unknown[])=>{filters.push(row=>values.includes(get(row,key)));return query;},
      order:()=>query,range:async(start:number,end:number)=>result(start,end),then:(resolve:any,reject:any)=>Promise.resolve(result()).then(resolve,reject)};
    return query;
  };
  return {store:new CopilotAnalytics(()=>({from}),()=>new Date("2026-10-22T10:00:00Z")),calls,failed};
}
const invoice={id:1,customer_id:1,salesperson_id:5,issue_date:"2026-10-10",status:"POSTED",currency_code:"PKR",subtotal:100,discount_total:10,grand_total:90};
const ledger=(id:number,code:string,debit:number,credit:number,date="2026-10-10",source_type="SALE")=>({id,journal_entry_id:String(id),account_id:id,entry_date:date,code,debit,credit,source_type});
describe("authoritative Copilot analytics",()=>{
  it("resolves Karachi calendar periods and requires ordered bounded custom dates",()=>{
    expect(karachiDate(new Date("2026-10-31T20:00:00Z"))).toBe("2026-11-01");
    expect(analyticsPeriod({period:"last_month"},"2026-01-03")).toEqual({from:"2025-12-01",to:"2025-12-31"});
    expect(analyticsPeriod({period:"year"},"2026-10-22")).toEqual({from:"2026-01-01",to:"2026-10-22"});
    expect(()=>analyticsPeriod({period:"custom"},"2026-10-22")).toThrow();
    expect(()=>analyticsPeriod({period:"custom",startDate:"2026-10-25",endDate:"2026-10-01"},"2026-10-22")).toThrow();
  });
  it("reconciles posted revenue/COGS/expenses including return reversals and excludes other branches",async()=>{
    const f=database({accounts:[{code:"4000",account_type:"REVENUE"},{code:"5000",account_type:"EXPENSE"},{code:"6000",account_type:"EXPENSE"}],general_ledger:[ledger(1,"4000",0,1000.1),ledger(2,"5000",600.05,0),ledger(3,"6000",100,0),ledger(4,"4000",100,0,"2026-10-12","CREDIT_NOTE"),ledger(5,"5000",0,60,"2026-10-12","CREDIT_NOTE"),{...ledger(6,"4000",0,999999),branch_id:"foreign"}]});
    const result=await f.store.read("erp_get_profit_summary",{period:"this_month"},scope);
    expect(result.metrics).toMatchObject({revenue:"900.1000",cogs:"540.0500",grossProfit:"360.0500",operatingExpenses:"100.0000",netProfit:"260.0500"});
    expect(analyticsAnswer(result,"اس مہینے کا پرافٹ کتنا ہے")).toContain("خالص منافع: 260.0500");
    expect(analyticsAnswer(result,"What is this month's profit?")).toContain("Net profit: 260.0500");
  });
  it("counts cash only, includes opening balance and excludes banks",async()=>{
    const f=database({general_ledger:[ledger(1,"1000",100,0,"2026-10-01"),ledger(2,"1000",50,0,"2026-10-22","CUSTOMER_PAYMENT"),ledger(3,"1000",0,20,"2026-10-22","EXPENSE"),ledger(4,"1010",999,0,"2026-10-22")]});
    expect((await f.store.read("erp_get_daily_cash_summary",{},scope)).metrics).toMatchObject({cashIn:"50.0000",cashOut:"20.0000",openingBalance:"100.0000",closingBalance:"130.0000",salesCounterCollections:"50.0000"});
  });
  it("ranks net customer sales after returns and keeps currency balances separate",async()=>{
    const f=database({customers:[{id:1,name:"Arslan"},{id:2,name:"Qasim"}],invoices:[invoice,{...invoice,id:2,customer_id:2,grand_total:100},{...invoice,id:3,currency_code:"USD",grand_total:20},{...invoice,id:4,status:"DRAFT",grand_total:1000000}],credit_notes:[{id:1,customer_id:2,invoice_id:2,status:"POSTED",credit_date:"2026-10-20",currency_code:"PKR",grand_total:50}],customer_ledger_entries:[{id:1,customer_id:1,currency_code:"PKR",debit:200,credit:40,entry_date:"2026-09-01"},{id:2,customer_id:1,currency_code:"USD",debit:20,credit:1,entry_date:"2026-10-10"}]});
    const report=await f.store.read("erp_get_top_customers",{period:"this_month",limit:1},scope);
    expect(report.rows).toHaveLength(2);expect(report.rows[0]).toMatchObject({name:"Arslan",currency:"PKR",salesVolume:"90.0000",outstanding:"160.0000"});expect(report.rows[1]).toMatchObject({currency:"USD",outstanding:"19.0000"});
  });
  it("does not invent a salesman for invoices without attribution",async()=>{
    const f=database({invoices:[invoice,{...invoice,id:2,salesperson_id:null,grand_total:100}],salespeople:[{id:5,name:"Ali"}]});
    const report=await f.store.read("erp_get_top_salesmen",{period:"this_month",limit:5},scope);
    expect(report.rows[0]).toMatchObject({name:"Unassigned",salespersonId:null,revenue:"100.0000"});expect(report.rows[1]).toMatchObject({name:"Ali",revenue:"90.0000"});
  });
  it("uses historical discounts and return COGS without discounting already-net lines twice",async()=>{
    const f=database({invoices:[invoice,{...invoice,id:2,grand_total:80}],invoice_items:[{id:11,invoice_id:1,product_id:4,quantity:1,unit:"pcs",line_total:100,customer_discount_amount:10,cogs_total:50},{id:12,invoice_id:2,product_id:5,quantity:1,unit:"pcs",line_total:80,cogs_total:40}],credit_notes:[{id:1,invoice_id:1,customer_id:1,status:"POSTED",credit_date:"2026-10-12",currency_code:"PKR",grand_total:9}],credit_note_items:[{id:9,credit_note_id:1,product_id:4,quantity:0.1,unit:"pcs",line_total:9,cogs_reversal_total:5}],products:[{id:4,name:"Dura Elbow"},{id:5,name:"Dura Pipe"}]});
    const report=await f.store.read("erp_get_top_profitable_products",{period:"this_month"},scope);
    expect(report.rows.find(row=>row.productId===4)).toMatchObject({revenue:"81.0000",cogs:"45.0000",grossProfit:"36.0000",quantity:0.9});
    expect(report.rows.find(row=>row.productId===5)).toMatchObject({revenue:"80.0000",grossProfit:"40.0000"});
    expect(f.calls.some(call=>call.table==="invoice_items"&&call.key==="invoices.organization_id")).toBe(true);
  });
  it("excludes missing historical costs instead of inventing zero cost profit",async()=>{
    const f=database({invoices:[invoice],invoice_items:[{id:1,invoice_id:1,product_id:4,quantity:1,unit:"pcs",line_total:100,cogs_total:null}],products:[{id:4,name:"Unknown cost"}]});
    const report=await f.store.read("erp_get_top_profitable_products",{},scope);expect(report.rows).toEqual([]);expect(report.metrics.missingHistoricalCost).toBe(1);
  });
  it("nets vendor returns, excludes payments from purchase volume and reads current payables",async()=>{
    const f=database({vendors:[{id:7,name:"Dura wholesaler"}],purchases:[{id:1,vendor_id:7,total:100,purchase_date:"2026-10-05"}],vendor_payable_ledger_entries:[{id:1,vendor_id:7,debit:0,credit:100,entry_type:"PURCHASE",entry_date:"2026-10-05"},{id:2,vendor_id:7,debit:10,credit:0,entry_type:"PURCHASE_RETURN",entry_date:"2026-10-06"},{id:3,vendor_id:7,debit:40,credit:0,entry_type:"PAYMENT",entry_date:"2026-10-10"}]});
    expect((await f.store.read("erp_get_top_vendors",{},scope)).rows[0]).toMatchObject({purchaseVolume:"90.0000",outstanding:"50.0000"});
  });
  it("uses all warehouse movement types for slow stock rather than recent sales alone",async()=>{
    const f=database({products:[{id:1,name:"Old",unit:"pcs",created_at:"2026-01-01T00:00:00Z"},{id:2,name:"Transfer",unit:"pcs",created_at:"2026-01-01T00:00:00Z"},{id:3,name:"New",unit:"pcs",created_at:"2026-10-21T00:00:00Z"}],inventory:[{id:1,product_id:1,quantity:4},{id:2,product_id:2,quantity:6},{id:3,product_id:3,quantity:2}],stock_movements:[{id:1,product_id:2,created_at:"2026-10-20T00:00:00Z",movement_type:"TRANSFER_IN"}]});
    const report=await f.store.read("erp_get_slow_moving_stock",{thresholdDays:60},scope);expect(report.rows.map(row=>row.productId)).toEqual([1]);
    expect(f.calls.filter(call=>call.table==="inventory").some(call=>call.key==="branch_id")).toBe(false);
  });
  it("uses exact product counts and paginates before computing totals or rankings",async()=>{
    const f=database({products:Array.from({length:1001},(_,id)=>({id})),inventory:[{id:1,product_id:1,quantity:1},{id:2,product_id:1,quantity:2}],customers:[{id:1,name:"Arslan"}],invoices:Array.from({length:1001},(_,id)=>({...invoice,id,grand_total:1}))});
    expect((await f.store.read("erp_get_inventory_summary",{},scope)).metrics).toEqual({productCount:1001,productsWithStock:1});
    expect((await f.store.read("erp_get_top_customers",{},scope)).rows[0]?.salesVolume).toBe("1001.0000");
  });
  it("fails a source error without substituting a zero total",async()=>{
    const f=database({});f.failed.add("general_ledger");await expect(f.store.read("erp_get_profit_summary",{},scope)).rejects.toMatchObject({code:"ANALYTICS_READ_FAILED"});
  });
});
describe("native analytics tools",()=>{
  it("checks branch and accounting permissions before reading",async()=>{
    const f=fixture(),read=vi.fn();vi.mocked(f.services.tenant.assertPermission).mockRejectedValue(new ApiError(403,"FORBIDDEN","Denied"));
    const tools=new ErpToolRegistry({...f.services,analytics:{read}});
    await expect(tools.execute("erp_get_profit_summary",{period:"this_month"},scope)).rejects.toMatchObject({status:403});expect(read).not.toHaveBeenCalled();
  });
  it("rejects tool-injected tenant identifiers and invalid limits",async()=>{
    const f=fixture(),read=vi.fn(),tools=new ErpToolRegistry({...f.services,analytics:{read}});
    for(const raw of [{limit:51},{limit:5,organizationId:"foreign"}])await expect(tools.execute("erp_get_top_customers",raw,scope)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
  it("returns verified monthly numbers even when the model's final wording invents totals",async()=>{
    const f=fixture(),report={analytics:true as const,tool:"erp_get_profit_summary" as const,period:{from:"2026-10-01",to:"2026-10-22"},rows:[],metrics:{currency:"PKR",revenue:"100.0000",cogs:"60.0000",grossProfit:"40.0000",operatingExpenses:"10.0000",netProfit:"30.0000"},notes:[]};
    const read=vi.fn(async()=>report),tools=new ErpToolRegistry({...f.services,analytics:{read}}),agent=new UnifiedCopilotAgent({respond:f.respond},tools);
    f.script(call("erp_get_profit_summary",{period:"this_month"}),final("Profit is 999999"));
    const result=await agent.run({message:"اس مہینے کا پرافٹ کتنا ہے"},scope);
    expect(result).toMatchObject({status:"completed",requiresConfirmation:false,toolNames:["erp_get_profit_summary"]});expect(result.answer).toContain("خالص منافع: 30.0000");expect(result.answer).not.toContain("999999");expect(f.erpWrite).not.toHaveBeenCalled();
  });
});
