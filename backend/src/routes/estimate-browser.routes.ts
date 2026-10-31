import { normalizeSavedEstimateLine } from '../ai-copilot/estimate-price-aliases.js';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { createCopilotAuth } from '../middleware/copilot-auth.js';
import { TenantAccessService } from '../auth/tenant-access.service.js';
import { createServiceRoleAuthorizationGateway } from '../auth/supabase-authorization.gateway.js';
import { ApiError } from '../errors/api-error.js';
import { requireAuthoritativeTransactionIdentity } from './authoritative-transaction-context.js';
import { SupabaseEstimateBrowserRepository, type EstimateBrowserRepository } from '../repositories/estimate-browser.repository.js';
import { assertBrowserSameOrigin } from '../security/browser-origin.js';

const positive=z.number().int().positive(), date=z.string().date();
const filters=z.object({search:z.string().trim().max(120).optional(),status:z.enum(['DRAFT','READY','INVOICED','CANCELLED']).optional(),from:date.optional(),to:date.optional(),limit:z.coerce.number().int().min(1).max(100).default(50),cursor:z.coerce.number().int().positive().optional()});
const line=z.preprocess(normalizeSavedEstimateLine,z.strictObject({id:positive.optional(),product_id:positive.nullable().optional(),is_pending:z.boolean().optional(),is_unlisted:z.boolean().optional(),quantity:z.number().positive().finite(),unit:z.string().trim().min(1).max(50),unit_price:z.number().finite().nonnegative().optional(),list_price:z.number().finite().nonnegative().optional(),discount_percent:z.number().finite().min(0).max(100).optional(),discount_amount:z.number().finite().nonnegative().optional(),description:z.string().trim().max(500).nullable().optional()}).superRefine((l,ctx)=>{
  if(l.list_price===undefined&&l.unit_price===undefined)ctx.addIssue({code:'custom',path:['list_price'],message:'A list or saved rate is required'});
  if(l.discount_percent!==undefined&&l.list_price===undefined)ctx.addIssue({code:'custom',path:['list_price'],message:'List rate is required with a percentage discount'});
  if(l.list_price!==undefined&&l.unit_price!==undefined)ctx.addIssue({code:'custom',path:['unit_price'],message:'Use either list rate or legacy saved rate'});
  if(l.discount_amount!==undefined&&l.discount_percent!==undefined)ctx.addIssue({code:'custom',path:['discount_amount'],message:'Use a percentage or an amount discount, not both'});
  if((l.discount_amount??0)>l.quantity*(l.list_price??l.unit_price??0))ctx.addIssue({code:'custom',path:['discount_amount'],message:'Discount exceeds the line amount'});
}));
const patch=z.strictObject({status:z.enum(['DRAFT','READY','INVOICED','CANCELLED']).optional(),expected_updated_at:z.string().datetime({offset:true}),notes:z.string().max(2000).nullable().optional(),issue_date:date.optional(),customer_id:positive.optional(),document_template:z.enum(['sanitary_electric','building_material']).optional(),pass_through_rent:z.number().finite().nonnegative().optional(),lines:z.array(line).min(1).max(500).optional()}).refine(p=>Object.keys(p).length>1,{message:'Specify a status or editable estimate field'});
export function createEstimateBrowserRouter(options:{repository?:EstimateBrowserRepository;authenticate?:RequestHandler;tenantAuthorizer?:Pick<TenantAccessService,'assertAuthorized'> | undefined;internalApiToken?:string | undefined;servicePrincipalId?:string | undefined}={}){
  const router=Router(), repository=options.repository??new SupabaseEstimateBrowserRepository();
  let tenant=options.tenantAuthorizer;
  router.use(options.authenticate??createCopilotAuth(options.internalApiToken,options.servicePrincipalId));
  async function identity(req:any,write=false){
    let scope:{userId:string;organizationId:string;branchId:string};
    if(req.browserPrincipal){assertBrowserSameOrigin(req);const actor=req.header('X-Actor-User-Id');if(actor&&actor!==req.browserPrincipal.userId)throw new ApiError(403,'FORBIDDEN','Actor does not match authenticated session');scope={userId:req.browserPrincipal.userId,organizationId:z.string().uuid().parse(req.header('X-Organization-Id')),branchId:z.string().uuid().parse(req.header('X-Branch-Id'))};}
    else{const i=requireAuthoritativeTransactionIdentity(req);scope={userId:i.actorUserId,organizationId:i.organizationId,branchId:i.branchId};}
    tenant??=new TenantAccessService(createServiceRoleAuthorizationGateway());
    await tenant.assertAuthorized({userId:scope.userId,organizationId:scope.organizationId},write?'sales.create':'sales.read',{kind:'branch',branchId:scope.branchId});return scope;
  }
  const reference=(value:unknown)=>z.string().trim().min(1).max(100).regex(/^(?:\d+|[A-Za-z0-9_-]+)$/).parse(value);
  router.get('/',async(req,res)=>{const s=await identity(req);res.setHeader('Cache-Control','no-store');res.json(await repository.list(s.organizationId,s.branchId,filters.parse(req.query)));});
  router.get('/:id',async(req,res)=>{const s=await identity(req),record=await repository.get(s.organizationId,s.branchId,reference(req.params.id));if(!record)throw new ApiError(404,'ESTIMATE_NOT_FOUND','Estimate was not found in this workspace');res.setHeader('Cache-Control','no-store');res.json({data:record});});
  router.patch('/:id',async(req,res)=>{const s=await identity(req,true),input=patch.parse(req.body),record=await repository.get(s.organizationId,s.branchId,reference(req.params.id));if(!record)throw new ApiError(404,'ESTIMATE_NOT_FOUND','Estimate was not found in this workspace');await repository.patch(s.organizationId,s.branchId,s.userId,record.id,input);res.setHeader('Cache-Control','no-store');res.json({data:await repository.get(s.organizationId,s.branchId,String(record.id))});});
  return router;
}
