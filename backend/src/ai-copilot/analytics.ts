import { z } from "zod";
import { ApiError } from "../errors/api-error.js";
import type { PermissionCode } from "../auth/authorization.types.js";
import type { AgentScope } from "./agent/erp-tools.js";
import { isEnglishRequest } from "./agent/language.js";

const limit=z.number().int().min(1).max(50).default(10);
const period=z.enum(["this_month","year"]).default("this_month");
export const ANALYTICS_SCHEMAS={
  erp_get_profit_summary:z.strictObject({period:z.enum(["this_month","last_month","custom"]).default("this_month"),startDate:z.iso.date().optional(),endDate:z.iso.date().optional()}),
  erp_get_top_customers:z.strictObject({period,limit}),
  erp_get_top_salesmen:z.strictObject({period,limit}),
  erp_get_top_profitable_products:z.strictObject({period:z.literal("this_month").default("this_month"),limit}),
  erp_get_top_vendors:z.strictObject({period,limit}),
  erp_get_daily_cash_summary:z.strictObject({date:z.iso.date().optional()}),
  erp_get_slow_moving_stock:z.strictObject({thresholdDays:z.number().int().min(1).max(3650).default(60)}),
  erp_get_inventory_summary:z.strictObject({}),
};
export type AnalyticsTool=keyof typeof ANALYTICS_SCHEMAS;
export const isAnalyticsTool=(name:string):name is AnalyticsTool=>Object.hasOwn(ANALYTICS_SCHEMAS,name);
export const ANALYTICS_PERMISSIONS:Record<AnalyticsTool,PermissionCode[]>={
  erp_get_profit_summary:["reports.view","accounting.read"],
  erp_get_top_customers:["reports.view","sales.read","customers.read","accounting.read"],
  erp_get_top_salesmen:["reports.view","sales.read"],
  erp_get_top_profitable_products:["reports.view","sales.read","purchases.read"],
  erp_get_top_vendors:["reports.view","purchases.read","vendors.read","accounting.read"],
  erp_get_daily_cash_summary:["reports.view","accounting.read"],
  erp_get_slow_moving_stock:["reports.view","inventory.read","products.read"],
  erp_get_inventory_summary:["inventory.read","products.read"],
};
const descriptions:Record<AnalyticsTool,string>={
  erp_get_profit_summary:"Read posted general-ledger revenue, COGS, gross profit, operating expenses and net profit. This/last month or explicit inclusive custom dates, using Asia/Karachi. Never use estimated catalog margins for realized profit.",
  erp_get_top_customers:"Rank customers by net posted invoice sales after posted returns and show their outstanding balance as of the period end. Separate currencies; this month or year-to-date.",
  erp_get_top_salesmen:"Rank the recorded invoice salespeople by posted sales revenue after returns. Unassigned invoices are reported explicitly; never invent a salesman or substitute the store owner.",
  erp_get_top_profitable_products:"Rank products by realized gross profit and separately by unit sales volume for this month. Uses historical invoice costs and posted return reversals, not current catalog purchase prices.",
  erp_get_top_vendors:"Rank vendors by posted purchase volume after returns and show outstanding payables; this month or year-to-date.",
  erp_get_daily_cash_summary:"Read actual cash account 1000 receipts, payments, counter collections, opening and closing cash register balances on a Karachi date. Bank transfers are excluded.",
  erp_get_slow_moving_stock:"List stocked products with no warehouse movement of any kind for thresholdDays. Organization warehouse scope is explicit; never call branch sales inactivity zero inventory movement.",
  erp_get_inventory_summary:"Read exact total number of catalog products and distinct products with positive warehouse inventory. Use for 'How many products in inventory?' without searching for a product called products.",
};
export const ANALYTICS_DEFINITIONS=Object.entries(ANALYTICS_SCHEMAS).map(([name,schema])=>({type:"function" as const,name,description:descriptions[name as AnalyticsTool],strict:false,parameters:z.toJSONSchema(schema)}));
type Row=Record<string,any>;
export interface AnalyticsReport { analytics:true; tool:AnalyticsTool; language?:"ur"|"en"; period:{from:string;to:string}; rows:Row[]; metrics:Row; notes:string[] }
export function karachiDate(now=new Date()):string { return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Karachi",year:"numeric",month:"2-digit",day:"2-digit"}).format(now); }
export function analyticsPeriod(input:{period?:string;startDate?:string;endDate?:string;date?:string},today:string){
  let from=input.date??today,to=from;
  if(input.period==="custom"){
    if(!input.startDate||!input.endDate)throw new ApiError(422,"ANALYTICS_DATES_REQUIRED","Custom reports require startDate and endDate.");
    from=input.startDate;to=input.endDate;
  }else if(input.period==="this_month")from=today.slice(0,7)+"-01";
  else if(input.period==="year")from=today.slice(0,4)+"-01-01";
  else if(input.period==="last_month"){
    const d=new Date(today.slice(0,7)+"-01T00:00:00Z");d.setUTCDate(0);to=d.toISOString().slice(0,10);from=to.slice(0,7)+"-01";
  }
  if(from>to||(Date.parse(to)-Date.parse(from))/86400000>366)throw new ApiError(422,"ANALYTICS_INVALID_PERIOD","Choose an ordered report period of at most 366 days.");
  return {from,to};
}
// Accounting uses four decimal places. Aggregate in fixed point, never floats.
function fixed(value:unknown):bigint {
  const match=String(value).match(/^(-?)(\d+)(?:\.(\d{1,4}))?$/);
  if(!match)throw new ApiError(502,"ANALYTICS_INVALID_AMOUNT","A source accounting amount is unavailable or invalid.");
  return (match[1]?-1n:1n)*(BigInt(match[2]!)*10000n+BigInt((match[3]??"").padEnd(4,"0")));
}
function money(value:bigint):string {const abs=value<0n?-value:value;return `${value<0n?"-":""}${abs/10000n}.${String(abs%10000n).padStart(4,"0")}`;}
const sum=(rows:Row[],field:string)=>rows.reduce((total,row)=>total+fixed(row[field]),0n);
const posted=["POSTED","PARTIALLY_PAID","PAID"];
const inPeriod=(date:string,p:{from:string;to:string})=>date>=p.from&&date<=p.to;

/** Read-only analytics. Every source query is tenant scoped; transactional
 * sources are also branch scoped. Complete pagination precedes every limit. */
export class CopilotAnalytics {
  constructor(private readonly database:()=>any,private readonly now:()=>Date=()=>new Date()){}
  private async rows(table:string,select:string,scope:AgentScope,filter:(q:any)=>any=q=>q,branch=true):Promise<Row[]>{
    const rows:Row[]=[];
    for(let offset=0;offset<100000;offset+=500){
      const child=table==="invoice_items";
      let query=this.database().from(table).select(select+(child?",invoices!inner(organization_id,branch_id)":"")).eq(child?"invoices.organization_id":"organization_id",scope.organizationId);
      if(branch)query=query.eq(child?"invoices.branch_id":"branch_id",scope.branchId);
      query=filter(query);
      query=table==="general_ledger"?query.order("journal_entry_id").order("account_id").order("debit").order("credit"):query.order("id");
      const {data,error}=await query.range(offset,offset+499);
      if(error||!Array.isArray(data))throw new ApiError(502,"ANALYTICS_READ_FAILED","Authoritative "+table+" records could not be read.");
      rows.push(...data);if(data.length<500)return rows;
    }
    throw new ApiError(422,"ANALYTICS_REPORT_TOO_LARGE","Narrow the report period; no partial total was returned.");
  }
  private async byIds(table:string,select:string,key:string,ids:unknown[],scope:AgentScope,branch=true){
    const unique=[...new Set(ids)],rows:Row[]=[];
    for(let i=0;i<unique.length;i+=100)rows.push(...await this.rows(table,select,scope,q=>q.in(key,unique.slice(i,i+100)),branch));
    return rows;
  }
  async read(tool:AnalyticsTool,raw:unknown,scope:AgentScope):Promise<AnalyticsReport>{
    const input:any=ANALYTICS_SCHEMAS[tool].parse(raw),today=karachiDate(this.now()),p=analyticsPeriod(input,today);
    const report:AnalyticsReport={analytics:true,tool,period:p,metrics:{},rows:[],notes:[]};
    if(tool==="erp_get_inventory_summary"){
      const {count,error}=await this.database().from("products").select("id",{count:"exact",head:true}).eq("organization_id",scope.organizationId);
      if(error||!Number.isSafeInteger(count)||count<0)throw new ApiError(502,"ANALYTICS_READ_FAILED","Product count could not be verified.");
      const stock=await this.rows("inventory","id,product_id,quantity",scope,q=>q.gt("quantity",0),false);
      report.metrics={productCount:count,productsWithStock:new Set(stock.map(row=>row.product_id)).size};
      report.notes=["Organization catalog and warehouse stock; inventory has no branch attribution."];return report;
    }
    if(tool==="erp_get_profit_summary"||tool==="erp_get_daily_cash_summary"){
      const cash=tool==="erp_get_daily_cash_summary";
      const lines=await this.rows("general_ledger","journal_entry_id,account_id,entry_date,source_type,code,debit,credit",scope,q=>cash?q.eq("code","1000").lte("entry_date",p.to):q.gte("entry_date",p.from).lte("entry_date",p.to));
      if(cash){
        const day=lines.filter(row=>row.entry_date===p.to),opening=lines.filter(row=>row.entry_date<p.to);
        const cashIn=sum(day,"debit"),cashOut=sum(day,"credit"),openingBalance=sum(opening,"debit")-sum(opening,"credit");
        const collections=day.filter(row=>["CUSTOMER_PAYMENT","SALE","INVOICE"].includes(row.source_type));
        report.metrics={currency:"PKR",cashIn:money(cashIn),cashOut:money(cashOut),salesCounterCollections:money(sum(collections,"debit")-sum(collections,"credit")),openingBalance:money(openingBalance),closingBalance:money(openingBalance+cashIn-cashOut)};
        report.notes=["Posted general ledger, cash account 1000 only; bank and clearing accounts excluded."];
      }else{
        const {data:accounts,error}=await this.database().from("accounts").select("code,account_type");
        if(error||!Array.isArray(accounts))throw new ApiError(502,"ANALYTICS_READ_FAILED","Accounting types could not be read.");
        const types=new Map(accounts.map((row:Row)=>[row.code,row.account_type]));
        const revenueRows=lines.filter(row=>types.get(row.code)==="REVENUE"),expenseRows=lines.filter(row=>types.get(row.code)==="EXPENSE"&&row.code!=="5000"),costRows=lines.filter(row=>row.code==="5000");
        const revenue=sum(revenueRows,"credit")-sum(revenueRows,"debit"),cogs=sum(costRows,"debit")-sum(costRows,"credit"),expenses=sum(expenseRows,"debit")-sum(expenseRows,"credit");
        report.metrics={currency:"PKR",revenue:money(revenue),cogs:money(cogs),grossProfit:money(revenue-cogs),operatingExpenses:money(expenses),netProfit:money(revenue-cogs-expenses)};
        report.notes=["Posted general ledger in functional currency PKR, including posted return reversals; COGS account 5000."];
      }
      return report;
    }
    if(tool==="erp_get_slow_moving_stock"){
      const cutoff=new Date(Date.parse(today+"T00:00:00Z")-input.thresholdDays*86400000).toISOString().slice(0,10);
      const [stock,products,movements]=await Promise.all([
        this.rows("inventory","id,product_id,quantity",scope,q=>q,false),
        this.rows("products","id,name,unit,created_at",scope,q=>q,false),
        this.rows("stock_movements","id,product_id,created_at",scope,q=>q.lte("created_at",today+"T23:59:59.999+05:00"),false),
      ]);
      const quantity=new Map<number,number>(),latest=new Map<number,string>();
      for(const row of stock)quantity.set(row.product_id,(quantity.get(row.product_id)??0)+Number(row.quantity));
      for(const row of movements){const date=karachiDate(new Date(row.created_at));if(date>(latest.get(row.product_id)??""))latest.set(row.product_id,date);}
      report.rows=products.flatMap(row=>{const lastMovement=latest.get(row.id)??null,created=karachiDate(new Date(row.created_at));return (quantity.get(row.id)??0)>0&&(lastMovement??created)<=cutoff?[{productId:row.id,name:row.name,unit:row.unit,onHand:quantity.get(row.id),lastMovement}]:[];}).sort((a,b)=>(a.lastMovement??"").localeCompare(b.lastMovement??"")||a.productId-b.productId);
      report.metrics={thresholdDays:input.thresholdDays,cutoff,itemCount:report.rows.length};report.notes=["Organization warehouse inventory and all stock movement types, not branch sales alone."];return report;
    }
    if(tool==="erp_get_top_vendors"){
      const [purchases,ledger,vendors]=await Promise.all([
        this.rows("purchases","id,vendor_id,total,purchase_date",scope,q=>q.gte("purchase_date",p.from).lte("purchase_date",p.to)),
        this.rows("vendor_payable_ledger_entries","id,vendor_id,debit,credit,entry_type,entry_date",scope,q=>q.lte("entry_date",p.to)),
        this.rows("vendors","id,name",scope,q=>q,false),
      ]);
      report.rows=vendors.flatMap(vendor=>{
        const sales=purchases.filter(row=>row.vendor_id===vendor.id),balance=ledger.filter(row=>row.vendor_id===vendor.id),credits=balance.filter(row=>row.entry_type==="PURCHASE_RETURN"&&inPeriod(row.entry_date,p));
        return sales.length||credits.length?[{vendorId:vendor.id,name:vendor.name,currency:"PKR",purchaseVolume:money(sum(sales,"total")-sum(credits,"debit")),outstanding:money(sum(balance,"credit")-sum(balance,"debit"))}]:[];
      }).sort((a,b)=>Number(b.purchaseVolume)-Number(a.purchaseVolume)||a.vendorId-b.vendorId).slice(0,input.limit);return report;
    }
    const [invoices,credits]=await Promise.all([
      this.rows("invoices","id,customer_id,salesperson_id,issue_date,currency_code,grand_total,subtotal,discount_total",scope,q=>q.in("status",posted).gte("issue_date",p.from).lte("issue_date",p.to)),
      this.rows("credit_notes","id,invoice_id,customer_id,currency_code,grand_total,credit_date",scope,q=>q.eq("status","POSTED").gte("credit_date",p.from).lte("credit_date",p.to)),
    ]);
    if(tool==="erp_get_top_customers"){
      const [customers,ledger]=await Promise.all([this.rows("customers","id,name",scope,q=>q,false),this.rows("customer_ledger_entries","id,customer_id,currency_code,debit,credit",scope,q=>q.lte("entry_date",p.to))]);
      report.rows=customers.flatMap(customer=>[...new Set([...invoices,...credits].filter(row=>row.customer_id===customer.id).map(row=>row.currency_code))].map(currency=>{
        const sales=invoices.filter(row=>row.customer_id===customer.id&&row.currency_code===currency),returns=credits.filter(row=>row.customer_id===customer.id&&row.currency_code===currency),balances=ledger.filter(row=>row.customer_id===customer.id&&row.currency_code===currency);
        return {customerId:customer.id,name:customer.name,currency,salesVolume:money(sum(sales,"grand_total")-sum(returns,"grand_total")),outstanding:money(sum(balances,"debit")-sum(balances,"credit"))};
      }));
      report.rows=this.rank(report.rows,"salesVolume",input.limit);return report;
    }
    if(tool==="erp_get_top_salesmen"){
      const [people,sourceInvoices]=await Promise.all([this.rows("salespeople","id,name",scope,q=>q,false),this.byIds("invoices","id,salesperson_id","id",credits.map(row=>row.invoice_id),scope)]);
      const source=new Map(sourceInvoices.map(row=>[row.id,row.salesperson_id]));
      const groups=new Map<string,{salespersonId:number|null;name:string;currency:string;amount:bigint}>();
      for(const [rows,sign] of [[invoices,1n],[credits,-1n]] as const)for(const row of rows){
        const id=sign===1n?row.salesperson_id:source.get(row.invoice_id),currency=row.currency_code,key=String(id??"unassigned")+"|"+currency;
        const group=groups.get(key)??{salespersonId:id??null,name:people.find(person=>person.id===id)?.name??"Unassigned",currency,amount:0n};
        group.amount+=sign*fixed(row.grand_total);groups.set(key,group);
      }
      report.rows=this.rank([...groups.values()].map(({amount,...row})=>({...row,revenue:money(amount)})),"revenue",input.limit);report.notes=["Unassigned means no salesperson is recorded on the source invoice."];return report;
    }
    const [items,returnItems,products]=await Promise.all([
      this.byIds("invoice_items","id,invoice_id,product_id,quantity,unit,line_total,cogs_total,customer_discount_amount","invoice_id",invoices.map(row=>row.id),scope),
      this.byIds("credit_note_items","id,credit_note_id,product_id,quantity,unit,line_total,cogs_reversal_total","credit_note_id",credits.map(row=>row.id),scope),
      this.rows("products","id,name",scope,q=>q,false),
    ]);
    const groups=new Map<string,{productId:number;name:string;unit:string;currency:string;quantity:number;revenue:bigint;cost:bigint;missingCost:boolean}>();
    for(const [rows,sign] of [[items,1n],[returnItems,-1n]] as const)for(const row of rows){
      const header=sign===1n?invoices.find(invoice=>invoice.id===row.invoice_id):credits.find(credit=>credit.id===row.credit_note_id);
      if(!header)throw new ApiError(502,"ANALYTICS_READ_FAILED","Invoice source header was not found.");
      const key=[row.product_id,row.unit,header.currency_code].join("|"),group=groups.get(key)??{productId:row.product_id,name:products.find(product=>product.id===row.product_id)?.name??String(row.product_id),unit:row.unit,currency:header.currency_code,quantity:0,revenue:0n,cost:0n,missingCost:false};
      // Legacy invoice header discounts are allocated proportionally once.
      const gross=fixed(row.line_total),legacyGross=sign===1n?sum(items.filter(item=>item.invoice_id===header.id),"line_total"):0n;
      const net=sign===1n&&row.customer_discount_amount!=null?gross-fixed(row.customer_discount_amount):
        sign===1n&&fixed(header.subtotal)>0n&&legacyGross===fixed(header.subtotal)?gross*fixed(header.grand_total)/fixed(header.subtotal):gross;
      group.quantity+=Number(sign)*Number(row.quantity);group.revenue+=sign*net;
      const cost=sign===1n?row.cogs_total:row.cogs_reversal_total;if(cost==null)group.missingCost=true;else group.cost+=sign*fixed(cost);
      groups.set(key,group);
    }
    const rows=[...groups.values()].map(row=>({productId:row.productId,name:row.name,unit:row.unit,currency:row.currency,quantity:row.quantity,revenue:money(row.revenue),cogs:row.missingCost?null:money(row.cost),grossProfit:row.missingCost?null:money(row.revenue-row.cost),marginPercent:row.missingCost||row.revenue<=0n?null:Number((row.revenue-row.cost)*10000n/row.revenue)/100}));
    report.rows=this.rank(rows.filter(row=>row.grossProfit!==null),"grossProfit",input.limit);
    report.metrics={highestVolume:this.rank(rows,"quantity",input.limit),highestMargin:this.rank(rows.filter(row=>row.marginPercent!==null),"marginPercent",input.limit),missingHistoricalCost:rows.filter(row=>row.grossProfit===null).length};
    report.notes=["Historical invoice COGS and posted credit-note reversals; items missing historical cost are excluded from profit ranking."];return report;
  }
  private rank(rows:Row[],metric:string,limit:number){
    // Each currency has its own ranking; USD and PKR amounts are never compared.
    const group=(row:Row)=>row.currency+(metric==="quantity"?"|"+row.unit:"");
    return [...new Set(rows.map(group))].sort().flatMap(key=>rows.filter(row=>group(row)===key).sort((a,b)=>Number(b[metric])-Number(a[metric])||String(a.name).localeCompare(String(b.name))).slice(0,limit).map((row,index)=>({...row,rank:index+1})));
  }
}

export function analyticsAnswer(report:AnalyticsReport,message:string):string{
  const en=isEnglishRequest(message);
  const titles:Record<AnalyticsTool,[string,string]>={erp_get_profit_summary:["Profit summary","منافع کی تفصیل"],erp_get_top_customers:["Top customers","سب سے زیادہ خریداری کرنے والے گاہک"],erp_get_top_salesmen:["Top salesmen","فروخت کے لحاظ سے سیل مین"],erp_get_top_profitable_products:["Most profitable products","سب سے زیادہ منافع دینے والے آئٹمز"],erp_get_top_vendors:["Top vendors","سب سے زیادہ خریداری والے وینڈر"],erp_get_daily_cash_summary:["Daily cash summary","روزانہ نقد کھاتہ"],erp_get_slow_moving_stock:["Slow-moving stock","بغیر نقل و حرکت کا اسٹاک"],erp_get_inventory_summary:["Inventory product count","اسٹاک اور کیٹلاگ میں آئٹمز کی تعداد"]};
  const labels:Record<string,[string,string]>={productCount:["Total catalog products","کیٹلاگ میں کل آئٹمز"],productsWithStock:["Products with positive stock","دستیاب اسٹاک والے آئٹمز"],revenue:["Revenue","فروخت کی آمدن"],cogs:["COGS","فروخت شدہ مال کی لاگت"],grossProfit:["Gross profit","مجموعی منافع"],operatingExpenses:["Operating expenses","دکان کے اخراجات"],netProfit:["Net profit","خالص منافع"],cashIn:["Cash in","نقد وصولی"],cashOut:["Cash out","نقد ادائیگی"],salesCounterCollections:["Counter collections","کاؤنٹر کی وصولی"],openingBalance:["Opening cash","ابتدائی نقد"],closingBalance:["Closing cash balance","موجودہ نقد بیلنس"],salesVolume:["Net sales","خالص فروخت"],purchaseVolume:["Net purchases","خالص خریداری"],outstanding:["Outstanding","بقایا"],quantity:["Quantity","مقدار"],marginPercent:["Margin %","مارجن فیصد"],onHand:["On hand","موجودہ اسٹاک"],lastMovement:["Last movement","آخری نقل و حرکت"]};
  const title=titles[report.tool][en?0:1],lines=[`${title} (${report.period.from} — ${report.period.to})`];
  const display=(key:string,value:unknown)=>`${labels[key]?.[en?0:1]??key}: ${value??(en?"unavailable":"دستیاب نہیں")}`;
  for(const [key,value] of Object.entries(report.metrics))if(labels[key])lines.push(display(key,value));
  for(const row of report.rows)lines.push(`${row.rank?row.rank+". ":""}${row.name==="Unassigned"&&!en?"سیل مین درج نہیں":row.name} ${row.currency??row.unit??""} — `+Object.entries(row).filter(([key])=>labels[key]).map(([key,value])=>display(key,value)).join("؛ "));
  if(!report.rows.length&&!Object.keys(report.metrics).some(key=>labels[key]))lines.push(en?"No posted records found in this period.":"جناب، اس مدت میں کوئی متعلقہ پوسٹ شدہ ریکارڈ موجود نہیں۔");
  if(report.metrics.currency)lines.push(en?"Currency: "+report.metrics.currency:"کرنسی: "+report.metrics.currency);
  if(["erp_get_inventory_summary","erp_get_slow_moving_stock"].includes(report.tool))lines.push(en?"Organization-wide warehouse inventory; no branch-only on-hand quantity is inferred.":"یہ ادارے کے تمام گوداموں کا اسٹاک ہے؛ برانچ کا الگ آن ہینڈ اندازہ نہیں لگایا گیا۔");
  if(report.metrics.missingHistoricalCost)lines.push(en?"Some items have no verified historical cost and are excluded from profit ranking.":"کچھ آئٹمز کی تاریخی لاگت دستیاب نہیں، اس لیے انہیں منافع کی درجہ بندی میں شامل نہیں کیا گیا۔");
  for(const [key,heading] of [["highestVolume",en?"Highest unit sales volume":"مقدار کے لحاظ سے سب سے زیادہ فروخت"],["highestMargin",en?"Highest margin percentage":"سب سے زیادہ مارجن فیصد"]])if(Array.isArray(report.metrics[key!])&&report.metrics[key!].length)lines.push(heading+": "+report.metrics[key!].map((row:Row)=>`${row.name} ${row.currency} — ${display(key==="highestVolume"?"quantity":"marginPercent",row[key==="highestVolume"?"quantity":"marginPercent"])} ${row.unit??""}`).join("؛ "));
  return lines.join("\n");
}
