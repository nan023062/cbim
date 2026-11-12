/**
 * 目录归属：backend/core/evidence；产物与 Workflow 证据规则。
 * 作用定位：正式成员的完整清单采集与原记录查询工具；输入没有路径、哈希、模块或运行身份。
 * 设计原因：真实范围在构造时冻结，实际 wire 独立核对一次；坏回包保留已保存事件，不通过重采掩盖原错误。
 * 职责边界：inspect 仅查询本轮原记录，不读取当前文件；采集是观察和记录，不是业务验收或写入许可。
 */
import {z} from 'zod';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {isDeepStrictEqual as equal} from 'node:util';
import {checkedJsonToolResult} from '../tools/results';
import type {ArtifactScopeBinding} from '../workspace/artifact-scope';
import {outputManifestInputSchema,outputManifestInspectSchema,outputManifestResultSchema,outputManifestToolName,outputManifestInspectToolName,type OutputManifestInput,type OutputManifestStaged} from './output-manifest';
import {outputManifestReference,verifyOutputManifests} from './output-manifest-evidence';

const inspectInput=z.object({}).strict();
/** 观察记录属于 maintenance；工具名保留 cbim_task_ 前缀，不能成为业务步骤证据。 */
export function outputManifestTool(name:string,input:unknown){
  if(name!==outputManifestToolName&&name!==outputManifestInspectToolName)return;
  return {args:(name===outputManifestToolName?outputManifestInputSchema:inspectInput).parse(input),effects:['maintenance'] as const,native:false,contractVersion:1};
}
type Binding=OutputManifestStaged['binding'];
export class OutputManifestTools {
  constructor(private readonly binding:Binding,private readonly knowledgeRevision:string,private readonly scopes:ArtifactScopeBinding[],private readonly ports:{capture(input:OutputManifestInput,id:string):Promise<OutputManifestStaged>;inspect():ReturnType<typeof verifyOutputManifests>}){
    this.binding=structuredClone(binding);this.scopes=structuredClone(scopes);
  }
  async list(){return [
    {name:outputManifestToolName,description:'完整采集本轮冻结 artifactScope 中的全部文件、目录与缺失根。仅传当前计划版本，不能选择路径或裁剪集合；需无其它在途工具。返回原清单引用，不是交付或业务验收。',input:outputManifestInputSchema,output:outputManifestResultSchema,recovery:{mode:'inspect_before_retry',queryTool:outputManifestInspectToolName,description:'先查询原本轮记录；保存后坏回包不等于未保存，不自动重新采集。'}},
    {name:outputManifestInspectToolName,description:'只列本轮已完成可信采集的完整清单引用、冻结范围及失效状态，不重新读取文件或自动选择最新清单。',input:inspectInput,output:outputManifestInspectSchema,recovery:{mode:'read_again',description:'可显式重读原记录，查询不重采或验收。'}},
  ].map(value=>({name:value.name,description:value.description,version:1,effects:['maintenance'] as const,inputSchema:zodToJsonSchema(value.input) as Record<string,unknown>,outputSchema:zodToJsonSchema(value.output) as Record<string,unknown>,cancellation:{mode:'preflight_only' as const,description:'停止取消尚在进行的读取；已保存的原事件不回滚。'},recovery:value.recovery}))}
  /** 只编码一次实际返回值；身份、范围、进度与原本轮端口分别核对，不能接受端口换绑。 */
  async call(name:string,raw:unknown,toolCallId?:string){
    const input=outputManifestTool(name,raw);if(!input||!toolCallId||toolCallId.length>128||toolCallId.trim()!==toolCallId||/[\x00-\x1f]/.test(toolCallId))throw Error('完整清单工具须来自本轮真实调用');
    if(name===outputManifestInspectToolName){
      const evidence=this.ports.inspect(),value={binding:structuredClone(this.binding),scopes:structuredClone(this.scopes),manifests:evidence.refs,issues:evidence.issues},expected=structuredClone(value);
      return checkedJsonToolResult(name,value,outputManifestInspectSchema.refine(value=>equal(value,expected),'查询结果已变化'));
    }
    const args=structuredClone(input.args) as OutputManifestInput,manifest=await this.ports.capture(args,toolCallId),ref=outputManifestReference(manifest);
    const value={state:'captured' as const,binding:manifest.binding,manifest:ref},expected=structuredClone(value);
    return checkedJsonToolResult(name,value,outputManifestResultSchema.superRefine((value,context)=>{
      if(!equal(value,expected)||!equal(value.binding,this.binding)||!equal(value.manifest.scopes,this.scopes)||value.manifest.knowledgeRevision!==this.knowledgeRevision||value.manifest.progressVersion!==args.expectedTaskProgressVersion||value.manifest.captureToolCallId!==toolCallId)context.addIssue({code:'custom',message:'清单回包不属于原运行、范围或请求'});
    }));
  }
}
