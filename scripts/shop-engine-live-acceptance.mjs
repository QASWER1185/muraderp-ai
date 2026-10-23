// Production acceptance uses synthetic demand slips, never the user's missing
// WA0060/WA0061/WA0062 originals. It prepares proposals, never posts a sale.
import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
import {createHmac} from "node:crypto";
import {writeFileSync} from "node:fs";
const require=createRequire(new URL("../backend/package.json",import.meta.url));
const {createClient}=require("@supabase/supabase-js"),{createCanvas}=require("@napi-rs/canvas");
function secret(name){
 if(!/^[a-z0-9-]+$/.test(name))throw Error("Invalid secret name");
 return execFileSync("cmd.exe",["/d","/s","/c",`gcloud secrets versions access latest --secret=${name} --project=muraderp-ai`],{encoding:"utf8",stdio:["ignore","pipe","pipe"],env:{...process.env,PYTHONUTF8:"1",PYTHONIOENCODING:"utf-8"}}).trim();
}
const db=createClient("https://pmsowmiivjkwtovynhje.supabase.co",secret("muraderp-supabase-secret-key"),{auth:{persistSession:false,autoRefreshToken:false}});
async function required(q){const {data,error}=await q;if(error)throw Error(error.message);return data;}
const org=await required(db.from("organizations").select("id").eq("slug","m-murad-building-materials-store").single());
const branch=await required(db.from("branches").select("id").eq("organization_id",org.id).eq("code","MAIN").eq("status","active").single());
const owner=await required(db.from("organization_memberships").select("user_id").eq("organization_id",org.id).eq("role","owner").eq("status","active").single());
const customer=await required(db.from("customers").select("id,name").eq("organization_id",org.id).order("id").limit(1).single());
const key=secret("muraderp-internal-api-token"),session=Buffer.from(JSON.stringify({userId:owner.user_id,exp:Math.floor(Date.now()/1000)+1800})).toString("base64url");
const headers={"Content-Type":"application/json","Cookie":"muraderp_session="+session+"."+createHmac("sha256",key).update(session).digest("base64url"),"X-Organization-Id":org.id,"X-Branch-Id":branch.id};
const base=process.env.COPILOT_BASE_URL??"https://muraderp-api-jy6eophhla-el.a.run.app";
async function post(path,body){const res=await fetch(base+path,{method:"POST",headers,body:JSON.stringify(body),signal:AbortSignal.timeout(240000)});const result=await res.json();return {httpStatus:res.status,...result};}
const checks=[];
for(const message of ["ایلبو 25mm کا ریٹ بتاؤ",'Dura Max Gate Valve 32mm کا 50 فیصد پر ریٹ بتاؤ',"HE China G.I. Elbow 1 inch کا 35 فیصد پر ریٹ بتاؤ"]){
 const result=await post("/api/v1/ai/copilot/agent",{message});const data=result.data;
 checks.push({test:"product_query",message,httpStatus:result.httpStatus,status:data?.status,answer:data?.answer,reports:data?.reports,error:result.error});
 console.log(JSON.stringify(checks.at(-1)));
}
const rows=[
 ["PPR-C Pipe PN-16 | 25mm | 2 | length","PPR-C Elbow | 25mm | 6 | pcs"],
 ["U-PVC Pipe Medium | 4 inch | 1 | length","U-PVC P-Trap Single | 4 inch | 2 | pcs"],
 ["PPR-C Gate Valve Plastic Head | 32mm | 1 | pcs","Teflon Tape | - | 3 | roll","PPR-C Test Connector | 77mm | 2 | pcs","Solvent Cement | 500g | 1 | can"],
];
const attachments=rows.map((lines,index)=>{
 const canvas=createCanvas(1200,520),ctx=canvas.getContext("2d");ctx.fillStyle="white";ctx.fillRect(0,0,1200,520);ctx.fillStyle="black";ctx.font="bold 28px sans-serif";
 ctx.fillText("SYNTHETIC ACCEPTANCE FIXTURE "+(index+1)+" (not an original plumber slip)",30,50);ctx.font="27px sans-serif";
 ctx.fillText("Brand: Dura Max - Demand slip - NO observed prices",30,105);ctx.fillText("Item and material | Exact size | Quantity | Unit",30,160);
 lines.forEach((line,i)=>ctx.fillText(line,30,220+i*60));
 return {fileName:"synthetic-shop-slip-"+(index+1)+".png",media:{mimeType:"image/png",base64:canvas.toBuffer("image/png").toString("base64")}};
});
const result=await post("/api/v1/ai/copilot/agent/input",{source:"image",task:"estimate",message:`Prepare a single complete estimate for customer ${customer.name}, Dura Max 50%. Include EVERY row in all three slips. Use current catalog prices. The Test Connector is intentionally unlisted: keep it pending. Teflon is PKR 50 per roll.`,attachments});
const data=result.data;
const observation={test:"three_synthetic_slips",httpStatus:result.httpStatus,status:data?.status,answer:data?.answer,extractedLineCount:data?.extraction?.document?.lines?.length,lines:data?.review?.preview?.lines,totals:data?.review?.preview?.totals,warnings:data?.review?.preview?.warnings,error:result.error};
checks.push(observation);console.log(JSON.stringify(observation));
const expectedRows=rows.flat().length;
const passed=checks.slice(0,3).every(row=>row.httpStatus===200&&row.status==="completed") && observation.httpStatus===200&&observation.extractedLineCount===expectedRows&&observation.lines?.length===expectedRows&&observation.lines.some(line=>line.pricing_source==="PENDING_RATE")&&observation.lines.some(line=>line.pricing_source==="RESOLVED_RATE")&&Number.isFinite(observation.totals?.cash_payable);
const report={verifiedAt:new Date().toISOString(),base,fixtures:"Synthetic printed demand slips; original WA0060/WA0061/WA0062 were not provided",expectedRows,passed,checks};
const output=process.argv.indexOf("--output");if(output>=0)writeFileSync(process.argv[output+1],JSON.stringify(report,null,2));
if(!passed)process.exitCode=1;
