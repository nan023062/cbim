/**
 * 作用定位：声明主 Agent 选型和供应商设置的桌面请求、运行时校验及返回值映射。
 * 设计原因：前端、preload 与 Main 共享一份公开协议，配置页与对话栏不能各自猜测字段；不引用后端服务实现。
 * 职责边界：类型不是授权，Main 仍核实发送窗口、工作区实例、版本和保存条件；密钥仅在显式写入请求中出现。
 * 连接测试显式选择引擎并返回实际协议/地址，不接受临时任意转发目标。
 */
import {z} from 'zod';
import {connectionSchema,definition,type LlmSettings} from './models';
import {mainAgentIdentitySchema,mainAgentSettingsSchema,type MainAgentSettingsView} from '../../logic/team/rules/agent-runtime';
import {loopEngineSchema,type LoopEngine,type LlmApi,type DiscoveredModel} from './models';

const identity=z.object({id:z.string().uuid()}).strict();
const discovery=z.object({id:z.string().uuid().optional(),connection:connectionSchema.strict(),apiKey:z.string().max(16000).optional()}).strict();
/** 仅现有公开字段；列表请求不接地址、命令或凭据。 */
export const modelActionSchemas={
  'agent.mainSettings':mainAgentIdentitySchema,
  'agent.configureMain':mainAgentSettingsSchema,
  'models.list':z.object({}).strict().optional(),
  'models.save':z.object({id:z.string().uuid().optional(),profile:definition,apiKey:z.string().max(16000).optional()}).strict(),
  'models.select':identity,
  'models.remove':identity,
  'models.test':identity.extend({modelId:z.string().min(1).optional(),engine:loopEngineSchema.optional()}).strict(),
  'models.discover':discovery,
  'models.discoverDetails':discovery,
} as const;
export type ModelAction=keyof typeof modelActionSchemas;
export type ModelActionInput<K extends ModelAction>=z.infer<(typeof modelActionSchemas)[K]>;
export interface ModelActionResults {
  'agent.mainSettings':MainAgentSettingsView;
  'agent.configureMain':MainAgentSettingsView;
  'models.list':LlmSettings;
  'models.save':LlmSettings;
  'models.select':LlmSettings;
  'models.remove':LlmSettings;
  'models.test':{ok:boolean;model:string;latencyMs:number;engine:LoopEngine;api:LlmApi;baseUrl:string};
  'models.discover':string[];
  'models.discoverDetails':DiscoveredModel[];
}
/** 只识别自身精确键，原型属性或未知 action 不能进入模型路由。 */
export const isModelAction=(action:string):action is ModelAction=>Object.hasOwn(modelActionSchemas,action);
