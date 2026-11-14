import {expect,it,vi} from 'vitest';
import Ajv from 'ajv';
import {CoordinationTools} from '../src/logic/tools/runtime/coordination-tools';
import {ModuleOwnershipTools} from '../src/logic/tools/runtime/module-ownership-tools';

const binding={workspaceId:'workspace',instanceId:'instance',rootSessionId:'root',scopeId:'scope',agentInstanceId:'main',agentSessionId:'session',runId:'run'};
const owners=()=>new ModuleOwnershipTools({inspect:vi.fn(),preview:vi.fn(),commit:vi.fn(),receipt:vi.fn()},binding);
const state={list:()=>[{name:'cbim_goal_inspect',inputSchema:{type:'object',properties:{},additionalProperties:false}}],describe:()=>({effects:['read' as const],native:false}),call:vi.fn()};

it.each([false,true])('真实负责人 Schema 嵌入统一目录后仍能解析引用，前置 state=%s',withState=>{
  const owner=owners(),original=structuredClone(owner.list());
  const tools=new CoordinationTools(withState?[state,owner]:[owner]);
  const ajv=new Ajv({strict:false,validateFormats:false});
  // 原工具合法，组合后必须仍合法；供应商会在执行任何工具前编译整份目录。
  expect(()=>ajv.compile(original[0].inputSchema)).not.toThrow();
  for(const definition of tools.list()){
    const validate=ajv.compile(definition.inputSchema);
    if(definition.name==='cbim_state_inspect'){
      expect(validate({target:'owner',input:{members:true}})).toBe(true);
      expect(validate({target:'owner',input:{moduleIds:['module']}})).toBe(true);
      expect(validate({target:'owner',input:{members:true,expectedRegistryCursor:'invalid'}})).toBe(false);
      expect(validate({target:'owner',input:{moduleIds:[42]}})).toBe(false);
      expect(validate({target:'owner',input:{members:true,unexpected:true}})).toBe(false);
    }else expect(validate({target:'owner',input:{commandId:'07973c97-7911-45a2-82ed-84ca4ed8c836'}})).toBe(true);
  }
  expect(owner.list()).toEqual(original);
});

it('组合时根引用仍指向原 input，保留递归约束且不污染原目录',()=>{
  const schema={type:'object',properties:{next:{$ref:'#'}},additionalProperties:false};
  const tools=new CoordinationTools([{...state,list:()=>[{name:'cbim_goal_inspect',inputSchema:schema}]}]);
  const validate=new Ajv({strict:false}).compile(tools.list()[0].inputSchema);
  expect(validate({target:'state',input:{next:{next:{}}}})).toBe(true);
  expect(validate({target:'state',input:{next:{unexpected:true}}})).toBe(false);
  expect(schema.properties.next.$ref).toBe('#');
});
