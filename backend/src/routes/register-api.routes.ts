import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { createCopilotAuth } from '../middleware/copilot-auth.js';
import { deletionIdentity } from './record-deletion.routes.js';
import { getSupabaseAdminClient } from '../config/supabase.js';
import { TenantAccessService } from '../auth/tenant-access.service.js';
import { createServiceRoleAuthorizationGateway } from '../auth/supabase-authorization.gateway.js';
import type { PermissionCode } from '../auth/authorization.types.js';
import { calculateEstimateTotals } from '../services/estimate.service.js';
import { ApiError } from '../errors/api-error.js';
type Row=Record<string,any>;
type Identity={userId:string;organizationId:string;branchId:string};
const specs:Record<string,{table:string;permission:PermissionCode;branch?:boolean;fields:string[]}>= {
 customers:{table:'customers',permission:'customers.read',fields:['name','phone','city']},
 vendors:{table:'vendors',permission:'vendors.read',fields:['name','phone','city']},
 'rate-lists':{table:'rate_lists',permission:'products.read',fields:['name','code']},
 purchases:{table:'purchases',permission:'purchases.read',branch:true,fields:['purchase_number','invoice_number','vendor_name']},
 invoices:{table:'invoices',permission:'sales.read',branch:true,fields:['invoice_number','customer_name']},
 estimates:{table:'estimates',permission:'sales.read',branch:true,fields:['estimate_number','customer_name']},
 stock:{table:'inventory',permission:'inventory.read',fields:['product_name','warehouse_name']},
 products:{table:'products',permission:'products.read',fields:['name','sku']},
 warehouses:{table:'warehouses',permission:'inventory.read',fields:['name','location']},
 returns:{table:'credit_notes',permission:'returns.create',branch:true,fields:['credit_note_number','customer_name']},
};
export function filterRegister(rows:Row[],resource:string,query:Record<string,any>){
 const ids=query.ids===undefined?undefined:new Set(String(query.ids)===''?[]:String(query.ids).split(',').map(id=>z.coerce.number().int().positive().parse(id)));
 const term=z.string().max(500).parse(query.search??'').trim().toLocaleLowerCase();
 const active=query.is_active===undefined?undefined:z.enum(['true','false']).parse(query.is_active)==='true';
 const from=!query.from?undefined:z.string().date().parse(query.from),to=!query.to?undefined:z.string().date().parse(query.to);
 return rows.filter(row=>(!ids||ids.has(Number(row.id)))&&(!term||specs[resource]!.fields.some(key=>String(row[key]??'').toLocaleLowerCase().includes(term)))&&(active===undefined||row.is_active===active)&&(!query.status||String(row.status??'')===query.status)&&(!from||String(row.issue_date??row.purchase_date??row.credit_date??row.updated_at??row.created_at??'').slice(0,10)>=from)&&(!to||String(row.issue_date??row.purchase_date??row.credit_date??row.updated_at??row.created_at??'').slice(0,10)<=to));
}
type Column=[string,string,'text'|'number'|'date'|'id'];
const common:Column[]=[['id','ID','id']];
const columns:Record<string,Column[]>={
 customers:[...common,['name','Name','text'],['phone','Phone','text'],['city','City','text']],
 vendors:[...common,['name','Name','text'],['phone','Phone','text'],['city','City','text'],['address','Address','text']],
 'rate-lists':[...common,['name','Name','text'],['code','Code','text'],['is_active','Active','text'],['created_at','Created','date']],
 invoices:[...common,['invoice_number','Invoice','text'],['customer_name','Customer','text'],['issue_date','Date','date'],['status','Status','text'],['subtotal','Subtotal','number'],['discount_total','Discount','number'],['grand_total','Total','number'],['pass_through_rent','Rent','number'],['customer_payable_total','Payable','number']],
 estimates:[...common,['estimate_number','Estimate','text'],['customer_name','Customer','text'],['issue_date','Date','date'],['status','Status','text'],['subtotal','Subtotal','number'],['discount_total','Discount','number'],['grand_total','Total','number'],['pass_through_rent','Rent','number'],['customer_payable_total','Payable','number']],
 purchases:[...common,['invoice_number','Purchase number','text'],['vendor_name','Vendor','text'],['purchase_date','Date','date'],['subtotal','Subtotal','number'],['discount','Discount','number'],['tax','Tax','number'],['total','Total','number']],
 stock:[...common,['product_id','Product ID','id'],['product_name','Product','text'],['warehouse_id','Warehouse ID','id'],['warehouse_name','Warehouse','text'],['quantity','Quantity','number'],['updated_at','Updated','date']],
 products:[...common,['name','Product','text'],['sku','SKU','text'],['unit','Unit','text'],['purchase_price','Purchase price','number'],['sale_price','Sale price','number']],
 warehouses:[...common,['name','Warehouse','text'],['location','Location','text']],
 returns:[...common,['credit_note_number','Return','text'],['customer_name','Customer','text'],['credit_date','Date','date'],['status','Status','text'],['grand_total','Total','number']],
};
export function registerCsv(resource:string,rows:Row[]){
 const quote=(v:unknown)=>`"${String(v??'').replaceAll('"','""')}"`;
 const field=(v:unknown,type:Column[2])=>{if(v===null||v===undefined||v==='')return '';if(type==='number')return Number.isFinite(Number(v))?Number(v).toFixed(2):'';if(type==='id')return Number.isSafeInteger(Number(v))&&Number(v)>0?String(Number(v)):'';if(type==='date'){const date=String(v).slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))?date:'';}return String(v);};
 const cols=columns[resource]!;return [cols.map(c=>quote(c[1])).join(','),...rows.map(row=>cols.map(c=>quote(field(row[c[0]],c[2]))).join(','))].join('\r\n')+'\r\n';
}
async function databaseRows(resource:string,i:Identity):Promise<Row[]>{
 const db=getSupabaseAdminClient() as any,spec=specs[resource]!;
 async function read(table:string,branch=false){const rows:Row[]=[];for(let offset=0;;offset+=1000){let q=db.from(table).select('*').eq('organization_id',i.organizationId).order('id').range(offset,offset+999);if(branch)q=q.eq('branch_id',i.branchId);const {data,error}=await q;if(error)throw new ApiError(502,'REGISTER_READ_FAILED','Register could not be loaded');rows.push(...data);if(data.length<1000)return rows;}}
 let rows=await read(spec.table,spec.branch);
 if(['invoices','estimates','returns'].includes(resource)){const customers=await read('customers'),names=new Map(customers.map(r=>[r.id,r.name]));rows=rows.map(r=>({...r,customer_name:names.get(r.customer_id)??'',customer_payable_total:Number(r.grand_total??0)+Number(r.pass_through_rent??0)}));}
 if(resource==='purchases'){const vendors=await read('vendors'),names=new Map(vendors.map(r=>[r.id,r.name]));rows=rows.map(r=>({...r,vendor_name:names.get(r.vendor_id)??''}));}
 if(resource==='estimates'&&rows.length){const items:Row[]=[];for(let start=0;start<rows.length;start+=200)for(let offset=0;;offset+=1000){const {data,error}=await db.from('estimate_items').select('*').in('estimate_id',rows.slice(start,start+200).map(r=>r.id)).order('id').range(offset,offset+999);if(error)throw new ApiError(502,'REGISTER_READ_FAILED','Estimate lines could not be loaded');items.push(...data);if(data.length<1000)break;}rows=rows.map(r=>({...r,...calculateEstimateTotals(items.filter(line=>line.estimate_id===r.id) as unknown as Parameters<typeof calculateEstimateTotals>[0],Number(r.pass_through_rent??0))}));}
 if(resource==='stock'){const [products,warehouses]=await Promise.all([read('products'),read('warehouses')]);rows=rows.map(r=>({...r,product_name:products.find(p=>p.id===r.product_id)?.name??'',warehouse_name:warehouses.find(w=>w.id===r.warehouse_id)?.name??''}));}
 return rows;
}
export function createRegisterApiRouter(options:{internalApiToken?:string|undefined;servicePrincipalId?:string|undefined;tenantAuthorizer?:Pick<TenantAccessService,'assertAuthorized'>|undefined;authenticate?:RequestHandler;loadRows?:(resource:string,i:Identity)=>Promise<Row[]>}={}){
 const router=Router(),auth=options.authenticate??createCopilotAuth(options.internalApiToken,options.servicePrincipalId);let authorizer=options.tenantAuthorizer;
 for(const resource of Object.keys(specs)){
  const paths=[resource,...(resource==='purchases'?['browser/purchases']:[])];
  for(const path of paths){
   const handler=(exporting:boolean):RequestHandler=>async(req,res)=>{const i=deletionIdentity(req);authorizer??=new TenantAccessService(createServiceRoleAuthorizationGateway());await authorizer.assertAuthorized({userId:i.userId,organizationId:i.organizationId},specs[resource]!.permission,{kind:'branch',branchId:i.branchId});const rows=filterRegister(await(options.loadRows??databaseRows)(resource,i),resource,req.query);res.setHeader('Cache-Control','no-store');if(exporting){res.type('text/csv').setHeader('Content-Disposition',`attachment; filename="${resource}.csv"`);res.send(registerCsv(resource,rows));return;}const limit=z.coerce.number().int().min(1).max(100).default(50).parse(req.query.limit),cursor=req.query.cursor===undefined?undefined:z.coerce.number().int().positive().parse(req.query.cursor);const available=rows.filter(r=>cursor===undefined||r.id>cursor).sort((a,b)=>a.id-b.id);res.json({data:available.slice(0,limit),next_cursor:available.length>limit?available[limit-1]!.id:null});};
   router.get(`/${path}/export`,auth,handler(true));
   if(['customers','vendors','rate-lists','purchases','invoices'].includes(resource))router.get(`/${path}`,(req,res,next)=>{if(req.query.search===undefined&&req.query.is_active===undefined){next();return;}auth(req,res,error=>error?next(error):void Promise.resolve(handler(false)(req,res,next)).catch(next));});
  }
 }return router;
}
