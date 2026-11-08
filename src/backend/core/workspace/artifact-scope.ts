/**
 * 作用定位：Workflow 可选完整产物观察范围的叶子契约，供知识冻结、运行采集和公开报告共用。
 * 设计原因：范围先于采集固定，不能由模型临时挑文件；拒绝重叠与大小写别名，避免一份清单漏算或重复归属。
 * 职责边界：普通范围只声明观察对象；可选删除/移动约定须由 Workflow 显式启用完整验收。声明不授予文件访问，真实操作与字节仍由可信端口核实。
 */
import {z} from 'zod';

export const artifactScopeLimits={roots:16,entries:512,depth:32,fileBytes:8*1024*1024,totalBytes:32*1024*1024,captures:8,readMs:15000,transitions:4} as const;
/** 采用可移植相对路径；无通配符或忽略规则，.cbim 和 Windows 设备/备用流名称均不能成为产物范围。 */
export const artifactScopePathSchema=z.string().min(1).max(2048).refine(value=>{
  const parts=value.split('/');
  return !/[\\:*?"<>|\x00-\x1f]/.test(value)&&parts.length<=artifactScopeLimits.depth&&parts.every(part=>!!part&&part!=='.'&&part!=='..'&&part.toLowerCase()!=='.cbim'&&!/[. ]$/.test(part)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
},'产物范围须为无跳转、通配符或受保护目录的业务相对路径');
export const artifactScopeRootSchema=z.object({path:artifactScopePathSchema,kind:z.enum(['file','directory'])}).strict();
export type ArtifactScopeRoot=z.infer<typeof artifactScopeRootSchema>;
/** 操作参数来自冻结约定，工具只选择模块与序号，不能临时改路径或将复制自称移动。 */
export const artifactTransitionDefinitionSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('delete'),path:artifactScopePathSchema}).strict(),
  z.object({kind:z.literal('move'),from:artifactScopePathSchema,to:artifactScopePathSchema}).strict(),
]);
export type ArtifactTransitionDefinition=z.infer<typeof artifactTransitionDefinitionSchema>;
/** 同一移动保留源和目标，供范围、重叠及当前状态检查共用。 */
export function artifactTransitionPaths(operation:ArtifactTransitionDefinition):string[]{return operation.kind==='delete'?[operation.path]:[operation.from,operation.to]}
/** 即使当前平台区分大小写，也不接受会在另一平台合并的根；目录范围包含全部后代。 */
export function artifactRootsDisjoint(roots:readonly ArtifactScopeRoot[]):boolean{
  return roots.every((root,index)=>roots.every((other,at)=>index===at||root.path.toLowerCase()!==other.path.toLowerCase()&&!(root.kind==='directory'&&other.path.toLowerCase().startsWith(root.path.toLowerCase()+'/'))));
}
export const artifactScopeSchema=z.object({version:z.literal(1),roots:z.array(artifactScopeRootSchema).min(1).max(artifactScopeLimits.roots).refine(artifactRootsDisjoint,'产物根不能重叠或使用大小写别名'),transitions:z.array(artifactTransitionDefinitionSchema).min(1).max(artifactScopeLimits.transitions).optional()}).strict().superRefine((value,context)=>{
  const paths=(value.transitions??[]).flatMap(artifactTransitionPaths),folded=paths.map(p=>p.toLowerCase());
  if(paths.some(p=>p.split('/').some(part=>part.toLowerCase()==='.git')||!value.roots.some(root=>root.path===p||root.kind==='directory'&&p.startsWith(root.path+'/')))||folded.some((p,i)=>folded.some((q,j)=>i!==j&&(p===q||p.startsWith(q+'/')))))context.addIssue({code:'custom',message:'删除/移动端点必须由本模块完整根覆盖，且不能重叠、使用大小写别名或访问受保护路径'});
});
export type ArtifactScope=z.infer<typeof artifactScopeSchema>;
const logical=z.string().min(1).max(512).refine(value=>value.trim()===value&&!/[\x00-\x1f]/.test(value));
export const artifactScopeBindingSchema=z.object({moduleId:logical,workflowId:logical,workflowVersion:logical,scope:artifactScopeSchema}).strict();
export const artifactScopeBindingsSchema=z.array(artifactScopeBindingSchema).min(1).max(artifactScopeLimits.roots).superRefine((values,context)=>{
  const roots=values.flatMap(value=>value.scope.roots);
  if(new Set(values.map(value=>value.moduleId)).size!==values.length||roots.length>artifactScopeLimits.roots||!artifactRootsDisjoint(roots))context.addIssue({code:'custom',message:'全部冻结模块的产物范围不能重复、重叠或超过16个根'});
  if(values.reduce((n,value)=>n+(value.scope.transitions?.length??0),0)>artifactScopeLimits.transitions)context.addIssue({code:'custom',message:'全部冻结模块合计最多四项删除/移动要求'});
});
export type ArtifactScopeBinding=z.infer<typeof artifactScopeBindingSchema>;
/** 序号只在原冻结模块内有意义；数组顺序及路径均进入范围身份。 */
export function preparedArtifactTransitions(scopes:readonly ArtifactScopeBinding[]){return scopes.flatMap(scope=>(scope.scope.transitions??[]).map((operation,operationIndex)=>({moduleId:scope.moduleId,operationIndex,operation:structuredClone(operation)})))}
/** 只投影已冻结 Workflow；没有声明时返回空数组，不给旧任务补造完整覆盖。 */
export function preparedArtifactScopes(bindings:readonly {moduleId:string;workflowId:string;workflowVersion:string;contract:{artifactScope?:ArtifactScope}}[]):ArtifactScopeBinding[]{
  const scopes=bindings.flatMap(value=>value.contract.artifactScope?[{moduleId:value.moduleId,workflowId:value.workflowId,workflowVersion:value.workflowVersion,scope:structuredClone(value.contract.artifactScope)}]:[]);
  return scopes.length?artifactScopeBindingsSchema.parse(scopes).sort((a,b)=>a.moduleId<b.moduleId?-1:a.moduleId>b.moduleId?1:0):[];
}
