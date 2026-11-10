import type {EngineContext} from '../src/backend/core/brain/types';

// 保留既有运行回归和坏回包注入的具体类型；生产引擎只认识通用目录。
// 此转换仅供测试访问真实装配对象，不创建能力、不绕过 beforeTool 或替换实现。
interface TestRuntimeTools {
  /** 绑定本轮日志的任务记录工具；不能签发业务验收。 */
  taskTools?:Pick<import('../src/backend/core/tasks/progress-tools').TaskProgressTools,'list'|'call'>;
  /** 仅正式成员运行具备；求助是待安全结算的记录，必须传递桥提供的真实 toolCallId。 */
  memberHelpTools?:Pick<import('../src/backend/core/tasks/member-help-tools').MemberHelpTools,'list'|'call'>;
  /** 仅注入可信文件端口的成员具备；采集由运行时核对真实工具来源，不接受模型路径。 */
  artifactTools?:Pick<import('../src/backend/core/tasks/artifact-tools').ArtifactTools,'list'|'call'>;
  /** 仅冻结 artifactScope 且有真实枚举端口的成员具备；完整范围由运行时提供，模型不能裁剪。 */
  manifestTools?:Pick<import('../src/backend/core/tasks/output-manifest-tools').OutputManifestTools,'list'|'call'>;
  /** 剩余额度允许的成员运行可合作式停泊一次；额度由可信工厂按完整历史计算，成功暂存后须正常结束。 */
  memberCheckpointTools?:Pick<import('../src/backend/core/tasks/member-checkpoint-tools').MemberCheckpointTools,'list'|'call'>;
  /** 仅实际受控平台端口支持的正式成员装配；引擎不能取得备份、补偿或权限签发能力。 */
  controlledFileTools?:Pick<import('../src/backend/core/brain/run-controlled-file').RunControlledFile,'list'|'call'>;
  /** 原任务冻结范围的实际工具；存在时各引擎关闭全部原生文件与命令注册。 */
  scopedExecutionTools?:Pick<import('../src/backend/core/brain/run-scoped-execution').RunScopedExecution,'list'|'call'>;
  /** 仅冻结了删除/移动要求且已装配真实平台的正式成员拥有，不能继承为任意 shell 权限。 */
  artifactTransitionTools?:import('../src/backend/core/tasks/artifact-transition').ArtifactTransitionToolPort;
  /** 仅有冻结产物验证要求的正式成员装配；路径、Schema 和结论来自可信端口。 */
  validationTools?:Pick<import('../src/backend/core/tasks/validation-tools').ValidationTools,'list'|'call'>;
}
export function runtimeTools(context:EngineContext):TestRuntimeTools{return (context.tools??{}) as unknown as TestRuntimeTools}
