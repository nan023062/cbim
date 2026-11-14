import {expect,test,vi} from 'vitest';
import Ajv from 'ajv';
import {DispatchTools} from '../src/logic/tools/runtime/dispatch-tools';
import {claudeInputSchema} from '../src/logic/execution/engines/claude/tools';

function cancellationCatalog(){
  return new DispatchTools({binding:{workspaceId:'w',rootSessionId:'r',scopeId:'s',runId:'run'},dispatch:vi.fn(),inspect:vi.fn(),cancel:vi.fn(),previewCancel:vi.fn()}).list();
}

test('Claude 真实撤销目录在顶层联合投影后仍能解析原分支引用',()=>{
  const catalog=cancellationCatalog(),before=structuredClone(catalog);
  for(const tool of catalog){
    const projected=claudeInputSchema(tool.inputSchema);
    const validate=new Ajv({strict:false,validateFormats:false}).compile(projected);
    if(tool.name==='cbim_dispatch_cancel'){
      expect(JSON.stringify(tool.inputSchema)).toContain('#/anyOf/0/properties/expectedGraphCursor');
      const input={expectedGraphCursor:{streamId:'stream',seq:1},targets:[{taskId:'task',expectedRevision:1}],reason:'cancel'};
      expect(validate(input)).toBe(true);
      expect(validate({...input,includeClosure:true})).toBe(true);
      expect(validate({...input,expectedGraphCursor:{streamId:'stream',seq:'bad'}})).toBe(false);
      expect(projected).not.toHaveProperty('anyOf');
    }
  }
  expect(catalog).toEqual(before);
});

test('Claude 投影保留递归及转义引用，不覆盖已有定义',()=>{
  const schema={definitions:{cbimOriginalInput:{type:'number'},'a/b':{type:'string'}},oneOf:[{type:'object',properties:{next:{$ref:'#'},value:{$ref:'#/definitions/a~1b'}},additionalProperties:false}]};
  const before=structuredClone(schema),projected=claudeInputSchema(schema);
  const validate=new Ajv({strict:false}).compile(projected);
  expect(validate({value:'ok',next:{next:{value:'ok'}}})).toBe(true);
  expect(validate({next:{value:42}})).toBe(false);
  expect(schema).toEqual(before);
});
