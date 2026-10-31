import {describe,it,expect} from 'vitest';
import {normalizeEstimateItem,normalizeSavedEstimateLine} from './estimate-price-aliases.js';
import {ERP_ACTION_SCHEMAS} from './tools/registry.js';
describe('estimate price aliases',()=>{
 it.each([null,0,undefined])('keeps missing/zero price pending: %s',price=>{const item=normalizeEstimateItem({name:'Solution',qty:6,price});expect(item.ratePending).toBe(true);expect(item.rate).toBeUndefined();expect(ERP_ACTION_SCHEMAS.erp_create_estimate.parse({customerId:34,items:[item]}).items).toHaveLength(1)});
 it.each(['rate','price','unit_price'])('normalizes %s without losing a confirmed price',key=>{expect(normalizeEstimateItem({name:'Cloth',qty:5,[key]:30,rateEvidence:'30 per gaz',ratePending:true})).toMatchObject({rate:30,ratePending:false})});
 it('rejects contradictory aliases',()=>expect(()=>normalizeEstimateItem({price:30,unit_price:50})).toThrow());
 it('normalizes a saved unlisted pending line without a fake product ID',()=>expect(normalizeSavedEstimateLine({description:'Solution',quantity:6,unit:'can',price:null})).toMatchObject({product_id:null,is_unlisted:true,is_pending:true,list_price:0}));
});
