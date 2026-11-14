import {createHash} from 'node:crypto';
import type {ResolvedEngineModel} from '../src/logic/engines';
/** 纯模型/知识事实；不启动应用、网络或共享可变服务。每次返回新对象。 */
export function memoryModel(baseUrl='https://memory.example/v1'):ResolvedEngineModel{
  const vector={kind:'embedding' as const,id:'22222222-2222-4222-8222-222222222222',name:'Vector',api:'openai-embeddings' as const,baseUrl,auth:'none' as const,model:'vector',inputTokens:8192,dimensions:2,inputPrice:1};
  return {apiKey:'',profile:{id:'11111111-1111-4111-8111-111111111111',name:'Chat',engine:'memory',api:'openai-completions',baseUrl,auth:'none',model:'chat',contextWindow:8192,maxTokens:1024,reasoning:false,pricing:{input:2,output:3,cacheRead:1,cacheWrite:1},modelRoles:{version:2,roles:{embedding:{kind:'embedding',profile:vector}}}},modelRoles:{embedding:{profile:vector,apiKey:''}}};
}
export function memorySnapshot(text='来源知识：项目要求保留原文和引用。'){
  const hash=createHash('sha256').update(text).digest('hex');return {workspaceId:'workspace',instanceId:'instance',revision:hash,files:[{path:'.cbim/workspace/memory.md',text,hash}]};
}
export const memoryEmbeddingReply=()=>({data:[{index:0,embedding:[1,0]}],usage:{prompt_tokens:5,total_tokens:5}});
export const memoryChatReply=(tool?:string,input:Record<string,unknown>={})=>({choices:[{index:0,finish_reason:tool?'tool_calls':'stop',message:{role:'assistant',content:tool?null:'摘要：保留原文及来源 .cbim/workspace/memory.md。',...(tool?{tool_calls:[{id:'provider-call',type:'function',function:{name:tool,arguments:JSON.stringify(input)}}]}:{})}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}});
