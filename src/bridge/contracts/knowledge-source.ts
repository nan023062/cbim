/**
 * 作用定位：向桌面公开知识来源身份、采纳预览和当前核实状态的纯数据协议。
 * 设计原因：视图只展示后端已经核实的事实；来源事务、原知识正文和写前屏障不能通过 Bridge 被客户端构造。
 */
export {knowledgeSourceRefSchema,capabilitySourceRefSchema,knowledgeSourceReadStateSchema,sourceSelectionSchema,sourceReadStateMatches} from '../../backend/core/workspace/knowledge-source';
export type {KnowledgeSourceRef,CapabilitySourceRef,KnowledgeSourceReadState,SourceSelection} from '../../backend/core/workspace/knowledge-source';
