import { getSupabaseServiceRoleClient } from '../config/supabase.js';
import { ApiError } from '../errors/api-error.js';
import { isOpenBrandRateList, type RateListRecord } from './rate-list.repository.js';

type Client={from(table:string):any};
export interface RateOverviewQuery {query?:string;rate_list_id?:number;after_id?:number;limit:number;sample_limit:number}
const normalize=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/پاپولر|پاپولار/g,'popular').replace(/ڈیورا|ڈورا|دورا/g,'dura').replace(/فلو/g,'flow').replace(/میکس/g,'max').replace(/[^\p{L}\p{N}]+/gu,'');
const near=(a:string,b:string)=>{
  if(a.includes(b))return true;
  if(b.length<4)return false;
  const distance=(x:string,y:string)=>{let row=Array.from({length:y.length+1},(_,i)=>i);for(let i=1;i<=x.length;i++){const next=[i];for(let j=1;j<=y.length;j++)next[j]=Math.min(next[j-1]!+1,row[j]!+1,row[j-1]!+(x[i-1]===y[j-1]?0:1));row=next;}return row[y.length]!;};
  return distance(a,b)<=1;
};
const fail=(error:{code?:string;message?:string}):never=>{throw new ApiError(502,'RATE_OVERVIEW_UNAVAILABLE',`Rate overview: ${error.code??''} ${error.message??''}`);};
export class CopilotRateOverviewRepository {
  constructor(private readonly clientFactory:()=>Client=()=>getSupabaseServiceRoleClient() as unknown as Client){}
  async inspect(organizationId:string,input:RateOverviewQuery){
    const client=this.clientFactory(),lists:RateListRecord[]=[];
    for(let offset=0;;offset+=500){
      let request=client.from('rate_lists').select('*').eq('organization_id',organizationId).eq('price_type','SALE').order('id').range(offset,offset+499);
      if(input.rate_list_id)request=request.eq('id',input.rate_list_id);else request=request.eq('is_active',true);
      if(input.after_id)request=request.gt('id',input.after_id);
      const {data,error}=await request;if(error)fail(error);lists.push(...(data??[]));if((data??[]).length<500)break;
    }
    const tokens=(input.query??'').trim().split(/\s+/).filter(Boolean).map(normalize).filter(Boolean);
    const matches=lists.filter(list=>(list.scope_type==='GLOBAL'||isOpenBrandRateList(list))&&tokens.every(token=>{
      const label=list.name+' '+list.code;
      return normalize(label).includes(token)||label.split(/\s+/).some(word=>near(normalize(word),token));
    }));
    const now=new Date().toISOString();
    const items=await Promise.all(matches.slice(0,input.limit).map(async list=>{
      const {data:versions,error}=await client.from('rate_list_versions').select('id,version_number,status,effective_from,effective_to,standard_discount_percent')
        .eq('rate_list_id',list.id).eq('status','ACTIVE').lte('effective_from',now).or(`effective_to.is.null,effective_to.gt.${now}`)
        .order('effective_from',{ascending:false}).order('version_number',{ascending:false}).limit(1);
      if(error)fail(error);const version=versions?.[0];
      const metadata={id:list.id,code:list.code,name:list.name,isActive:list.is_active,currency:list.currency_code,scope:list.scope_type};
      if(!version||!list.is_active)return {...metadata,status:'NO_CURRENT_ACTIVE_VERSION',version:null,totalItems:null,priceRange:null,samples:[],authoritative:true};
      const products=new Map<number,{id:number;name:string;sku:string;category:string;unit:string}>();
      const categories:Record<string,number>={},breakdown={pipes:0,fittings:0,other:0};
      let totalRateRows=0,min:number|null=null,max:number|null=null,invalidRateRows=0;
      const units=new Set<string>(),samples:any[]=[];
      for(let offset=0;;offset+=500){
        const {data:rows,error:itemError}=await client.from('rate_list_items').select('id,product_id,unit_price,unit,minimum_quantity,products!inner(id,name,sku,category,organization_id)')
          .eq('rate_list_version_id',version.id).eq('products.organization_id',organizationId).order('id').range(offset,offset+499);
        if(itemError)fail(itemError);
        for(const row of rows??[]){
          const product=Array.isArray(row.products)?row.products[0]:row.products;if(!product)continue;
          totalRateRows++;units.add(row.unit);
          const price=Number(row.unit_price),valid=row.unit_price!==null&&Number.isFinite(price)&&price>=0;
          if(valid){min=min===null?price:Math.min(min,price);max=max===null?price:Math.max(max,price);}else invalidRateRows++;
          if(!products.has(product.id)){
            products.set(product.id,{...product,unit:row.unit});categories[product.category]=(categories[product.category]??0)+1;
            const label=product.category+' '+product.name;
            const fitting=/fitting|elbow|tee\b|socket|coupl|union|nipple|adapto?r|end\s*cap|valve|trap|پلگ|البو|ساکٹ|فٹنگ/i.test(label);
            if(fitting)breakdown.fittings++;else if(/pipe|پائپ/i.test(label))breakdown.pipes++;else breakdown.other++;
            if(samples.length<input.sample_limit)samples.push({productId:product.id,name:product.name,sku:product.sku,category:product.category,unit:row.unit,catalogRate:valid?price:null,minimumQuantity:row.minimum_quantity});
          }
        }
        if((rows??[]).length<500)break;
      }
      return {...metadata,status:version.status,versionId:version.id,versionNumber:version.version_number,effectiveFrom:version.effective_from,effectiveTo:version.effective_to,
        standardDiscountPercent:version.standard_discount_percent??null,totalItems:products.size,totalRateRows,breakdown,categories,
        breakdownBasis:'Distinct organization products, grouped by category/name; unknown families kept as other',
        priceRange:{min,max,currency:list.currency_code,basis:'Stored catalog unit_price before standard discount',units:[...units]},invalidRateRows,samples,sampleBasis:'First distinct catalog products in stored row order, not a sales ranking',complete:true,authoritative:true};
    }));
    return {items,count:items.length,hasMore:matches.length>input.limit,nextCursor:matches.length>input.limit?items.at(-1)?.id:null,asOf:now,authoritative:true};
  }
}
