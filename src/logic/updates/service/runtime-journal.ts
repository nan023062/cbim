/**
 * 作用定位：冷壳拥有的资源激活日志；区分准备缓存、用户授权、原数据访问和已确认启动。
 * 设计原因：不覆盖活动指针；新代日志独立写入、flush、改名并回读。损坏或已访问数据的未确认启动必须恢复，不能盲目降级。
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';

const digest=z.string().regex(/^[a-f0-9]{64}$/);
const stateSchema=z.object({sequence:z.number().int().nonnegative(),confirmed:digest,previous:digest.optional(),highestResource:z.number().int().positive(),
  pending:z.object({digest,resourceVersion:z.number().int().positive(),stage:z.enum(['authorized','data-access']),dataAccessed:z.boolean(),transaction:z.string().uuid()}).strict().optional(),
  quarantined:z.array(digest).max(100)}).strict();
export type RuntimeState=z.infer<typeof stateSchema>;

/** 只在同一安装身份的单实例进程中使用；同步小记录也可在 Electron profile 初始化前执行。 */
export class RuntimeJournal {
  constructor(private readonly directory:string,private readonly initial:{digest:string;resourceVersion:number}){}
  read():RuntimeState{
    const initialized=fs.existsSync(this.directory+'.initialized');
    if(!fs.existsSync(this.directory)){if(initialized)throw Error('更新状态丢失，禁止自动回到初始资源');return {sequence:0,confirmed:this.initial.digest,highestResource:this.initial.resourceVersion,quarantined:[]};}
    if(fs.lstatSync(this.directory).isSymbolicLink())throw Error('更新状态目录不能是链接');
    const names=fs.readdirSync(this.directory).filter(name=>/^\d{12}\.json$/.test(name)).sort();
    if(!names.length){if(initialized)throw Error('更新状态丢失，禁止自动回到初始资源');return {sequence:0,confirmed:this.initial.digest,highestResource:this.initial.resourceVersion,quarantined:[]};}
    const name=names[names.length-1],file=path.join(this.directory,name),stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024)throw Error('更新状态记录无效');
    const record=JSON.parse(fs.readFileSync(file,'utf8'));
    if(typeof record.payload!=='string'||createHash('sha256').update(record.payload).digest('hex')!==record.sha256)throw Error('更新状态记录损坏');
    const state=stateSchema.parse(JSON.parse(record.payload));
    if(String(state.sequence).padStart(12,'0')+'.json'!==name)throw Error('更新状态代次不符');return state;
  }
  private write(state:RuntimeState){
    stateSchema.parse(state);fs.mkdirSync(this.directory,{recursive:true});
    if(fs.lstatSync(this.directory).isSymbolicLink())throw Error('更新状态目录不能是链接');
    // 目录外的见证不随日志清理丢失；状态被删或首次落盘中断时宁可恢复，不猜测旧 R 可读现有数据。
    if(!fs.existsSync(this.directory+'.initialized')){const marker=fs.openSync(this.directory+'.initialized','wx',0o600);try{fs.writeFileSync(marker,'1');fs.fsyncSync(marker)}finally{fs.closeSync(marker)}}
    const payload=JSON.stringify(state),text=JSON.stringify({payload,sha256:createHash('sha256').update(payload).digest('hex')});
    const target=path.join(this.directory,String(state.sequence).padStart(12,'0')+'.json'),temporary=target+'.'+randomUUID()+'.tmp';
    const fd=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(fd,text);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
    fs.renameSync(temporary,target);
    // Windows 的 FlushFileBuffers 需要写权限；只读句柄 fsync 会返回 EPERM。
    const check=fs.openSync(target,'r+');try{fs.fsyncSync(check)}finally{fs.closeSync(check)}
    if(fs.readFileSync(target,'utf8')!==text)throw Error('更新状态未能确认落盘');
    return state;
  }
  /** 只允许显式点击后的激活；缓存发现或普通退出不调用此入口。 */
  authorize(candidate:{digest:string;resourceVersion:number}){
    const state=this.read();if(state.pending)throw Error('仍有未完成的更新事务');
    if(candidate.resourceVersion<=state.highestResource||state.quarantined.includes(candidate.digest))throw Error('不能自动重放或降级资源版本');
    return this.write({...state,sequence:state.sequence+1,highestResource:candidate.resourceVersion,pending:{...candidate,stage:'authorized',dataAccessed:false,transaction:randomUUID()}});
  }
  /** 在导入候选代码和打开原用户数据前同步持久化；失败不得继续装载。 */
  accessData(expected:string){
    const state=this.read();if(!state.pending||state.pending.digest!==expected||state.pending.stage!=='authorized')throw Error('更新激活票据无效');
    return this.write({...state,sequence:state.sequence+1,pending:{...state.pending,stage:'data-access',dataAccessed:true}});
  }
  /** 业务入口与窗口真实就绪后确认同一候选；单纯进程存活不构成确认。 */
  confirm(expected:string){
    const state=this.read();if(!state.pending){if(state.confirmed!==expected)throw Error('启动版本不符');return state;}
    if(state.pending.digest!==expected||state.pending.stage!=='data-access')throw Error('启动回执与激活事务不符');
    return this.write({...state,sequence:state.sequence+1,previous:state.confirmed,confirmed:expected,pending:undefined});
  }
  /** 仅加载前验证失败可自动退回；一旦放行数据，保留事务供冷壳恢复界面处理。 */
  rejectBeforeData(expected:string){
    const state=this.read();if(state.pending?.digest!==expected||state.pending.stage!=='authorized'||state.pending.dataAccessed)throw Error('已访问数据，禁止自动回退');
    return this.write({...state,sequence:state.sequence+1,pending:undefined,quarantined:[...state.quarantined,expected].slice(-100)});
  }
  /** 恢复界面的明确重试只重试同一候选，不倒退数据格式或自动再次执行任务。 */
  retryPending(){const state=this.read();if(!state.pending)throw Error('没有待恢复更新');return this.write({...state,sequence:state.sequence+1,pending:{...state.pending,stage:'authorized'}})}
}
