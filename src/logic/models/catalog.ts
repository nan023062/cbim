/**
 * 目录归属：logic/models；模型目录与纯选型规则。
 * 作用定位：解析供应商模型目录的能力资料，供新增模型和显式同步容量使用。
 * 设计原因：读取显式视觉输入声明，不根据模型名称猜测；仅获取 ID 会把占位容量误当真实上限；缺失或异常字段保持未知，不按型号猜测。
 */
export interface DiscoveredModel {
  id:string;name?:string;
  /** 供应商声明的完整上下文容量，不是用户的工作预算。 */
  contextWindow?:number;
  /** 供应商允许的输出上限；同步时不自动提高用户单次请求预算。 */
  maxOutputTokens?:number;
  reasoning?:boolean;
  /** 输入模态声明；缺失保持未知，由用户在模型设置中确认。 */
  vision?:boolean;
}
/** 只接受有限正整数容量及有限长度标识，不传播接口中任意字段。 */
export function parseModelCatalog(data:unknown):DiscoveredModel[]{
 if(!Array.isArray(data))throw Error('接口未返回模型列表，请手动添加模型');
 const limit=(v:unknown)=>typeof v==='number'&&Number.isInteger(v)&&v>0&&v<=2000000?v:undefined;
 const found=new Map<string,DiscoveredModel>();
 for(const row of data){if(!row||typeof row.id!=='string'||!row.id.trim()||row.id.length>160)continue;
  const contextWindow=limit(row.context_window??row.contextWindow);
  const output=limit(row.max_output_tokens??row.maxOutputTokens);
  const modalities=row.input_modalities??row.architecture?.input_modalities??row.input;
  const vision=typeof row.vision==='boolean'?row.vision:typeof row.capabilities?.vision==='boolean'?row.capabilities.vision:Array.isArray(modalities)&&modalities.every((x:unknown)=>typeof x==='string')?modalities.includes('image'):undefined;
  found.set(row.id,{id:row.id,name:typeof row.name==='string'?row.name.slice(0,160):undefined,contextWindow,maxOutputTokens:output&&(!contextWindow||output<=contextWindow)?output:undefined,reasoning:typeof row.reasoning==='boolean'?row.reasoning:Array.isArray(row.effort?.supported_levels)&&row.effort.supported_levels.length>0?true:undefined});
  found.get(row.id)!.vision=vision;
  if(found.size>=200)break;
 }return [...found.values()];
}
