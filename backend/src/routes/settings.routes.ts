import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { deletionIdentity } from './record-deletion.routes.js';
import { createCopilotAuth } from '../middleware/copilot-auth.js';
import { TenantAccessService } from '../auth/tenant-access.service.js';
import { createServiceRoleAuthorizationGateway } from '../auth/supabase-authorization.gateway.js';
import { ERP_ROLES } from '../auth/authorization.types.js';
import { getSupabaseAdminClient } from '../config/supabase.js';
import { ApiError } from '../errors/api-error.js';
const text=z.string().trim().max(2000),currency=z.string().regex(/^[A-Z]{3}$/);
const company=z.strictObject({name:text,phone:text,address:text,tax_registration:text,currency}).partial();
const sequence=z.strictObject({prefix:z.string().trim().min(1).max(20),next:z.number().int().positive()}).partial();
const schemas={company,numbering:z.strictObject({estimate:sequence,invoice:sequence,purchase:sequence}).partial(),templates:z.strictObject({estimate:text,invoice:text,purchase:text}).partial(),'tax-currency':z.strictObject({currency,tax_percent:z.number().min(0).max(100)}).partial()};
const sectionName=z.enum(['company','numbering','templates','tax-currency']);
const rootInput=z.strictObject({company:company.optional(),numbering:schemas.numbering.optional(),templates:schemas.templates.optional(),'tax-currency':schemas['tax-currency'].optional(),name:text.optional(),phone:text.optional(),address:text.optional(),tax_registration:text.optional(),currency:currency.optional()}).refine(v=>Object.keys(v).length>0,'Provide settings to save');
export function createSettingsRouter(options:{internalApiToken?:string|undefined;servicePrincipalId?:string|undefined;tenantAuthorizer?:Pick<TenantAccessService,'assertAuthorized'>|undefined;authenticate?:RequestHandler;dbFactory?:()=>any}={}) {
 const router=Router();let authorizer=options.tenantAuthorizer;const database=options.dbFactory??getSupabaseAdminClient;
 router.use(options.authenticate??createCopilotAuth(options.internalApiToken,options.servicePrincipalId));
 router.use(async(req,_res,next)=>{const i=deletionIdentity(req);authorizer??=new TenantAccessService(createServiceRoleAuthorizationGateway());await authorizer.assertAuthorized({userId:i.userId,organizationId:i.organizationId},'organization.manage',{kind:'branch',branchId:i.branchId});next();});
 async function read(organizationId:string){const db=database();const [settings,users]=await Promise.all([db.from('organization_settings').select('section,value').eq('organization_id',organizationId),db.from('organization_memberships').select('user_id,role,status').eq('organization_id',organizationId)]);if(settings.error||users.error)throw new ApiError(502,'SETTINGS_FAILED','Settings could not be loaded');const values=Object.fromEntries(settings.data.map((r:any)=>[r.section,r.value]));return {settings:values,...values,users:users.data};}
 router.get('/',async(req,res)=>{res.setHeader('Cache-Control','no-store');res.json({data:await read(deletionIdentity(req).organizationId)});});
 router.get('/users',async(req,res)=>{res.setHeader('Cache-Control','no-store');res.json({data:(await read(deletionIdentity(req).organizationId)).users});});
 router.get('/roles',async(_req,res)=>{const {data,error}=await(database() as any).from('role_permissions').select('role,permission_code');if(error)throw new ApiError(502,'SETTINGS_FAILED','Role permissions could not be loaded');res.setHeader('Cache-Control','no-store');res.json({data:ERP_ROLES.map(role=>({role,permissions:data.filter((r:any)=>r.role===role).map((r:any)=>r.permission_code)}))});});
 async function save(req:any,res:any,updates:Record<string,unknown>,section?:string){const i=deletionIdentity(req);const {error}=await(database() as any).rpc('save_organization_settings',{p_organization_id:i.organizationId,p_actor_user_id:i.userId,p_updates:updates});if(error)throw new ApiError(error.code==='42501'?403:502,'SETTINGS_FAILED','Settings could not be saved');const saved=await read(i.organizationId);res.json({data:section?saved.settings[section]:saved});}
 const rootSave:RequestHandler=async(req,res)=>{const input=rootInput.parse(req.body),updates:Record<string,unknown>={};for(const key of sectionName.options)if(input[key])updates[key]=input[key];const flat=Object.fromEntries(['name','phone','address','tax_registration','currency'].filter(key=>key in input).map(key=>[key,(input as any)[key]]));if(Object.keys(flat).length)updates.company={...flat,...((updates.company as object)??{})};await save(req,res,updates);};
 router.post('/',rootSave);router.put('/',rootSave);router.patch('/',rootSave);
 const assign:RequestHandler=async(req,res)=>{const i=deletionIdentity(req),input=z.strictObject({user_id:z.string().uuid().optional(),role:z.enum(ERP_ROLES)}).parse(req.body),userId=z.string().uuid().parse(req.params.userId??input.user_id);const {error}=await(database() as any).rpc('update_organization_role',{p_organization_id:i.organizationId,p_actor_user_id:i.userId,p_user_id:userId,p_role:input.role});if(error)throw new ApiError(error.code==='23514'?409:error.code==='42501'?403:400,'ROLE_UPDATE_REFUSED',error.message);res.json({data:{user_id:userId,role:input.role}});};
 router.patch('/users/:userId',assign);router.put('/users/:userId',assign);router.post('/users',assign);router.put('/users',assign);
 router.get('/:section',async(req,res)=>{const section=sectionName.parse(req.params.section),data=await read(deletionIdentity(req).organizationId);res.setHeader('Cache-Control','no-store');res.json({data:data.settings[section]??{}});});
 const sectionSave:RequestHandler=async(req,res)=>{const section=sectionName.parse(req.params.section),value=schemas[section].parse(req.body);if(!Object.keys(value).length)throw new ApiError(400,'SETTINGS_INVALID','Provide settings to save');await save(req,res,{[section]:value},section);};
 router.patch('/:section',sectionSave);router.put('/:section',sectionSave);router.post('/:section',sectionSave);
 return router;
}
