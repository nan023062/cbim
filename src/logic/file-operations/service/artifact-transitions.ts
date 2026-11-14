/**
 * 目录归属：logic/file-operations/service；受控操作与原资源核实服务。
 * 作用定位：把已打开工作区的真实文件 utility 能力装配为成员删除/移动端口，不暴露平台句柄到 Core。
 * 设计原因：原阶段由可信 Runtime canonical 保存，Main 只核工作区生命周期、固定根及真实工人返回；无能力不能回退任意文件命令。
 * 职责边界：这里只执行冻结单项，不创建计划、改写原操作或生成验收决定；操作返回前等待工人真实退出。
 * 删除和移动沿用同一程序缓存保护边界，不允许把独立更新目录当业务产物目标。
 */
import {isDeepStrictEqual as equal} from 'node:util';
import {fail} from '../../../core/errors';
import type {ArtifactTransitionRunPort} from '../../execution/rules/capabilities/run-artifact-transition';
import type {ControlledFileTransport,ControlledNamespaceChange} from '../platform/files/controlled-file-protocol';
import type {Workspace} from '../../workspace/service/workspace';

/** 缺少专用传输返回 undefined，使运行准备按实际能力拒绝；不让只读 Node 宿主伪造执行能力。 */
export function createArtifactTransitionPort(owner:Workspace,transport:ControlledFileTransport|undefined,isCurrent:()=>boolean):ArtifactTransitionRunPort|undefined{
  if(!transport?.withExclusiveTransition)return;
  const root=owner.entry.path,instanceId=owner.instanceId,workspaceId=owner.entry.id,protectedRoots=[owner.paths.userRoot,owner.paths.installRoot,...(owner.paths.protectedRoots??[])];
  const check=()=>{owner.assert({workspaceId,instanceId});if(!isCurrent())fail('ARTIFACT_TRANSITION_UNAVAILABLE','工作区正在停止，不能发出删除/移动')};
  return {withExclusive:async(operation,signal,use)=>{
    check();signal.throwIfAborted();const frozen=structuredClone(operation),source=frozen.kind==='delete'?frozen.path:frozen.from,transition:ControlledNamespaceChange=frozen.kind==='delete'?{kind:'delete'}:{kind:'move',targetRelativePath:frozen.to};
    return transport.withExclusiveTransition!(root,source,transition,protectedRoots,signal,async file=>use({readBefore:async()=>{check();signal.throwIfAborted();const value=await file.readBefore();return {identity:value.identity,fact:value.fact}},apply:async()=>{
      check();signal.throwIfAborted();const result=await file.transitionAndVerify();if(!equal(result.transition,transition)||result.sourceMissing!==true)fail('ARTIFACT_TRANSITION_RESULT_INVALID','平台返回了另一项删除/移动');return {identity:result.identity,fact:result.fact,operation:frozen,sourceMissing:true};
    }}));
  },drain:()=>transport.drain(root)};
}
