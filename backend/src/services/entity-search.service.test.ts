import { describe, expect, it, vi } from "vitest";
import { SupabaseEntitySearchService, resolveCandidates } from "./entity-search.service.js";
const scope={userId:'u',organizationId:'o',branchId:'b'};
const row={id:1,name:'ELBOW FEMALE 25x1/2',sku:'EF25',unit:'PCS',category:'Fittings',brand_name:'Popular',confidence:.95,match_kind:'fuzzy'};
function setup(data: unknown = [row],error: unknown = null) {
  const rpc=vi.fn(async(_name: string,_args: unknown)=>({data,error}));const from=vi.fn();
  return {rpc,from,search:new SupabaseEntitySearchService(()=>({rpc,from}) as any)};
}
describe('database entity search service',()=>{
  it('makes one bounded RPC with trusted scope and maps only safe fields',async()=>{
    const {rpc,from,search}=setup([{...row,purchase_price:999,organization_id:'hidden'}]);
    const result=await search.searchProducts('EBOW FEM 25*1/2',1,scope);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('search_products_fuzzy',{p_user_id:'u',p_organization_id:'o',p_branch_id:'b',p_query:'EBOW FEM 25*1/2',p_limit:2});
    expect(from).not.toHaveBeenCalled();
    expect(result.bestCandidate).toMatchObject({id:1,brandName:'Popular',sku:'EF25',unit:'PCS'});
    expect(result.items[0]).not.toHaveProperty('purchase_price');
    expect(result.items[0]).not.toHaveProperty('organization_id');
  });
  it('cannot hide ambiguity through limit 1',async()=>{
    const {search}=setup([row,{...row,id:2,confidence:.94}]);
    expect(await search.searchProducts('elbow',1,scope)).toMatchObject({resolution:'ambiguous',requiresClarification:true,bestCandidate:null,hasMore:true,items:[expect.objectContaining({id:1})]});
  });
  it('gives exact SKU priority over a merely similar candidate',()=>{
    expect(resolveCandidates([{...row,confidence:1,match_kind:'exact_sku'},{...row,id:2}],10)).toMatchObject({resolution:'resolved',bestCandidate:{id:1}});
  });
  it('maps customers without leaking phone or unrelated data',async()=>{
    const {search,rpc}=setup([{id:5,name:'Qasim',city:'Lake City',confidence:1,match_kind:'exact_name',phone:'private'}]);
    const result=await search.searchCustomers('Qasim sahib',10,scope);
    expect(rpc.mock.calls[0]?.[0]).toBe('search_customers_fuzzy');
    expect(result.items[0]).not.toHaveProperty('phone');
  });
  it.each(['42501','57014','PGRST202'])('fails closed on RPC error %s with no catalog fallback',async code=>{
    const {search,from}=setup(null,{code});
    await expect(search.searchProducts('elbow',10,scope)).rejects.toMatchObject({status:code==='42501'?403:503});
    expect(from).not.toHaveBeenCalled();
  });
  it.each([NaN,1.1,-.1])('rejects invalid confidence %s',async confidence=>{
    await expect(setup([{...row,confidence}]).search.searchProducts('elbow',10,scope)).rejects.toMatchObject({code:'ENTITY_SEARCH_INVALID_RESULT'});
  });
  it('rejects invalid inputs before database access',async()=>{
    const {search,rpc}=setup();
    await expect(search.searchProducts('elbow',21,scope)).rejects.toMatchObject({status:400});
    await expect(search.searchCustomers('Qasim',10,{...scope,userId:''})).rejects.toMatchObject({status:401});
    expect(rpc).not.toHaveBeenCalled();
  });
});
