import {expect,it,vi} from 'vitest';
import {CoordinationTools} from '../src/logic/tools/runtime/coordination-tools';
import {GoalTools} from '../src/logic/tools/runtime/goal-tools';
import {DispatchTools} from '../src/logic/tools/runtime/dispatch-tools';
import {mainToolBinding,mainToolGraph,mainToolScope} from './main-tool-output-fixture';
import {memberPauseServiceFixture} from './member-pause-service-fixture';

it('统一 state 只读取一次，缺省计划明确 null，不能选写工具或冒用其他周期',async()=>{
 const inspect=vi.fn(async()=>({scope:mainToolScope(mainToolBinding),graph:mainToolGraph()})),plan=vi.fn(),review=vi.fn();
 const goals=new GoalTools({binding:mainToolBinding,inspect,plan,review}),tools=new CoordinationTools([goals]);
 const result=await tools.call('cbim_state_inspect',{target:'state',input:{}},new AbortController().signal,'read');
 const block=result.content[0];if(block.type!=='text')throw Error('expected state text');
 expect(JSON.parse(block.text)).toMatchObject({versions:{goalRevision:1,planRevision:null,graphCursor:{streamId:'stream',seq:1},tasks:[],evidence:[]}});
 expect(inspect).toHaveBeenCalledTimes(1);expect(plan).not.toHaveBeenCalled();expect(review).not.toHaveBeenCalled();
 for(const target of ['cbim_goal_plan','__proto__','member'])expect(()=>tools.describe('cbim_state_inspect',{target,input:{}})).toThrow();
 inspect.mockResolvedValueOnce({scope:mainToolScope({...mainToolBinding,rootSessionId:'foreign'}),graph:mainToolGraph()});
 await expect(tools.call('cbim_state_inspect',{target:'state',input:{}},new AbortController().signal,'bad')).rejects.toThrow();
});

it('等待闭包从真实 Store 生成完整检查点和后继；预览不审阅、不停泊、不启动',async()=>{
 const f=await memberPauseServiceFixture();try{
  const before=await f.store.read(),review=vi.fn(),binding={...f.identity,scopeId:f.scopeId,runId:f.mainRunId};
  const tools=new GoalTools({binding,inspect:vi.fn(),plan:vi.fn(),review,previewPause:()=>f.service.goals.previewClosure(f.identity,f.scopeId)});
  const input={decision:'awaiting_user',memberPause:{includeClosure:true}};
  expect(tools.describe('cbim_goal_review',input).effects).toEqual(['preview']);
  const result=JSON.parse((await tools.call('cbim_goal_review',input,new AbortController().signal,'preview')).content[0].text);
  expect(result).toMatchObject({status:'preview',readOnly:true,requiresConfirmation:true,issues:[],memberPause:f.pause});
  expect(result.retainedTaskIds).toEqual(f.pause.tasks.map(task=>task.taskId));
  expect(await f.store.read()).toEqual(before);expect(review).not.toHaveBeenCalled();expect(f.starts).toBe(1);
  const parked=await f.park();expect(parked.wait?.memberPause).toEqual(result.memberPause);
 }finally{await f.cleanup()}
});

it('撤销预览不落入写端口；回包周期错配拒绝；旧装配不宣称支持预览',async()=>{
 const input={expectedGraphCursor:{streamId:'stream',seq:1},targets:[{taskId:'a',expectedRevision:1}],reason:'cancel',includeClosure:true};
 const cancel=vi.fn(),previewCancel=vi.fn(async()=>({status:'preview',readOnly:true,requiresConfirmation:true,...mainToolBinding,graphCursor:{streamId:'stream',seq:1},goalRevision:1,affectedTaskIds:['a'],retainedTaskIds:[],issues:[]}));
 const tools=new DispatchTools({binding:mainToolBinding,dispatch:vi.fn(),inspect:vi.fn(),cancel,previewCancel});
 // runId 不是预览的公开字段，严格输出拒绝；不能因回包无效改走实际撤销。
 await expect(tools.call('cbim_dispatch_cancel',input,new AbortController().signal,'preview')).rejects.toThrow();
 expect(cancel).not.toHaveBeenCalled();expect(previewCancel).toHaveBeenCalledTimes(1);
 const old=new DispatchTools({binding:mainToolBinding,dispatch:vi.fn(),inspect:vi.fn(),cancel});
 expect(()=>old.describe('cbim_dispatch_cancel',input)).toThrow();
});
