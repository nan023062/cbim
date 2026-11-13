/**
 * 作用定位：向只读执行视图公开知识预览和提交的严格返回协议。
 * 设计原因：界面必须核对原调用的完整回执后才显示知识写入完成；复用协议不引入文件事务或把结构校验当作业务验收。
 */
export {knowledgePreviewOutputSchema,objectPreviewOutputSchema,knowledgeCommitOutputSchema,objectCommitOutputSchema} from '../../logic/knowledge/rules/tool-output-transactions';
export type {KnowledgeCommitOutput,KnowledgePreviewOutput} from '../../logic/knowledge/rules/tool-output-transactions';
