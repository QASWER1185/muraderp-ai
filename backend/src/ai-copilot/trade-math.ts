import { z } from 'zod';

const money=z.number().finite().nonnegative();
const percent=z.number().finite().min(0).max(100);
const common={quantity:z.number().finite().positive().default(1),carriage:money.default(0),evidence:z.string().trim().min(1).max(4000)};
export const tradeMathSchema=z.union([
  z.strictObject({...common,basis:z.literal('trade_discount'),list_price:money,purchase_discount_percent:percent,sale_discount_percent:percent}),
  z.strictObject({...common,basis:z.literal('cost'),sale_price:money,cost_price:money}),
]);
export type TradeMathInput=z.input<typeof tradeMathSchema>;
export const roundMoney=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
/** A quoted scenario, not realized ledger profit. Carriage is a liability/pass-through. */
export function calculateTradeMargin(raw:TradeMathInput){
  const input=tradeMathSchema.parse(raw);
  const sale=input.basis==='trade_discount'?input.list_price*(1-input.sale_discount_percent/100):input.sale_price;
  const cost=input.basis==='trade_discount'?input.list_price*(1-input.purchase_discount_percent/100):input.cost_price;
  const revenue=roundMoney(input.quantity*sale),totalCost=roundMoney(input.quantity*cost);
  return {visibility:'INTERNAL_ONLY',basis:'USER_SUPPLIED_SCENARIO',currency:'PKR',quantity:input.quantity,
    revenue,cost:totalCost,gross_profit:roundMoney(revenue-totalCost),net_profit_before_operating_expenses:roundMoney(revenue-totalCost),
    margin_percent:revenue?roundMoney((revenue-totalCost)/revenue*100):null,
    pass_through_carriage:input.carriage,customer_payable:roundMoney(revenue+input.carriage),
    formula:input.basis==='trade_discount'?'List × quantity × (purchase discount − sale discount) / 100':'(Sale − cost) × quantity'};
}

// Strip private accounting fields at the customer-document boundary, recursively.
export function customerDocument<T>(value:T):T{
  if(Array.isArray(value))return value.map(customerDocument) as T;
  if(!value||typeof value!=='object')return value;
  const privateKeys=new Set(['privateMargin','unitCost','unit_cost','merchantUnitCost','costSource','available','cogs_total','estimated_cost','estimated_cost_unit_price','grossProfit','gross_profit','profit_loss','margin_percent','purchase_price','cost_price','purchase_cost','cost','estimatedCost','total_estimated_cost','private_margin','purchase_discount_percent']);
  return Object.fromEntries(Object.entries(value).filter(([key])=>!privateKeys.has(key)).map(([key,v])=>[key,customerDocument(v)])) as T;
}
