import { randomUUID } from "node:crypto";
import { ApiError } from "../errors/api-error.js";
import type { AgentScope } from "./agent/erp-tools.js";
import type { OperationsDependencies } from "./tools/operations.js";
import type { PreparedErpAction,ErpWriteName } from "./tools/registry.js";
import { rateFreeChallan } from "./conversationalMunshi.js";

export const DEPOT_WRITES=new Set<ErpWriteName>(["erp_create_site","erp_prepare_site_return","erp_transfer_site_material","erp_deliver_site_transfer","erp_create_dispatch","erp_record_dispatch","erp_log_expense","erp_update_commodity_rates"]);
const fail=(message:string):never=>{throw new ApiError(422,"ERP_ACTION_CLARIFICATION",message);};
export function salePayload(action:PreparedErpAction) {
  const d=action.data,totals=d.totals;
  return {invoice:{invoice_number:d.documentNumber,customer_id:d.customerId,issue_date:d.date,currency_code:"PKR",
    source_type:d.sourceEstimateId?"FROM_ESTIMATE":"DIRECT",source_estimate_id:d.sourceEstimateId??null,
    subtotal:totals.subtotal,discount_total:totals.discount_total,grand_total:totals.grand_total,pass_through_rent:totals.pass_through_rent??0},
    warehouseId:d.warehouseId,paidAmount:0,lines:d.lines.map((line:any,index:number)=>({
      line_number:index+1,product_id:line.product_id,quantity:line.quantity,unit:line.unit,unit_price:line.unit_price,
      line_total:line.quantity*line.unit_price,unit_cost:line.unitCost,cogs_total:line.quantity*line.unitCost,
      gross_unit_price:line.unit_price,customer_discount_percent:line.discountPercent??0,customer_discount_amount:line.discount_amount??0,
    }))};
}
/** Site reservations never touch accounting until physical delivery is approved. */
export class SiteTransferService {
  constructor(private readonly deps:OperationsDependencies,
    private readonly prepareInvoice:(input:unknown,scope:AgentScope)=>Promise<PreparedErpAction>) {}
  private async one(table:string,id:string|number,scope:AgentScope) {
    const {data,error}=await this.deps.database().from(table).select("*").eq("organization_id",scope.organizationId).eq("branch_id",scope.branchId).eq("id",id).maybeSingle();
    if(error)throw new ApiError(502,"ERP_READ_FAILED","متعلقہ سائٹ یا ڈسپیچ کی تفصیل نہیں پڑھی جا سکی۔");
    if(!data)fail("منتخب سائٹ یا ریکارڈ اس برانچ میں موجود نہیں۔");
    return data;
  }
  private async rows(table:string,field:string,id:string,scope:AgentScope) {
    const {data,error}=await this.deps.database().from(table).select("*").eq("organization_id",scope.organizationId).eq("branch_id",scope.branchId).eq(field,id).order("line_number");
    if(error)throw new ApiError(502,"ERP_READ_FAILED","ڈسپیچ کے آئٹمز نہیں پڑھے جا سکے۔");
    return data??[];
  }
  private async rate(productId:number,customerId:number,quantity:number,discount:number,scope:AgentScope) {
    const product=await this.deps.erp.getProduct(productId,scope.organizationId);
    const rate=await this.deps.pricing.resolvePrice({organization_id:scope.organizationId,price_type:"SALE",customer_id:customerId,product_id:productId,quantity,as_of:new Date().toISOString()});
    if(!product||!rate||product.unit!==rate.unit)fail("اس سامان کا فعال اور غیر مبہم فروخت نرخ درکار ہے۔");
    await this.deps.memory?.assertFloor(scope,productId,rate!.unit_price,discount,product!.unit,rate!.currency_code);
    return {product:product!,rate:rate!};
  }
  async prepare(tool:ErpWriteName,input:any,scope:AgentScope):Promise<PreparedErpAction> {
    let data:any={...input},lines:any[]=[];
    const id=randomUUID(),number="DEP-"+id.slice(0,12),date=new Date().toISOString().slice(0,10);
    if(tool==="erp_create_site"){
      const customer=await this.deps.erp.getCustomer(input.customerId,scope.organizationId);
      if(!customer)fail("گاہک اس ادارے میں موجود نہیں۔");data.customerName=customer!.name;
    } else if(tool==="erp_prepare_site_return"){
      const site=await this.one("customer_sites",input.siteId,scope);
      const invoice=await this.deps.invoices.getById(scope.organizationId,scope.branchId,input.invoiceId);
      const line=invoice?.lines.find((row:any)=>row.id===input.invoiceItemId);
      if(!invoice||invoice.invoice.customer_id!==site.customer_id||!line)fail("واپسی کے لیے اسی گاہک کی اصل انوائس لائن منتخب کریں۔");
      const {data:history,error}=await this.deps.database().from("copilot_commercial_history").select("*")
        .eq("organization_id",scope.organizationId).eq("branch_id",scope.branchId).eq("document_type","invoice").eq("source_item_id",input.invoiceItemId).maybeSingle();
      if(error||!history)fail("اصل فروخت کا نیٹ نرخ دستیاب نہیں۔");
      if(input.quantity>Number(line!.quantity))fail("واپسی کی مقدار اصل فروخت سے زیادہ ہے۔");
      data={...input,customerId:site.customer_id,productId:line!.product_id,unit:line!.unit,
        originalNetRate:Number(history.net_unit_price),originalUnitCost:Number(line!.unit_cost),documentNumber:invoice!.invoice.invoice_number};
      lines=[{productName:history.product_name,quantity:input.quantity,unit:line!.unit,unit_price:data.originalNetRate}];
    } else if(tool==="erp_transfer_site_material"||tool==="erp_deliver_site_transfer"){
      const transfer=tool==="erp_deliver_site_transfer"?await this.one("site_transfers",input.transferId,scope):undefined;
      const memo=await this.one("site_return_memos",transfer?.memo_id??input.memoId,scope);
      const site=await this.one("customer_sites",transfer?.target_site_id??input.targetSiteId,scope);
      if(site.customer_id!==memo.customer_id||site.id===memo.site_id)fail("سائٹ ٹرانسفر ایک ہی گاہک کی دو مختلف سائٹس کے درمیان ہو گا۔");
      const quantity=Number(transfer?.quantity??input.quantity),discount=Number(transfer?.discount_percent??input.discount);
      const {product,rate}=await this.rate(memo.product_id,memo.customer_id,quantity,discount,scope);
      const discountAmount=Math.round(quantity*rate.unit_price*discount)/100;
      data={...input,customerId:memo.customer_id,quantity,discount,rate,productId:product.id,unit:product.unit,
        originalNetRate:Number(memo.original_net_rate),originalUnitCost:Number(memo.original_unit_cost),memoVersion:memo.version,
        ...(transfer?{transferVersion:transfer.version}:{})};
      lines=[{line_number:1,product_id:product.id,productName:product.name,quantity,unit:product.unit,unit_price:rate.unit_price,
        discount_amount:discountAmount,discountPercent:discount,unitCost:Number(memo.original_unit_cost),pricing_source:"RESOLVED_RATE",rate_list_id:rate.rate_list_id,rate_list_version_id:rate.rate_list_version_id}];
      const totals={subtotal:quantity*rate.unit_price,discount_total:discountAmount,grand_total:quantity*rate.unit_price-discountAmount,pass_through_rent:0};
      data.lines=lines;data.totals=totals;
      data.challan=rateFreeChallan({number,customer:String(memo.customer_id),site:site.name,lines:[{name:product.name,quantity,unit:product.unit}]});
      if(transfer){
        if(transfer.status!=="PLANNED")fail("یہ ٹرانسفر پہلے مکمل یا منسوخ ہو چکا ہے۔");
        if(!await this.deps.erp.getWarehouse(input.warehouseId,scope.organizationId))fail("درست ٹرانزٹ گودام منتخب کریں۔");
        if(lines[0].unitCost==null||!Number.isFinite(lines[0].unitCost))fail("اصل انوائس کی لاگت دستیاب نہیں۔");
        await this.deps.memory?.assertFloor(scope,product.id,rate.unit_price,discount,product.unit,rate.currency_code,lines[0].unitCost);
        data.sale=salePayload({tool:"erp_create_invoice",input:{},data:{...data,warehouseId:input.warehouseId,documentNumber:number,date},preview:{title:"",summary:""}});
      }
    } else if(tool==="erp_create_dispatch"){
      const {data:snapshot,error}=await this.deps.database().rpc("estimate_conversion_snapshot",{p_estimate_id:input.estimateId,p_organization_id:scope.organizationId});
      if(error||!snapshot||snapshot.record.branch_id!==scope.branchId)fail("اس برانچ کا اصل ایسٹیمیٹ منتخب کریں۔");
      if(input.siteId){const site=await this.one("customer_sites",input.siteId,scope);if(site.customer_id!==snapshot.record.customer_id)fail("سائٹ ایسٹیمیٹ والے گاہک کی ہونی چاہیے۔");}
      const customer=await this.deps.erp.getCustomer(snapshot.record.customer_id,scope.organizationId);
      for(const item of snapshot.items){const product=await this.deps.erp.getProduct(item.product_id,scope.organizationId);if(!product)fail("ایسٹیمیٹ کا آئٹم دستیاب نہیں۔");lines.push({lineNumber:item.line_number,name:product!.name,productId:item.product_id,quantity:Number(item.quantity),unit:item.unit});}
      data={...input,sourceFingerprint:snapshot.source_fingerprint,lines,customerId:snapshot.record.customer_id};
      data.challan=rateFreeChallan({number,customer:customer!.name,lines});
    } else if(tool==="erp_record_dispatch"){
      const order=await this.one("dispatch_orders",input.dispatchId,scope);
      const items=await this.rows("dispatch_items","dispatch_id",order.id,scope);
      if(order.status==="DELIVERED"||order.status==="CANCELLED")fail("یہ ڈسپیچ مکمل یا منسوخ ہو چکا ہے۔");
      const seen=new Set<number>();
      for(const requested of input.lines){
        if(seen.has(requested.lineNumber))fail("ہر ڈسپیچ لائن ایک بار شامل کریں۔");seen.add(requested.lineNumber);
        const row=items.find((item:any)=>item.line_number===requested.lineNumber);
        if(!row)fail("منتخب لائن اس ڈسپیچ میں موجود نہیں۔");
        const remaining=input.event==="DISPATCH"?Number(row.quantity)-Number(row.dispatched):Number(row.dispatched)-Number(row.delivered);
        if(requested.quantity>remaining)fail("بھیجی یا وصول کی جانے والی مقدار باقی مقدار سے زیادہ ہے۔");
      }
      const finalDelivery=input.event==="DELIVER" && items.every((row:any)=>Number(row.delivered)+(input.lines.find((line:any)=>line.lineNumber===row.line_number)?.quantity??0)===Number(row.quantity));
      data={...input,orderVersion:order.version,finalDelivery};
      if(finalDelivery){
        const invoice=await this.prepareInvoice({estimateId:order.estimate_id,...(input.warehouseId?{warehouseId:input.warehouseId}:{})},scope);
        const {data:snapshot,error}=await this.deps.database().rpc("estimate_conversion_snapshot",{p_estimate_id:order.estimate_id,p_organization_id:scope.organizationId});
        if(error||!snapshot)fail("اصل ایسٹیمیٹ کی تصدیق نہیں ہو سکی۔");
        data.invoiceAction=invoice;data.sourceFingerprint=snapshot.source_fingerprint;data.sale=salePayload(invoice);data.totals=invoice.data.totals;
      }
      lines=items.map((row:any)=>({lineNumber:row.line_number,quantity:Number(row.quantity),dispatched:Number(row.dispatched),delivered:Number(row.delivered),pending:Number(row.quantity)-Number(row.delivered)}));
    } else if(tool==="erp_log_expense"){
      const {data:accounts,error}=await this.deps.database().from("accounts").select("id,code,account_type").eq("is_active",true).in("code",[input.expenseAccountCode,input.cashAccountCode]);
      if(error)fail("حساب کے کھاتے نہیں پڑھے جا سکے۔");
      const expense=accounts?.find((row:any)=>row.code===input.expenseAccountCode && row.account_type==="EXPENSE");
      const cash=accounts?.find((row:any)=>row.code===input.cashAccountCode && row.account_type==="ASSET");
      if(!expense||!cash)fail("موجودہ خرچ اور نقد یا بینک کے درست کھاتے منتخب کریں۔");
      data={...input,expenseAccountId:expense.id,cashAccountId:cash.id};
    } else if(tool==="erp_update_commodity_rates"){
      data={...input,rates:[]};
      for(const item of input.items){
        const product=await this.deps.erp.getProduct(item.productId,scope.organizationId);
        const rate=await this.deps.pricing.resolvePrice({organization_id:scope.organizationId,price_type:"SALE",product_id:item.productId,quantity:1,as_of:new Date().toISOString(),...(item.rateListId?{rate_list_id:item.rateListId}:{})});
        if(!product||!rate)fail("قیمت تبدیل کرنے کے لیے فعال فروخت ریٹ لسٹ منتخب کریں۔");
        data.rates.push({...item,rateListId:rate!.rate_list_id,versionId:rate!.rate_list_version_id,minimumQuantity:rate!.minimum_quantity,before:rate!.unit_price,name:product!.name});
      }
      lines=data.rates;
    } else fail("یہ کاروباری عمل دستیاب نہیں۔");
    data.id=id;data.number=number;data.date=data.date??date;
    return {tool,input,data,preview:{title:tool,summary:"حاجی صاحب، "+({
      erp_create_site:"گاہک کی نئی سائٹ",erp_prepare_site_return:"اصل فروخت نرخ پر سائٹ واپسی کا زیرِ وصولی میمو",
      erp_transfer_site_material:"دوسری سائٹ کے لیے نئے نرخ پر سامان اور بغیر نرخ کا ٹرانسفر چلّان",
      erp_deliver_site_transfer:"سائٹ ترسیل، اصل نرخ پر کریڈٹ اور نئے نرخ پر انوائس",
      erp_create_dispatch:"بغیر نرخ کا لوڈنگ چلّان",erp_record_dispatch:data.finalDelivery?"مکمل ترسیل اور حتمی سیلز انوائس":"جزوی ڈسپیچ یا ترسیل کا اندراج",
      erp_log_expense:"متوازن حسابی اندراج کے ساتھ خرچ",erp_update_commodity_rates:"فعال ریٹ لسٹ کے نئے نرخ",
    } as Record<string,string>)[tool]+" تیار ہے۔ تفصیل دیکھ کر تصدیق کر دیں۔",lines,...(data.challan?{challan:data.challan}:{}),...(data.totals?{totals:data.totals}:{})}};
  }
  async execute(action:PreparedErpAction,scope:AgentScope,key:string) {
    const {data,error}=await this.deps.database().rpc("commit_depot_action",{
      p_organization_id:scope.organizationId,p_branch_id:scope.branchId,p_actor_user_id:scope.userId,
      p_service_principal:this.deps.principal,p_tool:action.tool,p_payload:action.data,p_idempotency_key:key,
    });
    if(error)throw new ApiError(error.code==="42501"?403:409,"DEPOT_ACTION_REJECTED","کاروباری اندراج مکمل نہیں ہو سکا؛ تفصیل یا قیمت بدل گئی ہو تو نیا پری ویو تیار کریں۔");
    return data;
  }
  async verify(action:PreparedErpAction,scope:AgentScope,result:any) {
    const tables:Record<string,string>={erp_create_site:"customer_sites",erp_prepare_site_return:"site_return_memos",erp_transfer_site_material:"site_transfers",erp_deliver_site_transfer:"site_transfers",erp_create_dispatch:"dispatch_orders",erp_record_dispatch:"dispatch_orders",erp_log_expense:"depot_expenses"};
    const table=tables[action.tool];
    if(table){const row=await this.one(table,result.id,scope);if(!row)throw new Error("Depot record verification failed");
      if(action.tool==="erp_deliver_site_transfer" && (row.status!=="DELIVERED"||!row.invoice_id||!row.credit_note_id))throw new Error("Transfer accounting is incomplete");
      if(action.tool==="erp_record_dispatch"&&action.data.finalDelivery&&(row.status!=="DELIVERED"||!row.invoice_id))throw new Error("Dispatch accounting is incomplete");
      if(action.tool==="erp_log_expense"){const journal=await this.one("journal_entries",row.journal_entry_id,scope);if(journal.status!=="POSTED")throw new Error("Expense journal not posted");}
    }else for(const item of action.data.rates??[]){
      const rate=await this.deps.pricing.resolvePrice({organization_id:scope.organizationId,price_type:"SALE",product_id:item.productId,quantity:1,as_of:new Date().toISOString(),rate_list_id:item.rateListId});
      if(rate?.unit_price!==item.newPrice)throw new Error("New commodity rate could not be verified");
    }
  }
}
