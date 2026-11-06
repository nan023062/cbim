/**
 * 作用定位：将团队/业务架构表单接到受控知识事务，作为可信桌面的预览与手动提交入口。
 * 设计原因：统一验证工作区实例、读取版本及维护声明，把真人花名册与模块一次性校验/提交；不向内部 Agent 工具增加本机用户确认能力。
 * 职责边界：这里只维护工作区唯一的静态团队/业务知识，不创建成员实例或改写任何主会话任务图；已派发任务继续持有自己的知识基线并由执行层复核版本。
 */
import {z} from 'zod';
import {ObjectCrud,objectOperation} from '../../core/knowledge/object-crud';
import type {KnowledgeWorkspace} from '../../core/knowledge/ports';
import {fail} from '../../core/foundation/errors';
import type {ArchitecturePreview,ArchitectureCommit} from '../../../bridge/contracts/architecture';

const identifier=z.string().min(1).max(512).regex(/^\S+$/);
const personId=z.string().min(1).max(512).regex(/^\S+$/);
const identity={workspaceId:identifier,instanceId:identifier};
const previewInput=z.object({...identity,revision:identifier,operations:z.array(objectOperation).min(1).max(100),peopleUpserts:z.array(z.object({id:personId,name:z.string().trim().min(1).max(256),team:identifier}).strict()).max(100).optional(),maintenance:z.object({moduleId:identifier.optional(),maintainerPersonIds:z.tuple([personId]).rest(personId),confirmed:z.literal(true)}).strict().optional()}).strict();
const commitInput=z.object({...identity,planId:z.string().uuid()}).strict();

/** 无独立写授权开关；只能由桌面 IPC 调用，执行中的 Agent 仍必须经过原工具逐次权限检查。 */
export class ArchitectureService {
  private readonly objects:ObjectCrud;
  constructor(private readonly workspace:KnowledgeWorkspace){this.objects=new ObjectCrud(workspace)}
  /** 只缓存完整预览计划；新增/编辑模块须显式选择维护真人，所有正式知识到 commit 才写入。 */
  async preview(raw:unknown):Promise<ArchitecturePreview>{
    const input=previewInput.parse(raw);this.workspace.assert(input);
    const modules=input.operations.filter(op=>op.kind==='module'&&op.action!=='delete');
    if(modules.length>1)fail('MAINTENANCE','桌面一次预览仅能新增或编辑一个模块，请分别确认维护关系');
    if(modules.length&&!input.maintenance)fail('MAINTENANCE_CONFIRMATION','新增或编辑模块需选择真人维护人并明确确认');
    if(input.maintenance&&!modules.length)fail('MAINTENANCE','维护确认必须关联本次新增或编辑的模块');
    if(input.maintenance&&new Set(input.maintenance.maintainerPersonIds).size!==input.maintenance.maintainerPersonIds.length)fail('MAINTENANCE','维护人不能重复');
    const operation=modules[0],moduleId=operation?.action==='create'?`${operation.parentId}/${operation.slug}`:operation?.id;
    if(input.maintenance?.moduleId&&input.maintenance.moduleId!==moduleId)fail('MAINTENANCE','维护确认的模块与对象操作不一致');
    const preview=await this.objects.preview(input.revision,input.operations,{peopleUpserts:input.peopleUpserts,maintenance:input.maintenance?{...input.maintenance,moduleId:moduleId!}:undefined});
    this.workspace.assert(input);
    return {...preview,notice:'仅预览。请核对差异、维护关系和校验结果，再手动确认提交；校验失败不能提交，不删除业务源码或资源。'};
  }
  /** 按预览时冻结的完整事务提交；旧实例、旧知识版本、失效校验和被篡改计划均由原事务链拒绝。 */
  async commit(raw:unknown):Promise<ArchitectureCommit>{
    const input=commitInput.parse(raw);this.workspace.assert(input);
    return this.objects.commit(input.planId);
  }
}
