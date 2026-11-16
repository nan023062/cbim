/**
 * 资源边界：工作区只暴露宿主注入的 assetsRoot，供内置资料读取，不暴露开发设计根。
 * 作用定位：核心知识领域需要的工作区存取与事务接口。
 * 边界说明：此完整端口用于知识写入协调；只读查询使用 types 中的 KnowledgeSnapshotReader，刷新使用自身四项最小端口。
 * 设计原因：核心只依赖能力契约，由 main 注入实际工作区；不导入 Electron 或服务生命周期实现。
 */
import type { StoragePaths as Paths } from '../../workspace/ports/paths';

import type { ChangeRequest, Preview, Snapshot, TaskView, KnowledgeCommit } from './types';

export type { KnowledgeCommit } from './types';

/** 可信知识串行域；调用方须在其内再取得模型与派发锁，不得从派发事务反向进入。 */
export interface SourceSnapshotReader
{
  WithSourceSnapshot<T>(use: (snapshot: Snapshot) => Promise<T>): Promise<T>
}

/** 实现方负责实例状态、路径边界、并发控制、版本检查、事务恢复和物理写入。 */
export interface KnowledgeWorkspace
{
  /** 对象预览缓存和空目录清理，由工作区平台存储实现。 */
  readonly objects: import('./object-storage').ObjectStorage;

  readonly entry:
  {
    id: string;

    path: string
  };

  readonly instanceId: string;

  readonly paths: Paths;

  /** 当前运行资产的可信绝对根路径，不是用户工作区路径。 */
  readonly rules:
  {
    assetsRoot: string
  };

  readonly tasks: Map<string, TaskView>;

  state: string;

  Assert(identity?: { workspaceId: string; instanceId: string }): void;

  Read(): Promise<Snapshot>;

  Snapshot(): Promise<Snapshot>;

  Preview(request: ChangeRequest): Promise<Preview>;

  Commit(request: ChangeRequest): Promise<KnowledgeCommit>;

  /** 只读核原完整请求的成功 journal；缓存回执不能替代权威成功证明。 */
  CommittedReceipt(request: ChangeRequest): Promise<KnowledgeCommit | undefined>;

  /** 内部计划提交只接固定类型与标识；实现重新读取完整私有计划，不能接调用者自报替换意图。 */
  CommitPlanned(reference: import('./planned-commit').KnowledgePlanRef): Promise<KnowledgeCommit>;

  PlanMove(snapshot: Snapshot, from: string, to: string | null): Promise<ChangeRequest>;

  StartTask(name: 'validate' | 'reindex'): TaskView;

  /** 仅接受本实例的维护任务 ID；未运行或未知任务须抛错，返回当前真实状态而非承诺已停止。终态重复请求保持原结果。 */
  CancelTask(id: string): TaskView;
}
