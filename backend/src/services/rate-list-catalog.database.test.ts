import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { expect, it, vi } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
vi.mock("../config/env.js",async importOriginal=>{
  const original=await importOriginal<typeof import("../config/env.js")>();
  return {...original,env:{...original.env,INTERNAL_API_TOKEN:randomBytes(32).toString("hex")}};
});
import express from "express";
import request from "supertest";
import { createCanvas, PDFDocument } from "@napi-rs/canvas";
import { duraUpvcPages } from "../ai-copilot/catalog.test-fixtures.js";
import { CopilotRuntime } from "../ai-copilot/copilot.runtime.js";
import { DefaultRateListService } from "./rate-list.service.js";
import { UnifiedCopilotAgent } from "../ai-copilot/agent/agent.js";
import { ErpToolRegistry } from "../ai-copilot/agent/erp-tools.js";
import { CopilotAgent } from "../ai-copilot/copilot-agent.js";
import { MultimodalAgentInput } from "../ai-copilot/agent/multimodal-input.js";
import { ProviderBusinessInput } from "../ai-input/business-input.provider.js";
import { createAiCopilotRouter } from "../routes/ai-copilot.routes.js";
import { errorHandler } from "../middleware/error-handler.js";
import { env } from "../config/env.js";

// Action checkpoints use the established runtime test gateway. Product/rate-list
// writes and independent reads below execute the real PostgreSQL import SQL.
function actionDatabase() {
  const rows:any[]=[];
  return {from:()=>{
    const q:any={};const filters:Array<[string,unknown]>=[];let update:any,insert:any;
    q.select=()=>q;q.eq=(field:string,value:unknown)=>{filters.push([field,value]);return q;};
    q.update=(value:any)=>{update=value;return q;};q.insert=(value:any)=>{insert=value;return q;};
    q.single=q.maybeSingle=async()=>{
      if(insert){const row={id:"55555555-5555-4555-8555-"+String(rows.length+1).padStart(12,"0"),...insert};rows.push(row);return {data:row,error:null};}
      const row=rows.find(row=>filters.every(([field,value])=>row[field]===value));if(row&&update)Object.assign(row,update);
      return {data:row??null,error:null};
    };
    q.then=(resolve:any,reject:any)=>q.single().then(resolve,reject);return q;
  }};
}

