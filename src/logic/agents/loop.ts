/**
 * 作用定位：独立 Agent 执行循环的生命周期封装，由装配注入已有 LoopRuntime/引擎驱动。
 * 设计原因：复用 SDK 的模型—工具循环，不在调度器里重写模型协议；停止必须等待真实排空。
 */
import type {Agent} from './agent';
import type {RunSummary} from '../execution/rules/types';

export interface AgentLoopDriver {
  start(message:string,signal:AbortSignal,beforeRun:(runId:string)=>Promise<void>):Promise<{runId:string;done:Promise<RunSummary>}>;
  stop():Promise<void>;
  close():Promise<void>;
}
/** 单次执行只启动一次；对话续接须另经已验证的日志入口，不自动重放失败执行。 */
export class AgentExecutionLoop {
  private started=false;
  private closed=false;
  private stopFailure:unknown;
  constructor(readonly agent:Agent,private readonly driver:AgentLoopDriver){}
  async start(message:string,signal:AbortSignal,beforeRun:(runId:string)=>Promise<void>):Promise<{runId:string;done:Promise<RunSummary>}>{
    if(this.started||this.closed)throw Error('Agent 循环已启动或关闭，不能重复执行');
    this.started=true;
    const abort=()=>{void this.stop().catch(()=>{})};signal.addEventListener('abort',abort,{once:true});
    try{
      signal.throwIfAborted();const run=await this.driver.start(message,signal,beforeRun);if(signal.aborted)await this.stop();
      const done=run.done.finally(async()=>{signal.removeEventListener('abort',abort);await this.close();if(this.stopFailure)throw this.stopFailure});void done.catch(()=>{});return {runId:run.runId,done};
    }catch(error){signal.removeEventListener('abort',abort);await this.close();throw error}
  }
  async run(message:string,signal:AbortSignal,beforeRun:(runId:string)=>Promise<void>):Promise<RunSummary>{return (await this.start(message,signal,beforeRun)).done}
  async stop(){try{await this.driver.stop()}catch(error){this.stopFailure=error;throw error}}
  async close(){if(this.closed)return;await this.driver.close();this.closed=true}
}
