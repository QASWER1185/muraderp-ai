import { z } from "zod";
import { ApiError } from "../../errors/api-error.js";
import type { AiInputRequest } from "../../ai-input/ai-input.types.js";
import type { AiProviderContract,AiProviderConfiguration } from "./contracts.js";
import { providerJson,invalidOutput,inlineMedia,appendMessage } from "./http.js";

export class AnthropicAdapter implements AiProviderContract {
  readonly name="anthropic" as const;
  constructor(private readonly config:AiProviderConfiguration,private readonly fetcher:typeof fetch=fetch){}
  private async request(body:unknown,signal?:AbortSignal){
    const result=await providerJson(this.fetcher,"https://api.anthropic.com/v1/messages",this.config.apiKey,{"x-api-key":this.config.apiKey??"","anthropic-version":"2023-06-01"},body,signal);
    if(!["end_turn","tool_use"].includes(result.stop_reason) || !Array.isArray(result.content))throw new ApiError(422,"AI_INCOMPLETE","AI reasoning/extraction did not complete. Please clarify or retry.");return result;
  }
  async toolTurn(instructions:string,input:unknown[],tools:unknown[],options?:{toolChoice?:"auto"|"required";signal?:AbortSignal}){
    const messages:any[]=[];
    for(const value of input){const item=value as any;
      if(item.type==="function_call")appendMessage(messages,"assistant",{type:"tool_use",id:item.call_id,name:item.name,input:JSON.parse(item.arguments)});
      else if(item.type==="function_call_output")appendMessage(messages,"user",{type:"tool_result",tool_use_id:item.call_id,content:item.output});
      else if(item.providerData?.anthropicBlock)appendMessage(messages,"assistant",item.providerData.anthropicBlock);
      else if(item.role || item.type==="message"){
        const text=typeof item.content==="string"?item.content:(item.content??[]).filter((part:any)=>typeof part.text==="string").map((part:any)=>part.text).join("");
        if(text)appendMessage(messages,item.role==="user"?"user":"assistant",{type:"text",text});
      }
    }
    const definitions=tools.map(value=>{const tool=value as any;return {name:tool.name,description:tool.description,input_schema:tool.parameters};});
    const result=await this.request({model:this.config.model,system:instructions,messages,max_tokens:4096,
      ...(definitions.length?{tools:definitions,tool_choice:{type:options?.toolChoice==="required"?"any":"auto",disable_parallel_tool_use:true}}:{})},options?.signal);
    const output=result.content.map((part:any)=>{
      if(part.type==="tool_use"){if(typeof part.id!=="string"||typeof part.name!=="string"||!part.input||typeof part.input!=="object"||Array.isArray(part.input))throw invalidOutput();return {type:"function_call",call_id:part.id,name:part.name,arguments:JSON.stringify(part.input)};}
      if(part.type==="text"&&typeof part.text==="string")return {type:"message",role:"assistant",content:[{type:"output_text",text:part.text}]};
      if(["thinking","redacted_thinking"].includes(part.type))return {type:"reasoning",providerData:{anthropicBlock:part}};
      throw invalidOutput();
    });return {output};
  }
  async generate(schema:z.ZodType,instructions:string,content:unknown[]){
    const blocks=content.map(value=>{const part=value as any;
      if(part.type==="input_text")return {type:"text",text:part.text};
      if(part.type==="input_image"||part.type==="input_file"){const media=inlineMedia(part.image_url??part.file_data);return {type:media.mimeType==="application/pdf"?"document":"image",source:{type:"base64",media_type:media.mimeType,data:media.data}};}
      throw new ApiError(422,"AI_INPUT_UNSUPPORTED","Unsupported extraction input.");
    });
    const model=content.some(value=>["input_image","input_file"].includes((value as any).type))?this.config.visionModel??this.config.model:this.config.model;
    const result=await this.request({model,system:instructions,messages:[{role:"user",content:blocks}],max_tokens:8000,tools:[{name:"erp_proposal",description:"Return extracted observations only, never ERP authority or actions.",input_schema:z.toJSONSchema(schema)}],tool_choice:{type:"tool",name:"erp_proposal",disable_parallel_tool_use:true}});
    const calls=result.content.filter((part:any)=>part.type==="tool_use");if(calls.length!==1||calls[0].name!=="erp_proposal")throw invalidOutput();
    try{return schema.parse(calls[0].input);}catch{throw invalidOutput();}
  }
  async transcribe(_input:NonNullable<AiInputRequest["media"]>):Promise<string>{
    throw new ApiError(422,"AI_INPUT_UNSUPPORTED","The selected provider has no native transcription adapter. Configure an explicit supported AI_SPEECH_PROVIDER or use text.");
  }
}
