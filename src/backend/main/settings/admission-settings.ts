/**
 * 目录归属：backend/main/settings；预算、并发与搜索设置。
 * 作用定位：持久化应用级并发上限，并在工作区装配前恢复准入策略。
 * 设计原因：只有可靠保存的设置才影响新运行；串行版本校验防止多个窗口相互覆盖，降低上限不结束已经获准的运行。
 */
import fs from 'node:fs/promises';
import {SerialQueue} from '../../../core/utility';
import {z} from 'zod';
import {atomic} from '../../../core/platform/node/files';
import {fail} from '../../../core/errors';
import {admissionPolicySchema,type AdmissionPolicy} from '../../../logic/runtime/rules/admission';
import type {GlobalRunAdmission} from '../../scheduler-engine/admission/run-admission';

const storedPolicy=z.object({version:z.literal(1),policy:admissionPolicySchema}).strict();
/** 文件适配可在测试注入失败；产品固定使用原子提交，不向 IPC 暴露路径或写入函数。 */
export interface AdmissionSettingsStorage {
  read(filename:string):Promise<string>;
  write(filename:string,value:string):Promise<void>;
}
const disk:AdmissionSettingsStorage={read:filename=>fs.readFile(filename,'utf8'),write:atomic};
/** 应用唯一实例；只在 init 成功后向桌面提供配置入口。 */
export class AdmissionSettings {
  /** 初始加载与保存共用实例队列；可靠写盘后才由本类发布并发策略。 */
  private readonly queue=new SerialQueue();
  private initialized=false;
  constructor(private filename:string,private admission:GlobalRunAdmission,private storage:AdmissionSettingsStorage=disk){}
  private serial<T>(work:()=>Promise<T>):Promise<T>{return this.queue.run(work)}
  /** 在任何工作区开启前读取；缺文件沿用默认 4，损坏配置明确失败，不擅自覆盖用户设置。 */
  init():Promise<void>{return this.serial(async()=>{
    if(this.initialized)return;
    let policy:AdmissionPolicy;
    try{policy=storedPolicy.parse(JSON.parse(await this.storage.read(this.filename))).policy}
    catch(error){if((error as {code?:string})?.code!=='ENOENT')fail('ADMISSION_SETTINGS_INVALID','运行配额设置无法读取，请核实设置文件后重新启动');policy=this.admission.snapshot().policy}
    this.admission.restorePolicy(policy);this.initialized=true;
  })}
  /** 仅读取当前已生效策略，不扫描运行日志，不触发任务或恢复。 */
  read():AdmissionPolicy{if(!this.initialized)fail('ADMISSION_NOT_READY','运行配额设置尚未就绪');return {...this.admission.snapshot().policy}}
  /** revision 是用户查看时的策略版本；写盘失败保留旧值，成功后唤醒等待者重新检查资格。 */
  configure(raw:unknown):Promise<AdmissionPolicy>{return this.serial(async()=>{
    const parsed=admissionPolicySchema.safeParse(raw);if(!parsed.success)fail('ADMISSION_SETTINGS_INPUT','并发上限必须为 1～32 的整数，并携带当前设置版本');
    const current=this.read();if(parsed.data.revision!==current.revision)fail('ADMISSION_SETTINGS_CONFLICT','运行配额设置已在其他窗口更新，请刷新后再保存');
    if(parsed.data.maxConcurrentRuns===current.maxConcurrentRuns)return current;
    if(current.revision>=Number.MAX_SAFE_INTEGER)fail('ADMISSION_SETTINGS_LIMIT','运行配额设置版本已达到上限');
    const next={revision:current.revision+1,maxConcurrentRuns:parsed.data.maxConcurrentRuns};
    try{await this.storage.write(this.filename,JSON.stringify({version:1,policy:next},null,2))}
    catch{fail('ADMISSION_SETTINGS_WRITE','运行配额设置保存失败，原上限仍然有效，请检查目录权限后重试')}
    // 产品只有本服务修改策略，所有保存共用串行入口；无 await 的应用阶段紧接可靠写盘。
    this.admission.configure(parsed.data);return this.read();
  })}
}
