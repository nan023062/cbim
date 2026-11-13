/**
 * 完整清单菜单不进入basis，已明确选择的原清单及观察进入basis；读取时间或新菜单不能重写批准对象。
 * 作用定位：将人工决定预览收敛为有界的真实依据，并生成与读取时间、并发序列无关的内容指纹。
 * 算法边界：复用后端 orderJsonValue，保留字符序、原 undefined 规则及历史序列化字节；业务身份与指纹内容仍在本模块。
 * 设计原因：菜单、正文预览和时钟不是批准对象；只对固定目标、候选、选择观察与不可移除限制计算 basis。
 * 职责边界：纯函数不读取日志、不认证 actor；调用方必须先从可信来源重建事实，哈希本身不授予任何权限。
 */
import {orderJsonValue} from '../../../foundations/utility';
import {hash} from '../foundation/serialization';
import {humanDecisionProofSchema,type HumanDecisionProof,type HumanDecisionPreview} from './human-decisions';

function normalized(value:unknown):unknown{return orderJsonValue(value,{compareKeys:(a,b)=>a<b?-1:a>b?1:0,omitUndefinedProperties:true})}
/** 去除候选菜单及显示正文，保留用于决定的固定事实；未就绪预览不能签发可提交证明。 */
export function humanDecisionProof(preview:HumanDecisionPreview):HumanDecisionProof{
  const {workspaceId,rootSessionId,scopeId}=preview.identity;
  return humanDecisionProofSchema.parse({identity:{workspaceId,rootSessionId,scopeId},source:preview.source,candidates:preview.candidates.map(({agentName:_name,summary:_summary,baselines:_choices,manifest:_manifest,...proof})=>proof),limitations:preview.limitations,allowedDecisions:preview.allowedDecisions});
}
/** 数组顺序是已显示内容的一部分，必须由服务稳定构造；仅规范对象键和缺省字段。 */
export function humanDecisionBasis(raw:HumanDecisionProof):string{return hash(JSON.stringify(normalized(humanDecisionProofSchema.parse(raw))))}
