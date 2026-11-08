/**
 * 作用定位：模块 Workflow 的可冻结执行范围及任务合并规则，供知识准备、运行门禁与平台装配共用。
 * 设计原因：声明只收窄原任务权限；混合无范围模块不能退回原生工具，多个模块的预算取最小值。
 * 职责边界：这里只比较规范路径，真实文件身份与进程隔离由平台负责，不把字符串检查称为沙箱。
 */
import {z} from 'zod';
import {artifactScopePathSchema,artifactRootsDisjoint,artifactTransitionPaths,type ArtifactScopeRoot,type ArtifactScope} from './artifact-scope';

export const executionPathSchema=artifactScopePathSchema.refine(path=>path.length<=512&&!path.includes('\x7f')&&!path.split('/').some(part=>part.toLowerCase()==='.git'),'执行路径最长512字符且不能访问 .git');
const root=z.object({path:executionPathSchema,kind:z.enum(['file','directory'])}).strict();
/** 文件根只覆盖自身；目录根覆盖后代，不能把一个文件权限解释成目录权限。 */
export function executionScopeCovers(roots:readonly ArtifactScopeRoot[],path:string,kind:'file'|'directory'='file'):boolean{
  return executionPathSchema.safeParse(path).success&&roots.some(root=>root.kind==='directory'&&(root.path===path||path.startsWith(root.path+'/'))||kind==='file'&&root.kind==='file'&&root.path===path);
}
export const executionScopeSchema=z.object({
  version:z.literal(1),profile:z.literal('windows-lpac-node-v1'),
  read:z.array(root).min(1).max(32).refine(artifactRootsDisjoint),
  write:z.array(root).max(32).refine(artifactRootsDisjoint),
  /** 这些是固定上限，工具参数不能覆盖；timeoutMs 是单次执行墙钟毫秒。 */
  node:z.object({timeoutMs:z.number().int().min(100).max(30000),memoryMiB:z.number().int().min(128).max(1024),processLimit:z.number().int().min(1).max(8)}).strict().optional(),
}).strict().superRefine((value,context)=>{if(value.write.some(root=>!executionScopeCovers(value.read,root.path,root.kind)))context.addIssue({code:'custom',message:'写范围必须完整包含在读范围内'})});
export type ExecutionScope=z.infer<typeof executionScopeSchema>;
type Contract={executionScope?:ExecutionScope;artifactScope?:ArtifactScope;delivery?:{requiredToolEvidence?:{toolName:string}[];requiredValidations?:{artifactPath:string}[]}};
/** 准备与恢复对全部实际模块调用；未声明任务返回 undefined，不能给旧记录自动加范围。 */
export function preparedExecutionScope(modules:readonly {contract?:Contract}[]):ExecutionScope|undefined{
  const scopes=modules.flatMap(module=>module.contract?.executionScope?[executionScopeSchema.parse(module.contract.executionScope)]:[]);
  if(!scopes.length)return;
  if(scopes.length!==modules.length)throw Error('EXECUTION_SCOPE_MIXED: 范围任务的全部模块必须显式声明 executionScope');
  for(const module of modules){const contract=module.contract!,scope=contract.executionScope!;
    if(contract.artifactScope?.roots.some(root=>!executionScopeCovers(scope.read,root.path,root.kind))||contract.delivery?.requiredValidations?.some(rule=>!executionScopeCovers(scope.read,rule.artifactPath)))throw Error('EXECUTION_SCOPE_OUTPUT: 产物与验证必须属于本模块冻结读范围');
    if(contract.artifactScope?.transitions?.some(operation=>artifactTransitionPaths(operation).some(path=>!executionScopeCovers(scope.write,path))))throw Error('EXECUTION_SCOPE_WRITE: 删除/移动两端必须属于本模块冻结写范围');
    if(contract.delivery?.requiredToolEvidence?.some(rule=>['read','write','edit','bash','grep','find','ls'].includes(rule.toolName)))throw Error('EXECUTION_SCOPE_NATIVE: 隔离模式不能要求原生工具证据');
    if(contract.delivery?.requiredToolEvidence?.some(rule=>rule.toolName==='cbim_scoped_node')&&!scope.node)throw Error('EXECUTION_SCOPE_NODE: Node证据要求必须同时声明固定预算');
  }
  // 合并显式授予的模块根，去掉已被目录覆盖的冗余根；不根据当前磁盘目录扩大授权。
  const merge=(key:'read'|'write')=>scopes.flatMap(scope=>scope[key]).filter((root,index,all)=>!all.some((other,at)=>at!==index&&(other.path===root.path&&other.kind===root.kind&&at<index||other.kind==='directory'&&(root.path.startsWith(other.path+'/')||root.path===other.path&&root.kind==='file'))));
  const budgets=scopes.map(scope=>scope.node);
  if(!budgets.every(Boolean)&&modules.some(module=>module.contract?.delivery?.requiredToolEvidence?.some(rule=>rule.toolName==='cbim_scoped_node')))throw Error('EXECUTION_SCOPE_NODE: 全部模块必须共同允许隔离Node证据要求');
  return executionScopeSchema.parse({version:1,profile:'windows-lpac-node-v1',read:merge('read'),write:merge('write'),...(budgets.every(Boolean)?{node:{timeoutMs:Math.min(...budgets.map(b=>b!.timeoutMs)),memoryMiB:Math.min(...budgets.map(b=>b!.memoryMiB)),processLimit:Math.min(...budgets.map(b=>b!.processLimit))}}:{})});
}
