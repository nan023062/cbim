/**
 * 作用定位：原治理观察、提案及责任变更的有界保存摘要，供影响报告与桌面共同读取。
 * 设计原因：原工具结果与私有记录保存是不同事实；纯叶子契约不导入后端指纹算法，旧报告不补字段。
 * 职责边界：不含正文、路径、权限或当前关系，只说明原记录；recorded 不表示批准、实施、交接或业务验收。
 */
import {z} from 'zod';

const id=z.string().min(1).max(512),uuid=z.string().uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/),positive=z.number().int().positive().safe();
export const persistentWriteEffects={cbim_governance_observe:'maintenance',cbim_governance_propose:'preview',cbim_module_owner_change_commit:'knowledge-write'} as const;
export type PersistentWriteName=keyof typeof persistentWriteEffects;
export const persistentWriteIdentitySchema=z.object({workspaceId:id,rootSessionId:id,runId:id,toolCallId:id,toolName:z.enum(['cbim_governance_observe','cbim_governance_propose','cbim_module_owner_change_commit']),commandId:uuid}).strict();
const record=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('observation'),recordId:uuid,instanceId:uuid,recordedAt:z.string().datetime()}).strict(),
  z.object({kind:z.literal('proposal'),recordId:uuid,instanceId:uuid,recordedAt:z.string().datetime()}).strict(),
  z.object({kind:z.literal('ownership'),recordId:uuid,instanceId:uuid,recordedAt:z.string().datetime(),action:z.enum(['assign','replace','unassign','adopt_source']),revision:positive}).strict(),
]);
/** sourceHash 绑定原已解析参数和真实来源；只有原记录完整校验通过才携带回执摘要。 */
export const persistentWriteObservationSchema=z.object({identity:persistentWriteIdentitySchema,sourceHash:hash,state:z.enum(['recorded','absent','unverifiable']),requestHash:hash.optional(),evidenceHash:hash.optional(),record:record.optional(),reason:z.enum(['original_record_unverifiable','query_unavailable']).optional()}).strict().superRefine((v,c)=>{
  const issue=(message:string)=>c.addIssue({code:'custom',message});
  if(v.state==='recorded'?!v.record||!v.requestHash||!v.evidenceHash||!!v.reason:!!v.record||!!v.evidenceHash||!!v.requestHash)issue('只有核实的原保存记录可提供原请求和回执证明');
  if(v.state==='unverifiable'?!v.reason:!!v.reason)issue('不可核实须保留有界原因');
  if(v.record){const kind=v.identity.toolName==='cbim_governance_observe'?'observation':v.identity.toolName==='cbim_governance_propose'?'proposal':'ownership';if(v.record.kind!==kind||kind!=='ownership'&&v.record.recordId!==v.identity.commandId)issue('原记录类型或身份与工具不一致')}
});
export type PersistentWriteObservation=z.infer<typeof persistentWriteObservationSchema>;
