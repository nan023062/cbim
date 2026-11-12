import {expect,it,vi} from 'vitest';
import {RepeatedToolFailures} from '../src/backend/core/execution/repeated-tool-failures';
import {toolFailureResult,toolReturnedResult,runToolResult,withToolReconciliation} from '../src/backend/core/tools/outcome';
import {Fault} from '../src/backend/core/foundation/errors';

it('连续失败按提出顺序计算，参数键序一致，重复结束不计数，成功或不同参数重置',()=>{
 const tracker=new RepeatedToolFailures();
 const add=(id:string,input:Record<string,unknown>={a:1,b:2})=>tracker.proposed({id,name:'write',input});
 add('a');add('b',{b:2,a:1});add('c');
 expect(tracker.settled('c',true)).toBeUndefined();expect(tracker.settled('b',true)).toBeUndefined();
 expect(tracker.settled('a',true)).toMatchObject({code:'TOOL_REPEAT_BLOCKED',consecutive:3,tool:'write'});
 const reset=new RepeatedToolFailures();
 for(const [id,failed,input] of [['1',true,{a:1}],['2',true,{a:1}],['3',false,{a:1}],['4',true,{a:1}],['5',true,{a:2}]] as const){
  reset.proposed({id,name:'read',input});expect(reset.settled(id,failed)).toBeUndefined();expect(reset.settled(id,true)).toBeUndefined();
 }
 expect(reset.blocked).toBeUndefined();
});

it('unknown 和 FORBIDDEN 均终止相同请求重试，保留可信只读原回执地址',async()=>{
 const original=withToolReconciliation(new Fault('TOOL_OUTPUT_INVALID','原回包损坏'),{tool:'cbim_receipt_inspect',args:{target:'dispatch',input:{runId:'run',toolCallId:'original'}}});
 const call=vi.fn(async()=>{throw original});
 const value=await runToolResult('cbim_write',call);
 const block=value.content[0];if(block.type!=='text')throw Error('text expected');
 expect(JSON.parse(block.text)).toMatchObject({status:'unknown',retryable:false,terminal:true,reconcileTool:'cbim_receipt_inspect',reconcileArgs:{target:'dispatch',input:{runId:'run',toolCallId:'original'}}});
 expect(call).toHaveBeenCalledTimes(1);
 const forbidden=toolFailureResult(new Fault('FORBIDDEN','禁止写入'));expect(forbidden.details).toMatchObject({outcome:{status:'rejected',retryable:false,terminal:true,reconcileTool:null,reconcileArgs:null}});
 expect(toolReturnedResult({isError:true,content:[{type:'text',text:'lost output'}]}).details).toMatchObject({outcome:{status:'unknown',retryable:false}});
 const unknown={content:[{type:'text' as const,text:'{"status":"unknown","commandId":"original"}'}]};
 expect(toolReturnedResult(unknown)).toMatchObject({...unknown,details:{outcome:{status:'unknown',retryable:false}}});
});
