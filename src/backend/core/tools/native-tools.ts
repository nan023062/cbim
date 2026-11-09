/**
 * 作用定位：定义当前引擎真实装配的原生工具及可信副作用分类。
 * 设计原因：适配器启动参数、能力预检、授权与 canonical 证据共用同一纯表，避免分类漂移或把模型声明当能力。
 * 职责边界：清单只表示可提供的工具，逐次路径检查、权限和审批仍由既有门禁完成。
 */
import type {RunToolDescriptor} from '../policy/tool-policy';

const definitions:Readonly<Record<string,RunToolDescriptor>>={read:{effects:['read'],native:true},grep:{effects:['read'],native:true},find:{effects:['read'],native:true},ls:{effects:['read'],native:true},bash:{effects:['command'],native:true},write:{effects:['business-write'],native:true},edit:{effects:['business-write'],native:true}};
/** 返回独立的描述，调用方不能改变后续运行的注册分类。 */
export function nativeToolDescriptor(name:string):RunToolDescriptor|undefined{const value=Object.hasOwn(definitions,name)?definitions[name]:undefined;return value?{effects:[...value.effects],native:value.native}:undefined}
/** 与 --tools 真实注册参数一致；ask/execute 可以提供执行工具，但不代表某次调用已获准。 */
export function nativeToolNames(allowExecution:boolean):string[]{return Object.entries(definitions).filter(([,tool])=>allowExecution||tool.effects.every(effect=>effect==='read')).map(([name])=>name)}
