import {describe,it,expect,vi} from 'vitest';
import {CopilotRateListActivation} from './rate-list-activation.js';
function fixture(role='manager') {const q:any={};for(const k of ['select','eq'])q[k]=()=>q;q.maybeSingle=async()=>({data:{role},error:null});const repo:any={getRateList:vi.fn(async()=>({id:13,name:'Popular UPVC',is_active:true})),listVersions:vi.fn(async()=>[{id:15,version_number:1,status:'DRAFT'}]),publishVersion:vi.fn(async()=>({id:15,status:'ACTIVE'}))};return {repo,service:new CopilotRateListActivation(repo,()=>({from:()=>q}))};}
describe('scoped rate-list activation',()=>{
it('publishes the exact approved newest draft for a manager',async()=>{const f=fixture();expect(await f.service.activate('org','actor',13,15)).toMatchObject({rateListId:13,versionId:15,status:'ACTIVE'});expect(f.repo.getRateList).toHaveBeenCalledWith(13,'org');expect(f.repo.publishVersion).toHaveBeenCalledWith(15,'org');});
it('blocks non-manager roles',async()=>{const f=fixture('inventory');await expect(f.service.prepare('org','actor',13)).rejects.toMatchObject({status:403});expect(f.repo.publishVersion).not.toHaveBeenCalled();});
it('rejects a foreign organization list',async()=>{const f=fixture();f.repo.getRateList.mockResolvedValue(null);await expect(f.service.prepare('org','actor',13)).rejects.toMatchObject({status:404});});
it('rejects stale approval when a newer draft exists',async()=>{const f=fixture();f.repo.listVersions.mockResolvedValue([{id:17,version_number:2,status:'DRAFT'},{id:15,version_number:1,status:'DRAFT'}]);await expect(f.service.activate('org','actor',13,15)).rejects.toMatchObject({status:409});expect(f.repo.publishVersion).not.toHaveBeenCalled();});
});
