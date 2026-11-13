/**
 * 作用定位：将团队/业务架构表单接到受控知识事务，作为可信桌面的预览与手动提交入口。
 * 设计原因：统一验证工作区实例、读取版本及对象操作；不再要求真人花名册或维护确认，岗位与模块负责人由各自服务管理。
 * 职责边界：这里只维护工作区唯一的静态团队/业务知识，不创建成员实例或改写任何主会话任务图；已派发任务继续持有自己的知识基线并由执行层复核版本。
 */
import {z} from 'zod';
import {ObjectCrud,objectOperation} from '../../../logic/knowledge/rules/object-crud';
import type {KnowledgeWorkspace} from '../../../logic/knowledge/rules/ports';
import type {ArchitecturePreview,ArchitectureCommit} from '../../../bridge/contracts/architecture';

const identifier=z.string().min(1).max(512).regex(/^\S+$/);
const identity={workspaceId:identifier,instanceId:identifier};
const previewInput=z.object({...identity,revision:identifier,operations:z.array(objectOperation).min(1).max(100)}).strict();
const commitInput=z.object({...identity,planId:z.string().uuid()}).strict();

/** 无独立写授权开关；只能由桌面 IPC 调用，执行中的 Agent 仍必须经过原工具逐次权限检查。 */
export class ArchitectureService {
  private readonly objects:ObjectCrud;
  constructor(private readonly workspace:KnowledgeWorkspace){this.objects=new ObjectCrud(workspace)}
  /** 只缓存对象预览；不要求真人登记，所有正式知识到 commit 才写入，未知输入仍严格拒绝。 */
  async preview(raw:unknown):Promise<ArchitecturePreview>{
    const input=previewInput.parse(raw);this.workspace.assert(input);
    const preview=await this.objects.preview(input.revision,input.operations);
    this.workspace.assert(input);
    return {...preview,notice:'仅预览。请核对差异和校验结果，再手动确认提交；校验失败不能提交，不删除业务源码或资源。'};
  }
  /** 按预览时冻结的完整事务提交；旧实例、旧知识版本、失效校验和被篡改计划均由原事务链拒绝。 */
  async commit(raw:unknown):Promise<ArchitectureCommit>{
    const input=commitInput.parse(raw);this.workspace.assert(input);
    return this.objects.commit(input.planId);
  }
}
