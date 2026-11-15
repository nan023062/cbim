/**
 * 作用定位：V2 额外模型角色的公开引用与冻结快照，供 Agent、岗位和任务共同携带。
 * 设计原因：primary 保持原 profileId/modelId 与运行 profile 的唯一位置；新增角色放在版本化块中，旧记录不补块、不重复保存主模型。
 * 职责边界：只描述明确角色及公开配置，不持有凭据，不注册引擎或改变运行权限。
 */
import {z} from 'zod';
import {generationSnapshotSchema,embeddingSnapshotSchema,type ModelConnectionRequirement} from '../models';

const roleId=z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/).refine(value=>!['primary','constructor','prototype','__proto__'].includes(value),'额外模型角色不能覆盖 primary 或使用保留名称');
export const modelRoleReferenceSchema=z.object({kind:z.enum(['generation','embedding']),profileId:z.string().uuid(),modelId:z.string().trim().min(1).max(160)}).strict();
/** V2 仅保存额外角色；primary 仍由原顶层字段表达，避免两处配置不一致。 */
export const modelRolesSelectionSchema=z.object({version:z.literal(2),roles:z.record(roleId,modelRoleReferenceSchema).refine(value=>Object.keys(value).length<=8,'额外模型角色最多 8 个')}).strict();
export type ModelRolesSelection=z.infer<typeof modelRolesSelectionSchema>;
export const modelRoleSnapshotSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('generation'),profile:generationSnapshotSchema}).strict(),
  z.object({kind:z.literal('embedding'),profile:embeddingSnapshotSchema}).strict(),
]);
export const modelRolesSnapshotSchema=z.object({version:z.literal(2),roles:z.record(roleId,modelRoleSnapshotSchema).refine(value=>Object.keys(value).length<=8)}).strict();
export type ModelRolesSnapshot=z.infer<typeof modelRolesSnapshotSchema>;
/** 引用和冻结快照必须同角色、同操作、同供应商与型号；历史双方缺省才视为一致。 */
export function modelRolesMatch(selection:ModelRolesSelection|undefined,snapshot:ModelRolesSnapshot|undefined):boolean{
  if(selection===undefined||snapshot===undefined)return selection===undefined&&snapshot===undefined;
  const roles=Object.entries(selection.roles);return roles.length===Object.keys(snapshot.roles).length&&roles.every(([slot,ref])=>{
    const value=snapshot.roles[slot];return !!value&&value.kind===ref.kind&&value.profile.id===ref.profileId&&value.profile.model===ref.modelId;
  });
}
/** 角色能力由官方代码声明；型号白名单缺省允许满足协议/操作约束的自定义型号。 */
export type ModelRoleDescriptor={id:string;label:string;required:boolean;modelIds?:readonly string[]}&({kind:'generation';connection:ModelConnectionRequirement}|{kind:'embedding'});
