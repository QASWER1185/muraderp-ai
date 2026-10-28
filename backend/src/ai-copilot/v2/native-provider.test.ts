import {describe,it,expect,vi} from 'vitest';
import {GeminiAdapter} from '../../ai/providers/gemini.adapter.js';

describe('v2 native Gemini transport',()=>{
  it('passes image and PDF bytes directly and preserves native thought signatures after a tool result',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[
      {text:'private thought',thought:true,thoughtSignature:'reasoning-signature'},
      {functionCall:{id:'native-1',name:'manage_estimate',args:{action:'get',data:{reference:'EST-1067'}}},thoughtSignature:'call-signature'},
    ]}}]}))).mockResolvedValueOnce(new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'کل رقم تصدیق شدہ ہے۔'}]}}]})));
    const model=new GeminiAdapter({provider:'gemini',apiKey:'test',model:'test',speechModel:'test',nativeToolsOnly:true},fetcher);
    const messages:any[]=[{role:'user',content:[{type:'input_text',text:'پرچی پڑھیں'},{type:'input_image',image_url:'data:image/png;base64,aGVsbG8='},{type:'input_file',file_data:'data:application/pdf;base64,aGVsbG8='}]}];
    const first=await model.toolTurn('Urdu only',messages,[]);
    const body=JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
    expect(body.contents[0].parts).toContainEqual({inlineData:{mimeType:'image/png',data:'aGVsbG8='}});
    expect(body.contents[0].parts).toContainEqual({inlineData:{mimeType:'application/pdf',data:'aGVsbG8='}});
    await model.toolTurn('Urdu only',[...messages,...first.output,{type:'function_call_output',call_id:'native-1',output:'{"grand_total":91477.71}'}],[]);
    const next=JSON.parse(String(fetcher.mock.calls[1]![1]!.body));
    expect(JSON.stringify(next)).toContain('reasoning-signature');expect(JSON.stringify(next)).toContain('call-signature');expect(JSON.stringify(next)).toContain('91477.71');
  });
  it('never falls back to parsing prose JSON as executable tool calls in v2',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({error:{message:'bad tool schema'}}),{status:400}));
    const model=new GeminiAdapter({provider:'gemini',apiKey:'test',model:'test',speechModel:'test',nativeToolsOnly:true},fetcher);
    await expect(model.toolTurn('instructions',[{role:'user',content:'سلام'}],[])).rejects.toBeDefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
