/**
 * 公开无原值的字段校验说明函数，供历史拒绝提示消费；函数不赋予执行/恢复权限。
 * 作用定位：对话、运行和排队在 IPC 中传递的可序列化类型。
 * 设计原因：界面通过协议消费 Core 数据，不导入文件操作；验证视图保留当时字节、可选完整清单身份及无原值诊断，不暴露Schema或正文。资料读取不能冒充项目文件验证，可续聊头仍由后端核实。
 * 插入边界：排队消息插入必须携带点击时的真实主 runId，迟到请求不能改为下一轮执行。
 */
export type {RunSummary,StoredEvent,EngineEvent,ConversationThreadView} from '../../logic/execution/rules/types';
export type {TaskSpec} from '../../logic/tasks/rules/types';
export type {QueuedMessage,QueueCursor,QueueDelta} from '../../logic/tasks/rules/queue';
export type {PendingQuestion,QuestionInput} from '../../logic/tools/rules/questions';
/** 只读字段说明；不据错误文本决定是否执行或是否可重试。 */
export {inputIssueMessage} from '../../logic/tools/rules/input-validation';
/** 只插入已持久排队的消息；expectedRunId 必填，拒绝或未知结果不能自动换轮重发。 */
export interface QueueInsertRequest {id:string;taskId:string;queueId:string;expectedRunId:string}
export {repositoryToolScopeSchema} from '../../logic/tools/rules/scope-schema';
export type {RepositoryToolScope} from '../../logic/tools/rules/scope-schema';
/** 已脱敏事件投影；不含冻结 Schema、成员私有配置或业务文件正文，也不是当前有效性证明。 */
export type PublicValidationResult=Pick<import('../../logic/evidence/rules/validation').ValidationResult,'validationId'|'toolCallId'|'validator'|'requirement'|'artifact'|'manifest'|'checkedAt'|'outcome'|'issues'>;
