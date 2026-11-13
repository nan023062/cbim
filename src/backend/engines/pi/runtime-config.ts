/**
 * 目录归属：backend/engines/pi；Pi 引擎适配。
 * 作用定位：将模型容量和工作预算转换为 Pi 原生运行设置，供每轮隔离进程使用。
 * 设计原因：移植 Cindy buildPiSettingsJsonContent 的预算公式与重试配置；
 * 工作预算只控制压缩时机，不能缩小 model.contextWindow 而意外截断输出。
 * 来源：makecindy/cindy@56b6e9a，Apache-2.0，许可见 legal/cindy-LICENSE。
 */
import type {LlmModel} from '../../../logic/models';

/** 可选设置缺省保持 Pi 原生压缩阈值；输出容量不参与工作预算的改写。 */
export function buildPiRuntimeSettings(model?:Pick<LlmModel,'contextWindow'|'workingContextWindow'|'compactionPercent'>){
  const capacity=model?.contextWindow??128000;
  const budget=Math.min(model?.workingContextWindow??capacity,capacity);
  const reserveTokens=model?.compactionPercent===undefined&&budget===capacity?undefined:
    Math.max(1,Math.ceil(capacity-budget*((model?.compactionPercent??90)/100)));
  return {transport:'sse',retry:{enabled:true,maxRetries:6,baseDelayMs:2000,provider:{maxRetries:0}},
    ...(reserveTokens===undefined?{}:{compaction:{reserveTokens}})};
}

/** 无推理模型强制 off；未设置的推理模型使用 Pi 的默认 medium，恢复时不继承旧模型档位。 */
export function requestedThinkingLevel(model:{reasoning:boolean;thinkingLevel?:LlmModel['thinkingLevel']}){
  return !model.reasoning?'off':model.thinkingLevel??'medium';
}
