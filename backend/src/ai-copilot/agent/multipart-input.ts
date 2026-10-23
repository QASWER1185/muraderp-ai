import express, {type RequestHandler} from "express";
import {ApiError} from "../../errors/api-error.js";

/** Bounded native multipart decoding; media validation still checks bytes/MIME. */
export const copilotMultipart:RequestHandler[]=[express.raw({type:"multipart/form-data",limit:"9mb"}),async(req,_res,next)=>{
  if(!req.is("multipart/form-data")){next();return;}
  try{
    const form=await new Response(new Uint8Array(req.body),{headers:{"Content-Type":req.get("Content-Type")!}}).formData();
    const body:Record<string,unknown>={},attachments=[];
    for(const [key,value] of form){
      if(typeof value==="string"){
        if(!["message","source","task","conversationToken","conversationId"].includes(key)||key in body)throw new ApiError(422,"INVALID_MEDIA","منسلک پرچی کی درخواست میں غیر درست یا دہرائی گئی تفصیل ہے۔");
        body[key]=value;
      }else{
        if(!["attachments","images","files","audio"].includes(key)||attachments.length>=11)throw new ApiError(422,"INVALID_MEDIA","ایک ساتھ دس پرچیاں اور ایک صوتی پیغام شامل کریں۔");
        attachments.push({fileName:value.name,media:{mimeType:value.type,base64:Buffer.from(await value.arrayBuffer()).toString("base64")}});
      }
    }
    req.body={...body,source:body.source??(attachments.some(file=>!file.media.mimeType.startsWith("audio/"))?"image":"voice"),attachments};next();
  }catch(error){next(error instanceof ApiError?error:new ApiError(422,"INVALID_MEDIA","منسلک فائلوں کا فارمیٹ درست نہیں؛ تصاویر دوبارہ منتخب کریں۔"));}
}];
