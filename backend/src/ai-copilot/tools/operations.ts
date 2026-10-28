import { demandMarkdownTable } from '../estimate-table.js';
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
import { ERP_ACTION_SCHEMAS, type ErpWriteName, type ErpReadName, type PreparedErpAction } from "./registry.js";
import type { CopilotTarget } from "../copilot.types.js";
import { RateListCatalogSchema } from "../rate-list-catalog.js";
import { CustomerMemoryStore, rememberedDiscount, returnMemoryMessage, type CustomerMemory } from "../customerMemoryStore.js";
import { SupabaseSalesReturnService, type SalesReturnService } from "../../services/sales-return.service.js";
import { explicitBrand, sameBrand, canonicalBrand, matchesProductSpecification } from "../productResolver.js";
import { InstallationCompletenessService } from "../installationCompletenessService.js";
import { applyHybridRules, groupQuotation, quotationCard, classifyMaterial } from "../hybridQuotationEngine.js";
import { reconcileVendorQuote } from "../vendorQuoteAudit.js";
import { landedCost,canonicalUnit } from "../conversationalMunshi.js";
import { SiteTransferService, DEPOT_WRITES } from "../siteTransferService.js";
import type { CompanionLearningStore } from "../companionLearningStore.js";
import type { DepotIntelligenceStore } from "../depotIntelligenceStore.js";
import { duraCatalogBaseline } from "../catalogIntegrity.js";
import {DEMAND_SLIP_ESTIMATE,hardwareKind,hardwareLabel,hardwarePrompt} from '../demand-slip.js';
import { StoreMemoryStore } from '../storeMemoryStore.js';

