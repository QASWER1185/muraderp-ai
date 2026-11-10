import express from 'express';
import request from 'supertest';
import {it,expect,vi} from 'vitest';
import {createRecordDeletionRouter} from './record-deletion.routes.js';
import {errorHandler} from '../middleware/error-handler.js';
const org='11111111-1111-4111-8111-111111111111',branch='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333';
const headers={'X-Organization-Id':org,'X-Branch-Id':branch};
function setup(){const remove=vi.fn().mockResolvedValue({data:true,error:null}),assertAuthorized=vi.fn().mockResolvedValue(undefined);const app=express();app.use(createRecordDeletionRouter({remove,tenantAuthorizer:{assertAuthorized},authenticate:(req,_res,next)=>{req.browserPrincipal={userId:actor};(req as any).log={warn:vi.fn(),error:vi.fn()};next();}}));app.use(errorHandler);return {app,remove,assertAuthorized};}
it.each(['customers','vendors','products','warehouses','estimates','invoices','purchases','rate-lists','rate-lists/versions','returns','payments','vendor-payments'])('scopes DELETE %s to the authenticated actor and workspace',async path=>{const {app,remove}=setup();expect((await request(app).delete(`/${path}/7`).set(headers)).status).toBe(204);expect(remove).toHaveBeenCalledWith(expect.objectContaining({p_id:7,p_organization_id:org,p_branch_id:branch,p_actor_user_id:actor}));});
it('returns a clear conflict for linked records and a 404 for another tenant',async()=>{const {app,remove}=setup();remove.mockResolvedValueOnce({data:null,error:{code:'23514',message:'Cannot delete: linked stock movements exist.'}});let response=await request(app).delete('/invoices/7').set(headers);expect(response.status).toBe(409);expect(response.body.error.message).toContain('stock movements');remove.mockResolvedValueOnce({data:false,error:null});expect((await request(app).delete('/invoices/7').set(headers)).status).toBe(404);});
it('blocks cross-site requests before accessing data',async()=>{const {app,remove}=setup();expect((await request(app).delete('/customers/7').set(headers).set('Sec-Fetch-Site','cross-site')).status).toBe(403);expect(remove).not.toHaveBeenCalled();});
