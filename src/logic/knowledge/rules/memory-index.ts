/**
 * 作用定位：正式知识的派生向量索引规则，固定来源版本、向量模型和分块策略，提供可重建的代际与检索。
 * 设计原因：索引不是正式知识；新模型/维度/正文生成新代，全部向量验证后才可使用，不混入旧模型向量。
 * 职责边界：只消费已授权快照与已结算向量，不读文件、不调用模型、不提交知识或授予权限。
 */
import {createHash} from 'node:crypto';
import {knowledgeSearchOutputSchema,type KnowledgeSearchOutput} from './tool-output-base';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export interface MemoryChunk {path:string;sourceHash:string;offset:number;text:string}
/** key 同时绑定工作区、完整来源版本和公开 embedding 配置摘要；不得保存密钥。 */
export interface MemoryIndexPlan {version:1;key:string;workspaceId:string;revision:string;modelHash:string;dimensions:number;strategy:'characters-768-v1';chunks:MemoryChunk[]}
export interface MemoryIndex extends MemoryIndexPlan {vectors:number[][]}
/** 超过规模明确拒绝，不静默截断后宣称完整索引；offset 为 JS 字符偏移，来源文本原样保留。 */
export function planMemoryIndex(input:unknown,modelHash:string,dimensions:number):MemoryIndexPlan{
  const snapshot:KnowledgeSearchOutput=knowledgeSearchOutputSchema.parse(input);
  if(!/^[a-f0-9]{64}$/.test(modelHash)||!Number.isSafeInteger(dimensions)||dimensions<1||dimensions>65536)throw Error('向量索引模型身份无效');
  const chunks:MemoryChunk[]=[],paths=new Set<string>();
  for(const file of [...snapshot.files].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)){
    if(paths.has(file.path)||digest(file.text)!==file.hash)throw Error('知识来源重复或正文与版本不一致');paths.add(file.path);
    for(let offset=0;offset<file.text.length;offset+=768){chunks.push({path:file.path,sourceHash:file.hash,offset,text:file.text.slice(offset,offset+768)});if(chunks.length>128)throw Error('当前记忆引擎最多索引 128 个片段，请缩小知识范围')}
  }
  const value={version:1 as const,workspaceId:snapshot.workspaceId,revision:snapshot.revision,modelHash,dimensions,strategy:'characters-768-v1' as const,chunks};
  return {...value,key:digest(JSON.stringify(value))};
}
/** 以副本形成完整新代；失败不会修改旧代。零向量不可用于余弦检索。 */
export function finishMemoryIndex(plan:MemoryIndexPlan,vectors:readonly number[][]):MemoryIndex{
  if(vectors.length!==plan.chunks.length)throw Error('索引向量数量与来源不一致');
  for(const vector of vectors)checkVector(vector,plan.dimensions);
  return {...structuredClone(plan),vectors:vectors.map(v=>[...v])};
}
function checkVector(vector:readonly number[],dimensions:number){
  if(vector.length!==dimensions||vector.some(v=>!Number.isFinite(v))||!Number.isFinite(Math.hypot(...vector))||Math.hypot(...vector)===0)throw Error('向量维度或数值无效');
}
/** 查询向量必须由相同模型产生；返回带来源版本的资料，不把命中正文解释为指令。 */
export function searchMemoryIndex(index:MemoryIndex,query:readonly number[],limit=6){
  checkVector(query,index.dimensions);if(!Number.isSafeInteger(limit)||limit<1||limit>16)throw Error('检索数量无效');
  const qn=Math.hypot(...query);
  return index.chunks.map((chunk,i)=>{const v=index.vectors[i],vn=Math.hypot(...v);return {...chunk,score:v.reduce((sum,n,j)=>sum+n/vn*(query[j]/qn),0)}}).sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path)||a.offset-b.offset).slice(0,limit);
}
