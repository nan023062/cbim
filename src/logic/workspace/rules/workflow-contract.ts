/**
 * 可选executionScope冻结文件/目录边界与固定Node预算，产物/验证须在本模块范围内；全任务混合模式另由执行知识校验拒绝。
 * 作用定位：定义模块 Workflow 正文中可选执行条件的严格协议，供知识治理、资源包与执行准备共同解析。
 * 设计原因：自然语言方法仍由模型运用，只有显式声明的少量稳定条件才交程序检查；坏声明不能静默退回无约束流程。
 * 职责边界：纯解析，JSON/CSV/PNG要求固定产物与受限结构；普通artifactScope只声明观察，删除/移动约定须启用requireCompleteManifest并核原操作。不读取工程或签发权限。
 */
import {codeCheckRequirementSchema} from './code-check';
import {z} from 'zod';
import {fail} from '../../../core/errors';
import {parseJson} from '../../../core/json';
import {boundedJsonSchemaSchema} from './json-validation-schema';
import {csvTableSchema} from './csv-validation-schema';
import {pngImageSchema} from './png-validation-schema';
import {artifactScopeSchema} from './artifact-scope';
import {executionScopeSchema,preparedExecutionScope} from './execution-scope';

/** 限制单份条件的规模；正文其它自然语言仍沿原知识文件大小规则。 */
export const workflowContractLimits={requirements:16,blockBytes:64*1024} as const;
/** 仅匹配已实现原生或受限业务工具；知识写入、调度或记录工具不能作为此类出口。 */
export const workflowToolNameSchema=z.enum(['read','write','edit','grep','find','ls','bash','cbim_scoped_read','cbim_scoped_node','cbim_file_write_controlled']);
export type WorkflowToolName=z.infer<typeof workflowToolNameSchema>;
const requirement=z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),toolName:workflowToolNameSchema}).strict();
const artifactPath=z.string().min(1).max(2048).refine(value=>!/[\\:\x00-\x1f]/.test(value)&&!value.startsWith('/')&&value.split('/').every(part=>!!part&&part!=='.'&&part!=='..'&&part.toLowerCase()!=='.cbim'));
export const jsonValidationRequirementSchema=z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),validator:z.literal('json-schema-v1'),artifactPath,schema:boundedJsonSchemaSchema}).strict();
export type JsonValidationRequirement=z.infer<typeof jsonValidationRequirementSchema>;
/** 验证器与参数共同冻结；同名要求不能把 JSON 证明解释成 CSV 检查，模型不可覆盖路径或规则。 */
export const csvValidationRequirementSchema=z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),validator:z.literal('csv-table-v1'),artifactPath,schema:csvTableSchema}).strict();
/** 图片要求固定精确尺寸和采样通道；真实解码能力由执行平台预检，不在知识解析时加载。 */
export const pngValidationRequirementSchema=z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),validator:z.literal('png-raster-v1'),artifactPath,schema:pngImageSchema}).strict();
export const artifactValidationRequirementSchema=z.discriminatedUnion('validator',[jsonValidationRequirementSchema,csvValidationRequirementSchema,pngValidationRequirementSchema]);
export type ArtifactValidationRequirement=z.infer<typeof artifactValidationRequirementSchema>;
/** 至少一项显式执行条件或产物观察范围；范围本身不构成交付条件，不做隐式默认。 */
export const workflowContractSchema=z.object({
  version:z.literal(1),
  /** 完整枚举的范围随知识冻结；不把观察声明冒充交付条件。 */
  artifactScope:artifactScopeSchema.optional(),
  /** 原任务权限之内的显式限制；旧 Workflow 缺省不升级为隔离模式。 */
  executionScope:executionScopeSchema.optional(),
  beforeEffects:z.object({requirePlan:z.literal(true)}).strict().optional(),
  delivery:z.object({requiredCodeChecks:z.array(codeCheckRequirementSchema).min(1).max(8).optional(),requiredToolEvidence:z.array(requirement).min(1).max(workflowContractLimits.requirements).optional(),requiredValidations:z.array(artifactValidationRequirementSchema).min(1).max(workflowContractLimits.requirements).optional(),requireCompleteManifest:z.literal(true).optional()}).strict().refine(value=>!!value.requiredCodeChecks||!!value.requiredToolEvidence||!!value.requiredValidations||value.requireCompleteManifest===true,'交付至少声明一种非空条件').optional(),
}).strict().superRefine((value,context)=>{
  if(!value.beforeEffects&&!value.delivery&&!value.artifactScope&&!value.executionScope)context.addIssue({code:z.ZodIssueCode.custom,message:'至少声明一项执行条件或产物观察范围'});
  try{preparedExecutionScope([{contract:value}])}catch(error){context.addIssue({code:'custom',message:String(error)})}
  if(value.delivery?.requireCompleteManifest&&!value.artifactScope)context.addIssue({code:z.ZodIssueCode.custom,message:'完整交付要求必须同时声明本模块 artifactScope'});
  if(value.artifactScope?.transitions&&!value.delivery?.requireCompleteManifest)context.addIssue({code:z.ZodIssueCode.custom,message:'删除/移动要求必须显式启用完整清单验收'});
  if(value.delivery?.requiredCodeChecks&&(!value.delivery.requireCompleteManifest||!value.artifactScope||value.executionScope))context.addIssue({code:"custom",message:"代码检查要求完整源码清单且不能使用隔离执行模式"});
  const ids=[...value.delivery?.requiredCodeChecks??[],...value.delivery?.requiredToolEvidence??[],...value.delivery?.requiredValidations??[]].map(item=>item.id);
  if(new Set(ids).size!==ids.length)context.addIssue({code:z.ZodIssueCode.custom,path:['delivery','requiredToolEvidence'],message:'证据要求 ID 不能重复'});
});
export type WorkflowContract=z.infer<typeof workflowContractSchema>;

