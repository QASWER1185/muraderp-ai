// Read-only production acceptance. Credentials stay in memory and never enter
// argv, transcripts, signed conversation files or logs. No action is confirmed.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { createHmac } from "node:crypto";
const require=createRequire(new URL("../backend/package.json",import.meta.url));
const {createClient}=require("@supabase/supabase-js");
function secret(name){
  if(!/^[a-z0-9-]+$/.test(name))throw new Error("Invalid secret identifier.");
  try{
    const args=["secrets","versions","access","latest","--secret",name,"--project","muraderp-ai"];
    const value=execFileSync(process.platform==="win32"?"cmd.exe":"gcloud",process.platform==="win32"?["/d","/s","/c",`gcloud secrets versions access latest --secret=${name} --project=muraderp-ai`]:args,{encoding:"utf8",env:{...process.env,PYTHONIOENCODING:"utf-8",PYTHONUTF8:"1"},stdio:["ignore","pipe","pipe"]});
    return name==="muraderp-internal-api-token"?value:value.trim();
  }catch{throw new Error("Secret Manager credential could not be loaded: "+name);}
}
const db=createClient(process.env.SUPABASE_URL??"https://pmsowmiivjkwtovynhje.supabase.co",process.env.SUPABASE_SECRET_KEY??secret("muraderp-supabase-secret-key"),{auth:{persistSession:false,autoRefreshToken:false}});
async function required(query){const {data,error}=await query;if(error)throw new Error(error.message);return data;}
const org=await required(db.from("organizations").select("id,name").eq("slug","m-murad-building-materials-store").single());
const branch=await required(db.from("branches").select("id").eq("organization_id",org.id).eq("code","MAIN").eq("status","active").single());
const owner=await required(db.from("organization_memberships").select("user_id").eq("organization_id",org.id).eq("role","owner").eq("status","active").single());
const scope={organizationId:org.id,branchId:branch.id,userId:owner.user_id};
if(process.argv.includes("--catalog-audit")){
  const products=await required(db.from('products').select('id,name,unit').eq('organization_id',org.id).ilike('name','%Dura Max%').limit(1000));
  const now=new Date().toISOString();
  const rates=await required(db.from('rate_list_items').select('product_id,unit,unit_price,rate_list_versions!inner(status,effective_from,effective_to,rate_lists!inner(organization_id,is_active,price_type))').eq('rate_list_versions.rate_lists.organization_id',org.id).eq('rate_list_versions.rate_lists.is_active',true).eq('rate_list_versions.rate_lists.price_type','SALE').eq('rate_list_versions.status','ACTIVE').limit(1000));
  const missing=products.filter(product=>!rates.some(rate=>rate.product_id===product.id&&rate.unit===product.unit&&Number(rate.unit_price)>0&&rate.rate_list_versions.effective_from<=now&&(!rate.rate_list_versions.effective_to||rate.rate_list_versions.effective_to>now)));
  console.log(JSON.stringify({catalogProducts:products.length,productsWithActiveSaleRate:products.length-missing.length,missingActiveRates:missing}));
}else if(process.argv.includes("--search-debug")){
  for(const query of ['U-PVC Elbow 90° 2 inch','Dura Max U-PVC Elbow 90° 2 inch','Dura Max Elbow 90° 2 inch','Dura Max Elbow 2 inch']){
    const data=await required(db.rpc('search_catalog_products',{p_user_id:scope.userId,p_organization_id:scope.organizationId,p_branch_id:scope.branchId,p_query:query,p_brand:'Dura Max',p_limit:20}));
    console.log(JSON.stringify({query,data}));
  }
}else if(process.argv.includes("--inspect")){
  console.log(JSON.stringify({scope,organization:org.name}));
  for(const table of ["invoices","invoice_items","credit_note_items","purchases","inventory","stock_movements"]){
    const {data,error}=await db.from(table).select(table==="invoice_items"?"*,invoices!inner(organization_id)":"*").eq(table==="invoice_items"?"invoices.organization_id":"organization_id",org.id).limit(1);
    console.log(JSON.stringify({table,columns:Object.keys(data?.[0]??{}),error:error?.message}));
  }
  const products=await required(db.from("products").select("id,name,unit,brand_id").eq("organization_id",org.id).ilike("name","%Dura%").limit(1000));
  const selected=products.filter(row=>/PN.?16.*25|25.*PN.?16|Elbow.*90.*2\s*(?:inch|in|\")|P.?Trap|Gate.*(?:25|32)|solvent|solution|Medium.*(?:4|3|2)\s*(?:inch|in|\")/i.test(row.name)).slice(0,40);
  for(const product of selected){
    const rates=await required(db.from("rate_list_items").select("id,unit_price,unit,rate_list_version_id,minimum_quantity,rate_list_versions!inner(status,rate_list_id,rate_lists!inner(organization_id,is_active))").eq("rate_list_versions.rate_lists.organization_id",org.id).eq("product_id",product.id));
    console.log(JSON.stringify({product,rates}));
  }
}else{
  const token=process.env.INTERNAL_API_TOKEN??secret("muraderp-internal-api-token");
  // Exercise the same browser auth/ACL route with a short-lived test cookie.
  // It is never stored or logged, and this harness never confirms a mutation.
  const session=Buffer.from(JSON.stringify({userId:scope.userId,exp:Math.floor(Date.now()/1000)+1800})).toString("base64url");
  const cookie="muraderp_session="+session+"."+createHmac("sha256",token).update(session).digest("base64url");
  const base=process.env.COPILOT_BASE_URL??"https://muraderp-api-jy6eophhla-el.a.run.app";
  let localAgent;
  if(process.argv.includes("--local-chat")){
    Object.assign(process.env,{SUPABASE_URL:"https://pmsowmiivjkwtovynhje.supabase.co",SUPABASE_SECRET_KEY:process.env.SUPABASE_SECRET_KEY??secret("muraderp-supabase-secret-key"),INTERNAL_API_TOKEN:token,INTERNAL_API_PRINCIPAL_ID:process.env.INTERNAL_API_PRINCIPAL_ID??secret("muraderp-internal-api-principal-id"),AI_PROVIDER:"gemini",AI_API_KEY:process.env.AI_API_KEY??secret("muraderp-gemini-api-key"),AI_MODEL:"gemini-3.5-flash-lite",AI_VISION_MODEL:"gemini-3.5-flash-lite"});
    const {createUnifiedAgent}=await import("../backend/dist/ai-copilot/agent/factory.js");localAgent=createUnifiedAgent();
    if(process.argv.includes("--trace")){
      const execute=localAgent.tools.execute.bind(localAgent.tools);
      localAgent.tools.execute=async(name,args,...rest)=>{const result=await execute(name,args,...rest);console.log(JSON.stringify({traceTool:name,args,result}));return result;};
    }
  }
  const questions=["اس مہینے کا پرافٹ کتنا ہے","اس مہینے سب سے زیادہ کس کسٹمر نے مال خریدا","اس مہینے ٹاپ سیل مین کون سا ہے","سب سے زیادہ کس ایٹم نے ہمیں پرافٹ دیا","اس مہینے ہم نے کس وینڈر سے سب سے زیادہ مال خریدا","How many products in inventory?","What is the rate of Dura Max PPRC Pipe PN-16 25mm?","ڈیورا میکس یو پی وی سی ایلبو 90 ڈگری 2 انچ کا ریٹ بتاؤ"];
  let selectedQuestions=process.argv.includes("--rates-only")?questions.slice(6):questions;
  const questionFile=process.argv.indexOf("--questions");
  if(questionFile>=0){
    selectedQuestions=JSON.parse(readFileSync(process.argv[questionFile+1],"utf8"));
    const {isAffirmation}=await import("../backend/dist/ai-copilot/tools/confirmation.js");
    if(!Array.isArray(selectedQuestions)||selectedQuestions.length>20||selectedQuestions.some(question=>typeof question!=="string"||question.length>20000||isAffirmation(question)))throw new Error("Acceptance questions must be bounded non-approval requests.");
  }
  const transcripts=[];let conversationToken,conversationId;
  for(const question of selectedQuestions){
    const conversation=conversationToken?{conversationToken,conversationId}:{};
    const response=localAgent?undefined:await fetch(base+"/api/copilot/chat",{method:"POST",headers:{"Content-Type":"application/json","Cookie":cookie,"X-Branch-Id":scope.branchId},body:JSON.stringify({organizationId:scope.organizationId,userId:scope.userId,message:question,...conversation}),signal:AbortSignal.timeout(180000)});
    const result=localAgent?{data:await localAgent.run({message:question,...conversation},scope)}:await response.json(),data=result.data;
    if(data?.conversationToken){conversationToken=data.conversationToken;conversationId=data.conversationId;}
    const transcript={question,httpStatus:response?.status??null,transport:localAgent?"local agent / live Gemini and ERP":"production HTTP",status:data?.status,answer:data?.answer??data?.message,toolNames:data?.toolNames,error:result.error};
    transcripts.push(transcript);console.log(JSON.stringify(transcript));
  }
  const output=process.argv.indexOf("--output");if(output>=0)writeFileSync(process.argv[output+1],JSON.stringify({verifiedAt:new Date().toISOString(),base,scope,transcripts},null,2));
}
