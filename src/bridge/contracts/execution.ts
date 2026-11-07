/**
 * 作用定位：对话、运行和排队在 IPC 中传递的可序列化类型。
 * 设计原因：界面通过协议消费 Core 数据，不导入文件操作；共享纯范围 Schema 保留真实仓库身份，验证视图只含当时指定字节和无原值诊断。资料读取不能冒充项目文件验证，可续聊头仍由后端核实。
 */
export type {RunSummary,StoredEvent,EngineEvent,ConversationThreadView} from '../../backend/core/brain/types';
export type {TaskSpec} from '../../backend/core/tasks/types';
export type {QueuedMessage,QueueCursor,QueueDelta} from '../../backend/core/tasks/queue';
export type {PendingQuestion,QuestionInput} from '../../backend/core/tools/questions';
export {repositoryToolScopeSchema} from '../../backend/core/tools/scope-schema';
export type {RepositoryToolScope} from '../../backend/core/tools/scope-schema';
/** 已脱敏事件投影；不含冻结 Schema、成员私有配置或业务文件正文，也不是当前有效性证明。 */
export type PublicValidationResult=Pick<import('../../backend/core/tasks/validation').ValidationResult,'validationId'|'toolCallId'|'validator'|'requirement'|'artifact'|'checkedAt'|'outcome'|'issues'>;
