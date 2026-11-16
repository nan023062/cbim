import {it,expect} from 'vitest';
import {fixture} from './helpers';
import {knowledgeTools} from '../src/logic/tools/runtime/knowledge-tools';
import type {KnowledgeWorkspace} from '../src/logic/knowledge/rules/ports';

// Keep this regression independent of fixture changes for external host integration.
function internalKnowledge(workspace:KnowledgeWorkspace){return {async call(name:string,input:Record<string,unknown>){
  const result=await knowledgeTools(workspace).CallFromRun(name,{workspaceId:workspace.entry.id,instanceId:workspace.instanceId,...input},true);
  return JSON.parse((result as {content:{text:string}[]}).content[0].text);
}}}

it('未知、对话或其他工作区维护任务 ID 均明确报错，不返回空工具结果',async()=>{
  const f=await fixture();try{
    const a=await f.app.Dispatch('add',{path:f.a}),b=await f.app.Dispatch('add',{path:f.b});
    const wa=f.app.Workspace(a.id),wb=f.app.Workspace(b.id),other=wb.StartTask('validate');
    for(const id of ['missing-maintenance-task','conversation-not-maintenance',other.id]){
      expect(()=>wa.CancelTask(id)).toThrowError(expect.objectContaining({code:'TASK_NOT_FOUND'}));
      await expect(internalKnowledge(wa).call('cbim_task_cancel',{taskId:id})).rejects.toMatchObject({code:'TASK_NOT_FOUND',message:expect.stringContaining('知识检查或索引维护任务')});
    }
    expect(wa.tasks.size).toBe(0);
    await expect.poll(()=>other.state).toBe('completed');
  }finally{await f.cleanup()}
});

it('取消维护任务只请求停止，等待任务确认后才报告 cancelled，重复请求保留终态',async()=>{
  const f=await fixture();try{
    const entry=await f.app.Dispatch('add',{path:f.a}),ws=f.app.Workspace(entry.id),task=ws.StartTask('validate');
    const pending=ws.CancelTask(task.id);
    expect(pending).toBe(task);expect(pending.state).toBe('running');
    expect(ws.CancelTask(task.id).state).toBe('running');
    await expect.poll(()=>task.state).toBe('cancelled');
    const terminal=structuredClone(task);
    expect(ws.CancelTask(task.id)).toEqual(terminal);
    expect(await internalKnowledge(ws).call('cbim_task_cancel',{taskId:task.id})).toEqual(terminal);
  }finally{await f.cleanup()}
});

it('已经完成或失败的维护任务不会被取消请求改写为取消',async()=>{
  const f=await fixture();try{
    const entry=await f.app.Dispatch('add',{path:f.a}),ws=f.app.Workspace(entry.id),completed=ws.StartTask('validate');
    await expect.poll(()=>completed.state).toBe('completed');
    const before=structuredClone(completed);
    expect(ws.CancelTask(completed.id)).toEqual(before);
    const original=ws.rules.Validate;
    try{
      ws.rules.Validate=async()=>{throw Error('isolated validation failure')};
      const failed=ws.StartTask('validate');await expect.poll(()=>failed.state).toBe('failed');
      const failure=structuredClone(failed);expect(ws.CancelTask(failed.id)).toEqual(failure);
      expect(failed.error).toBe('isolated validation failure');
    }finally{ws.rules.Validate=original}
  }finally{await f.cleanup()}
});

it('取消操作先检查工作区运行状态，不从已关闭实例返回旧任务',async()=>{
  const f=await fixture();try{
    const entry=await f.app.Dispatch('add',{path:f.a}),ws=f.app.Workspace(entry.id),task=ws.StartTask('validate');
    await expect.poll(()=>task.state).toBe('completed');await ws.Close();
    expect(()=>ws.CancelTask(task.id)).toThrowError(expect.objectContaining({code:'NOT_RUNNING'}));
    expect(()=>ws.CancelTask('missing')).toThrowError(expect.objectContaining({code:'NOT_RUNNING'}));
  }finally{await f.cleanup()}
});
