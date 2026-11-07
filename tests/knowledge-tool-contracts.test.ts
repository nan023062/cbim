import {expect,it} from 'vitest';
import {fixture,internalKnowledge} from './helpers';
import {knowledgeToolCatalogOutputSchema,knowledgeToolDescribeOutputSchema} from '../src/backend/core/tools/contracts';

it('真实知识目录只发现已注册能力，自描述有限且不执行领域写入或启动维护任务',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(entry.id),{service,call}=internalKnowledge(ws),before=await ws.snapshot();
    const catalog=await call('cbim_knowledge_tool_catalog');
    expect(knowledgeToolCatalogOutputSchema.parse(catalog)).toEqual(catalog);expect(catalog.family).toBe('knowledge');expect(catalog.tools).toHaveLength(28);
    expect(catalog.tools.map((item:any)=>item.name)).toEqual(service.list().map(item=>item.name));
    for(const item of catalog.tools){expect(Object.keys(item).sort()).toEqual(item.description===undefined?['effects','name','version']:['description','effects','name','version']);expect(item.name).not.toMatch(/^cbim_dispatch_/)}
    for(const item of catalog.tools){
      const result=await call('cbim_knowledge_tool_describe',{name:item.name});expect(knowledgeToolDescribeOutputSchema.parse(result)).toEqual(result);
      expect(result.tool).toMatchObject({...item,cancellation:{mode:'preflight_only'}});expect(result.tool.inputSchema.type).toBe('object');expect(result.tool).not.toHaveProperty('execute');
    }
    const self=await call('cbim_knowledge_tool_describe',{name:'cbim_knowledge_tool_describe'});
    expect(JSON.stringify(self).length).toBeLessThan(32_768);expect(self.tool.outputSchema.type).toBe('object');expect(self.tool.outputSchema.properties.family.const).toBe('knowledge');
    for(const name of ['bash','cbim_dispatch_task','cbim_missing'])await expect(call('cbim_knowledge_tool_describe',{name})).rejects.toMatchObject({code:'TOOL'});
    const after=await ws.snapshot();expect(after.revision).toBe(before.revision);expect(after.files).toEqual(before.files);
  }finally{await f.cleanup()}
});

it('按真实预览、提交和维护协议描述恢复，不把新ID当作未知结果的重试',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),{call}=internalKnowledge(f.app.workspace(entry.id));
    const recovery=async(name:string)=>(await call('cbim_knowledge_tool_describe',{name})).tool.recovery;
    expect(await recovery('cbim_knowledge_preview')).toMatchObject({mode:'new_preview',description:expect.stringContaining('revision')});
    expect(await recovery('cbim_knowledge_move_preview')).toMatchObject({mode:'new_preview',description:expect.stringContaining('新的 requestId')});
    expect(await recovery('cbim_knowledge_commit')).toMatchObject({mode:'same_request',keyFields:['requestId']});
    expect(await recovery('cbim_object_commit')).toMatchObject({mode:'same_plan',keyFields:['planId']});
    expect(await recovery('cbim_knowledge_refresh')).toMatchObject({mode:'inspect_before_retry'});
    expect(await recovery('cbim_rules_validate')).toMatchObject({mode:'query_task',queryTool:'cbim_task_status'});
    expect(await recovery('cbim_task_cancel')).toMatchObject({mode:'query_task',queryTool:'cbim_task_status',keyFields:['taskId']});
  }finally{await f.cleanup()}
});
