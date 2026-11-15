import {test,expect} from 'vitest';
import {memoryDecision,memoryVectors} from '../../../../src/logic/execution/engines/memory/protocol';
import {memoryChatReply} from '../../../memory-engine-data';
test('截断、未知工具、重复键和多工具响应不能产生执行决定',()=>{
  const allowed=new Set(['cbim_object_commit']);expect(memoryDecision(memoryChatReply('cbim_object_commit'),allowed).tool_calls).toHaveLength(1);
  const truncated=memoryChatReply('cbim_object_commit');truncated.choices[0].finish_reason='length';expect(()=>memoryDecision(truncated,allowed)).toThrow('上限');
  expect(()=>memoryDecision(memoryChatReply('cbim_other'),allowed)).toThrow('未提供');
  const duplicate=memoryChatReply('cbim_object_commit');duplicate.choices[0].message.tool_calls![0].function.arguments='{"x":1,"x":2}';expect(()=>memoryDecision(duplicate,allowed)).toThrow('重复');
  const multiple=memoryChatReply('cbim_object_commit');multiple.choices[0].message.tool_calls!.push(multiple.choices[0].message.tool_calls![0]);expect(()=>memoryDecision(multiple,allowed)).toThrow();
});
test('向量次序可还原，重复序号、错误维度及非有限值不能补零',()=>{
  expect(memoryVectors({data:[{index:1,embedding:[0,1]},{index:0,embedding:[1,0]}]},2,2)).toEqual([[1,0],[0,1]]);
  for(const data of [[{index:0,embedding:[1]}],[{index:0,embedding:[NaN,1]}],[{index:1,embedding:[1,0]}]])expect(()=>memoryVectors({data},1,2)).toThrow();
});
