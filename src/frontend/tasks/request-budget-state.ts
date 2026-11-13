/**
 * 作用定位：管理单一目标的只读请求账本摘要，显式刷新且核对完整身份与冻结策略版本。
 * 设计原因：换目标后迟到的旧结果不能写入新卡片，读取失败不显示零；构造、订阅和渲染均不发请求或恢复模型。
 * 订阅边界：前端 SubscriptionSet 只持有监听器；通知时机、状态、轮询及销毁仍由本控制器决定。
 */
import {SubscriptionSet} from '../foundations/utility';
import {requestBudgetReportSchema,type RequestBudgetReport} from '../../bridge/contracts/scope-budget';
export type RequestBudgetQuery={workspaceId:string;rootSessionId:string;scopeId:string};
export interface RequestBudgetState {busy:boolean;error:string;report?:RequestBudgetReport}
/** 一个实例只绑定一个目标；dispose 使未完成读取失效，不取消或修改后端事实。 */
export class RequestBudgetController {
  private state:RequestBudgetState={busy:false,error:''};private generation=0;private listeners=new SubscriptionSet();
  constructor(private readonly query:RequestBudgetQuery,private readonly revision:number,private readonly call:(query:RequestBudgetQuery)=>Promise<unknown>){}
  snapshot=()=>this.state;
  subscribe=(listener:()=>void)=>{return this.listeners.subscribe(listener)};
  private publish(value:RequestBudgetState){this.state=value;this.listeners.notify()}
  dispose(){this.generation++;this.listeners.clear();this.state={...this.state,busy:false}}
  async load(){if(this.state.busy)return;const generation=++this.generation;this.publish({...this.state,busy:true,error:''});
    try{const report=requestBudgetReportSchema.parse(await this.call({...this.query}));if(report.workspaceId!==this.query.workspaceId||report.rootSessionId!==this.query.rootSessionId||report.scopeId!==this.query.scopeId||report.policyRevision!==this.revision)throw Error('请求账本返回了其它目标或策略的记录');if(generation===this.generation)this.publish({busy:false,error:'',report})}
    catch(error){if(generation===this.generation)this.publish({...this.state,busy:false,error:(error instanceof Error?error.message:String(error))+'；未将读取失败计为零消耗。'})}
  }
}
