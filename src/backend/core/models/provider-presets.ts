/**
 * 作用定位：模型设置与接口解析共用的官方供应商地址预设，属于模型配置的纯数据策略。
 * 设计原因：将供应商地址变化集中在此处；不请求网络、不持有 Key，也不根据模型品牌猜第三方网关。
 * 核实日期：2026-11-13；来源随条目保存。地域、特殊套餐及未列出的路径必须显式配置。
 */
import type {AlternateConnection} from './config';

/** 首项用于新配置的默认连接；aliases 只接受明确列出的等价根地址。 */
export interface ProviderPreset {
  id:string;
  name:string;
  connections:readonly AlternateConnection[];
  aliases?:readonly string[];
  sources:readonly string[];
}

export const providerPresets:readonly ProviderPreset[]=[
  {id:'deepseek',name:'DeepSeek',connections:[
    {api:'openai-completions',baseUrl:'https://api.deepseek.com'},
    {api:'anthropic-messages',baseUrl:'https://api.deepseek.com/anthropic'},
    {api:'openai-responses',baseUrl:'https://api.deepseek.com'},
  ],aliases:['https://api.deepseek.com/v1','https://api.deepseek.com/anthropic/v1'],sources:[
    'https://api-docs.deepseek.com/guides/anthropic_api/',
    'https://api-docs.deepseek.com/guides/responses_api/',
  ]},
  {id:'kimi-intl',name:'Kimi（国际 API）',connections:[
    {api:'openai-completions',baseUrl:'https://api.moonshot.ai/v1'},
    {api:'anthropic-messages',baseUrl:'https://api.moonshot.ai/anthropic'},
    {api:'openai-responses',baseUrl:'https://api.moonshot.ai/v1'},
  ],aliases:['https://api.moonshot.ai/anthropic/v1'],sources:[
    'https://platform.kimi.ai/docs/guide/claude-code-kimi',
    'https://platform.kimi.ai/docs/guide/codex-kimi',
  ]},
  {id:'minimax-intl',name:'MiniMax（国际 API）',connections:[
    {api:'openai-completions',baseUrl:'https://api.minimax.io/v1'},
    {api:'anthropic-messages',baseUrl:'https://api.minimax.io/anthropic',modelIds:['MiniMax-M3.1-Flash','MiniMax-M3']},
  ],aliases:['https://api.minimax.io/anthropic/v1'],sources:[
    'https://platform.minimax.io/docs/api-reference/text-openai-api',
    'https://platform.minimax.io/docs/api-reference/text-anthropic-api',
  ]},
  {id:'openai',name:'OpenAI',connections:[
    {api:'openai-completions',baseUrl:'https://api.openai.com/v1'},
    {api:'openai-responses',baseUrl:'https://api.openai.com/v1'},
  ],sources:['https://platform.openai.com/docs/api-reference/responses']},
  {id:'anthropic',name:'Anthropic',connections:[
    {api:'anthropic-messages',baseUrl:'https://api.anthropic.com'},
  ],aliases:['https://api.anthropic.com/v1'],sources:['https://platform.claude.com/docs/en/api/messages']},
];

/** 精确匹配官方 HTTPS origin 与路径；不把子域、代理、套餐路径或地区地址互相转换。 */
export function identifyProvider(baseUrl:string):ProviderPreset|undefined {
  try{
    const url=new URL(baseUrl);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)return undefined;
    const normalized=url.origin+url.pathname.replace(/\/+$/,'');
    return providerPresets.find(preset=>[...preset.connections.map(connection=>connection.baseUrl),...(preset.aliases??[])].includes(normalized));
  }catch{return undefined}
}
