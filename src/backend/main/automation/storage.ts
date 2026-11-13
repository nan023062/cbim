/**
 * 目录归属：backend/main/automation；自动化定义与记录保存。
 * 作用定位：在工作区私有用户目录保存自动化定义与有界运行历史。
 * 设计原因：调度状态不属于 .cbim 知识；依赖工作区独占锁和唯一调度器串行写入，原子替换失败时保留原文件，损坏数据不得当成空清单覆盖。
 */
import fs from 'node:fs/promises';
import {atomic} from '../../core/foundation/files';
import {fail} from '../../core/foundation/errors';
import {automationStateSchema,type AutomationState,type AutomationStorage} from '../../core/automation/contracts';

export class FileAutomations implements AutomationStorage {
 constructor(private readonly file:string,private readonly workspaceId:string){}
 async read():Promise<AutomationState>{
  let text:string;
  try{if((await fs.stat(this.file)).size>32*1024*1024)fail('AUTOMATION_SIZE','自动化存储超过大小限制');text=await fs.readFile(this.file,'utf8')}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {version:1,workspaceId:this.workspaceId,jobs:[],runs:[]};throw error}
  const state=automationStateSchema.parse(JSON.parse(text));
  if(state.workspaceId!==this.workspaceId)fail('AUTOMATION_IDENTITY','自动化存储不属于当前工作区');
  return state;
 }
 async write(state:AutomationState){
  const checked=automationStateSchema.parse(state);
  if(checked.workspaceId!==this.workspaceId)fail('AUTOMATION_IDENTITY','自动化存储不属于当前工作区');
  const text=JSON.stringify(checked);if(Buffer.byteLength(text)>32*1024*1024)fail('AUTOMATION_SIZE','自动化存储超过大小限制');
  await atomic(this.file,text);
 }
}
