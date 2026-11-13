import {expect,it,vi} from 'vitest';
import {fixture} from './helpers';
import {internalKnowledge} from './knowledge-tool-fixture';
import {knowledgeToolCatalogOutputSchema,knowledgeToolDescribeOutputSchema} from '../src/logic/tools/rules/contracts';

it('缺省知识身份取当前实例，可选query不必填写；显式旧身份、缺业务字段和写权限仍拒绝',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(entry.id),{service,identity}=internalKnowledge(ws),assert=vi.spyOn(ws,'assert');
    const original={};const automatic=await service.callFromRun('cbim_agent_registry',original,false);
    expect(original).toEqual({});expect(assert).toHaveBeenCalledWith(identity);
    expect(automatic).toEqual(await service.callFromRun('cbim_agent_registry',identity,false));
    expect(service.describe('cbim_agent_registry',{}).effects).toEqual(['read']);
    const schema=service.list().find(t=>t.name==='cbim_agent_registry')!.inputSchema as {required?:string[]};
    expect(schema.required??[]).not.toContain('workspaceId');expect(schema.required??[]).not.toContain('query');
    for(const bad of [{workspaceId:'other'},{instanceId:'old'},{workspaceId:null},{instanceId:''}])await expect(service.callFromRun('cbim_agent_registry',bad,false)).rejects.toThrow();
    await expect(service.callFromRun('cbim_module_get',{},false)).rejects.toMatchObject({code:'TOOL_INPUT_INVALID',message:expect.stringContaining('id：缺少必填字段')});
    await expect(service.callFromRun('cbim_object_commit',{planId:'not-a-plan'},false)).rejects.toMatchObject({code:'FORBIDDEN'});
    try{await service.callFromRun('cbim_knowledge_refresh',{},true)}catch(error){expect(String(error)).toContain('revision：');expect(String(error)).toContain('requestId：');expect(String(error)).not.toContain('instanceId：')}
    assert.mockImplementation(()=>{throw Error('实例已关闭')});await expect(service.callFromRun('cbim_agent_registry',{},false)).rejects.toThrow('实例已关闭');assert.mockRestore();
  }finally{await f.cleanup()}
});

it('真实知识目录只发现已注册能力，自描述有限且不执行领域写入或启动维护任务',async()=>{
  const f=await fixture();try{
    const entry=await f.app.dispatch('add',{path:f.a}),ws=f.app.workspace(entry.id),{service,call}=internalKnowledge(ws),before=await ws.snapshot();
    const catalog=await call('cbim_knowledge_tool_catalog');
    expect(knowledgeToolCatalogOutputSchema.parse(catalog)).toEqual(catalog);expect(catalog.family).toBe('knowledge');expect(catalog.tools).toHaveLength(31);
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
    expect(await recovery('cbim_knowledge_refresh')).toMatchObject({mode:'same_request',keyFields:['requestId']});
    expect(await recovery('cbim_rules_validate')).toMatchObject({mode:'query_task',queryTool:'cbim_task_status'});
    expect(await recovery('cbim_task_cancel')).toMatchObject({mode:'query_task',queryTool:'cbim_task_status',keyFields:['taskId']});
  }finally{await f.cleanup()}
});
