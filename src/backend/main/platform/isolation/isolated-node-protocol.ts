/**
 * 目录归属：backend/main/platform/isolation；隔离进程与残留资源平台。
 * 作用定位：声明平台隔离执行器的有界输入与返回事实，供可信装配和独立平台验收使用。
 * 设计原因：传入已读取的字节快照而非业务路径，避免原工程 ACL 被扩权；本协议不签发任务权限或业务验证通过。
 */
import {z} from 'zod';

/** 路径相对于本次私有 input/output；拒绝 Windows 别名、ADS、设备和受管目录。 */
export const isolatedRelativePath=z.string().min(1).max(512).refine(value=>!/[\\:<>"|?*\x00-\x1f\x7f]/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!/[. ]$/.test(part)&&!/^\.(cbim|git)$/i.test(part)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)),'必须是明确的相对普通文件路径');
export const isolatedNodeRequestSchema=z.object({
  files:z.array(z.object({path:isolatedRelativePath,base64:z.string().max(12*1024*1024).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)}).strict()).min(1).max(64),
  entry:isolatedRelativePath,
  args:z.array(z.string().max(2048).refine(value=>!value.includes('\0'))).max(16).default([]),
  outputs:z.array(isolatedRelativePath).max(32).default([]),
  /** 毫秒；包含准备后的实际执行与退出收束，启动准备另受 AbortSignal 控制。 */
  timeoutMs:z.number().int().min(100).max(30000),
  /** Job 全体进程可提交内存的 MiB 上限，不是磁盘配额或 V8 虚拟地址空间。 */
  memoryMiB:z.number().int().min(128).max(1024).default(512),
  processLimit:z.number().int().min(1).max(8).default(4),
}).strict().superRefine((value,context)=>{
  const names=value.files.map(file=>file.path.toLowerCase());
  if(new Set(names).size!==names.length||!value.files.some(file=>file.path===value.entry)||!/[.](?:c|m)?js$/.test(value.entry)||new Set(value.outputs.map(p=>p.toLowerCase())).size!==value.outputs.length)context.addIssue({code:'custom',message:'文件、入口或输出存在歧义'});
  if(value.files.reduce((n,file)=>n+file.base64.length/4*3-(file.base64.endsWith('==')?2:file.base64.endsWith('=')?1:0),0)>8*1024*1024)context.addIssue({code:'custom',message:'输入快照超过 8 MiB'});
});
export type IsolatedNodeRequest=z.input<typeof isolatedNodeRequestSchema>;
export interface IsolatedNodeResult {
  /** 平台新运行身份；不是业务 taskId、runId 或重试许可。 */
  executionId:string;pid:number;isolation:'windows-lpac-registry-read-v1';
  status:'exited'|'timed_out'|'cancelled'|'output_limit'|'resource_limit';exitCode:number;
  /** 由宿主持有的管道最多接收 64 KiB；不把程序输出自述作为隔离证明。 */
  stdio:string;
  runtime:{sha256:string;assets:{name:string;sha256:string}[]};
  inputs:{path:string;sha256:string;byteLength:number}[];
  outputs:{path:string;base64:string;sha256:string;byteLength:number}[];
  /** 原 Job 的内核计量；peakMemoryBytes 可能含失败的提交尝试，不解释为RSS或承诺绝不高于设置值。 */
  resources:{totalProcesses:number;limitTerminations:number;peakMemoryBytes:number};
  allProcessesExited:true;cleanup:'complete';
}
