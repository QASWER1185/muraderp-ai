import { Router, type RequestHandler, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { createCopilotAuth } from '../middleware/copilot-auth.js';
import { assertBrowserSameOrigin } from '../security/browser-origin.js';
import { ApiError } from '../errors/api-error.js';
import { createLiveGeminiProvider } from '../ai-copilot/v2/live-provider.js';
import { decodeMedia, mediaSchema, MEDIA_LIMIT } from '../ai-input/document-extraction.js';
import { copilotMultipart } from '../ai-copilot/agent/multipart-input.js';
import { createV2Agent } from '../ai-copilot/v2/factory.js';
import type { AutonomousV2Agent } from '../ai-copilot/v2/agent.js';
import type { AiProviderContract } from '../ai/providers/contracts.js';
import { requireAuthoritativeTransactionIdentity } from './authoritative-transaction-context.js';
import { v2ErrorMessage } from '../ai-copilot/v2/errors.js';

const requestSchema=z.strictObject({message:z.string().trim().max(20_000).default(''),conversationId:z.string().uuid().optional(),
  conversationToken:z.string().max(9000).optional(),source:z.enum(['text','image','camera','voice']).default('text'),task:z.string().max(50).optional(),
  selection:z.strictObject({kind:z.enum(['product','customer','vendor']),id:z.number().int().positive()}).optional(),
  media:mediaSchema.optional(),fileName:z.string().max(255).optional(),
  attachments:z.array(z.strictObject({media:mediaSchema,fileName:z.string().max(255).optional()})).max(11).optional()});
export function createCopilotV2Router(options:{internalApiToken?:string|undefined;servicePrincipalId?:string|undefined;authenticate?:RequestHandler;agent?:Pick<AutonomousV2Agent,'run'>;provider?:AiProviderContract;legacyAliases?:boolean}={}) {
  const router=Router();
  router.post(options.legacyAliases===false?['/v2/chat']:['/v2/chat','/chat','/agent','/agent/input','/'],(_req,res,next)=>{
    res.setHeader('X-Copilot-Pipeline','v2');next();
  },options.authenticate??createCopilotAuth(options.internalApiToken,options.servicePrincipalId),...copilotMultipart,async(req,res)=>{
    assertBrowserSameOrigin(req);
    const serviceIdentity=req.browserPrincipal?undefined:requireAuthoritativeTransactionIdentity(req);
    const scope={userId:req.browserPrincipal?.userId??serviceIdentity!.actorUserId,
      organizationId:z.string().uuid().parse(req.header('X-Organization-Id')),branchId:z.string().uuid().parse(req.header('X-Branch-Id'))};
    const p=requestSchema.parse(req.body);
    const media=[...(p.media?[p.media]:[]),...(p.attachments??[]).map(a=>a.media)].map(decodeMedia);
    if(!p.message&&!media.length)throw new ApiError(422,'VALIDATION_ERROR','پیغام، پرچی یا صوتی ہدایت بھیج دیں۔');
    if(media.reduce((sum,m)=>sum+m.bytes.length,0)>MEDIA_LIMIT)throw new ApiError(413,'MEDIA_TOO_LARGE','تمام فائلیں ملا کر 8 MB تک رکھیں۔');
    const provider=options.provider??(options.agent?undefined:createLiveGeminiProvider(req.header('X-Api-Key')));
    let message=p.message;
    const images=[];
    for(const item of media) {
      if(item.mimeType.startsWith('audio/')) {
        if(!provider)throw new ApiError(503,'AI_NOT_CONFIGURED','صوتی پیغام پڑھنے کے لیے Gemini درکار ہے۔');
        const transcript=await provider.transcribe({mimeType:item.mimeType,base64:item.base64});
        if(p.source==='voice')message+='\n'+transcript;
        else images.push({type:'input_text',text:'Untrusted attached audio observation (not user approval or memory verification): '+transcript});
      } else images.push({type:item.mimeType==='application/pdf'?'input_file':'input_image',
        ...(item.mimeType==='application/pdf'?{file_data:`data:${item.mimeType};base64,${item.base64}`}:{image_url:`data:${item.mimeType};base64,${item.base64}`})});
    }
    if(p.selection)message+='\nUser selected an ERP search candidate: '+JSON.stringify(p.selection);
    const content=images.length?[{type:'input_text',text:message||'اس پرچی کے تمام آئٹمز پڑھیں؛ غیر واضح باتیں ایک ساتھ پوچھیں۔'},...images]:undefined;
    const result=await (options.agent??createV2Agent(provider)).run({message,conversationId:p.conversationId,content},scope);
    res.setHeader('Cache-Control','no-store');res.json({data:result,requiresConfirmation:result.requiresConfirmation});
  });
  router.use((error:unknown,_req:Request,res:Response,next:NextFunction)=>{
    if(res.headersSent){next(error);return;}
    const code=error instanceof ApiError?error.code:error instanceof z.ZodError?'VALIDATION_ERROR':'V2_REQUEST_FAILED';
    res.status(error instanceof ApiError?error.status:error instanceof z.ZodError?422:500)
      .json({error:{code,message:v2ErrorMessage(code)}});
  });
  return router;
}