const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const amount=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const today=()=>new Date().toISOString().slice(0,10);
function requireChoice(message:string):never { throw new ApiError(422,"ERP_ACTION_CLARIFICATION",message); }
function equal(actual:unknown,expected:unknown,label:string) {
  if (JSON.stringify(actual)!==JSON.stringify(expected)) throw new ApiError(409,"ERP_APPROVAL_CHANGED",label+" changed. Prepare a fresh preview before confirming.");
}
const maleVariant=(name:string)=>/(?:\bmale\b|\bMT\b|نر)/iu.test(name);
const femaleVariant=(name:string)=>/(?:\bfemale\b|\bFT\b|فیمیل|مادہ)/iu.test(name);
const explicitVariant=(text:string):"Male"|"Female"|undefined=>{
  const negativeMale=/(?:\b(?:no|not|without|don't|do not)\s+(?:male|MT)\b|\b(?:male|MT)\s+(?:نہ|نہیں|مت)|\bmale\s+not\b)/iu.test(text);
  if(maleVariant(text)&&!negativeMale)return "Male";
  if(femaleVariant(text))return "Female";
  return undefined;
};
const threadedFittingRequest=(text:string)=>/(?:\b(?:elbow|tee|socket|adapter|union|nipple)\b|کہنی|ٹی|ساکٹ)/iu.test(text)&&
  (/(?:\bthread(?:ed)?\b|\bBSP\b|\bNPT\b|\b\d+\s*[x×*]\s*\d+\s*\/\s*\d+|\b\d+\s*\/\s*\d+\s*["″]?|\b1\s*["″])/iu.test(text));
export const ACTION_TARGETS:Record<ErpWriteName,CopilotTarget>={
  erp_amend_estimate:"estimate",erp_accept_companions:"estimate",erp_create_site:"depot_action",erp_prepare_site_return:"depot_action",
  erp_transfer_site_material:"depot_action",erp_deliver_site_transfer:"depot_action",erp_create_dispatch:"depot_action",erp_record_dispatch:"depot_action",
  erp_log_expense:"depot_action",erp_update_commodity_rates:"depot_action",
  erp_import_rate_list:"rate_list_update",erp_update_product_price:"product_price_update",
  erp_create_customer:"customer_create",erp_update_customer:"customer_update",erp_record_payment:"customer_payment",
  erp_create_estimate:"estimate",erp_create_invoice:"invoice",erp_convert_estimate_to_invoice:"estimate_convert_invoice",
  erp_customer_return:"customer_return",
};
export interface OperationsDependencies {
  /** V2 preferences come only from verified shop memory passed in tool input. */
  verifiedPreferencesOnly?:boolean;
  erp:ErpService; search:EntitySearchService; pricing:PricingService; rateLists:RateListService;
  rates:SupabaseRateListRepository; estimates:SupabaseEstimateRepository; invoices:InvoiceBrowserRepository;
  payments:CustomerPaymentService; paymentReader:Pick<SupabaseCustomerPaymentBrowserRepository,"getPayment">;
  database:()=>any; principal:string;
  memory?: CustomerMemory;
  returns?: SalesReturnService;
  companions?:CompanionLearningStore;
  intelligence?:DepotIntelligenceStore;
}
export interface ErpOperations {
  prepare(tool:ErpWriteName,raw:unknown,scope:AgentScope):Promise<PreparedErpAction>;
  execute(action:PreparedErpAction,scope:AgentScope,key:string):Promise<any>;
  verify(action:PreparedErpAction,scope:AgentScope,result:any):Promise<void>;
  report(raw:unknown,scope:AgentScope):Promise<unknown>;
  read?(tool:ErpReadName,raw:unknown,scope:AgentScope):Promise<unknown>;
}
/** Preparation performs scoped reads only. The runtime owns approval/claiming. */
export class DefaultErpOperations implements ErpOperations {
  private readonly memory: CustomerMemory;
  private readonly depot:SiteTransferService;
  private readonly storeMemory:StoreMemoryStore;
  constructor(private readonly deps:OperationsDependencies) {
    this.memory = deps.memory ?? new CustomerMemoryStore(deps.database);
    this.storeMemory = new StoreMemoryStore(deps.database);
    this.depot=new SiteTransferService({...deps,memory:this.memory},(input,scope)=>this.prepare("erp_convert_estimate_to_invoice",input,scope));
  }
  private async rpc(name:string,args:Record<string,unknown>) {
    const {data,error}=await this.deps.database().rpc(name,args);
    if(error) throw new ApiError(error.code==="42501"?403:error.code==="40001"?409:422,"ERP_TRANSACTION_REJECTED",error.message??"ERP transaction was rejected.");
    return data;
  }
  private async rows(table:string,select:string,filter:(query:any)=>any) {
    const rows:any[]=[];
    for(let offset=0;;offset+=500) {
      const {data,error}=await filter(this.deps.database().from(table).select(select)).order(table==="dispatch_items"?"line_number":"id").range(offset,offset+499);
      if(error) throw new ApiError(502,"ERP_READ_FAILED","Authoritative "+table+" records could not be read.");
      rows.push(...(data??[]));if((data??[]).length<500)return rows;
    }
  }
  private async customer(input:any,scope:AgentScope,allowNew=false):Promise<any> {
    const id=input.customerId;
    if(id) { const row=await this.deps.erp.getCustomer(id,scope.organizationId);if(!row)requireChoice("Customer was not found in this organization.");return row; }
    if(!input.customerName)requireChoice("جناب، اس ایسٹیمیٹ کے لیے صرف گاہک کا نام بتا دیں۔");
    const match=await this.deps.search.searchCustomers(input.customerName,5,scope);
    if(allowNew && match.resolution==="no_match") {
      if(input.mode===DEMAND_SLIP_ESTIMATE){
        const payload={name:input.customerName,address:input.customerAddress??'',phone:input.customerPhone??''};
        const result=await this.rpc('commit_copilot_profile_action',{p_organization_id:scope.organizationId,p_branch_id:scope.branchId,p_actor_user_id:scope.userId,p_service_principal:this.deps.principal,p_idempotency_key:'demand-customer-'+digest({...scope,...payload}),p_tool:'erp_create_customer',p_payload:payload});
        return {id:result.id,name:payload.name,city:payload.address,phone:payload.phone};
      }
      return {name:input.customerName,city:input.customerAddress??"",newCustomer:{name:input.customerName,city:input.customerAddress??"",phone:input.customerPhone??""}};
    }
    if(match.resolution!=="resolved"||!match.bestCandidate)requireChoice("Please clarify the customer: "+match.items.map(row=>row.name+" (ID "+row.id+")").join("; "));
    const customer=(await this.deps.erp.getCustomer(match.bestCandidate.id,scope.organizationId))!;
    if(allowNew&&input.mode===DEMAND_SLIP_ESTIMATE){
      const updates={...(input.customerPhone&&input.customerPhone!==customer.phone?{phone:input.customerPhone}:{}),...(input.customerAddress&&input.customerAddress!==customer.city?{address:input.customerAddress}:{})};
      if(Object.keys(updates).length)await this.rpc('commit_copilot_profile_action',{p_organization_id:scope.organizationId,p_branch_id:scope.branchId,p_actor_user_id:scope.userId,p_service_principal:this.deps.principal,p_idempotency_key:'demand-customer-'+digest({...scope,id:customer.id,updates}),p_tool:'erp_update_customer',p_payload:{customerId:customer.id,updates}});
      return {...customer,...(updates.phone?{phone:updates.phone}:{}),...(updates.address?{city:updates.address}:{})};
    }
    return customer;
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
  private async quote(input:any,scope:AgentScope,invoice=false,asOf=today(),approvedCustomer?:any) {
    const customer=approvedCustomer ? {name:approvedCustomer.name,city:approvedCustomer.city,newCustomer:approvedCustomer} : await this.customer(input,scope,!invoice);
    const profile=customer.id&&!this.deps.verifiedPreferencesOnly ? await this.memory.recall(scope,customer.id,customer.name) :
      {history:[],preferredBrands:[],transactionCount:0,averageTransactionVolume:0,averageOrderIntervalDays:null,context:"",customerId:0};
    const warehouseId=invoice?await this.warehouse(input.warehouseId,scope):undefined;
    const storeMemory=invoice||this.deps.verifiedPreferencesOnly?{rates:[],rules:[]}:await this.storeMemory.recall(scope);
    const lines:any[]=[];
    const listNames=new Map<number,Promise<string>>();
    for(let offset=0;offset<input.items.length;offset+=8) {
      const batch=await Promise.all(input.items.slice(offset,offset+8).map(async(original:any,index:number)=>{
      if(input.mode===DEMAND_SLIP_ESTIMATE&&!/\bpipe\b|پائپ/iu.test(original.name??'')&&!/\bPN[ -]?\d+\b|\b(?:Medium|Heavy|Light)\b/iu.test(original.rawShorthand??''))
        original={...original,name:(original.name??'').replace(/\bPN[ -]?\d+\b|\b(?:Medium|Heavy|Light)\b/giu,'').replace(/\s+/g,' ').trim()};
      const hardware=input.mode===DEMAND_SLIP_ESTIMATE?hardwareKind(original.name??''):undefined;
      let candidates:any[]=[];
      try {
      // Owner prices are transaction terms, not catalog updates. They do not
      // require a catalog match or a purchase baseline to prepare an estimate.
      if(!invoice&&original.rate!==undefined){
        const product=original.productId?await this.deps.erp.getProduct(original.productId,scope.organizationId):null;
        if(original.productId&&!product)requireChoice('منتخب آئٹم اس ادارے میں دستیاب نہیں۔');
        if(!original.name&&!product)requireChoice('براہ کرم اس نرخ والے آئٹم کا نام بتا دیں۔');
        const discount=original.discount??0;
        return {line_number:offset+index+1,productName:[original.name??product?.name,original.size].filter(Boolean).join(' '),...(product?{product_id:product.id}:{}),size:original.size,brandName:original.brand??input.brand,quantity:original.qty,unit:original.unit??product?.unit??'pcs',unit_price:original.rate,discountPercent:discount,discount_amount:amount(original.qty*original.rate*discount/100),...(hardware?{hardware:true}:{}),pricing_source:'OWNER_QUOTED',ownerRate:original.rate};
      }
      if((input.mode===DEMAND_SLIP_ESTIMATE||this.deps.verifiedPreferencesOnly)&&original.specificationPending)throw new ApiError(422,'ESTIMATE_PRODUCT_PENDING','اس سطر کا درست سائز واضح کریں؛ مختلف سائز کا نرخ شامل نہیں کیا گیا۔');
      if(hardware){
        const manual=input.hardwareRates?.find((entry:any)=>entry.kind===hardware);
        if(manual)return {line_number:offset+index+1,productName:hardwareLabel(original.name),...(original.size?{size:original.size}:{}),quantity:original.qty,unit:original.unit??'pcs',unit_price:manual.rate,discountPercent:original.discount??0,discount_amount:amount(original.qty*manual.rate*(original.discount??0)/100),hardware:true,pricing_source:'OWNER_QUOTED',ownerRate:manual.rate};
      }
      const item=applyHybridRules<any>(original,input.pricingRules??[]);
      if(input.mode===DEMAND_SLIP_ESTIMATE&&!hardware&&sameBrand(input.brand??item.brand,'Dura Max')&&/\bpipe\b/i.test(item.name??'')&&!/ppr|pvc|\bg[.\s-]*i\b|brass/iu.test(item.name??'')&&/^[2-6]\s*(?:inch|["″])$/iu.test(item.size??''))item.name+=' U-PVC';
      if(input.mode===DEMAND_SLIP_ESTIMATE&&!hardware&&/\bpipe\b/i.test(item.name??'')&&!/PN[ -]?\d|medium|heavy|light/i.test([item.name,item.size].join(' '))){
        if(/u[ -]?pvc/i.test(item.name??''))item.name+=' Medium';
        else if(/ppr/i.test(item.name??''))item.name+=' PN-16';
      }
      const brand=hardware?undefined:item.brand ?? input.brand ?? explicitBrand(item.name??"");

      let product=item.productId?await this.deps.erp.getProduct(item.productId,scope.organizationId):null;
      if(!item.name&&!product)requireChoice("Each item needs a product name or Product ID.");
      const query=[item.name,item.size].filter(Boolean).join(" ");
      let match:any=null;
      if(!product) {
        match=brand ? await this.deps.search.searchProducts(query,5,scope,brand) : await this.deps.search.searchProducts(query,5,scope);
        if(brand) {
          match={...match,items:match.items.filter((row:any)=>sameBrand(row.brandName,brand))};
          if(!match.bestCandidate || !sameBrand(match.bestCandidate.brandName,brand))match={...match,resolution:"no_match",bestCandidate:null};
        }
      }
      const variantText=[input.message??'',query,original.rawShorthand??''].join(' ');
      const requestedVariant=input.mode===DEMAND_SLIP_ESTIMATE?explicitVariant(variantText):undefined;
      const currentRows:any[]=[...(match?.items??[])];
      if(match?.bestCandidate&&!currentRows.some(row=>row.id===match.bestCandidate.id))currentRows.push(match.bestCandidate);
      if(product)currentRows.push({id:product.id,name:product.name,unit:product.unit,brandName:product.brand_id==null?explicitBrand(product.name):await this.deps.search.getProductBrand(product.brand_id,scope.organizationId)});
      const hasGenderedCandidate=currentRows.some(row=>maleVariant(row.name)||femaleVariant(row.name));
      const forceFemale=input.mode===DEMAND_SLIP_ESTIMATE&&!requestedVariant&&(threadedFittingRequest(variantText)||hasGenderedCandidate);
      const targetVariant=requestedVariant??(forceFemale?'Female':undefined);
      if(targetVariant){
        const isTarget=targetVariant==='Male'?maleVariant:femaleVariant;
        const fitsBrand=(row:any)=>!brand||sameBrand(row.brandName,brand);
        let variantRows=currentRows.filter(row=>isTarget(row.name)&&fitsBrand(row));
        const neutralQuery=query.replace(/\b(?:male|female|MT|FT)\b/giu,' ').replace(/نر|فیمیل|مادہ/gu,' ').replace(/\s+/g,' ').trim();
        if(variantRows.length!==1){
          const variantQuery=[targetVariant,neutralQuery].filter(Boolean).join(' ');
          const variantSearch=brand?await this.deps.search.searchProducts(variantQuery,8,scope,brand):await this.deps.search.searchProducts(variantQuery,8,scope);
          variantRows=variantSearch.items.filter((row:any)=>isTarget(row.name)&&fitsBrand(row));
        }
        if(variantRows.length!==1){
          const names=variantRows.map((row:any)=>row.name+" (ID "+row.id+")");
          const question=targetVariant==='Female'
            ?`درخواست میں Male واضح نہیں تھا، اس لیے Female threaded variant درکار ہے؛ ${query} کے لیے درست Female کیٹلاگ آئٹم نہیں ملا۔ درست سائز یا آئٹم بتا دیں۔`
            :`${query} کے لیے Male threaded variant نہیں ملا؛ درست کیٹلاگ آئٹم بتا دیں۔`;
          throw new ApiError(422,"ESTIMATE_PRODUCT_PENDING",names.length?question+" "+names.join("؛ "):question);
        }
        product=await this.deps.erp.getProduct(variantRows[0].id,scope.organizationId);
      }
      if(!item.productId&&!targetVariant) {
        if(input.mode===DEMAND_SLIP_ESTIMATE&&(match.resolution!=='resolved'||!match.bestCandidate)){
          // Present genuine active alternatives; never choose a different brand here.
          let alternatives=match.items;
          if(!alternatives.length){
            const brands=await this.rows('brands','name',q=>q.eq('organization_id',scope.organizationId));
            const options=await Promise.all(brands.filter(row=>!brand||!sameBrand(row.name,brand)).map(row=>this.deps.search.searchProducts(query,5,scope,row.name)));
            alternatives=options.flatMap(option=>option.items);
          }
          candidates=(await Promise.all(alternatives.map(async(row:any)=>{
            const rate=await this.deps.pricing.resolvePrice({organization_id:scope.organizationId,price_type:'SALE',product_id:row.id,...(customer.id?{customer_id:customer.id}:{}),rate_list_brand:row.brandName??brand,quantity:item.qty,as_of:asOf+'T23:59:59.999Z'});
            return rate?{productId:row.id,name:row.name,brand:row.brandName,unit:row.unit,rate:rate.unit_price,rateListId:rate.rate_list_id}:null;
          }))).filter(Boolean);
        }
        if(!brand && match.resolution!=="resolved") {
          const preferred=profile.preferredBrands.filter(brand=>match.items.some((row:any)=>row.category===brand.category && row.brandName===brand.brandName));
          if(preferred.length===1) match=await this.deps.search.searchProducts([preferred[0]!.brandName,item.name,item.size].filter(Boolean).join(" "),5,scope);
        }
        if(match.resolution!=="resolved"||!match.bestCandidate)throw new ApiError(422,"ESTIMATE_PRODUCT_PENDING",hardware?
          `اس ہارڈویئر آئٹم (${original.name??'نام واضح نہیں'}) کی درست کیٹلاگ آئٹم نہیں ملی؛ براہِ کرم نام، سائز اور ریٹ بتا دیں۔`:
          match.items.length?
          (match.items.some((row:any)=>/\b(?:female|male)\b/iu.test(row.name))?"براہِ کرم Male یا Female منتخب کریں؛ ":"براہِ کرم ")+(brand?canonicalBrand(brand)+" کا ":"")+item.name+" کی درست قسم منتخب کریں۔ "+match.items.map((row:any)=>row.name+" (ID "+row.id+")").join("؛ "):
          [brand?canonicalBrand(brand):'',item.name,item.size].filter(Boolean).join(' ')+" منتخب برانڈ کی فعال ریٹ لسٹ میں موجود نہیں۔ کیا دوسرے برانڈ کا دستیاب نرخ یا اپنا نرخ استعمال کریں؟ "+candidates.map(row=>row.brand+" "+row.name+" PKR "+row.rate).join("؛ "));
        product=await this.deps.erp.getProduct(match.bestCandidate.id,scope.organizationId);
      }
      if(!product)requireChoice("جناب، اس ادارے کی ریٹ لسٹ میں یہ آئٹم نہیں ملا؛ اس کا درست نام یا سائز بتا دیں۔");
      const specification=[item.name,item.size].filter(Boolean).join(" ");
      const needsMaterialEvidence=/\bppr/iu.test(specification)&&!/\bppr/iu.test(product.name)&&!/\b(?:u[\s-]*)?pvc\b|\bcpvc\b|\bbrass\b|\bgalvanized\b|\bg[.\s-]*i(?:\b|\.)/iu.test(product.name)&&
        matchesProductSpecification(specification.replace(/\bppr[\s-]*c\b/giu,""),product.name);
      if(!needsMaterialEvidence && !matchesProductSpecification(specification,product.name))
        throw new ApiError(422,"ESTIMATE_PRODUCT_PENDING",item.name+" کے لیے "+(item.size??"درخواست کردہ سائز یا پریشر")+" کا درست کیٹلاگ آئٹم درکار ہے؛ مختلف سائز کا نرخ شامل نہیں کیا گیا۔");
      if(brand && !sameBrand(product.brand_id==null?explicitBrand(product.name):await this.deps.search.getProductBrand(product.brand_id,scope.organizationId),brand))
        requireChoice("منتخب آئٹم "+canonicalBrand(brand)+" کا نہیں ہے۔ اسی برانڈ کا درست آئٹم منتخب کریں۔");
      const countedPipe=(/\bpipe\b/i.test(product.name)||/^pipes?$/i.test(product.category))&&["pcs","length"].includes(canonicalUnit(item.unit??""))&&["pcs","length"].includes(canonicalUnit(product.unit));
      const countedCan=input.mode===DEMAND_SLIP_ESTIMATE&&item.unit==='can'&&product.unit==='pcs'&&/solvent|solution/iu.test(product.name)&&/\d+\s*g\b/iu.test(product.name)&&/\d+\s*g\b/iu.test(specification);
      if(item.unit&&canonicalUnit(item.unit)!==canonicalUnit(product.unit)&&!countedPipe&&!countedCan){
        const reason=product.name+" کا ERP یونٹ "+product.unit+" ہے؛ مختلف یونٹ کی درست تبدیلی واضح کر دیں۔";
        if(input.mode===DEMAND_SLIP_ESTIMATE)throw new ApiError(422,'ESTIMATE_RATE_PENDING',reason,{productId:product.id,productName:product.name,unit:item.unit});
        requireChoice(reason);
      }
      const rate=await this.deps.pricing.resolvePrice({organization_id:scope.organizationId,price_type:"SALE",product_id:product.id,...(customer.id?{customer_id:customer.id}:{}),rate_list_brand:brand,
        quantity:item.qty,as_of:asOf+"T23:59:59.999Z",...(item.rateListId?{rate_list_id:item.rateListId}:{})});
      if(!rate||rate.unit!==product.unit)throw new ApiError(422,"ESTIMATE_RATE_PENDING",product.name+" کا واضح فعال نرخ نہیں ملا؛ اس کی درست ریٹ لسٹ بتا دیں۔",{productId:product.id,productName:product.name,unit:product.unit});
      if(needsMaterialEvidence){
        if(!listNames.has(rate.rate_list_id))listNames.set(rate.rate_list_id,Promise.resolve(this.deps.rates?.getRateList(rate.rate_list_id,scope.organizationId)).then(list=>list?.name??""));
        const listName=await listNames.get(rate.rate_list_id)!;
        if(!matchesProductSpecification(specification,product.name+" "+listName))throw new ApiError(422,"ESTIMATE_PRODUCT_PENDING",`${item.name} کے مٹیریل کی فعال ریٹ لسٹ سے تصدیق درکار ہے؛ درست PPR-C آئٹم منتخب کریں۔`);
      }
      if(item.rate!==undefined&&item.rate!==rate.unit_price)requireChoice("Requested rate differs from the active catalog for "+product.name+". Update the product price with its reason first.");
      if(rate.currency_code!=="PKR")requireChoice("براہِ کرم اس تخمینے کے لیے PKR کی فعال ریٹ لسٹ منتخب کریں۔");
      const baseline=this.deps.verifiedPreferencesOnly?undefined:duraCatalogBaseline(product.name,brand);
      if(input.mode!==DEMAND_SLIP_ESTIMATE&&baseline&&rate.unit_price!==baseline.listPrice)requireChoice(product.name+" کا فعال نرخ "+rate.unit_price+" ہے جبکہ فراہم کردہ کیٹلاگ نرخ "+baseline.listPrice+" ہے۔ پہلے درستگی کا پری ویو منظور کریں؛ مختلف قسم یا نرخ خود سے شامل نہیں کیا گیا۔");
      const categoryItem=applyHybridRules<any>({...item,name:product.name,category:product.category},input.pricingRules??[]);
      const discount=hardware?0:categoryItem.discount??input.discountScheme?.percent??input.discount??(this.deps.verifiedPreferencesOnly?0:rememberedDiscount(profile,product,product.unit,rate.currency_code,baseline?50:0));
      const cost=invoice?await this.inventory(product.id,warehouseId!,scope,item.unitCost):undefined;
      const merchantCost=!invoice && this.deps.intelligence?await this.deps.intelligence.purchaseFloor(scope,product.id,rate.unit_price,product.unit,rate.currency_code):null;
      const discountAmount=Math.min(item.qty*rate.unit_price,amount(item.qty*rate.unit_price*discount/100));
      await this.memory.assertFloor(scope,product.id,rate.unit_price,item.qty*rate.unit_price===0?0:discountAmount/(item.qty*rate.unit_price)*100,product.unit,rate.currency_code,cost?.unitCost);
      if(classifyMaterial([brand,product.name].join(" "))==="GI" && /brass|براس|پیتل/iu.test(product.name))
        requireChoice("HE China صرف G.I. فٹنگ ہے؛ اسے پیتل یا Brass کے طور پر شامل نہیں کیا جا سکتا۔");
      return {line_number:offset+index+1,product_id:product.id,productName:product.name,...(item.size?{size:item.size}:{}),brandName:brand??explicitBrand(product.name)??"دیگر سامان",quantity:item.qty,unit:product.unit,unit_price:rate.unit_price,
        discount_amount:discountAmount,discountPercent:discount,pricing_source:"RESOLVED_RATE",
        rate_list_id:rate.rate_list_id,rate_list_version_id:rate.rate_list_version_id,resolved_price:rate,
        ...(merchantCost!=null?{merchantUnitCost:merchantCost}:{}),
        ...(hardware?{hardware:true}:{}),...(cost??{})};
      }catch(error){
        if(invoice || !(error instanceof ApiError) || !["ESTIMATE_PRODUCT_PENDING","ESTIMATE_RATE_PENDING"].includes(error.code))throw error;
        const name=[original.name,original.size].filter(Boolean).join(' '),unit=original.unit??'pcs';
        const remembered=this.deps.verifiedPreferencesOnly?undefined:this.storeMemory.findRate(storeMemory,name,original.size,unit)??await this.storeMemory.historicalRate(scope,name,unit);
        if(remembered&&!original.specificationPending){
          return {line_number:offset+index+1,productName:name,quantity:original.qty,unit,unit_price:remembered.rate,discountPercent:original.discount??0,
            discount_amount:amount(original.qty*remembered.rate*(original.discount??0)/100),pricing_source:'STORE_MEMORY',rememberedAt:remembered.learnedAt,
            memoryNotice:`${name}: پچھلا محفوظ نرخ PKR ${remembered.rate}/${unit} شامل کیا ہے؛ تبدیلی ہو تو بتا دیں۔`};
        }
        const pending=error.details as {productId?:number;productName?:string;unit?:string}|undefined;
        const pendingItem=applyHybridRules<any>(original,input.pricingRules??[]);
        return {line_number:offset+index+1,productName:pending?.productName??([original.name,original.size].filter(Boolean).join(" ")||"آئٹم "+original.productId),product_id:pending?.productId??original.productId,
          ...(original.size?{size:original.size}:{}),quantity:original.qty,unit:pending?.unit??original.unit??"",unit_price:null,discountPercent:hardware?0:pendingItem.discount??input.discountScheme?.percent??0,
          ...(hardware?{hardware:true}:{}),candidates,pending:true,pendingReason:error.message,rateLabel:'ریٹ مطلوب'};
      }
      }));
      lines.push(...batch);
    }
    if(invoice) {
      const required=new Map<number,number>();
      for(const line of lines)required.set(line.product_id,(required.get(line.product_id)??0)+line.quantity);
      for(const line of lines)if(required.get(line.product_id)!>line.available)requireChoice(`${line.productName} کا موجودہ اسٹاک ${line.available} ${line.unit} ہے، جبکہ بل میں ${required.get(line.product_id)} درکار ہیں۔ مقدار کم کر دیں، ابھی ایسٹیمیٹ رکھیں، یا پہلے فیکٹری سے وصولی درج کر کے پورا بل تیار کریں۔`);
    }
    const priced=lines.filter(line=>!line.pending);
    const totals=calculateEstimateTotals(priced,input.carriageCharges??0);
    for(const key of Object.keys(totals) as Array<keyof typeof totals>)totals[key]=amount(totals[key]);
    if((input.paidAmount??0)>totals.customer_payable_total)requireChoice("Paid amount exceeds the invoice payable amount.");
    return {...(customer.id?{customerId:customer.id}:{}),customerName:customer.name,...(customer.newCustomer?{newCustomer:customer.newCustomer}:{}),...(warehouseId?{warehouseId}:{}),lines,totals,date:asOf,
      ...(input.mode===DEMAND_SLIP_ESTIMATE?{mode:DEMAND_SLIP_ESTIMATE,unmatched_hardware_items:lines.filter(x=>x.pending&&x.hardware)}:{}),
      ...(priced.length!==lines.length?{incomplete:true,pendingCount:lines.length-priced.length}:{})};
  }
  async prepare(tool:ErpWriteName,raw:unknown,scope:AgentScope):Promise<PreparedErpAction> {
    let input:any=ERP_ACTION_SCHEMAS[tool].parse(raw);
    if(tool==="erp_create_customer"){input.phone??="";input.address??="";}
    if(DEPOT_WRITES.has(tool))return this.depot.prepare(tool,input,scope);
    if(tool==="erp_amend_estimate"||tool==="erp_accept_companions"){
      if(!input.draftId)requireChoice("جناب، پہلے ایسٹیمیٹ کا پری ویو تیار کر لیں تاکہ اسی میں سامان شامل کروں۔");
      const source=(await this.rows("ai_copilot_actions","id,user_id,status,action_plan",q=>q.eq("organization_id",scope.organizationId).eq("id",input.draftId)))[0];
      if(!source || source.user_id!==scope.userId || source.action_plan.branchId!==scope.branchId ||
        source.status!=="DRAFT" || source.action_plan.unifiedAction?.tool!=="erp_create_estimate")
        requireChoice("اس گفتگو کا فعال ایسٹیمیٹ پری ویو دستیاب نہیں؛ نیا پری ویو تیار کریں۔");
      const previous=source.action_plan.unifiedAction;
      const locked=previous.data.mode===DEMAND_SLIP_ESTIMATE&&previous.input.items.length>0;

      const additions:any[]=input.addItems??[],warnings:string[]=[];
      if(tool==="erp_accept_companions"&&!locked)for(const item of previous.data.companions??[]){
        const match=previous.input.brand?await this.deps.search.searchProducts(item.query,5,scope,previous.input.brand):await this.deps.search.searchProducts(item.query,5,scope);
        if(match.resolution==="resolved" && match.bestCandidate)additions.push({productId:match.bestCandidate.id,qty:item.quantity});
        else warnings.push(item.name+" کا مناسب برانڈ، سائز یا نرخ واضح نہیں؛ اسے خود سے شامل نہیں کیا گیا۔");
      }
      const ruleKey=(rule:any)=>{const key=rule.match.toLowerCase().trim();return /^(?:fittings?|فٹنگز?)$/u.test(key)?'fittings':/^(?:pipes?|پائپ)$/u.test(key)?'pipe':key;};
      const updates:any[]=input.updateItems??[];
      const previousItems=previous.input.items.map((item:any,index:number)=>({...item,...(previous.data.lines[index]?.product_id?{productId:previous.data.lines[index].product_id}:{})}));
      const lineUpdates=input.updateLines??[];
      if(new Set(lineUpdates.map((row:any)=>row.lineNumber)).size!==lineUpdates.length)requireChoice("جناب، ایک ہی سطر کے لیے دو تبدیلیاں آئی ہیں؛ ہر سطر کی حتمی درست تفصیل ایک بار بتا دیں۔");
      if([...lineUpdates.map((row:any)=>row.lineNumber),...(input.removeLineNumbers??[])].some(number=>number>previousItems.length))requireChoice("جناب، یہ سطر موجودہ مسودے میں نہیں ہے؛ دکھائی گئی سطر کا درست نمبر بتا دیں۔");
      if(updates.some(update=>!previousItems.some((item:any)=>item.productId===update.productId)))requireChoice("جناب، تبدیل کرنے والا آئٹم موجودہ مسودے میں نہیں ملا؛ اصل آئٹم منتخب کر دیں۔");
      const kept=previousItems.flatMap((item:any,index:number)=>{
        if((input.removeProductIds??[]).includes(item.productId)||(input.removeLineNumbers??[]).includes(index+1))return [];
        const rowChange=lineUpdates.find((row:any)=>row.lineNumber===index+1)?.changes??{};
        const updated={...item,...updates.find(update=>update.productId===item.productId),...rowChange,...(input.brand?{brand:input.brand}:{})};
        if(input.brand&&input.brand!==item.brand)delete updated.productId;
        if(rowChange.productId===undefined && ["name","size","brand"].some(key=>rowChange[key]!==undefined&&rowChange[key]!==item[key]))delete updated.productId;
        if(rowChange.size===null)delete updated.size;
        if(rowChange.size||rowChange.name)delete updated.specificationPending;
        if((input.discountScheme||(input.pricingRules&&applyHybridRules<any>({...item,discount:undefined},input.pricingRules).discount!==undefined)) && rowChange.discount===undefined && !updates.some(update=>update.productId===item.productId && update.discount!==undefined))delete updated.discount;
        return [updated];
      });
      const retained={...previous.input,...(previous.data.customerId?{customerId:previous.data.customerId}:{}),...(input.customerId?{customerId:input.customerId}:{}),...(input.customerName?{customerName:input.customerName,customerId:undefined}:{}),...(input.customerAddress?{customerAddress:input.customerAddress}:{}),...(input.customerPhone?{customerPhone:input.customerPhone}:{}),...(input.brand?{brand:input.brand}:{})};
      const next=await this.prepare("erp_create_estimate",{...retained,items:[...kept,...additions],...(input.hardwarePricing?{hardwarePricing:input.hardwarePricing}:{}),...(input.hardwareRates?.length?{hardwareRates:[...(previous.input.hardwareRates??[]).filter((x:any)=>!input.hardwareRates.some((y:any)=>y.kind===x.kind)),...input.hardwareRates]}:{}),...(input.discountScheme?{discountScheme:input.discountScheme}:{}),...(input.pricingRules?{pricingRules:[...(previous.input.pricingRules??[]).filter((old:any)=>!input.pricingRules.some((rule:any)=>ruleKey(rule)===ruleKey(old))),...input.pricingRules]}:{})},scope);
      const expected=kept.length+additions.length;
      if(next.data.lines.length!==expected)throw new ApiError(409,'ESTIMATE_LINES_LOCKED','Every retained source line must survive the amendment.');
      if(previous.data.nativeEstimateId)next.data.nativeEstimateId=previous.data.nativeEstimateId;
      next.preview.summary="جی جناب، بالکل! آپ کی ہدایت کے مطابق اسی مسودے کی تازہ تفصیل حاضر ہے۔\n"+next.preview.summary;
      next.preview.warnings=[...(next.preview.warnings??[]),...warnings];return next;
    }
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
      const rate=await this.deps.pricing.resolvePrice({organization_id:scope.organizationId,price_type:"SALE",product_id:product.id,quantity:1,as_of:new Date().toISOString(),rate_list_brand:explicitBrand(product.name),...(input.rateListId?{rate_list_id:input.rateListId}:{})});
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
        if(item.quantity>cost.available)requireChoice(`آئٹم ${item.product_id} کا موجودہ اسٹاک ${cost.available} ${item.unit} ہے، جبکہ ایسٹیمیٹ میں ${item.quantity} درکار ہیں۔ مقدار کم کریں یا پہلے وصولی درج کریں؛ موجودہ ایسٹیمیٹ سے کام جاری رہے گا۔`);
        const {rate_list_selection_source:_selection,...commercial}=item;
        lines.push({...commercial,...cost,discountPercent:Number(item.quantity)*Number(item.unit_price)===0?0:Number(item.discount_amount)/(Number(item.quantity)*Number(item.unit_price))*100});
      }
      data={customerId:source.record.customer_id,warehouseId,lines,totals:calculateEstimateTotals(lines,source.record.pass_through_rent??0),
        sourceEstimateId:input.estimateId,sourceFingerprint:digest(source),date:today()};
      if(input.paidAmount>data.totals.customer_payable_total)requireChoice("جناب، وصول شدہ رقم بل کی کل قابلِ ادائیگی رقم سے زیادہ ہے؛ درست وصولی بتا دیں۔");
      data.paidAmount=input.paidAmount;data.outstandingAmount=amount(data.totals.customer_payable_total-input.paidAmount);
    }
    data.documentNumber="AI-"+randomUUID().slice(0,18);
    if(tool==="erp_create_estimate"){
      const installation=new InstallationCompletenessService();
      data.companions=installation.audit(data.lines.filter((line:any)=>!line.pending).map((line:any)=>({name:line.productName,quantity:line.quantity})));
      if(this.deps.companions){
        const learned=await this.deps.companions.suggestions(scope,data.lines.filter((line:any)=>!line.pending).map((line:any)=>line.product_id),input.brand);
        data.companions.push(...learned.filter(item=>!data.companions.some((known:any)=>known.query.toLowerCase()===item.query.toLowerCase())));
      }
      data.creditWarnings=data.customerId && this.deps.intelligence?await this.deps.intelligence.creditWarnings(scope,data.customerId):[];
      const grouped=groupQuotation(data.lines.filter((line:any)=>!line.pending).map((line:any)=>({...line,...(line.merchantUnitCost!=null?{unitCost:line.merchantUnitCost}:{})})));
      if(!data.incomplete)data.quotation=quotationCard(data.customerName,grouped);data.privateMargin=grouped.privateMargin;
    }
    const count=data.lines?.length??data.catalog?.items.length;
    const sum=data.totals?.customer_payable_total??input.amount??input.newPrice;
    const summary=data.incomplete?`جناب، ${data.customerName} کے تمام ${count} آئٹمز مسودے میں شامل ہیں۔ ${data.pendingCount} آئٹمز کا ریٹ مطلوب ہے۔ نرخ والے آئٹمز کی جزوی رقم PKR ${data.totals.grand_total} ہے؛ یہ حتمی کل نہیں۔\n${hardwarePrompt(data.lines,input.hardwarePricing==="catalog")||'باقی آئٹمز کے درست کیٹلاگ سائز یا فعال نرخ کی تصدیق کر دیں۔'}` :tool==="erp_create_estimate" ?
      "حاجی صاحب! "+data.customerName+(data.newCustomer?(data.newCustomer.city?" ("+data.newCustomer.city+")":"")+" کو بطور نیا گاہک درج کرنے کے ساتھ":" کے لیے")+
      (input.brand?" "+canonicalBrand(input.brand):"")+(input.discountScheme?" "+input.discountScheme.percent+"% پر":"")+
      " "+count+" آئٹمز کا مکمل ایسٹیمیٹ پری ویو تیار کر دیا گیا ہے۔ کل رقم PKR "+data.totals.grand_total+" ہے۔ تفصیل دیکھ لیں؛ ERP میں محفوظ کرنے کے لیے آخر میں منظوری دے دیں۔" :
      "میں "+(data.customerName??input.name??data.catalog?.name??data.productName??"منتخب ریکارڈ")+" کے لیے "+
      (count?count+" آئٹمز کا ":sum!==undefined?"PKR "+sum+" کا ":"")+title+" درج کرنے جا رہا ہوں۔ کیا آپ منظوری دیتے ہیں؟" + (data.memoryMessage?"\n"+data.memoryMessage:"");
    const billing=["erp_create_invoice","erp_convert_estimate_to_invoice"].includes(tool)?`\nبل کی قابلِ ادائیگی رقم PKR ${data.totals.customer_payable_total}؛ نقد کاؤنٹر وصولی PKR ${input.paidAmount??0}؛ بقایا کھاتہ PKR ${amount(data.totals.customer_payable_total-(input.paidAmount??0))}۔ نقد بل کے لیے پوری وصولی، یا ادھار کے لیے مطلوبہ جزوی وصولی اسی گفتگو میں بتا دیں۔`:"";
    const creditWarnings=billing && data.customerId && this.deps.intelligence?await this.deps.intelligence.creditWarnings(scope,data.customerId):[];
    const catalogPending=data.mode===DEMAND_SLIP_ESTIMATE?data.lines.filter((line:any)=>line.pending&&!line.hardware):[];
    const catalogNotice=catalogPending.length?'\n\nفعال کیٹلاگ میں درج ذیل درست انتخاب دستیاب یا واضح نہیں؛ ان پر متبادل نرخ نہیں لگائے گئے:\n'+catalogPending.map((line:any)=>`${line.line_number}. ${line.productName}: ${line.pendingReason}`).join('\n'):'';
    const memoryNotice=(data.lines??[]).flatMap((line:any)=>line.memoryNotice?[line.memoryNotice]:[]).join('\n');
    return {tool,input,data,preview:{title,summary:summary+billing+(memoryNotice?'\n'+memoryNotice:'')+(data.mode===DEMAND_SLIP_ESTIMATE?"\n\n"+demandMarkdownTable(data.lines)+catalogNotice:""),...(billing?{warnings:creditWarnings}:{}),
      lines:data.lines??data.catalog?.items??[tool==="erp_update_product_price"?{product:data.productName,oldPrice:data.rate.unit_price,newPrice:input.newPrice,reason:input.reason}:tool==="erp_update_customer"?input.updates:input],
      ...(data.mode?{mode:data.mode,customer:{id:data.customerId,name:data.customerName,address:input.customerAddress??data.newCustomer?.city??'',phone:input.customerPhone??data.newCustomer?.phone??''},unmatched_hardware_items:data.unmatched_hardware_items,saveDraftAvailable:true,hardwareQuestion:hardwarePrompt(data.lines,input.hardwarePricing==="catalog")}:{}),
      ...(data.incomplete?{incomplete:true,partialTotals:data.totals}:data.totals?{totals:data.totals}:{}),
      ...(tool==="erp_create_estimate"?{companions:data.companions,quotation:data.quotation,privateMargin:data.privateMargin,
        warnings:[...data.creditWarnings,new InstallationCompletenessService().prompt(data.companions)].filter(Boolean)}:{}),
      ...(tool==="erp_record_payment"&&!data.allocations.length?{warnings:["یہ غیر مختص پیشگی وصولی ہے؛ کسی مخصوص invoice کو ادا شدہ نہیں کیا جائے گا۔"]}:{})}};
  }
  async execute(action:PreparedErpAction,scope:AgentScope,key:string) {
    const {tool,input,data}=action;
    if(data.mode===DEMAND_SLIP_ESTIMATE&&data.lines?.some((line:any)=>!line.product_id))requireChoice('جناب، یہ تخمینہ مکمل مسودے میں محفوظ ہے؛ مالی بل بنانے سے پہلے متفرق سامان کے کیٹلاگ آئٹمز منسلک کریں۔');
    if(data.incomplete || data.lines?.some((line:any)=>line.pending))requireChoice("جناب، پینڈنگ نرخوں والا مسودہ محفوظ نہیں ہو گا۔ پہلے تمام آئٹمز کے فعال نرخ واضح کر کے نیا پری ویو تیار کریں۔");
    if(DEPOT_WRITES.has(tool))return this.depot.execute(action,scope,key);
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
      const current=await this.quote(input,scope,tool==="erp_create_invoice",data.date,data.newCustomer);
      equal(current,dataWithoutNumber(data),"Authoritative prices, units, costs or totals");
    } else {
      const source=await this.deps.estimates.getEstimateAggregate(data.sourceEstimateId,scope.organizationId);
      equal(digest(source),data.sourceFingerprint,"Source estimate");
      for(const line of data.lines) await this.memory.assertFloor(scope,line.product_id,line.unit_price,line.quantity*line.unit_price===0?0:(line.discount_amount??0)/(line.quantity*line.unit_price)*100,line.unit,source!.record.currency_code,line.unitCost);
    }
    if(tool==="erp_create_estimate" && data.newCustomer) {
      const saved=await this.rpc("create_copilot_customer_estimate",{
        p_organization_id:scope.organizationId,p_branch_id:scope.branchId,p_actor_user_id:scope.userId,p_idempotency_key:key,
        p_customer:data.newCustomer,p_definition:{estimate_number:data.documentNumber,issue_date:data.date,currency_code:"PKR"},p_lines:data.lines,
      });
      return {id:saved.estimate.id,customerId:saved.estimate.customer_id,status:saved.estimate.status,lines:data.lines,totals:data.totals};
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
    if(DEPOT_WRITES.has(tool))return this.depot.verify(action,scope,result);
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
      equal(Number(saved.record.customer_id),data.customerId??result.customerId,"Estimate customer");
      if(data.newCustomer) {
        const customer=await this.deps.erp.getCustomer(saved.record.customer_id,scope.organizationId);
        if(!customer)throw new Error("Estimate customer was not found.");
        equal([customer.name,customer.city],[data.newCustomer.name,data.newCustomer.city],"New estimate customer");
      }
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
  async read(tool:ErpReadName,raw:any,scope:AgentScope):Promise<unknown> {
    const input:any=ERP_ACTION_SCHEMAS[tool].parse(raw);
    if(tool==="erp_get_business_report")return this.report(raw,scope);
    if(tool==="erp_find_site_records"){
      const table=({sites:"customer_sites",returns:"site_return_memos",transfers:"site_transfers",dispatches:"dispatch_orders"} as Record<string,string>)[input.kind]!;
      let query=this.deps.database().from(table).select("*").eq("organization_id",scope.organizationId).eq("branch_id",scope.branchId);
      if(input.customerId && ["sites","returns"].includes(input.kind))query=query.eq("customer_id",input.customerId);
      if(input.query && input.kind==="sites")query=query.ilike("name","%"+input.query.replace(/[%_\\]/g,"\\$&")+"%");
      const {data,error}=await query.order("created_at",{ascending:false}).limit(input.limit);
      if(error)throw new ApiError(502,"ERP_READ_FAILED","سائٹ کی تفصیل نہیں پڑھی جا سکی۔");
      return {answer:"اس برانچ میں "+(data??[]).length+" متعلقہ ریکارڈ ملے ہیں۔",report:{kind:input.kind,records:data??[]}};
    }
    if(tool==="erp_get_dispatch_status"){
      const order=(await this.rows("dispatch_orders","id,status,estimate_id,invoice_id,challan",q=>q.eq("organization_id",scope.organizationId).eq("branch_id",scope.branchId).eq("id",input.dispatchId)))[0];
      if(!order)requireChoice("اس برانچ کا درست ڈسپیچ منتخب کریں۔");
      const rows=await this.rows("dispatch_items","dispatch_id,line_number,product_id,unit,quantity,dispatched,delivered",q=>q.eq("organization_id",scope.organizationId).eq("branch_id",scope.branchId).eq("dispatch_id",input.dispatchId));
      return {answer:"ڈسپیچ کی تازہ مقداریں حاضر ہیں؛ اصل ایسٹیمیٹ کی رقم تبدیل نہیں ہوئی۔",report:{...order,lines:rows.map(row=>({...row,pending:Number(row.quantity)-Number(row.delivered)}))}};
    }
    if(tool==="erp_reconcile_vendor_quote"){
      const report=reconcileVendorQuote(input.demand,input.vendor),auditId=randomUUID();
      const {error}=await this.deps.database().from("vendor_quote_reviews").insert({id:auditId,organization_id:scope.organizationId,branch_id:scope.branchId,actor_user_id:scope.userId,observations:input,audit:report});
      if(error)throw new ApiError(502,"AUDIT_CONTEXT_UNAVAILABLE","کوٹیشن کی پڑتال محفوظ نہیں ہو سکی؛ دوبارہ کوشش کریں۔");
      return {answer:report.issues.length?report.issues.map(issue=>issue.message).join("\n"):"حاجی صاحب، طلب اور وینڈر کوٹیشن میں مقدار، معیار اور رعایت مطابق ہیں۔",report:{...report,auditId}};
    }
    if(tool==="erp_correct_vendor_quote"){
      if(!input.auditId)requireChoice("پہلے طلب اور وینڈر کوٹیشن کی پڑتال کر لیں۔");
      const row=(await this.rows("vendor_quote_reviews","id,actor_user_id,audit",q=>q.eq("organization_id",scope.organizationId).eq("branch_id",scope.branchId).eq("id",input.auditId)))[0];
      if(!row||row.actor_user_id!==scope.userId)requireChoice("اسی گفتگو کی وینڈر کوٹیشن کی پڑتال منتخب کریں۔");
      return {answer:"مقدار، معیار اور طے شدہ رعایت کے مطابق درست کوٹیشن کا پری ویو تیار ہے۔ کوئی سپلائر بل پوسٹ نہیں ہوا۔",report:{auditId:row.id,corrected:row.audit.corrected,issues:row.audit.issues}};
    }
    const report=tool==="erp_calculate_landed_cost"?landedCost(input):await this.rpc("depot_intelligence_report",{p_organization_id:scope.organizationId,p_branch_id:scope.branchId,p_actor_user_id:scope.userId,p_request:input});
    return {answer:JSON.stringify(report),report};
  }
}
function dataWithoutNumber(data:Record<string,any>) {const {documentNumber,companions,quotation,privateMargin,creditWarnings,...value}=data;return value;}
function projectLines(lines:any[],discount=true) {return lines.map(line=>[line.product_id,Number(line.quantity),line.unit,Number(line.unit_price),...(discount?[Number(line.discount_amount??0)]:[])]);}