it("imports catalogs atomically and confirms all 35 conduit rows through Urdu, Roman Urdu and voice without duplicates", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table organizations(id uuid primary key);
      create table brands(id bigint generated always as identity primary key,organization_id uuid,name text);
      create table products(id bigint generated always as identity primary key,organization_id uuid,brand_id bigint references brands(id),name text,sku text unique,category text,unit text,purchase_price numeric,sale_price numeric);
      create table rate_lists(id bigint generated always as identity primary key,organization_id uuid,name text,code text,price_type text,scope_type text,currency_code text,is_active boolean);
      create table rate_list_versions(id bigint generated always as identity primary key,rate_list_id bigint references rate_lists(id),version_number integer,status text,effective_from timestamptz,effective_to timestamptz);
      create unique index active_version on rate_list_versions(rate_list_id) where status='ACTIVE';
      create table rate_list_items(id bigint generated always as identity primary key,rate_list_version_id bigint references rate_list_versions(id),product_id bigint references products(id),minimum_quantity numeric,unit_price numeric,unit text,unique(rate_list_version_id,product_id,minimum_quantity));
      insert into organizations values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
    `);
    await db.exec(await readFile(new URL("../../../supabase/migrations/20261019090000_copilot_catalog_import.sql",import.meta.url),"utf8"));
    await db.exec(await readFile(new URL("../../../supabase/migrations/20261021100000_copilot_partial_catalog_import.sql",import.meta.url),"utf8"));
    const catalog={documentType:"rate_list",name:"Dura Flow PPRC",complete:true,standardDiscountPercent:50,items:Array.from({length:132},(_,i)=>({brand:"Dura Flow",category:"Fittings",name:"Socket",size:i+"mm",unit:"pcs",list_price:43+i}))};
    const run=(key:string,value:unknown=catalog,org="11111111-1111-4111-8111-111111111111")=>db.query<{result:any}>("select import_rate_list_catalog($1,$2,$3::jsonb) result",[org,key,JSON.stringify(value)]);
    const first=(await run("catalog-1")).rows[0]!.result;
    expect(first.items).toHaveLength(132);expect(first.version).toMatchObject({status:"ACTIVE",standard_discount_percent:50});expect(Number(first.items[0].unit_price)).toBe(43);
    expect((await run("catalog-1")).rows[0]!.result).toEqual(first);
    await expect(run("catalog-1",{...catalog,name:"Changed"})).rejects.toThrow("idempotency conflict");
    const bad={...catalog,name:"Invalid catalog",items:[catalog.items[0],{...catalog.items[1],list_price:-1}]};
    await expect(run("catalog-bad",bad)).rejects.toThrow("Invalid catalog row");
    expect((await db.query<{count:number}>("select count(*)::int count from rate_lists")).rows[0]!.count).toBe(1);
    await run("catalog-other",catalog,"22222222-2222-4222-8222-222222222222");
    expect((await db.query<{count:number}>("select count(*)::int count from products")).rows[0]!.count).toBe(264);
    const revised=(await run("catalog-2",{...catalog,items:catalog.items.map(item=>({...item,list_price:item.list_price+1}))})).rows[0]!.result;
    expect(revised.version.version_number).toBe(2);
    expect((await db.query<{status:string}>("select status from rate_list_versions where id=$1",[first.version.id])).rows[0]!.status).toBe("ARCHIVED");
    expect((await db.query<{count:number}>("select count(*)::int count from products")).rows[0]!.count).toBe(264);

    // Reproduce the browser issue end to end: upload 35 extracted conduit rows,
    // approve in Urdu, read them from ERP, then replay in Roman Urdu and voice.
    const scope={organizationId:"11111111-1111-4111-8111-111111111111",userId:"33333333-3333-4333-8333-333333333333",branchId:"44444444-4444-4444-8444-444444444444"};
    const conduit={documentType:"rate_list",name:"Dura Max Electric Conduit Pipes & Fittings",complete:true,confidence:1,warnings:[],standardDiscountPercent:0,
      items:Array.from({length:35},(_,i)=>({brand:"Dura Max",category:i<10?"Pipes":"Fittings",name:i<10?"Conduit Pipe":"Conduit Elbow",size:(16+i)+"mm",unit:i<10?"length":"pcs",list_price:100+i}))};
    const importRateList=vi.fn(async(input:any)=>(await run(input.idempotency_key,input,input.organization_id)).rows[0]!.result);
    const rateLists=new DefaultRateListService({importRateList} as any);
    const verify=vi.fn(async(plan:any,result:any)=>{
      const actual=(await db.query("select p.name,p.category,ri.unit,ri.unit_price from rate_list_items ri join products p on p.id=ri.product_id join rate_list_versions v on v.id=ri.rate_list_version_id join rate_lists rl on rl.id=v.rate_list_id where rl.organization_id=$1 and v.id=$2 and v.status='ACTIVE' order by ri.id",[scope.organizationId,result.version.id])).rows;
      expect(actual).toEqual(plan.catalogImport.items.map((item:any)=>({name:[item.brand,item.name,item.size].join(" "),category:item.category,unit:item.unit,unit_price:String(item.list_price)})));
    });
    const actionDatabaseGateway=actionDatabase();
    const runtime=new CopilotRuntime({} as any,{database:()=>actionDatabaseGateway,rateLists,verifier:{verify},
      authorization:{assertPermission:vi.fn()},branchAccess:{assertBranchAccess:vi.fn()},references:{assertOwnedReferences:vi.fn()},erp:{},pricing:{},estimate:{},salesTransaction:{},returns:{}} as any);
    const tools=new ErpToolRegistry({tenant:{assertBranchAccess:vi.fn(),assertPermission:vi.fn()},runtime} as any);
    expect(tools.definitions()).toContainEqual(expect.objectContaining({name:"erp_import_rate_list"}));
    const respond=vi.fn(async()=>{throw new Error("Confirmation must not call the language model");});
    const core=new UnifiedCopilotAgent({respond},tools);
    const provider={generate:vi.fn(async()=>conduit),transcribe:vi.fn(async()=>"جو ریٹ نکالے ہیں ان کو ای آر پی کے اندر درج کر دیں")};
    const secret=env.INTERNAL_API_TOKEN??"rate-list-confirmation-test-secret-123456789";
    const app=express();app.use(express.json({limit:"12mb"}));app.use((req,_res,next)=>{req.log={info:vi.fn(),warn:vi.fn()} as any;next();});
    app.use("/copilot",createAiCopilotRouter(secret,runtime,"catalog-test",new CopilotAgent(core),core,tools,new MultimodalAgentInput(new ProviderBusinessInput(provider as any))));app.use(errorHandler);
    const payload=Buffer.from(JSON.stringify({userId:scope.userId,exp:Math.floor(Date.now()/1000)+300})).toString("base64url");
    const cookie=`muraderp_session=${payload}.${createHmac("sha256",secret).update(payload).digest("base64url")}`;
    const post=(path:string,body:object)=>request(app).post("/copilot/"+path).set("Cookie",cookie).set("X-Organization-Id",scope.organizationId).set("X-Branch-Id",scope.branchId).send(body);
    const image={mimeType:"image/png",base64:createCanvas(120,60).toBuffer("image/png").toString("base64")};
    const preview=await post("agent/input",{source:"image",media:image,fileName:"Dura Rate List Conduit Pipe & Fitting.png"});
    expect(preview.status).toBe(200);expect(preview.body.data.catalogReview.itemCount).toBe(35);expect(importRateList).not.toHaveBeenCalled();
    const context={conversationToken:preview.body.data.conversationToken,conversationId:preview.body.data.conversationId};
    const saved=await post("agent",{message:"درج کر دیں",...context});
    expect(saved.status).toBe(200);expect(saved.body.data.answer).toBe("✓ مبارک ہو! Dura Max Electric Conduit Pipes & Fittings کے تمام 35 آئٹمز ERP ریٹ لسٹ میں کامیابی سے درج کر دیے گئے ہیں۔");
    expect(importRateList).toHaveBeenCalledOnce();expect(verify).toHaveBeenCalledOnce();
    const rateListId=saved.body.data.execution.result.rate_list.id;
    expect((await db.query<{count:number}>("select count(*)::int count from rate_list_items ri join rate_list_versions v on v.id=ri.rate_list_version_id where v.rate_list_id=$1 and v.status='ACTIVE'",[rateListId])).rows[0]!.count).toBe(35);
    expect((await post("agent",{message:"JO RATE LIST MEIN DARJ KER DEIN",...context})).status).toBe(200);
    const audio=Buffer.alloc(1644);audio.write("RIFF");audio.writeUInt32LE(audio.length-8,4);audio.write("WAVEfmt ",8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(8000,24);audio.writeUInt32LE(16000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write("data",36);audio.writeUInt32LE(1600,40);audio.fill(12,44);
    const spoken=await post("agent/input",{source:"voice",media:{mimeType:"audio/wav",base64:audio.toString("base64")},...context});
    expect(spoken.status).toBe(200);expect(spoken.body.data.answer).toContain("تمام 35 آئٹمز");
    expect(importRateList).toHaveBeenCalledOnce();expect(respond).not.toHaveBeenCalled();expect(provider.generate).toHaveBeenCalledOnce();
    expect((await db.query<{count:number}>("select count(*)::int count from rate_list_versions where rate_list_id=$1",[rateListId])).rows[0]!.count).toBe(1);

    // The two-page U-PVC regression contains 85 priced variants and three dash
    // cells. A partial preview must survive approval and real SQL persistence.
    const [pageOne,pageTwo]=duraUpvcPages();
    const verifiedBeforePartial=verify.mock.calls.length;
    provider.generate.mockResolvedValueOnce({...pageOne,complete:false} as any).mockResolvedValueOnce(pageTwo as any);
    const pdf=new PDFDocument();for(let n=0;n<2;n++){const ctx=pdf.beginPage(120,60);ctx.fillText("U-PVC catalog",5,20);pdf.endPage();}
    const partial=await post("agent/input",{source:"image",media:{mimeType:"application/pdf",base64:pdf.close().toString("base64")},fileName:"Dura Max U-PVC Price List 29.09.2026.pdf"});
    expect(partial.status).toBe(200);expect(partial.body.data.catalogReview.itemCount).toBe(85);
    expect(partial.body.data.extraction.catalog).toMatchObject({complete:false,warnings:expect.arrayContaining([expect.stringContaining("Skipped 3")])});
    expect(importRateList).toHaveBeenCalledOnce();
    const approved=await post("agent",{message:"درج کر دیں",conversationToken:partial.body.data.conversationToken,conversationId:partial.body.data.conversationId});
    expect(approved.status).toBe(200);expect(approved.body.data.answer).toContain("تمام 85 آئٹمز");
    expect(importRateList).toHaveBeenCalledTimes(2);expect(verify).toHaveBeenCalledTimes(verifiedBeforePartial+1);
    expect((await db.query<{count:number;minimum:string}>("select count(*)::int count,min(unit_price)::text minimum from rate_list_items where rate_list_version_id=$1",[approved.body.data.execution.result.version.id])).rows[0]).toEqual({count:85,minimum:"176"});
    await expect(run("raw-unpriced-catalog",{...pageOne,complete:false})).rejects.toThrow("Invalid catalog row");
    await expect(run("empty-partial-catalog",{...pageOne,items:[],complete:false})).rejects.toThrow("validated priced items");
  } finally { await db.close(); }
},120000);
