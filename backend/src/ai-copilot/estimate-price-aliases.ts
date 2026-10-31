import { ApiError } from '../errors/api-error.js';
export function normalizeEstimateItem(row:any):any {
  const values=[row.rate,row.price,row.unit_price].filter(v=>v!=null);
  if(values.some(v=>v!==values[0]))throw new ApiError(422,'ESTIMATE_PRICE_CONFLICT','Supply one consistent per-unit price.');
  const {price:_p,unit_price:_u,...item}=row;
  const value=values[0];
  if(value==null || (value===0&&!row.rateEvidence)){delete item.rate;if(['rate','price','unit_price'].some(k=>Object.hasOwn(row,k)))item.ratePending=true;}
  else {item.rate=value;item.ratePending=false;}
  return item;
}
export function normalizeEstimateInput(input:any):any {
  return {...input,...Object.fromEntries(['items','addItems','updateItems'].filter(k=>Array.isArray(input[k])).map(k=>[k,input[k].map(normalizeEstimateItem)])),...(input.updateLines?{updateLines:input.updateLines.map((r:any)=>({...r,changes:normalizeEstimateItem(r.changes)}))}:{})};
}

export function normalizeSavedEstimateLine(raw:unknown):unknown {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return raw;
  const row:any={...raw}; const prices=[row.list_price,row.unit_price,row.price].filter(v=>v!=null);
  if(prices.some(v=>v!==prices[0]))throw new ApiError(422,'ESTIMATE_PRICE_CONFLICT','Supply one consistent per-unit price.');
  if(row.list_price==null)delete row.list_price;if(row.unit_price==null)delete row.unit_price;
  if(row.price!=null||prices.length>1){row.list_price=prices[0];delete row.unit_price;}delete row.price;
  if(!prices.length){row.list_price=0;row.is_pending=true;}
  if(row.product_id==null){row.product_id=null;row.is_unlisted=true;}
  return row;
}
