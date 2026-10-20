import { createHash, randomUUID } from "node:crypto";
import { ApiError } from "../../errors/api-error.js";
import type { AgentScope } from "../agent/erp-tools.js";
import type { ErpService } from "../../services/erp.service.js";
import type { EntitySearchService } from "../../services/entity-search.service.js";
import type { PricingService } from "../../services/pricing.service.js";
import type { RateListService } from "../../services/rate-list.service.js";
import type { SupabaseRateListRepository } from "../../repositories/rate-list.repository.js";
import type { SupabaseEstimateRepository } from "../../repositories/estimate.repository.js";
import type { InvoiceBrowserRepository } from "../../repositories/invoice-browser.repository.js";
import type { CustomerPaymentService } from "../../services/customer-payment.service.js";
import type { SupabaseCustomerPaymentBrowserRepository } from "../../repositories/customer-payment-browser.repository.js";
import { DefaultEstimateService, calculateEstimateTotals } from "../../services/estimate.service.js";
import { SalesTransactionService } from "../../services/sales-transaction.service.js";
import { SupabaseReportingGateway } from "../../reports/supabase-reporting.gateway.js";
import { ERP_ACTION_SCHEMAS, type ErpActionName, type PreparedErpAction } from "./registry.js";
import type { CopilotTarget } from "../copilot.types.js";
import { RateListCatalogSchema } from "../rate-list-catalog.js";
import { CustomerMemoryStore, rememberedDiscount, returnMemoryMessage, type CustomerMemory } from "../customerMemoryStore.js";
import { SupabaseSalesReturnService, type SalesReturnService } from "../../services/sales-return.service.js";

