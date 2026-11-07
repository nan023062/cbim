/**
 * 作用定位：Main 与专用文件 utility 子进程之间的严格私有消息及不透明会话端口。
 * 设计原因：每个子进程只持有一个文件操作；正文和句柄不进入公开 DTO，消息顺序不允许重复 apply。
 */
import {z} from 'zod';

export const controlledPlatformBytes=1024*1024;
const token=z.string().regex(/^[a-f0-9]{64}$/),seq=z.number().int().positive();
const fact=z.object({byteLength:z.number().int().min(0).max(controlledPlatformBytes),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const identity=z.object({kind:z.literal('windows_file'),volumeId:z.string().min(1).max(128),fileId:z.string().min(1).max(128),links:z.literal(1)}).strict();
export const controlledChildRequestSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('open'),token,seq,root:z.string().min(1).max(32768),relativePath:z.string().min(1).max(2048),protectedRoots:z.array(z.string().max(32768)).max(32),koffiPath:z.string().min(1).max(32768)}).strict(),
  z.object({kind:z.literal('recheck'),token,seq}).strict(),
  z.object({kind:z.literal('apply'),token,seq,bytes:z.string().max(Math.ceil(controlledPlatformBytes/3)*4),expected:fact}).strict(),
  z.object({kind:z.literal('close'),token,seq}).strict(),
]);
export type ControlledChildRequest=z.infer<typeof controlledChildRequestSchema>;
export const controlledChildReplySchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('opened'),token,seq,identity,fact,bytes:z.string().max(Math.ceil(controlledPlatformBytes/3)*4)}).strict(),
  z.object({kind:z.literal('checked'),token,seq,identity,fact}).strict(),
  z.object({kind:z.literal('applied'),token,seq,identity,fact}).strict(),
  z.object({kind:z.literal('closed'),token,seq}).strict(),
  z.object({kind:z.literal('error'),token,seq,code:z.string().regex(/^[A-Z0-9_]{1,80}$/),writeIssued:z.boolean()}).strict(),
]);
export type ControlledFileIdentity=z.infer<typeof identity>;
export type ControlledContentFact=z.infer<typeof fact>;
export type ControlledChildReply=z.infer<typeof controlledChildReplySchema>;
/** 会话由平台持有；replace 只供已可靠保存 executing 的可信服务调用一次。 */
export interface ExclusiveControlledFile {
  readBefore():Promise<{identity:ControlledFileIdentity;fact:ControlledContentFact;bytes:Uint8Array}>;
  recheckIdentity():Promise<{identity:ControlledFileIdentity;fact:ControlledContentFact}>;
  replaceAndFlush(bytes:Uint8Array):Promise<{identity:ControlledFileIdentity;fact:ControlledContentFact}>;
  /** 已向子进程发出 apply 后即为 true；丢回包也不能宣称零写。 */
  readonly writeIssued:boolean;
}
/** 平台能力只由桌面 app.ready 后注入；无端口不得退回主进程同步写。 */
export interface ControlledFileTransport {
  withExclusiveExisting<T>(root:string,relativePath:string,protectedRoots:readonly string[],signal:AbortSignal,use:(file:ExclusiveControlledFile)=>Promise<T>):Promise<T>;
  /** 工作区关闭只排空该根的子进程；不退役其它工作区的传输。 */
  drain(root:string):Promise<void>;
  close():Promise<void>;
}
