import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {mainToolTask,mainToolBinding} from './main-tool-output-fixture';
import type {TaskNode,DependencyRevision} from '../src/bridge/contracts/dispatch';
import {MemberDependencyNotice} from '../src/view/tasks/MemberDependencyNotice';
import {MemberTaskDetail} from '../src/view/tasks/MemberTaskDetail';
import {memberDependencyRevisionHistory} from '../src/view/tasks/member-dependency-state';
const time='2026-11-08T00:00:00.000Z';
function node():TaskNode{
 const task=mainToolTask(mainToolBinding,'target'),revision:DependencyRevision={commandId:'revise',scopeId:mainToolBinding.scopeId,mainRunId:mainToolBinding.runId,revisedAt:time,request:{expectedGraphCursor:{streamId:'graph',seq:5},expectedGoalRevision:2,target:{taskId:'target',expectedRevision:1,expectedPlanRevision:1},remove:[{edgeId:'old-edge',expectedRevision:1}],add:[{taskId:'new',expectedRevision:1,expectedPlanRevision:1}],reason:'<script>原子调整</script>'},goalPlanRevision:2,knowledgeRevision:'knowledge',removed:[{edgeId:'old-edge',edgeRevision:1,sourceTaskId:'old',sourceTaskRevision:1,sourcePlanRevision:1}],added:[{edgeId:'new-edge',sourceTaskId:'new',sourceTaskRevision:1,sourcePlanRevision:1}],trackedTaskIds:['old','target','new']};
 return {...task,scopeId:mainToolBinding.scopeId,revision:2,planRevision:1,status:'waiting',dependencyRevisions:[revision]};
}
const render=(task:TaskNode,compact=false)=>renderToStaticMarkup(createElement(MemberDependencyNotice,{task,compact}));
it('原子增删只读呈现来源数量和原请求，文本转义且不产生操作控件',()=>{
 const task=node(),before=structuredClone(task),html=render(task);expect(memberDependencyRevisionHistory(task).invalid).toBe(false);
 for(const s of ['前置已修订','退役 1 条，新增 1 条','&lt;script&gt;','data-revision-id="revise"','不代表执行完成或业务验收'])expect(html).toContain(s);
 expect(html).not.toContain('<script>');expect(html).not.toMatch(/<(button|input|form)\b/);expect(task).toEqual(before);
 const detail=renderToStaticMarkup(createElement(MemberTaskDetail,{workspaceId:mainToolBinding.workspaceId,rootSessionId:mainToolBinding.rootSessionId,task}));expect(detail).toContain('member-dependency-revision');
});
it('旧节点不补历史，坏身份/请求/重复来源不显示已修订；混合历史按任务版本选最新',()=>{
 const task=node(),r=task.dependencyRevisions![0];expect(render({...task,dependencyRevisions:undefined})).toBe('');
 for(const bad of [{...task,scopeId:'other'},{...task,dependencyRevisions:[]},{...task,revision:1},{...task,dependencyRevisions:[{...r,request:{...r.request,remove:[]}}]},{...task,dependencyRevisions:[{...r,added:[...r.added,...r.added]}]}])expect(render(bad)).toContain('member-dependency-invalid');
 const mixed={...task,revision:5,dependencyAdditions:[{commandId:'later',scopeId:r.scopeId,mainRunId:r.mainRunId,addedAt:time,reason:'稍后追加',graphCursor:{streamId:'graph',seq:8},goalRevision:2,goalPlanRevision:2,knowledgeRevision:'knowledge',previousTaskRevision:3,targetPlanRevision:1,dependency:{edgeId:'another',sourceTaskId:'another',sourceTaskRevision:1,sourcePlanRevision:1},trackedTaskIds:['target','another']}]};
 expect(render(mixed,true)).toContain('稍后追加');expect(render(mixed,true)).not.toContain('前置已修订');expect(render(mixed)).toContain('前置已修订');mixed.dependencyAdditions[0].previousTaskRevision=1;expect(render(mixed)).toContain('member-dependency-invalid');
});