const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const amount=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const today=()=>new Date().toISOString().slice(0,10);
function requireChoice(message:string):never { throw new ApiError(422,"ERP_ACTION_CLARIFICATION",message); }
function equal(actual:unknown,expected:unknown,label:string) {
  if (JSON.stringify(actual)!==JSON.stringify(expected)) throw new ApiError(409,"ERP_APPROVAL_CHANGED",label+" changed. Prepare a fresh preview before confirming.");
}
export const ACTION_TARGETS:Record<Exclude<ErpActionName,"erp_get_business_report">,CopilotTarget>={
  erp_import_rate_list:"rate_list_update",erp_update_product_price:"product_price_update",
  erp_create_customer:"customer_create",erp_update_customer:"customer_update",erp_record_payment:"customer_payment",
  erp_create_estimate:"estimate",erp_create_invoice:"invoice",erp_convert_estimate_to_invoice:"estimate_convert_invoice",
  erp_customer_return:"customer_return",
};
export interface OperationsDependencies {
  erp:ErpService; search:EntitySearchService; pricing:PricingService; rateLists:RateListService;
  rates:SupabaseRateListRepository; estimates:SupabaseEstimateRepository; invoices:InvoiceBrowserRepository;
  payments:CustomerPaymentService; paymentReader:Pick<SupabaseCustomerPaymentBrowserRepository,"getPayment">;
  database:()=>any; principal:string;
  memory?: CustomerMemory;
  returns?: SalesReturnService;
}
export interface ErpOperations {
  prepare(tool:Exclude<ErpActionName,"erp_get_business_report">,raw:unknown,scope:AgentScope):Promise<PreparedErpAction>;
  execute(action:PreparedErpAction,scope:AgentScope,key:string):Promise<any>;
  verify(action:PreparedErpAction,scope:AgentScope,result:any):Promise<void>;
  report(raw:unknown,scope:AgentScope):Promise<unknown>;
}
/** Preparation performs scoped reads only. The runtime owns approval/claiming. */
export class DefaultErpOperations implements ErpOperations {
  private readonly memory: CustomerMemory;
  constructor(private readonly deps:OperationsDependencies) { this.memory = deps.memory ?? new CustomerMemoryStore(deps.database); }
  private async rpc(name:string,args:Record<string,unknown>) {
    const {data,error}=await this.deps.database().rpc(name,args);
    if(error) throw new ApiError(error.code==="42501"?403:error.code==="40001"?409:422,"ERP_TRANSACTION_REJECTED",error.message??"ERP transaction was rejected.");
    return data;
  }
  private async rows(table:string,select:string,filter:(query:any)=>any) {
    const rows:any[]=[];
    for(let offset=0;;offset+=500) {
      const {data,error}=await filter(this.deps.database().from(table).select(select)).order("id").range(offset,offset+499);
      if(error) throw new ApiError(502,"ERP_READ_FAILED","Authoritative "+table+" records could not be read.");
      rows.push(...(data??[]));if((data??[]).length<500)return rows;
    }
  }
  private async customer(input:any,scope:AgentScope) {
    const id=input.customerId;
    if(id) { const row=await this.deps.erp.getCustomer(id,scope.organizationId);if(!row)requireChoice("Customer was not found in this organization.");return row; }
    if(!input.customerName)requireChoice("Please provide the customer name or Customer ID.");
    const match=await this.deps.search.searchCustomers(input.customerName,5,scope);
    if(match.resolution!=="resolved"||!match.bestCandidate)requireChoice("Please clarify the customer: "+match.items.map(row=>row.name+" (ID "+row.id+")").join("; "));
    return (await this.deps.erp.getCustomer(match.bestCandidate.id,scope.organizationId))!;
  }
  private async warehouse(id:number|undefined,scope:AgentScope) {
    if(id) {if(!await this.deps.erp.getWarehouse(id,scope.organizationId))requireChoice("Warehouse was not found in this organization.");return id;}
    const rows=await this.deps.erp.listWarehouses({limit:2},scope.organizationId);
    if(rows.data.length!==1||rows.next_cursor)requireChoice("Please choose the warehouse for this invoice.");
    return rows.data[0]!.id;
  }
  private async inventory(productId:number,warehouseId:number,scope:AgentScope,explicitCost?:number) {
    const stock=await this.deps.erp.listInventory({limit:2,product_id:productId,warehouse_id:warehouseId},scope.organizationId);
    const available=stock.data.reduce((sum,row)=>sum+Number(row.quantity),0);
    if(explicitCost!==undefined)return {unitCost:explicitCost,available,costSource:"explicit reviewed unit cost"};
    const movements=await this.rows("stock_movements","id,movement_type,quantity,unit_cost",q=>q.eq("organization_id",scope.organizationId).eq("product_id",productId).eq("warehouse_id",warehouseId));
    const inbound=new Set(["OPENING","PURCHASE","SALE_RETURN","TRANSFER_IN"]);
    const outbound=new Set(["SALE","PURCHASE_RETURN","TRANSFER_OUT"]);
    let quantity=0,value=0;
    for(const row of movements) {
      if(row.unit_cost==null||(!inbound.has(row.movement_type)&&!outbound.has(row.movement_type)))requireChoice("Inventory costing needs review for Product "+productId+". Provide its verified unitCost.");
      const direction=inbound.has(row.movement_type)?1:-1;
      quantity+=direction*Number(row.quantity);value+=direction*Number(row.quantity)*Number(row.unit_cost);
    }
    if(available<=0||Math.abs(quantity-available)>.000001||value<0)requireChoice("Reconciled inventory cost is unavailable for Product "+productId+". Provide its verified unitCost.");
    return {unitCost:value/available,available,costSource:"reconciled stock movement valuation"};
  }
  private async quote(input:any,scope:AgentScope,invoice=false,asOf=today()) {
    const customer=await this.customer(input,scope);
    const profile=await this.memory.recall(scope,customer.id,customer.name);
    const warehouseId=invoice?await this.warehouse(input.warehouseId,scope):undefined;
    const lines:any[]=[];
    for(const item of input.items) {
      let product=item.productId?await this.deps.erp.getProduct(item.productId,scope.organizationId):null;
      if(!item.productId) {
        if(!item.name)requireChoice("Each item needs a product name or Product ID.");
        let match=await this.deps.search.searchProducts([item.name,item.size].filter(Boolean).join(" "),5,scope);
        if(match.resolution!=="resolved") {
          const preferred=profile.preferredBrands.filter(brand=>match.items.some(row=>row.category===brand.category && row.brandName===brand.brandName));
          if(preferred.length===1) match=await this.deps.search.searchProducts([preferred[0]!.brandName,item.name,item.size].filter(Boolean).join(" "),5,scope);
        }
        if(match.resolution!=="resolved"||!match.bestCandidate)requireChoice("Please clarify product "+item.name+": "+match.items.map(row=>row.name+" (ID "+row.id+")").join("; "));
        product=await this.deps.erp.getProduct(match.bestCandidate.id,scope.organizationId);
      }
      if(!product)requireChoice("Product was not found in this organization.");
      if(item.unit&&item.unit.toLowerCase()!==product.unit.toLowerCase())requireChoice("Unit for "+product.name+" must be "+product.unit+"; confirm a supported conversion.");
      const rate=await this.deps.pricing.resolvePrice({organization_id:scope.organizationId,price_type:"SALE",product_id:product.id,customer_id:customer.id,
        quantity:item.qty,as_of:asOf+"T23:59:59.999Z",...(item.rateListId?{rate_list_id:item.rateListId}:{})});
      if(!rate||rate.unit!==product.unit)requireChoice("No unambiguous active sale rate is available for "+product.name+". Choose its Rate List.");
      if(item.rate!==undefined&&item.rate!==rate.unit_price)requireChoice("Requested rate differs from the active catalog for "+product.name+". Update the product price with its reason first.");
      const discount=item.discount??input.discountScheme?.percent??input.discount??rememberedDiscount(profile,product,product.unit,rate.currency_code);
      const cost=invoice?await this.inventory(product.id,warehouseId!,scope,item.unitCost):undefined;
      const discountAmount=Math.min(item.qty*rate.unit_price,amount(item.qty*rate.unit_price*discount/100));
      await this.memory.assertFloor(scope,product.id,rate.unit_price,item.qty*rate.unit_price===0?0:discountAmount/(item.qty*rate.unit_price)*100,product.unit,rate.currency_code,cost?.unitCost);
      lines.push({line_number:lines.length+1,product_id:product.id,productName:product.name,quantity:item.qty,unit:product.unit,unit_price:rate.unit_price,
        discount_amount:discountAmount,discountPercent:discount,pricing_source:"RESOLVED_RATE",
        rate_list_id:rate.rate_list_id,rate_list_version_id:rate.rate_list_version_id,resolved_price:rate,
        ...(cost??{})});
    }
    if(invoice) {
      const required=new Map<number,number>();
      for(const line of lines)required.set(line.product_id,(required.get(line.product_id)??0)+line.quantity);
      for(const line of lines)if(required.get(line.product_id)!>line.available)requireChoice("Insufficient stock for "+line.productName+".");
    }
    const totals=calculateEstimateTotals(lines,input.carriageCharges??0);
    if((input.paidAmount??0)>totals.customer_payable_total)requireChoice("Paid amount exceeds the invoice payable amount.");
    return {customerId:customer.id,customerName:customer.name,...(warehouseId?{warehouseId}:{}),lines,totals,date:asOf};
  }
  async prepare(tool:Exclude<ErpActionName,"erp_get_business_report">,raw:unknown,scope:AgentScope):Promise<PreparedErpAction> {
    const input:any=ERP_ACTION_SCHEMAS[tool].parse(raw);
    let data:any={},title=tool.replace(/^erp_/,"").replaceAll("_"," ");
    if(tool==="erp_import_rate_list") {
      data.catalog=RateListCatalogSchema.parse({documentType:"rate_list",name:[input.brand,input.category].join(" "),effectiveDate:input.effectiveDate,
        items:input.items.map((item:any)=>({brand:input.brand,category:item.category??(/pipe|پائپ/i.test(item.name)?"Pipes":/valve|plug|وال|پلگ/i.test(item.name)?"Hardware":"Fittings"),
          name:item.name,size:item.size,unit:item.unit,list_price:item.list_price,discountPercent:item.discount})),
        standardDiscountPercent:input.items.every((item:any)=>item.discount===input.items[0].discount)?input.items[0].discount:null,complete:true,confidence:1,warnings:[]});
    } else if(tool==="erp_customer_return") {
      const customer=await this.customer(input,scope);
      const sale=await this.memory.latestSale(scope,customer.id,input.productId,input.invoiceId);
      const warehouseId=await this.warehouse(input.warehouseId,scope);
      const returned=await this.rows("credit_note_items","id,quantity,credit_notes!inner(status)",q=>q.eq("organization_id",scope.organizationId).eq("branch_id",scope.branchId).eq("invoice_item_id",sale.source_item_id).eq("credit_notes.status","POSTED"));
      if(input.qty+returned.reduce((sum,row)=>sum+Number(row.quantity),0)>Number(sale.quantity))requireChoice("Return quantity exceeds the remaining quantity of the bound historical invoice line.");
      data={customerId:customer.id,customerName:customer.name,sale,warehouseId,date:today(),reason:input.reason,
        lines:[{product_id:sale.product_id,invoice_item_id:sale.source_item_id,quantity:input.qty,unit:sale.unit,unit_price:Number(sale.net_unit_price),discountPercent:Number(sale.discount_percent)}],
        totals:{grand_total:input.qty*Number(sale.net_unit_price)},memoryMessage:returnMemoryMessage(customer.name,sale)};
    } else if(tool==="erp_create_customer") data={...input};
    else if(tool==="erp_update_customer") {
      if(!Object.keys(input.updates).length)requireChoice("Specify at least one customer field to update.");
      const customer=await this.customer(input,scope);data={customerId:customer.id,before:customer,updates:input.updates};
    } else if(tool==="erp_update_product_price") {
      const product=await this.deps.erp.getProduct(input.productId,scope.organizationId);if(!product)requireChoice("Product was not found.");
      const rate=await this.deps.pricing.resolvePrice({organization_id:scope.organizationId,price_type:"SALE",product_id:product.id,quantity:1,as_of:new Date().toISOString(),...(input.rateListId?{rate_list_id:input.rateListId}:{})});
      if(!rate)requireChoice("Choose an active authoritative Rate List for the price change.");
      data={...input,productName:product.name,before:product,rate};
    } else if(tool==="erp_record_payment") {
      const customer=await this.customer(input,scope);
      if(input.allocations?.length&&amount(input.allocations.reduce((sum:number,row:any)=>sum+row.amount,0))!==amount(input.amount))requireChoice("Invoice allocations must equal the payment amount.");
      for(const allocation of input.allocations??[]) {
        const invoice=await this.deps.invoices.getById(scope.organizationId,scope.branchId,allocation.invoiceId);
        if(!invoice||invoice.invoice.customer_id!==customer.id)requireChoice("Payment invoice was not found for this customer and branch.");
      }
      data={...input,customerName:customer.name,paymentDate:input.paymentDate??today(),allocations:input.allocations??[]};
    } else if(tool==="erp_create_estimate"||tool==="erp_create_invoice") data=await this.quote(input,scope,tool==="erp_create_invoice");
    else {
      const source=await this.deps.estimates.getEstimateAggregate(input.estimateId,scope.organizationId);
      if(!source||source.record.branch_id!==scope.branchId||!["DRAFT","READY"].includes(source.record.status))requireChoice("An active estimate was not found in this branch.");
      if(source.record.currency_code!=="PKR")requireChoice("This invoice workflow requires a PKR estimate.");
      const warehouseId=await this.warehouse(input.warehouseId,scope),lines=[];
      for(const item of source.items) {
        const cost=await this.inventory(item.product_id,warehouseId,scope,input.unitCosts?.find((row:any)=>row.productId===item.product_id)?.unitCost);
        await this.memory.assertFloor(scope,item.product_id,Number(item.unit_price),Number(item.quantity)*Number(item.unit_price)===0?0:Number(item.discount_amount)/(Number(item.quantity)*Number(item.unit_price))*100,item.unit,source.record.currency_code,cost.unitCost);
        if(item.quantity>cost.available)requireChoice("Insufficient stock for Product "+item.product_id+".");
        const {rate_list_selection_source:_selection,...commercial}=item;
        lines.push({...commercial,...cost,discountPercent:Number(item.quantity)*Number(item.unit_price)===0?0:Number(item.discount_amount)/(Number(item.quantity)*Number(item.unit_price))*100});
      }
      data={customerId:source.record.customer_id,warehouseId,lines,totals:calculateEstimateTotals(lines,source.record.pass_through_rent??0),
        sourceEstimateId:input.estimateId,sourceFingerprint:digest(source),date:today()};
    }
    data.documentNumber="AI-"+randomUUID().slice(0,18);
    const count=data.lines?.length??data.catalog?.items.length;
    const sum=data.totals?.customer_payable_total??input.amount??input.newPrice;
    const summary="میں "+(data.customerName??input.name??data.catalog?.name??data.productName??"منتخب ریکارڈ")+" کے لیے "+
      (count?count+" آئٹمز کا ":sum!==undefined?"PKR "+sum+" کا ":"")+title+" درج کرنے جا رہا ہوں۔ کیا آپ منظوری دیتے ہیں؟" + (data.memoryMessage?"\n"+data.memoryMessage:"");
    return {tool,input,data,preview:{title,summary,
      lines:data.lines??data.catalog?.items??[tool==="erp_update_product_price"?{product:data.productName,oldPrice:data.rate.unit_price,newPrice:input.newPrice,reason:input.reason}:tool==="erp_update_customer"?input.updates:input],
      ...(data.totals?{totals:data.totals}:{}),
      ...(tool==="erp_record_payment"&&!data.allocations.length?{warnings:["یہ غیر مختص پیشگی وصولی ہے؛ کسی مخصوص invoice کو ادا شدہ نہیں کیا جائے گا۔"]}:{})}};
  }
  async execute(action:PreparedErpAction,scope:AgentScope,key:string) {
    const {tool,input,data}=action;
    if(tool==="erp_customer_return") {
      // Revalidate the exact approved source, never silently rebind to a newer sale.
      const sale=await this.memory.latestSale(scope,input.customerId,input.productId,data.sale.document_id);
      equal(sale,data.sale,"Historical return binding");
      const service=this.deps.returns??new SupabaseSalesReturnService(this.deps.database);
      const result=await service.recordSalesReturn({credit_note_number:data.documentNumber,invoice_id:sale.document_id,customer_id:input.customerId,
        credit_date:data.date,currency_code:sale.currency_code,reason:data.reason,items:[{invoice_item_id:sale.source_item_id,warehouse_id:data.warehouseId,quantity:input.qty}]},
        {organizationId:scope.organizationId,branchId:scope.branchId,actorUserId:scope.userId,servicePrincipalId:this.deps.principal,
          operation:"sales-return.create",idempotencyKey:key,requestFingerprint:digest(action)});
      return {...(result as Record<string,unknown>),memoryMessage:returnMemoryMessage(data.customerName,sale,true)};
    }
    if(tool==="erp_import_rate_list")return {...await this.deps.rateLists.importRateList({...data.catalog,organization_id:scope.organizationId,idempotency_key:key})};
    if(tool==="erp_create_customer"||tool==="erp_update_customer"||tool==="erp_update_product_price"||(tool==="erp_record_payment"&&!data.allocations.length))
      return this.rpc("commit_copilot_profile_action",{p_organization_id:scope.organizationId,p_branch_id:scope.branchId,p_actor_user_id:scope.userId,
        p_service_principal:this.deps.principal,p_idempotency_key:key,p_tool:tool,p_payload:data});
    if(tool==="erp_record_payment") return this.deps.payments.recordPayment({
      customer_id:input.customerId,amount:input.amount,payment_date:data.paymentDate,currency_code:"PKR",payment_method:input.paymentMethod,
      ...(input.reference?{reference_number:input.reference}:{}),...(input.notes?{notes:input.notes}:{}),
      allocations:data.allocations.map((row:any)=>({invoice_id:row.invoiceId,amount:row.amount})),
    },{organizationId:scope.organizationId,branchId:scope.branchId,actorUserId:scope.userId,servicePrincipalId:this.deps.principal,
      operation:"customer-payment.create",idempotencyKey:key,requestFingerprint:digest(action)});
    if(tool==="erp_create_estimate"||tool==="erp_create_invoice") {
      const current=await this.quote(input,scope,tool==="erp_create_invoice",data.date);
      equal(current,dataWithoutNumber(data),"Authoritative prices, units, costs or totals");
    } else {
      const source=await this.deps.estimates.getEstimateAggregate(data.sourceEstimateId,scope.organizationId);
      equal(digest(source),data.sourceFingerprint,"Source estimate");
      for(const line of data.lines) await this.memory.assertFloor(scope,line.product_id,line.unit_price,line.quantity*line.unit_price===0?0:(line.discount_amount??0)/(line.quantity*line.unit_price)*100,line.unit,source!.record.currency_code,line.unitCost);
    }
    if(tool==="erp_create_estimate") return new DefaultEstimateService(this.deps.estimates).createDraft({
      definition:{organization_id:scope.organizationId,branch_id:scope.branchId,customer_id:data.customerId,estimate_number:data.documentNumber,issue_date:data.date,currency_code:"PKR"},
      lines:data.lines,
    },{branch_id:scope.branchId,actor_user_id:scope.userId,idempotency_key:key,source_type:"AI_ASSISTED"});
    const invoice:any={id:0,status:"DRAFT",source_type:data.sourceEstimateId?"FROM_ESTIMATE":"DIRECT",source_estimate_id:data.sourceEstimateId??null,
      definition:{invoice_number:data.documentNumber,customer_id:data.customerId,issue_date:data.date,currency_code:"PKR"},lines:data.lines,
      subtotal:data.totals.subtotal,discount_total:data.totals.discount_total,grand_total:data.totals.grand_total,pass_through_rent:data.totals.pass_through_rent};
    let committed:any;
    const result=await new SalesTransactionService({execute:async request=>{
      committed=await this.rpc("commit_copilot_sale",{p_organization_id:scope.organizationId,p_branch_id:scope.branchId,p_actor_user_id:scope.userId,
        p_service_principal:this.deps.principal,p_idempotency_key:key,p_payload:{
          invoice:{...request.invoice.definition,source_type:invoice.source_type,source_estimate_id:invoice.source_estimate_id,subtotal:invoice.subtotal,discount_total:invoice.discount_total,grand_total:invoice.grand_total,pass_through_rent:invoice.pass_through_rent},
          lines:request.lines.map((line,index)=>({...line,gross_unit_price:data.lines[index].unit_price,customer_discount_percent:data.lines[index].discountPercent??0,customer_discount_amount:data.lines[index].discount_amount??0})),warehouseId:data.warehouseId,paidAmount:input.paidAmount??0,
        }});
      return {invoice:{...invoice,id:committed.invoice_id,status:"POSTED"},inventory_decreased:true,customer_receivable_updated:true,revenue_recorded:true,cogs_recorded:true,profit_loss_recorded:true,pass_through_rent_recorded:invoice.pass_through_rent>0};
    }}).createInvoice({organization_id:scope.organizationId,branch_id:scope.branchId,actor_user_id:scope.userId,idempotency_key:key,warehouse_id:data.warehouseId,invoice,
      lines:data.lines.map((line:any,index:number)=>({line_number:index+1,product_id:line.product_id,quantity:line.quantity,unit:line.unit,unit_price:line.unit_price,
        line_total:line.quantity*line.unit_price,unit_cost:line.unitCost,cogs_total:line.quantity*line.unitCost}))});
    return {...result,...committed};
  }
  async verify(action:PreparedErpAction,scope:AgentScope,result:any) {
    const {tool,input,data}=action;
    if(tool==="erp_customer_return") {
      const notes=await this.rows("credit_notes","id,customer_id,invoice_id,status,grand_total",q=>q.eq("organization_id",scope.organizationId).eq("branch_id",scope.branchId).eq("id",result.credit_note?.id));
      const note=notes[0];if(!note||note.status!=="POSTED")throw new Error("Posted return was not found.");
      equal(Number(note.customer_id),input.customerId,"Return customer");equal(Number(note.invoice_id),data.sale.document_id,"Return invoice");
      equal(Number(note.grand_total),data.totals.grand_total,"Return net credit");
      const items=await this.rows("credit_note_items","id,invoice_item_id,quantity,unit_price",q=>q.eq("organization_id",scope.organizationId).eq("branch_id",scope.branchId).eq("credit_note_id",note.id));
      equal(items.map(row=>[Number(row.invoice_item_id),Number(row.quantity),Number(row.unit_price)]),[[data.sale.source_item_id,input.qty,Number(data.sale.net_unit_price)]],"Return historical price");
      return;
    }
    if(tool==="erp_create_customer"||tool==="erp_update_customer") {
      const id=tool==="erp_create_customer"?result.id:data.customerId;
      const row:any=await this.deps.erp.getCustomer(id,scope.organizationId);
      if(!row)throw new Error("Customer was not found on independent read.");
      const expected=tool==="erp_create_customer"?input:input.updates;
      for(const [key,value] of Object.entries(expected)) {
        if(key==="openingBalance")continue;
        equal(row[key==="address"?"city":key==="creditLimit"?"credit_limit":key],value,"Customer "+key);
      }
      if(tool==="erp_create_customer"&&input.openingBalance!==0) {
        const entries=await this.rows("customer_ledger_entries","id,debit,credit",q=>q.eq("organization_id",scope.organizationId).eq("branch_id",scope.branchId).eq("customer_id",id).eq("reference_type","CUSTOMER_OPENING"));
        equal(entries.reduce((sum,row)=>sum+Number(row.debit)-Number(row.credit),0),input.openingBalance,"Opening ledger balance");
        const journals=await this.rows("journal_entries","id,status",q=>q.eq("organization_id",scope.organizationId).eq("branch_id",scope.branchId).eq("source_type","CUSTOMER_OPENING").eq("source_record_id",String(id)));
        if(journals.length!==1||journals[0].status!=="POSTED")throw new Error("Opening balance accounting was not posted.");
      }
    } else if(tool==="erp_update_product_price") {
      const row=await this.deps.erp.getProduct(input.productId,scope.organizationId);
      equal(row?.sale_price,input.newPrice,"Product price");
      const rate=await this.deps.pricing.resolvePrice({organization_id:scope.organizationId,product_id:input.productId,price_type:"SALE",quantity:1,as_of:new Date().toISOString(),rate_list_id:data.rate.rate_list_id});
      equal(rate?.unit_price,input.newPrice,"Active catalog price");
    } else if(tool==="erp_import_rate_list") {
      const list=await this.deps.rates.getRateList(result.rate_list.id,scope.organizationId);
      if(!list||list.name!==data.catalog.name)throw new Error("Imported rate list was not found.");
      const versions=await this.deps.rates.listVersions(list.id),version=versions.find(row=>row.id===result.version.id);
      if(version?.status!=="ACTIVE")throw new Error("Imported catalog is not active.");
      const items=await this.deps.rates.listItems([version.id]);
      equal(items.length,data.catalog.items.length,"Catalog item count");
      const actual=[];
      for(const item of items) {
        const product=await this.deps.erp.getProduct(item.product_id,scope.organizationId);if(!product)throw new Error("Imported product is unavailable.");
        actual.push([product.name,item.unit,Number(item.unit_price),Number((item as any).standard_discount_percent??(version as any).standard_discount_percent??0)]);
      }
      const expected=data.catalog.items.map((item:any)=>[[item.brand,item.name,item.size].join(" "),item.unit,item.list_price,item.discountPercent??data.catalog.standardDiscountPercent??0]);
      equal(actual.map(row=>JSON.stringify(row)).sort(),expected.map((row:any)=>JSON.stringify(row)).sort(),"Catalog prices and discounts");
    } else if(tool==="erp_record_payment") {
      const id=result.payment?.id??result.id;
      const payment:any=await this.deps.paymentReader.getPayment(scope.organizationId,scope.branchId,id);
      const row=payment?.payment??payment;
      if(!row)throw new Error("Payment was not found.");
      equal(Number(row.amount),input.amount,"Receipt amount");equal(Number(row.customer_id),input.customerId,"Receipt customer");
      equal(row.payment_method,input.paymentMethod,"Receipt method");
    } else if(tool==="erp_create_estimate") {
      const saved=await this.deps.estimates.getEstimateAggregate(result.id,scope.organizationId);
      if(!saved||saved.record.branch_id!==scope.branchId)throw new Error("Estimate was not found in this branch.");
      equal(Number(saved.record.customer_id),data.customerId,"Estimate customer");
      equal(projectLines(saved.items),projectLines(data.lines),"Estimate lines");
    } else {
      const saved=await this.deps.invoices.getById(scope.organizationId,scope.branchId,result.invoice_id);
      if(!saved||!["POSTED","PAID","PARTIALLY_PAID"].includes(saved.invoice.status))throw new Error("Posted invoice was not found.");
      equal(saved.invoice.customer_id,data.customerId,"Invoice customer");
      equal(Number(saved.invoice.grand_total),data.totals.grand_total,"Invoice total");
      equal(projectLines(saved.lines,false),projectLines(data.lines,false),"Invoice lines");
      const {data:terms,error:termsError}=await this.deps.database().from("copilot_commercial_history").select("source_item_id,unit_price,discount_percent,net_unit_price")
        .eq("organization_id",scope.organizationId).eq("branch_id",scope.branchId).eq("document_type","invoice").eq("document_id",result.invoice_id).order("source_item_id");
      if(termsError)throw new Error("Invoice commercial terms could not be verified.");
      equal((terms??[]).map((row:any)=>[Number(row.unit_price),Number(row.discount_percent),Number(row.net_unit_price)]),
        data.lines.map((line:any)=>[Number(line.unit_price),Number(line.discountPercent??0),(line.quantity*line.unit_price-(line.discount_amount??0))/line.quantity]),"Invoice discount memory");
      if(input.paidAmount>0) {
        const payment:any=await this.deps.paymentReader.getPayment(scope.organizationId,scope.branchId,result.payment_id);
        if(!payment)throw new Error("Invoice receipt was not found.");
        equal(Number((payment.payment??payment).amount),input.paidAmount,"Invoice receipt");
      }
    }
  }
  async report(raw:unknown,scope:AgentScope) {
    const input=ERP_ACTION_SCHEMAS.erp_get_business_report.parse(raw);
    const period=input.dateRange??{from:today(),to:today()};if(period.from>period.to)requireChoice("Report start date must precede end date.");
    let result:unknown;
    if(input.reportType==="low_stock") {
      const rows=await this.rows("inventory","id,product_id,warehouse_id,quantity",q=>q.eq("organization_id",scope.organizationId).lte("quantity",input.lowStockThreshold??10));
      result={scope:"organization warehouses (inventory has no branch attribution)",threshold:input.lowStockThreshold??10,items:rows};
    } else if(input.reportType==="customer_balances") {
      const rows=await this.rows("customer_ledger_entries","id,customer_id,debit,credit,currency_code",q=>q.eq("organization_id",scope.organizationId).eq("branch_id",scope.branchId).lte("entry_date",period.to));
      const balances=new Map<string,any>();
      for(const row of rows) {const key=row.customer_id+"|"+row.currency_code;const entry=balances.get(key)??{customerId:row.customer_id,currency:row.currency_code,outstanding:0};entry.outstanding+=Number(row.debit)-Number(row.credit);balances.set(key,entry);}
      result={asOf:period.to,customers:[...balances.values()]};
    } else {
      const summary=await new SupabaseReportingGateway(scope.branchId,this.deps.database).getDashboardSummary(scope.organizationId,period);
      result=input.reportType==="daily_sales"?{period,sales:summary.sales,salesReturns:summary.salesReturns,currency:"PKR"}:
        {period,sales:summary.sales,netProfit:summary.netIncome,netProfitMarginPercent:Number(summary.sales)===0?null:amount(Number(summary.netIncome)/Number(summary.sales)*100),basis:"posted general ledger; net profit after posted expenses"};
    }
    return {answer:JSON.stringify(result),report:result,reportType:input.reportType};
  }
}
function dataWithoutNumber(data:Record<string,any>) {const {documentNumber,...value}=data;return value;}
function projectLines(lines:any[],discount=true) {return lines.map(line=>[line.product_id,Number(line.quantity),line.unit,Number(line.unit_price),...(discount?[Number(line.discount_amount??0)]:[])]);}
