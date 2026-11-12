/**
 * 目录归属：backend/core/knowledge/read-models；知识快照与领域读模型。
 * 作用定位：固定知识快照的公开读取入口，向查询编排、成员上下文和测试提供 Team、BusinessWorkspace 及正文读取。
 * 设计原因：将公开契约与分散在 team/workspace 的读取实现分开；消费者不再直达私有模型，读取链只能依赖快照数据和纯基础能力。
 * 职责边界：不读取磁盘、不刷新或提交知识、不管理实例生命周期；传入快照的校验、版本及权限由调用方负责。
 */
export {Team} from './team';
export {BusinessWorkspace} from './workspace';
export {context,data,content} from './snapshot';
