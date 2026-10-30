export function landedCost(input:{quantity:number;baseUnitCost:number;carriage:number;unloadingPerUnit:number}) {
  if(input.quantity<=0 || [input.quantity,input.baseUnitCost,input.carriage,input.unloadingPerUnit].some(value=>!Number.isFinite(value)||value<0))throw new Error("Invalid landed cost inputs");
  const total=input.quantity*(input.baseUnitCost+input.unloadingPerUnit)+input.carriage;
  return {total,unitCost:total/input.quantity,base:input.quantity*input.baseUnitCost,carriage:input.carriage,unloading:input.quantity*input.unloadingPerUnit};
}
export function rateFreeChallan(input:{number:string;customer:string;site?:string;lines:Array<{name:string;size?:string;quantity:number;unit:string}>}) {
  return {number:input.number,customer:input.customer,...(input.site?{site:input.site}:{}),
    lines:input.lines.map(line=>({checked:false,name:line.name,...(line.size?{size:line.size}:{}),quantity:line.quantity,unit:line.unit})),
    text:[ "ڈسپیچ چلّان "+input.number,input.customer,input.site??"",...input.lines.map(line=>"▢ "+line.name+(line.size?" "+line.size:"")+" — "+line.quantity+" "+line.unit)].filter(Boolean).join("\n")};
}
