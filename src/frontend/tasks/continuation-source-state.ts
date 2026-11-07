/**
 * 作用定位：核对安全等待资料选择器的公开授权目标与真实仓库分页身份。
 * 设计原因：迟到页或不同共享代际不能替换用户当前选择；只校验公开协议，不签发权限或推断静态资源可以执行。
 */
import {z} from 'zod';
import {repositoryToolTargetSchema,repositoryListOutputSchema} from '../../bridge/contracts/repository-connections';
import type {RepositoryToolTarget} from '../../bridge/contracts/repository-connections';

const targets=z.object({workspaceId:z.string().min(1),instanceId:z.string().uuid(),targets:z.array(repositoryToolTargetSchema)}).strict();
/** 捕获仅提供已授权目标；所有目标必须属于原工作区，没有自动 HTTP 探测。 */
export function checkedMaterialTargets(raw:unknown,workspaceId:string){
  const value=targets.parse(raw);
  if(value.workspaceId!==workspaceId||value.targets.some(item=>item.workspaceId!==workspaceId)||new Set(value.targets.map(item=>item.connectorId)).size!==value.targets.length)throw Error('仓库资料来源与原工作区不一致');
  return value.targets;
}
/** 后续分页锁定首次真实 revision，换源或换共享实例须重新显式读取。 */
export function checkedMaterialPage(raw:unknown,workspaceId:string,request:{target:RepositoryToolTarget;expectedRevision?:string;offset?:number}){
  const page=repositoryListOutputSchema.parse(raw),{target}=request;
  if(target.workspaceId!==workspaceId||page.scope.workspaceId!==workspaceId||page.scope.connectorId!==target.connectorId||page.scope.repositoryId!==target.repositoryId||page.scope.connectionId!==target.connectionId||page.offset!==(request.offset??0)||request.expectedRevision&&page.revision!==request.expectedRevision)throw Error('仓库目录回包与原来源或版本不一致');
  return page;
}
