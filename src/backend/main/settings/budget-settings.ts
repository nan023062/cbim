/**
 * 目录归属：backend/main/settings；预算、并发与搜索设置。
 * 作用定位：可靠保存新目标的额度及显式逐请求模式，供调度器创建周期时冻结，缺省模式保留原软限额语义。
 * 设计原因：默认关闭且仅接受用户显式设置；版本化原子写盘避免多个窗口覆盖，运行中的周期不随设置改变，失败保留原策略。
 */
import fs from 'node:fs/promises';
import {SerialQueue} from '../../../foundations/utility';
import {z} from 'zod';
import {atomic} from '../../../foundations/files';
import {fail} from '../../core/foundation/errors';
import {scopeBudgetPolicySchema,type ScopeBudgetPolicy} from '../../core/budget/scope-budget';

const stored=z.object({version:z.literal(1),policy:scopeBudgetPolicySchema}).strict();
/** 测试可注入读写故障；路径由主进程装配，桌面请求不能指定文件或替换存储。 */
export interface BudgetSettingsStorage {read(filename:string):Promise<string>;write(filename:string,value:string):Promise<void>}
const disk:BudgetSettingsStorage={read:filename=>fs.readFile(filename,'utf8'),write:atomic};

/** 应用只装配一份；read 返回副本，不允许调用方修改已保存策略或已有目标的冻结副本。 */
export class BudgetSettings {
  private policy?:ScopeBudgetPolicy;
  /** 初始加载与保存共用实例队列；预算规则和 revision 仍由本类判断。 */
  private readonly queue=new SerialQueue();
  constructor(private readonly filename:string,private readonly storage:BudgetSettingsStorage=disk){}
  private serial<T>(work:()=>Promise<T>):Promise<T>{return this.queue.run(work)}
  /** 在工作区装配前恢复；仅缺文件使用关闭默认值，损坏文件不会悄悄禁用用户限额。 */
  init():Promise<void>{return this.serial(async()=>{
    if(this.policy)return;
    try{this.policy=stored.parse(JSON.parse(await this.storage.read(this.filename))).policy}
    catch(error){if((error as {code?:string})?.code!=='ENOENT')fail('BUDGET_SETTINGS_INVALID','目标软限额设置无法读取，请核实设置文件后重新启动');this.policy={revision:1,enabled:false,limits:{}}}
  })}
  /** 只读取已可靠保存的策略；调度器按新周期冻结，不以配置更新复活旧目标。 */
  read():ScopeBudgetPolicy{if(!this.policy)fail('BUDGET_NOT_READY','目标软限额设置尚未就绪');return structuredClone(this.policy)}
  /** revision 是界面读取的版本；相同内容幂等，写失败/冲突不更新内存或已有周期。 */
  configure(raw:unknown):Promise<ScopeBudgetPolicy>{return this.serial(async()=>{
    const parsed=scopeBudgetPolicySchema.safeParse(raw);if(!parsed.success)fail('BUDGET_SETTINGS_INPUT','软限额配置无效：启用时须填写正整数 Token 或正数美元额度');
    const current=this.read(),input=parsed.data;
    if(input.revision!==current.revision)fail('BUDGET_SETTINGS_CONFLICT','目标软限额设置已在其它窗口更新，请刷新后再保存');
    if(input.enabled===current.enabled&&input.enforcement===current.enforcement&&input.limits.tokens===current.limits.tokens&&input.limits.estimatedCostUsd===current.limits.estimatedCostUsd)return current;
    if(current.revision>=Number.MAX_SAFE_INTEGER)fail('BUDGET_SETTINGS_LIMIT','目标软限额设置版本已达到上限');
    const next={...input,revision:current.revision+1};
    try{await this.storage.write(this.filename,JSON.stringify({version:1,policy:next},null,2))}
    catch{fail('BUDGET_SETTINGS_WRITE','目标软限额保存失败，原设置仍有效，请检查目录权限后重试')}
    this.policy=structuredClone(next);return this.read();
  })}
}
