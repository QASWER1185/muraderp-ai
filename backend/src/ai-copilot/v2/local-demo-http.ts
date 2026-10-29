import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { createLiveGeminiProvider } from './live-provider.js';
import { createLocalDemoAgent } from './local-demo.js';
const scope={userId:'00000000-0000-4000-8000-000000000001',organizationId:'00000000-0000-4000-8000-000000000002',branchId:'00000000-0000-4000-8000-000000000003'};
const input=z.object({message:z.string().trim().min(1).max(20000),conversationId:z.string().uuid().optional()});
export function localDemoHttp(req:IncomingMessage,res:ServerResponse):boolean {
  if(req.url!=='/__local-dev/copilot'||env.NODE_ENV!=='development'||env.SUPABASE_URL||env.SUPABASE_SECRET_KEY)return false;
  const expected=process.env.LOCAL_DEV_BRIDGE_TOKEN,actual=req.headers['x-local-dev-bridge'];
  const local=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'');
  if(!local||!expected||typeof actual!=='string'||Buffer.byteLength(actual)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected))){res.writeHead(403).end();return true;}
  if(req.method!=='POST'){res.writeHead(405).end();return true;}
  res.setHeader('X-Copilot-Pipeline','v2-local-demo');
  let body='';req.on('data',chunk=>{body+=chunk;if(body.length>100000)req.destroy();});
  req.on('end',()=>{void(async()=>{
    try {
      const p=input.parse(JSON.parse(body));
      const apiKey=typeof req.headers['x-api-key']==='string'?req.headers['x-api-key']:undefined;
      const provider=createLiveGeminiProvider(apiKey);
      const wrapped={name:provider.name,generate:provider.generate.bind(provider),transcribe:provider.transcribe.bind(provider),toolTurn:(instructions:string,...args:Parameters<typeof provider.toolTurn> extends [unknown,...infer R]?R:never)=>provider.toolTurn(instructions+'\nLOCAL DEMO: tool data is simulated, never real balances; no ERP record is actually saved. Explain this when relevant to business queries, matching Urdu or Roman Urdu. Casual greetings need no demo disclaimer.',...args)};
      const result=await createLocalDemoAgent(wrapped).run(p,scope);
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store','X-Copilot-Pipeline':'v2-local-demo'});res.end(JSON.stringify({data:{...result,demo:true},requiresConfirmation:false}));
    } catch(error) {
      res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});
      res.end(JSON.stringify({error:{code:'LOCAL_DEMO_UNAVAILABLE',message:error instanceof z.ZodError?'Send a text message and a valid demo conversation ID.': 'Local demo could not complete the request; check Gemini configuration and conversation availability.'}}));
    }
  })();});
  return true;
}
