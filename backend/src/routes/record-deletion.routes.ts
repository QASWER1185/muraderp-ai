import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { createCopilotAuth } from '../middleware/copilot-auth.js';
import { requireAuthoritativeTransactionIdentity } from './authoritative-transaction-context.js';
import { TenantAccessService } from '../auth/tenant-access.service.js';
import { createServiceRoleAuthorizationGateway } from '../auth/supabase-authorization.gateway.js';
import type { PermissionCode } from '../auth/authorization.types.js';
import { getSupabaseAdminClient } from '../config/supabase.js';
import { ApiError } from '../errors/api-error.js';

const targets: [string, string, PermissionCode][] = [
  ['customers','customers','customers.write'], ['vendors','vendors','vendors.write'],
  ['products','products','products.write'], ['warehouses','warehouses','inventory.adjust'],
  ['estimates','estimates','sales.create'], ['invoices','invoices','sales.create'],
  ['purchases','purchases','purchases.create'], ['rate-lists','rate_lists','products.write'],
  ['rate-lists/versions','rate_list_versions','products.write'], ['returns','credit_notes','returns.create'],
  ['payments','customer_payments','payments.create'], ['customer-payments','customer_payments','payments.create'],
  ['vendor-payments','vendor_payments','payments.create'],
];
export function deletionIdentity(request: Request) {
  if (!request.browserPrincipal) {
    const i = requireAuthoritativeTransactionIdentity(request);
    return { userId:i.actorUserId, organizationId:i.organizationId, branchId:i.branchId };
  }
  const origin=request.header('Origin');
  const site=request.header('Sec-Fetch-Site');
  const host=origin && URL.canParse(origin) ? new URL(origin).host : null;
  if(site==='cross-site' || (origin && (!host || (host!==request.get('host') && !(site==='same-origin' && host===request.header('X-Forwarded-Host')))))) {
    throw new ApiError(403,'FORBIDDEN','Same-origin request required');
  }
  const actor=request.header('X-Actor-User-Id');
  if(actor && actor!==request.browserPrincipal.userId) throw new ApiError(403,'FORBIDDEN','Actor does not match authenticated session');
  return {userId:request.browserPrincipal.userId,organizationId:z.string().uuid().parse(request.header('X-Organization-Id')),branchId:z.string().uuid().parse(request.header('X-Branch-Id'))};
}
export function createRecordDeletionRouter(options: {
  internalApiToken?: string | undefined; servicePrincipalId?: string | undefined;
  authenticate?: RequestHandler; tenantAuthorizer?: Pick<TenantAccessService,'assertAuthorized'> | undefined;
  remove?: (args: Record<string, unknown>)=>Promise<{data:unknown;error:{code?:string;message?:string}|null}>;
  removeVersion?: (args: Record<string, unknown>)=>Promise<{data:unknown;error:{code?:string;message?:string}|null}>;
}={}) {
  const router=Router();
  const authenticate=options.authenticate??createCopilotAuth(options.internalApiToken,options.servicePrincipalId);
  let authorizer=options.tenantAuthorizer;
  router.delete('/rate-lists/:id/versions/:vid',authenticate,async(request,response)=>{
    const i=deletionIdentity(request);authorizer??=new TenantAccessService(createServiceRoleAuthorizationGateway());
    await authorizer.assertAuthorized({userId:i.userId,organizationId:i.organizationId},'products.write',{kind:'branch',branchId:i.branchId});
    const positive=z.coerce.number().int().positive();
    const args={p_list_id:positive.parse(request.params.id),p_version_id:positive.parse(request.params.vid),p_organization_id:i.organizationId,p_branch_id:i.branchId,p_actor_user_id:i.userId};
    const {data,error}=options.removeVersion?await options.removeVersion(args):await(getSupabaseAdminClient() as any).rpc('delete_rate_list_version_scoped',args);
    if(error)throw new ApiError(error.code==='23514'||error.code==='23503'?409:error.code==='42501'?403:502,'DELETE_REFUSED',['23514','23503'].includes(error.code??'')?error.message??'Referenced records prevent deletion':'Version could not be deleted');
    if(!data)throw new ApiError(404,'NOT_FOUND','record not found');response.status(204).send();
  });
  for(const [path,entity,permission] of targets) router.delete(`/${path}/:id`,authenticate,async(request,response)=>{
    const identity=deletionIdentity(request);
    authorizer??=new TenantAccessService(createServiceRoleAuthorizationGateway());
    await authorizer.assertAuthorized({userId:identity.userId,organizationId:identity.organizationId},permission,{kind:'branch',branchId:identity.branchId});
    const args={p_entity:entity,p_id:z.coerce.number().int().positive().parse(request.params.id),p_organization_id:identity.organizationId,p_branch_id:identity.branchId,p_actor_user_id:identity.userId};
    const result=options.remove ? await options.remove(args) : await (getSupabaseAdminClient() as any).rpc('delete_unused_record',args);
    if(result.error) {
      const status=result.error.code==='42501'?403:['23503','23514'].includes(result.error.code??'')?409:502;
      throw new ApiError(status,'DELETE_REFUSED',status===502?'Deletion could not be completed':result.error.message??'Linked records prevent deletion');
    }
    if(!result.data) throw new ApiError(404,'NOT_FOUND','Record was not found in this workspace');
    response.status(204).send();
  });
  return router;
}
