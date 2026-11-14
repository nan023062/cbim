/**
 * 作用定位：公开网页读取与搜索的有界工具协议，以及桌面 robots/搜索设置契约。
 * 设计原因：模型只能提交地址或关键词，网络策略和凭据留在主进程；返回资料不是执行指令。
 */
import {z} from 'zod';
export const webFetchInput=z.object({url:z.string().url().max(2048),maxChars:z.number().int().min(500).max(20000).optional()}).strict();
export const webSearchInput=z.object({query:z.string().trim().min(1).max(500),count:z.number().int().min(1).max(10).optional()}).strict();
export const webFetchOutput=z.object({url:z.string().url(),title:z.string().max(500),markdown:z.string().max(40000),truncated:z.boolean(),cached:z.boolean(),capturedAt:z.string().datetime(),untrusted:z.literal(true)}).strict();
export const webSearchOutput=z.object({provider:z.literal('brave'),query:z.string(),results:z.array(z.object({title:z.string().max(500),url:z.string().url(),snippet:z.string().max(2000)}).strict()).max(10),untrusted:z.literal(true)}).strict();
export const webConfigureInput=z.object({revision:z.number().int().positive(),enabled:z.boolean(),apiKey:z.string().trim().min(1).max(512).optional(),clearKey:z.boolean().optional(),browserRobotsPolicy:z.enum(['allow','respect']).optional()}).strict();
export interface WebSettingsView {
  revision:number;provider:'brave';enabled:boolean;hasKey:boolean;secureStorage:boolean;
  /** 默认 allow：浏览器按普通访问读取正文；respect：所有浏览器请求核实 robots。与搜索开关独立。 */
  browserRobotsPolicy:'allow'|'respect';
}
/** 实例绑定主进程网络服务；取消后不交付迟到结果，不接受自定义请求头、代理或 API 地址。 */
export interface WebToolsPort {
  fetch(input:z.infer<typeof webFetchInput>,signal:AbortSignal):Promise<z.infer<typeof webFetchOutput>>;
  search(input:z.infer<typeof webSearchInput>,signal:AbortSignal):Promise<z.infer<typeof webSearchOutput>>;
}
