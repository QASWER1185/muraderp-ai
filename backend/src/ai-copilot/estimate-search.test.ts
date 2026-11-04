import {describe,it,expect} from 'vitest';
import {SupabaseEstimateBrowserRepository} from '../repositories/estimate-browser.repository.js';
import {matchesEstimateSearch} from './estimate-search.js';

const record={estimate_number:'EST-1069',customer_name:'Owais Sahab',lines:[{description:'Dora Flow conduit 25mm',products:{name:'Electric conduit'},product_name:'Dora Flow conduit 25mm'}]};
describe('saved estimate keyword search',()=>{
 it.each(['electric conduit','کنڈیوٹ','Dora Flow','EST-1069','Owais'])('matches %s from saved evidence',search=>expect(matchesEstimateSearch(record,search)).toBe(true));
 it('recognizes Dora Flow as the saved DURAFLOW brand',()=>expect(matchesEstimateSearch({...record,lines:[{product_name:'DURAFLOW CONDUIT PIPE'}]},'Dora Flow')).toBe(true));
 it('does not substitute an unrelated customer',()=>expect(matchesEstimateSearch(record,'Faisal')).toBe(false));
 it('matches product names when a custom description differs',()=>expect(matchesEstimateSearch({...record,lines:[{description:'custom label',products:{name:'PPR-C elbow'}}]},'PPRC')).toBe(true));
 it('includes drafts, joins lines and orders by creation timestamp before applying limit',async()=>{
  const calls:any[]=[];
  const headers=[{id:8,estimate_number:'EST-1069',customer_id:1,status:'DRAFT',created_at:'2026-11-01T10:00:00Z'},{id:99,estimate_number:'EST-OLD',customer_id:2,status:'READY',created_at:'2026-10-01T00:00:00Z'}];
  const client={from:(table:string)=>{
   const q:any={};for(const method of ['select','eq','in','order','range'])q[method]=(...args:any[])=>{calls.push([table,method,...args]);return q;};
   q.then=(resolve:any)=>Promise.resolve({data:table==='estimates'?headers:table==='customers'?[{id:1,name:'Owais Sahab'},{id:2,name:'Faisal'}]:headers.map(r=>({estimate_id:r.id,description:'Dora Flow conduit',quantity:1,unit_price:100,line_number:1})),error:null}).then(resolve);
   return q;
  }};
  const result=await new SupabaseEstimateBrowserRepository(()=>client).list('org','branch',{search:'کنڈیوٹ',limit:1,deepSearch:true});
  expect(result.data[0]).toMatchObject({estimate_number:'EST-1069',customer_name:'Owais Sahab',status:'DRAFT',total_amount:100,line_item_summary:[{name:'Dora Flow conduit'}]});
  expect(calls).toContainEqual(['estimates','order','created_at',{ascending:false}]);
  expect(calls).toContainEqual(['estimates','eq','organization_id','org']);
  expect(calls).toContainEqual(['estimates','eq','branch_id','branch']);
  expect(calls.some(x=>x[0]==='estimates'&&x[1]==='eq'&&x[2]==='status')).toBe(false);
 });
});
