/**
 * 作用定位：管理额度及显式逐请求模式草稿、版本化保存，隔离页面卸载后的异步响应；缺省仍是运行间软限额。
 * 设计原因：空白额度不是零预算，未知保存结果不能盲目覆盖；失败保留用户草稿，重新读取才取得最新版本，无自动重试或轮询。
 */
import {scopeBudgetPolicySchema,type ScopeBudgetPolicy} from '../../bridge/contracts/scope-budget';

export interface BudgetSettingsDraft {enabled:boolean;tokens:string;estimatedCostUsd:string;enforcement?:'request'}
export interface BudgetSettingsState extends BudgetSettingsDraft {policy?:ScopeBudgetPolicy;busy:boolean;error:string;notice:string}
/** 空白项代表未配置；禁用时清除额度，不把隐藏值作为新的运行限制。 */
export function budgetSettingsInput(draft:BudgetSettingsDraft,revision:number):ScopeBudgetPolicy {
  const tokens=draft.tokens.trim(),cost=draft.estimatedCostUsd.trim();
  if(draft.enabled&&tokens&&!/^\d+$/.test(tokens))throw Error('Token 额度必须是正整数。');
  if(draft.enabled&&cost&&!/^(?:\d+\.?\d*|\.\d+)$/.test(cost))throw Error('美元额度必须是正数。');
  const parsed=scopeBudgetPolicySchema.safeParse({revision,enabled:draft.enabled,...(draft.enforcement==='request'?{enforcement:'request'}:{}),limits:draft.enabled?{...(tokens?{tokens:Number(tokens)}:{}),...(cost?{estimatedCostUsd:Number(cost)}:{})}:{}});
  if(!parsed.success)throw Error('启用时至少填写一项：正整数 Token 或正数美元额度。');
  return parsed.data;
}
type Call=(action:'budget.settings'|'budget.configure',input?:unknown)=>Promise<unknown>;
const fields=(policy:ScopeBudgetPolicy):BudgetSettingsDraft=>({enabled:policy.enabled,enforcement:policy.enforcement,tokens:policy.limits.tokens===undefined?'':String(policy.limits.tokens),estimatedCostUsd:policy.limits.estimatedCostUsd===undefined?'':String(policy.limits.estimatedCostUsd)});

/** 构造和订阅不读写配置；只有 load/save 会发 IPC。busy 时拒绝重复提交，cancel 仅使迟到响应失效。 */
export class BudgetSettingsController {
  private state:BudgetSettingsState={enabled:false,tokens:'',estimatedCostUsd:'',busy:false,error:'',notice:''};
  private generation=0;
  private readonly listeners=new Set<()=>void>();
  constructor(private readonly call:Call){}
  snapshot=()=>this.state;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener)}};
  private publish(value:Partial<BudgetSettingsState>){this.state={...this.state,...value};for(const listener of this.listeners)listener()}
  edit(value:Partial<BudgetSettingsDraft>){if(!this.state.busy)this.publish({...value,error:'',notice:''})}
  cancel(){this.generation++;this.state={...this.state,busy:false}}
  async load(){
    if(this.state.busy)return;const ticket=++this.generation;this.publish({busy:true,error:'',notice:''});
    try{const policy=scopeBudgetPolicySchema.parse(await this.call('budget.settings'));if(ticket===this.generation)this.publish({policy,...fields(policy)})}
    catch(error){if(ticket===this.generation)this.publish({error:error instanceof Error?error.message:String(error)})}
    finally{if(ticket===this.generation)this.publish({busy:false})}
  }
  async save(){
    if(this.state.busy||!this.state.policy)return;
    let input:ScopeBudgetPolicy;
    try{input=budgetSettingsInput(this.state,this.state.policy.revision)}catch(error){this.publish({error:error instanceof Error?error.message:String(error)});return}
    const ticket=++this.generation;this.publish({busy:true,error:'',notice:''});
    try{const policy=scopeBudgetPolicySchema.parse(await this.call('budget.configure',input));if(ticket===this.generation)this.publish({policy,...fields(policy),notice:'已保存，仅对之后创建的新目标生效。当前目标继续使用原来的额度。'})}
    catch(error){if(ticket===this.generation)this.publish({error:(error instanceof Error?error.message:String(error))+'；草稿已保留。若保存结果未知，请刷新设置核实后再提交。'})}
    finally{if(ticket===this.generation)this.publish({busy:false})}
  }
}
