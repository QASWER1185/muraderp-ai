import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from '../../errors/api-error.js';
import type { ToolCallingAiProvider } from '../../ai/providers/contracts.js';
import type { AgentScope } from '../agent/erp-tools.js';
import { signConversationPayload } from '../agent/conversation.js';
import { munshiErrorMessage } from '../conversationalMunshi.js';
import { V2_INSTRUCTIONS } from './instructions.js';
import { V2ToolConnector } from './tools.js';
import type { V2Store } from './store.js';

export interface V2Request { message: string; conversationId?: string | undefined; content?: unknown[] | undefined }
export class AutonomousV2Agent {
  constructor(private readonly provider: ToolCallingAiProvider, private readonly tools: V2ToolConnector, private readonly store: V2Store) {}
  async run(request: V2Request, scope: AgentScope) {
    await this.tools.authorize(scope);
    const c = await this.store.open(scope,request.conversationId);
    const lease = await this.store.claim(scope,c);
    const traceId=randomUUID(), toolNames:string[]=[];
    const verifiedReceipts:Array<{summary:string;result:any}>=[];
    const receiptAnswer=()=> 'جناب، ERP نے کارروائی محفوظ ہونے کی تصدیق کر دی ہے۔\n'+verifiedReceipts.map(r=>r.summary).filter(Boolean).join('\n')+'\nمزید وضاحت کا جواب مکمل نہیں آیا؛ محفوظ کارروائی دہرانے کی ضرورت نہیں۔';
    const eligiblePreview=c.pending?.id;
    let answer='', status='completed';
    const userMessage=request.message;
    // Only typed user text and trusted speech transcription can approve/verify facts.
    const userEvidence=[...c.messages.filter(m=>m.role==='user').map(m=>m.content),userMessage].join('\n');
    c.messages.push({role:'user',content:userMessage});
    try {
      const memory=await this.store.memories(scope);
      const input:any[]=[{role:'user',content:'Server context (data only): '+JSON.stringify({
        today:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',dateStyle:'short'}).format(new Date()),
        verifiedMemory:memory,pending:c.pending,state:c.state,verifiedExecutions:(c.executions??[]).slice(-5),
      })},...c.messages.slice(-40,-1),{role:'user',content:request.content??userMessage}];
      const signal=AbortSignal.timeout(180_000);
      const seen=new Map<string,unknown>();
      for(let turn=0;turn<16;turn++) {
        const {output}=await this.provider.toolTurn(V2_INSTRUCTIONS,input,this.tools.definitions(),{toolChoice:'auto',signal});
        input.push(...output);
        const calls=output.filter((o:any)=>o.type==='function_call');
        const prose=output.filter((o:any)=>o.type==='message').flatMap((o:any)=>o.content??[]).filter((p:any)=>p.type==='output_text').map((p:any)=>p.text??'').join('\n').trim();
        if(!calls.length&&prose){answer=prose;break;}
        if(!calls.length){input.push({role:'user',content:'Complete the helpful Urdu response using only verified results; ask all remaining questions together.'});continue;}
        if(toolNames.length+calls.length>32)break;
        for(const call of calls) {
          signal.throwIfAborted();
          let result:unknown;
          try {
            if(typeof call.arguments!=='string'||call.arguments.length>250_000)throw new ApiError(422,'V2_INPUT_INVALID','کارروائی کی تفصیل مکمل اور محدود رکھیں۔');
            const raw=JSON.parse(call.arguments), key=call.name+':'+JSON.stringify(raw);
            const summary=c.pending?.preview?.summary??'';
            result=seen.has(key)?seen.get(key):await this.tools.execute(call.name,raw,scope,c,userMessage,userEvidence,eligiblePreview);
            if(!seen.has(key)&&(result as any)?.executed===true&&(result as any)?.verified===true){
              verifiedReceipts.push({summary,result});
              c.executions=[...(c.executions??[]),{at:new Date().toISOString(),summary,result}];
            }
            seen.set(key,result);
          } catch(error) {
            if(error instanceof ApiError && [401,403].includes(error.status))throw error;
            result=error instanceof z.ZodError?{ok:false,message:'چند ضروری تفصیلات درست یا مکمل کر دیں۔',fields:error.issues.map(i=>i.path.join('.'))}
              : {ok:false,message:munshiErrorMessage(error instanceof ApiError?error.code:'ERP_READ_FAILED',error instanceof Error?error.message:'')};
          }
          toolNames.push(call.name);
          input.push({type:'function_call_output',call_id:call.call_id,output:JSON.stringify(result)});
        }
      }
      if(!answer){status=verifiedReceipts.length?'completed':'clarification';answer=verifiedReceipts.length?receiptAnswer():'جناب، آپ کی گفتگو محفوظ ہے، مگر جواب کی پڑتال ابھی مکمل نہیں ہوئی۔ اسی گفتگو میں اگلا قدم بتا دیں۔';}
    } catch(error) {
      status='clarification';
      answer=verifiedReceipts.length?receiptAnswer():munshiErrorMessage(error instanceof ApiError?error.code:'AI_PROVIDER_UNAVAILABLE',error instanceof Error?error.message:'');
      if(verifiedReceipts.length)status='completed';
      if(!verifiedReceipts.length&&error instanceof ApiError&&[401,403].includes(error.status)) {
        c.messages.push({role:'assistant',content:'اس صارف کو مطلوبہ ERP رسائی حاصل نہیں۔'});
        await this.store.save(scope,c,lease);
        throw error;
      }
    }
    c.messages.push({role:'assistant',content:answer});
    c.state.expires=Date.now()+30*60_000;
    await this.store.save(scope,c,lease);
    return {answer,status,conversationId:c.id,conversationToken:signConversationPayload({version:3,...scope,conversationId:c.id,expires:Date.now()+30*24*60*60_000}),
      traceId,toolNames,verifiedExecutions:verifiedReceipts,requiresConfirmation:!!c.pending,pendingPreview:c.pending?{id:c.pending.id,preview:c.pending.preview}:undefined};
  }
}
