import { describe, expect, it, vi } from "vitest";
import { SupabaseEntitySearchService, resolveCandidates, normalizeProductSearchQuery } from "./entity-search.service.js";
import {canonicalSlipWords} from "../ai-copilot/conversationalMunshi.js";
const scope={userId:'u',organizationId:'o',branchId:'b'};
const row={id:1,name:'ELBOW FEMALE 25x1/2',sku:'EF25',unit:'PCS',category:'Fittings',brand_name:'Popular',confidence:.95,match_kind:'fuzzy'};
function setup(data: unknown = [row],error: unknown = null) {
  const rpc=vi.fn(async(_name: string,_args: unknown)=>({data,error}));const from=vi.fn();
  return {rpc,from,search:new SupabaseEntitySearchService(()=>({rpc,from}) as any)};
}
describe('database entity search service',()=>{
  it('selects an exact fitting family over equal-score mixer and angle variants',async()=>{
    const {search}=setup([{...row,name:'Dura Max Elbow 25 mm',brand_name:'Dura Max'},
      {...row,id:2,name:'Dura Max Mixer Elbow 25 mm',brand_name:'Dura Max'},
      {...row,id:3,name:'Dura Max Elbow 45 25 mm',brand_name:'Dura Max'}]);
    expect(await search.searchProducts('Elbow 25mm',5,scope,'Dura Max')).toMatchObject({resolution:'resolved',bestCandidate:{id:1}});
  });
  it.each(['Dura Max PPR-C','Dura Max U-PVC'])('verifies omitted product material through the scoped active catalog heading: %s',async heading=>{
    const f=setup([{...row,name:'Dura Max Elbow 25 mm',brand_name:'Dura Max'}]);
    const result=Promise.resolve({data:[{product_id:1,rate_list_versions:{rate_lists:{name:heading}}}],error:null});
    const table:any={select:()=>table,in:()=>table,eq:vi.fn(()=>table),then:result.then.bind(result)};f.from.mockReturnValue(table);
    const matched=await f.search.searchProducts('PPR-C Elbow 25mm',5,scope,'Dura Max');
    expect(matched.resolution).toBe(heading.includes('PPR-C')?'resolved':'no_match');
    expect(table.eq).toHaveBeenCalledWith('rate_list_versions.rate_lists.organization_id',scope.organizationId);
  });
  it.each([
    ['ایلو 25 ایم ایم','Elbow 25 mm'],['ٹی ساکٹ 32mm','Tee 32mm'],['پی ٹرپ چار انچ','P-Trap 4 inch'],
    ['Elbow پونا انچ','Elbow 25mm'],['PPRC Pipe ایک انچ','PPR-C Pipe 32mm'],['U-PVC Pipe ایک انچ','U-PVC Pipe 1 inch'],
    ['Elbow 25','Elbow 25mm'],['PPRC Pipe PN-16 25mm','PPR-C Pipe PN-16 25mm'],
  ])('preserves shop diameter phonics for %s',async(input,expected)=>{
    const {search,rpc}=setup([]);await search.searchProducts(input,5,scope);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({p_query:expected});
  });
  it.each([
    ['ELBOW KA KIA RATE HY', 'ELBOW'],
    ['ELBOOW 25*1/2 KA RATE KIA HY', 'elbow 25*1/2'],
    ['PIPE 25MM RATE KIA HY', 'PIPE 25MM'],
    ['POPULAR PIPE PN-20 25 MM MTR ka rate hai?', 'POPULAR PIPE PN-20 25 MM MTR'],
    ['ELBOOW 25x1/2 PCS ki kya rate hai؟', 'elbow 25x1/2 PCS'],
    ['ELBOW 25*1/2', 'ELBOW 25*1/2'],
    ['What PIPE 25MM', 'PIPE 25MM'],
    ['What is the rate of Dura Max PPRC Pipe PN-16 25mm?', 'Dura Max PPRC Pipe PN-16 25mm'],
    ['ڈیورا میکس یو پی وی سی ایلبو 90 ڈگری 2 انچ کا ریٹ بتاؤ','ڈیورا میکس یو پی وی سی ایلبو 90 ڈگری 2 انچ'],
  ])('keeps the catalog query and dimensions from %s', async (input, expected) => {
    const {search,rpc}=setup();
    expect(normalizeProductSearchQuery(input)).toBe(expected);
    await search.searchProducts(input,10,scope);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({p_query:canonicalSlipWords(expected)});
  });
  it('does not turn equally ranked size variants into a chosen product',async()=>{
    const {search}=setup([row,{...row,id:2,name:'ELBOW 25x3/4',confidence:.94}]);
    expect(await search.searchProducts('ELBOOW 25*1/2 KA RATE KIA HY',10,scope))
      .toMatchObject({resolution:'ambiguous',bestCandidate:null,requiresClarification:true});
  });
  it('normalizes spoken uPVC and an explicit elbow angle without losing the size',async()=>{
    const {search,rpc}=setup([{...row,id:269,name:'DURA MAX ELBOW 90° 2"',brand_name:'DURA MAX'}]);
    expect(await search.searchProducts('uPVC Elbow 90 2 inch',10,scope,'Dura Max')).toMatchObject({resolution:'resolved',bestCandidate:{id:269}});
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({p_query:'U-PVC Elbow 90° 2 inch',p_brand:'Dura Max'});
    expect(await search.searchProducts('uPVC Elbow 45 2 inch',10,scope,'Dura Max')).toMatchObject({resolution:'no_match'});
  });

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
