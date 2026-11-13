/**
 * 作用定位：在应用用户目录保存工作区资源仓库只读授权及原命令回执。
 * 设计原因：授权不属于可移植知识，不随链接器定义发布；先持久保存再发布内存状态，同命令异参拒绝，不以重试复活已撤销授权。启动时核对连续命令链与最终授权，孤立记录不能成为权限或“未受理”证明。
 */
import fs from 'node:fs/promises';
import {z} from 'zod';
import {isDeepStrictEqual} from 'node:util';
import {atomic} from '../../../core/platform/node/files';
import {json} from '../../core/foundation/serialization';
import {fail} from '../../core/foundation/errors';
import {repositoryConnectionGrantSchema,repositoryConnectionReceiptSchema,type RepositoryConnectionGrant,type RepositoryConnectionReceipt} from '../../core/connectors/repository-connection';

const commandSchema=z.object({workspaceId:z.string().min(1),commandId:z.string().uuid(),inputHash:z.string().regex(/^[a-f0-9]{64}$/),receipt:repositoryConnectionReceiptSchema}).strict();
const stateSchema=z.object({version:z.literal(1),grants:z.array(repositoryConnectionGrantSchema).max(1024),commands:z.array(commandSchema).max(4096)}).strict();
type State=z.infer<typeof stateSchema>;
const maxBytes=2*1024*1024;
/** 只由外层串行服务变更；读取返回副本，不能通过查询接口修改授权。 */
export class RepositoryConnectionStore {
  private state:State={version:1,grants:[],commands:[]};
  constructor(private filename:string){}
  async init(){let text:string;try{const stat=await fs.lstat(this.filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxBytes)fail('REPOSITORY_CONNECTION_DATA','本机仓库授权文件不安全或超过限制');text=await fs.readFile(this.filename,'utf8')}catch(error:any){if(error.code==='ENOENT')return;throw error}
    try{const state=stateSchema.parse(JSON.parse(text)),grants=new Set<string>(),commands=new Set<string>(),heads=new Map<string,RepositoryConnectionGrant>();
      for(const grant of state.grants){const key=JSON.stringify([grant.workspaceId,grant.connectorId]);if(grants.has(key))throw Error('duplicate');grants.add(key)}
      for(const command of state.commands){const {receipt}=command,grant=receipt.grant,key=JSON.stringify([grant.workspaceId,grant.connectorId]),previous=heads.get(key);
        if(commands.has(command.commandId)||command.workspaceId!==receipt.workspaceId||command.commandId!==receipt.commandId||receipt.workspaceId!==grant.workspaceId||receipt.connectorId!==grant.connectorId||grant.enabled!==(receipt.action==='grant')||grant.revision!==(previous?.revision??0)+1||!previous&&receipt.action!=='grant')throw Error('identity');
        if(receipt.action==='revoke'&&previous&&(previous.repositoryId!==grant.repositoryId||previous.definitionHash!==grant.definitionHash))throw Error('revoke identity');
        commands.add(command.commandId);heads.set(key,grant);
      }
      if(heads.size!==state.grants.length||state.grants.some(grant=>!isDeepStrictEqual(grant,heads.get(JSON.stringify([grant.workspaceId,grant.connectorId])))))throw Error('orphan grant');
      this.state=state;
    }catch{fail('REPOSITORY_CONNECTION_DATA','本机仓库授权记录损坏，原文件已保留；不能猜测授权状态')}
  }
  grants(workspaceId:string){return structuredClone(this.state.grants.filter(grant=>grant.workspaceId===workspaceId))}
  grant(workspaceId:string,connectorId:string){return this.grants(workspaceId).find(grant=>grant.connectorId===connectorId)}
  receipt(workspaceId:string,commandId:string){const command=this.state.commands.find(item=>item.commandId===commandId);return command?.workspaceId===workspaceId?structuredClone(command.receipt):undefined}
  /** 未受理证明检查全局命令占用；不同工作区记录同样不能被当成不存在。 */
  hasCommand(commandId:string){return this.state.commands.some(item=>item.commandId===commandId)}
  replay(workspaceId:string,commandId:string,inputHash:string){const command=this.state.commands.find(item=>item.commandId===commandId);if(!command)return undefined;if(command.workspaceId!==workspaceId||command.inputHash!==inputHash)fail('REPOSITORY_CONNECTION_CONFLICT','原命令已绑定其他请求，请查询原回执，不要更换命令重放');return structuredClone(command.receipt)}
  /** 成功回执与授权同一次原子文件替换；失败不发布新内存状态，不删除旧历史腾空间。 */
  async save(grant:RepositoryConnectionGrant,receipt:RepositoryConnectionReceipt,inputHash:string){
    const next=stateSchema.parse({version:1,grants:[...this.state.grants.filter(item=>item.workspaceId!==grant.workspaceId||item.connectorId!==grant.connectorId),grant],commands:[...this.state.commands,{workspaceId:grant.workspaceId,commandId:receipt.commandId,inputHash,receipt}]});
    const encoded=json(next);if(Buffer.byteLength(encoded)>maxBytes)fail('REPOSITORY_CONNECTION_LIMIT','本机仓库授权历史已达到容量上限，未保存新授权');
    await atomic(this.filename,encoded);this.state=next;
  }
}