function invalid(reason:string):never{fail('WORKFLOW_CONTRACT_INVALID','Workflow 执行约定无效：'+reason)}
/**
 * 读取最多一个顶层 cbim-workflow 围栏块；标准反引号/波浪线围栏支持 0–3 空格缩进。
 * 普通代码块内的示例、引用块和缩进代码不是声明。命名后附加语言/属性、未闭合、重复及非严格 JSON 均拒绝。
 * 缺块返回 undefined，保留旧自然语言流程；返回值只描述条件，实际权限与执行证据由可信运行时检查。
 */
export function parseWorkflowContract(markdown:string):WorkflowContract|undefined{
  if(typeof markdown!=='string')invalid('正文必须是文本');
  let fence:{character:string;length:number;declared:boolean}|undefined;
  let declared=false,body:string[]=[],contract:WorkflowContract|undefined;
  for(const line of markdown.replace(/^\uFEFF/,'').split(/\r\n?|\n/)){
    if(fence){
      const closing=line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
      if(closing&&closing[1][0]===fence.character&&closing[1].length>=fence.length){
        if(fence.declared){
          const text=body.join('\n');if(new TextEncoder().encode(text).byteLength>workflowContractLimits.blockBytes)invalid('条件块超过 64 KiB');
          let raw:unknown;try{raw=parseJson(text)}catch{invalid('条件块必须是无重复字段的严格 JSON')}
          const parsed=workflowContractSchema.safeParse(raw);if(!parsed.success)invalid('版本、字段、工具或证据要求不受支持');contract=parsed.data;
        }
        fence=undefined;body=[];
      }else if(fence.declared)body.push(line);
      continue;
    }
    const opening=line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);if(!opening)continue;
    const info=opening[2].trim(),named=info.split(/\s+/)[0].toLowerCase()==='cbim-workflow';
    if(named){if(info!=='cbim-workflow')invalid('条件块标记必须精确为 cbim-workflow');if(declared)invalid('最多允许一个条件块');declared=true}
    // Markdown 反引号围栏的 info 不能再含反引号；无效普通语法不遮蔽后续真实声明。
    if(opening[1][0]==='`'&&info.includes('`')){if(named)invalid('条件块标记格式无效');continue}
    fence={character:opening[1][0],length:opening[1].length,declared:named};body=[];
  }
  if(fence?.declared)invalid('条件块未闭合');
  return contract;
}
