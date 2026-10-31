import {describe,it,expect,vi} from 'vitest';
import {withGeminiBackoff,resolveRequestGeminiKey,stripHistoricalMedia} from './resilience.js';
describe('Copilot quota resilience',()=>{
  it('retries transient quota errors three times with exponential delays',async()=>{
    const operation=vi.fn().mockRejectedValueOnce({status:429}).mockRejectedValueOnce({status:'RESOURCE_EXHAUSTED'}).mockRejectedValueOnce({error:{status:'RESOURCE_EXHAUSTED'}}).mockResolvedValue('ready');
    const wait=vi.fn(async(_ms:number)=>{});
    expect(await withGeminiBackoff(operation,undefined,wait)).toBe('ready');
    expect(wait.mock.calls.map(args=>args[0])).toEqual([2000,4000,8000]);expect(operation).toHaveBeenCalledTimes(4);
  });
  it('stops after four attempts',async()=>{const op=vi.fn().mockRejectedValue({status:429});await expect(withGeminiBackoff(op,undefined,async()=>{})).rejects.toEqual({status:429});expect(op).toHaveBeenCalledTimes(4);});
  it('does not retry authentication failures',async()=>{const op=vi.fn().mockRejectedValue({status:401});await expect(withGeminiBackoff(op,undefined,async()=>{})).rejects.toEqual({status:401});expect(op).toHaveBeenCalledOnce();});
  it('honors cancellation before requests',async()=>{const c=new AbortController();c.abort();const op=vi.fn();await expect(withGeminiBackoff(op,c.signal)).rejects.toThrow();expect(op).not.toHaveBeenCalled();});
  it.each([undefined,null,'','  ','null',' undefined '])('ignores absent key %s',value=>expect(resolveRequestGeminiKey(value)).toBeUndefined());
  it('trims a supplied key',()=>expect(resolveRequestGeminiKey(' example ')).toBe('example'));
  it('drops persisted bytes and keeps only text stubs',()=>{
    const raw=[{role:'user' as const,content:'Read slip data:image/png;base64,aGVsbG8=',visualParts:[{inlineData:{data:'SECRET_BYTES'}}]}];
    const clean=stripHistoricalMedia(raw);expect(JSON.stringify(clean)).not.toContain('SECRET_BYTES');expect(JSON.stringify(clean)).not.toContain('base64');expect(clean[0]!.content).toContain('[Attached Slip');expect(raw[0]!.visualParts).toHaveLength(1);
  });
});
