import { createCanvas } from "@napi-rs/canvas";
import { expect, it, vi } from "vitest";
import { ProviderBusinessInput } from "../ai-input/business-input.provider.js";
import { MultimodalAgentInput } from "./agent/multimodal-input.js";
import { SlipLearningStore } from "./slipLearningStore.js";

it("expands subsequent vision prompts with newly confirmed shorthand without learning unconfirmed OCR",async()=>{
  let rows:any[]=[];
  const query:any={};for(const name of ["select","eq","order","limit"])query[name]=()=>query;
  query.then=(resolve:any)=>Promise.resolve({data:rows,error:null}).then(resolve);
  const db={from:()=>query,rpc:vi.fn(async(_name:string,args:any)=>{rows=args.p_patterns.map((row:any)=>({...row,usage_count:1}));return {error:null};})};
  const learning=new SlipLearningStore(()=>db);
  const document={customerName:"Faisal",vendorName:null,warehouseName:null,documentNumber:null,documentDate:null,currencyCode:"PKR",
    lines:[{productName:"Dura Max Elbow",productCode:null,brandHint:"Dura Max",quantity:2,unit:"pcs",unitRate:null,discountPercent:null,confidence:.99,rawShorthand:"dm elb 3/4",size:"3/4 inch"}],
    discountPercent:null,subtotal:null,total:null,confidence:.99,warnings:[]};
  const provider={generate:vi.fn(async()=>document),transcribe:vi.fn()};
  const input=new MultimodalAgentInput(new ProviderBusinessInput(provider as any,learning));
  const scope={userId:"actor",organizationId:"org",branchId:"branch"};
  const media={mimeType:"image/png",base64:createCanvas(120,60).toBuffer("image/png").toString("base64")};
  await input.normalize({source:"image",media},scope);
  expect((provider.generate.mock.calls[0] as any)[1]).not.toContain('"raw_shorthand":"dm elb 3/4"');
  expect(db.rpc).not.toHaveBeenCalled();
  await learning.confirm(scope,"confirmed-action",[{raw_shorthand:"dm elb 3/4",verified_item_name:"Dura Max Elbow",verified_size:"3/4 inch",verified_unit:"pcs"}]);
  const next=await input.normalize({source:"image",media},scope);
  expect((provider.generate.mock.calls[1] as any)[1]).toContain('"raw_shorthand":"dm elb 3/4"');
  expect(next.message).toContain('"rawShorthand":"dm elb 3/4"');expect(next.message).toContain('"size":"3/4 inch"');
  expect(db.rpc).toHaveBeenCalledOnce();
});
