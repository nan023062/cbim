/**
 * 作用定位：从已结束的原知识调用中提取预览诊断或已提交回执，供工具轨道和工作摘要展示。
 * 设计原因：只接受工具名称匹配的严格完整输出及同一工作区身份；缺失、报错或混杂文本不能被猜成写入成功。保留每项诊断，不改变运行或业务目标状态。
 */
import {knowledgePreviewOutputSchema,objectPreviewOutputSchema,knowledgeCommitOutputSchema,objectCommitOutputSchema} from '../../bridge/contracts/knowledge-transactions';

/** 唯一 JSON 文本块是知识工具的既定协议；旧错误字符串与部分输出只按原始证据显示。 */
export function knowledgeToolView(name:string,result:unknown,workspaceId:string){
  if(!result||typeof result!=='object'||!('content' in result)||!Array.isArray(result.content)||result.content.length!==1||'isError' in result&&result.isError===true)return undefined;
  const block=result.content[0];if(block?.type!=='text'||typeof block.text!=='string')return undefined;
  let value:unknown;try{value=JSON.parse(block.text)}catch{return undefined}
  if(name==='cbim_object_preview'||name==='cbim_knowledge_preview'){
    const parsed=(name==='cbim_object_preview'?objectPreviewOutputSchema:knowledgePreviewOutputSchema).safeParse(value);
    if(parsed.success&&parsed.data.request.workspaceId===workspaceId)return {kind:'preview' as const,validation:parsed.data.validation};
  }
  if(name==='cbim_object_commit'||name==='cbim_knowledge_commit'){
    const parsed=(name==='cbim_object_commit'?objectCommitOutputSchema:knowledgeCommitOutputSchema).safeParse(value);
    if(parsed.success&&parsed.data.workspaceId===workspaceId)return {kind:'committed' as const,receipt:parsed.data};
  }
  return undefined;
}
