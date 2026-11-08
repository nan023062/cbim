/**
 * 生命周期工厂消费原可靠授权；未确认收尾保留token和仅清理原资源的闭包，drain不创建新执行。
 * 作用定位：正式成员冻结范围的实际 Win32 文件读取与 LPAC 执行端口。
 * 设计原因：原工程从不授予沙箱 ACL；可信宿主锁定目录/文件后复制字节，预算和运行断言来自原任务闭包。
 * 职责边界：单文件1MiB、总输入8MiB；输出不回写。未知物理清理保留占用，不能用工具失败当作实际进程退出。
 */
import path from 'node:path';
import {createRequire} from 'node:module';
import {executionScopeSchema,executionScopeCovers,type ExecutionScope} from '../../core/workspace/execution-scope';
import {scopedNodeInputSchema,type ScopedNodeInput} from '../../core/tasks/scoped-execution';
import type {ScopedExecutionPort} from '../../core/brain/run-scoped-execution';
import {Win32ControlledFile} from './controlled-file-win32';
import {runIsolatedNode} from './isolated-node';
import {fail} from '../../core/foundation/errors';
import type {ScopedExecutionAuthorization} from '../../core/tasks/isolated-execution-recovery';
import type {IsolationLifecycle} from './isolation-record';
const requireRuntime=createRequire(typeof __filename==='string'?__filename:import.meta.url);
/** 每个成员 run 创建独立对象；scope 不向模型写入，调用前后均复核原工作区仍有效。 */
export class ScopedExecutionFiles implements ScopedExecutionPort {
  readonly scope:ExecutionScope;private unsettled=new Set<symbol>();private cleanupRetries=new Map<symbol,()=>Promise<void>>();
  private readonly koffiPath:string;
  constructor(private readonly root:string,scope:ExecutionScope,private readonly assertCurrent:()=>void,private readonly protectedRoots:readonly string[]=[],private readonly lifecycle?:(authorization:ScopedExecutionAuthorization)=>Promise<IsolationLifecycle>){
    this.scope=executionScopeSchema.parse(structuredClone(scope));
    if(process.platform!=='win32'||process.arch!=='x64')fail('EXECUTION_SCOPE_UNSUPPORTED','当前平台未提供冻结范围执行');
    const host=process as NodeJS.Process&{resourcesPath?:string;defaultApp?:boolean};
    this.koffiPath=host.resourcesPath&&!host.defaultApp?path.join(host.resourcesPath,'koffi'):requireRuntime.resolve('koffi');
  }
  /** 返回完整锁定读取，供产物指纹/验证复用；调用者不得把 bytes 缓存为以后读取权限。 */
  snapshot(relative:string,signal:AbortSignal){
    this.assertCurrent();signal.throwIfAborted();if(!executionScopeCovers(this.scope.read,relative))fail('EXECUTION_SCOPE_DENIED','文件不属于原任务冻结读范围');
    const file=new Win32ControlledFile(this.root,relative,this.protectedRoots,this.koffiPath,undefined,true);
    const token=Symbol();this.unsettled.add(token);
    try{const result=file.read(true);this.assertCurrent();signal.throwIfAborted();return result}finally{file.close();this.unsettled.delete(token)}
  }
  /** 枚举期间持目标和全部祖先目录，不允许删除/重命名替换；返回释放函数只关闭本次句柄。 */
  lockDirectory(relative:string){this.assertCurrent();if(!executionScopeCovers(this.scope.read,relative,'directory'))fail('EXECUTION_SCOPE_DENIED','目录不属于原任务冻结读范围');const directory=new Win32ControlledFile(this.root,relative,this.protectedRoots,this.koffiPath,undefined,true,true);const token=Symbol();this.unsettled.add(token);return ()=>{directory.close();this.unsettled.delete(token)}}
  async read(relative:string,signal:AbortSignal){const value=this.snapshot(relative,signal),content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(value.bytes);return {file:{path:relative,...value.fact},encoding:'utf8' as const,content,acceptance:'not_evaluated' as const}}
  async node(raw:ScopedNodeInput,signal:AbortSignal,authorization?:ScopedExecutionAuthorization){
    if(this.unsettled.size)fail('EXECUTION_SCOPE_DRAIN_PENDING','原隔离资源尚未确认收尾，不能创建新执行');
    if(this.lifecycle&&!authorization)fail('EXECUTION_SCOPE_AUTHORIZATION','正式范围执行缺少原可信授权');
    const lifecycle=this.lifecycle?await this.lifecycle(authorization!):undefined;
    const input=scopedNodeInputSchema.parse(raw),budget=this.scope.node;if(!budget)fail('EXECUTION_SCOPE_DENIED','原任务未声明隔离Node能力');
    // 全部路径先核范围，避免恶意尾部参数使前几个文件先被读取。
    if(input.files.some(file=>!executionScopeCovers(this.scope.read,file)))fail('EXECUTION_SCOPE_DENIED','输入文件超出原任务冻结范围');
    let total=0;const files=input.files.map(relative=>{const value=this.snapshot(relative,signal);total+=value.bytes.length;if(total>8*1024*1024)fail('EXECUTION_SCOPE_LIMIT','输入快照超过8MiB');return {path:relative,base64:value.bytes.toString('base64')}});
    this.assertCurrent();signal.throwIfAborted();const token=Symbol();this.unsettled.add(token);
    const value=await runIsolatedNode({...input,files,...budget},signal,{koffiPath:this.koffiPath,lifecycle,onCleanupPending:retry=>{this.cleanupRetries.set(token,retry)},onSettled:()=>{this.unsettled.delete(token);this.cleanupRetries.delete(token)}});
    this.assertCurrent();return {executionId:value.executionId,isolation:value.isolation,status:value.status,exitCode:value.exitCode,stdio:value.stdio,runtime:value.runtime,inputs:value.inputs,outputs:value.outputs,allProcessesExited:value.allProcessesExited,cleanup:value.cleanup,acceptance:'not_evaluated' as const};
  }
  async drain(){for(const retry of this.cleanupRetries.values())await retry();if(this.unsettled.size)fail('EXECUTION_SCOPE_DRAIN_PENDING','原隔离执行尚未确认物理退出与清理，请保留运行占用并核实')}
}
