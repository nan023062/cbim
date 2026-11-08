/**
 * 完整出口的三字段身份与原成功采集证明是可选新字段；旧观察/基线不补造完整验收资格。
 * 作用定位：声明范围完整清单、可信采集事件和独立复核的公开序列化契约。
 * 设计原因：目录条目和缺失根与文件指纹共同形成集合身份，新增文件或空目录不能在旧文件哈希相同的情况下被遗漏。
 * 职责边界：不保存文件正文，不声称操作因果、原子快照、业务验收或恢复资格；旧选定文件基线保持独立。
 */
import {z} from 'zod';
import {artifactScopeBindingsSchema,artifactScopeLimits,artifactScopePathSchema} from '../workspace/artifact-scope';
import {artifactBaselineStagedSchema,artifactReportInputSchema} from './artifact-baseline';

const id=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),digest=z.string().regex(/^[a-f0-9]{64}$/),seq=z.number().int().nonnegative().safe();
const callId=z.string().min(1).max(128).refine(value=>value.trim()===value&&!/[\x00-\x1f]/.test(value));
export const outputManifestToolName='cbim_task_manifest_capture';
export const outputManifestInspectToolName='cbim_task_manifest_inspect';
export const outputManifestInputSchema=z.object({expectedTaskProgressVersion:seq.min(1)}).strict();
export type OutputManifestInput=z.infer<typeof outputManifestInputSchema>;
export const outputManifestEntrySchema=z.discriminatedUnion('kind',[
  z.object({relativePath:artifactScopePathSchema,kind:z.literal('directory')}).strict(),
  z.object({relativePath:artifactScopePathSchema,kind:z.literal('file'),byteLength:seq.max(artifactScopeLimits.fileBytes),sha256:digest}).strict(),
]);
export type OutputManifestEntry=z.infer<typeof outputManifestEntrySchema>;
const root=z.object({relativePath:artifactScopePathSchema,state:z.enum(['file','directory','missing'])}).strict();
/** roots 对全部声明逐项观察；entries 包含存在的根自身及全部后代，不能用分页或截断数组充当完整集合。 */
export const outputManifestSnapshotSchema=z.object({scopes:artifactScopeBindingsSchema,roots:z.array(root).min(1).max(artifactScopeLimits.roots),entries:z.array(outputManifestEntrySchema).max(artifactScopeLimits.entries)}).strict().superRefine((value,context)=>{
  const issue=(message:string)=>context.addIssue({code:'custom',message}),declared=value.scopes.flatMap(item=>item.scope.roots);
  const paths=value.entries.map(entry=>entry.relativePath),roots=value.roots.map(item=>item.relativePath);
  if(new Set(paths.map(path=>path.toLowerCase())).size!==paths.length||paths.some((path,index)=>index>0&&paths[index-1]>=path)||new Set(roots).size!==roots.length)issue('清单条目须唯一并按路径完整排序');
  if(value.roots.length!==declared.length||declared.some(item=>!value.roots.some(root=>root.relativePath===item.path)))issue('根观察未完整对应全部冻结声明');
  for(const observed of value.roots){
    const expected=declared.find(item=>item.path===observed.relativePath),entry=value.entries.find(item=>item.relativePath===observed.relativePath);
    if(!expected||(observed.state==='missing'?!!entry:!entry||entry.kind!==observed.state||expected.kind!==observed.state))issue('根类型与真实条目或冻结声明不符');
    if(observed.state==='missing'&&value.entries.some(item=>item.relativePath.startsWith(observed.relativePath+'/')))issue('缺失根不能包含后代');
  }
  for(const entry of value.entries){
    const owners=declared.filter(root=>entry.relativePath===root.path||root.kind==='directory'&&entry.relativePath.startsWith(root.path+'/'));
    if(owners.length!==1){issue('清单含范围外或重复归属条目');continue}
    if(entry.relativePath!==owners[0].path){const parent=entry.relativePath.slice(0,entry.relativePath.lastIndexOf('/'));if(!value.entries.some(value=>value.relativePath===parent&&value.kind==='directory'))issue('清单缺少条目的父目录')}
  }
  if(value.entries.reduce((sum,entry)=>sum+(entry.kind==='file'?entry.byteLength:0),0)>artifactScopeLimits.totalBytes)issue('清单总文件字节超过32 MiB');
});
export type OutputManifestSnapshot=z.infer<typeof outputManifestSnapshotSchema>;
/** 唯一采集引用只公开范围、数量与摘要；完整条目留在原 canonical，显式报告才读取。 */
export const outputManifestRefSchema=z.object({manifestId:id,captureToolCallId:callId,scopeHash:digest,manifestHash:digest,knowledgeRevision:z.string().min(1).max(512),progressVersion:seq.min(1),capturedAt:z.string().datetime(),lastEffectSeq:seq,entryCount:seq.max(artifactScopeLimits.entries),fileCount:seq.max(artifactScopeLimits.entries),byteLength:seq.max(artifactScopeLimits.totalBytes),scopes:artifactScopeBindingsSchema}).strict();
export type OutputManifestRef=z.infer<typeof outputManifestRefSchema>;
/** 验证与接受使用同一集合身份；不能只匹配文件摘要而忽略目录集合或冻结范围。 */
export const outputManifestIdentitySchema=outputManifestRefSchema.pick({manifestId:true,scopeHash:true,manifestHash:true});
export type OutputManifestIdentity=z.infer<typeof outputManifestIdentitySchema>;
/** 交付固定原成功采集的引用和日志顺序；不复制正文或全部条目到每一份人工意见。 */
export const outputManifestProofSchema=outputManifestRefSchema.extend({capturedSeq:seq.min(1),finishedSeq:seq.min(1)}).strict().refine(value=>value.capturedSeq<value.finishedSeq);
export type OutputManifestProof=z.infer<typeof outputManifestProofSchema>;
export const outputManifestInspectSchema=z.object({binding:artifactBaselineStagedSchema.innerType().shape.binding,scopes:artifactScopeBindingsSchema,manifests:z.array(outputManifestRefSchema.extend({invalidated:z.boolean()}).strict()).max(artifactScopeLimits.captures),issues:z.array(z.object({code:z.string().min(1).max(128),message:z.string().min(1).max(512)}).strict()).max(32)}).strict();
export const outputManifestStagedSchema=outputManifestRefSchema.extend({version:z.literal(1),binding:artifactBaselineStagedSchema.innerType().shape.binding,snapshot:outputManifestSnapshotSchema}).strict();
export type OutputManifestStaged=z.infer<typeof outputManifestStagedSchema>;
export const outputManifestResultSchema=z.object({state:z.literal('captured'),binding:artifactBaselineStagedSchema.innerType().shape.binding,manifest:outputManifestRefSchema}).strict();
export const outputManifestRecordSchema=z.object({manifest:outputManifestStagedSchema,capturedSeq:seq.min(1),finishedSeq:seq.min(1)}).strict();
export type OutputManifestRecord=z.infer<typeof outputManifestRecordSchema>;
/** 只有当前运行可信采集实例提供；选择不读文件，verifyCurrent 完整复核后才允许保存交付。 */
export interface ProgressManifestPort {select(manifestId:string,progressVersion:number):OutputManifestRecord;verifyCurrent(record:OutputManifestRecord):Promise<void>}
export const outputManifestQuerySchema=artifactReportInputSchema.omit({baselineId:true}).extend({manifestId:id.optional()}).strict();
export type OutputManifestQuery=z.infer<typeof outputManifestQuerySchema>;
export const outputManifestCheckSchema=z.object({state:z.enum(['matches','changed','unverifiable']),expectedHash:digest,observed:outputManifestSnapshotSchema.optional(),observedHash:digest.optional(),reason:z.string().min(1).max(512).optional()}).strict();
export type OutputManifestCheck=z.infer<typeof outputManifestCheckSchema>;
export const outputManifestReportSchema=z.object({identity:outputManifestQuerySchema.omit({manifestId:true}),checkedAt:z.string().datetime(),basis:digest,consistency:z.enum(['stable','changed_during_read']),log:z.enum(['verified','unavailable']),coverage:z.literal('declared_scope_complete'),scopes:artifactScopeBindingsSchema.optional(),manifests:z.array(outputManifestRefSchema.extend({invalidated:z.boolean()}).strict()).max(artifactScopeLimits.captures),verification:outputManifestCheckSchema.extend({manifestId:id,expected:outputManifestSnapshotSchema.optional()}).strict().optional(),issues:z.array(z.object({code:z.string().min(1).max(128),message:z.string().min(1).max(512)}).strict()).max(32)}).strict();
export type OutputManifestReport=z.infer<typeof outputManifestReportSchema>;
