import {describe,it,expect,vi} from 'vitest';
import {GeminiAdapter} from './gemini.adapter.js';
describe('Gemini follow-up signature recovery',()=>{
 it('retains tool observations as plain text after a native format rejection',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({error:{message:'Invalid thought signature'}}),{status:400})).mockResolvedValueOnce(new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'درست کر دیا'}]}}]})));
  const adapter=new GeminiAdapter({provider:'gemini',model:'test',visionModel:'test',speechModel:'test',apiKey:'test'},fetcher);
  const result=await adapter.toolTurn('instructions',[{role:'user',content:'اسی مسودے میں نرخ درست کریں'},{type:'function_call',call_id:'one',name:'inspect_pending_action',arguments:'{}'},{type:'function_call_output',call_id:'one',output:'{"draftId":"saved-draft","lines":[{"quantity":4,"size":"6 inch"}]}'}],[]);
  expect(result.output).toHaveLength(1);expect(fetcher).toHaveBeenCalledTimes(2);
  const retried=JSON.parse(String(fetcher.mock.calls[1]![1]!.body));expect(retried.contents[0].parts[0].text).toContain('saved-draft');expect(retried.contents[0].parts[0].text).toContain('6 inch');expect(retried.contents[0].parts[0]).not.toHaveProperty('functionResponse');
 });
});
