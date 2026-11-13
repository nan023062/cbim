/**
 * 作用定位：将运行终态错误投影为任务卡、执行详情共用的公开诊断。
 * 设计原因：不能丢掉超时、输出上限等根因，也不能把供应商正文、凭据、路径或工具输入
 * 直接复制到任务图。仅识别确定的错误形态并重建说明；未知错误仍留在原始运行记录。
 */
export function publicRunFailure(error:unknown):string|undefined {
  if(typeof error!=='string'||!error.trim())return;
  const idle=/^(Pi|Codex|Claude Code) 连续 (\d+(?:\.\d+)?) (分钟|秒)无执行进展，已中断；请核实未确认的操作与产物。$/.exec(error);
  if(idle)return `${idle[1]} 连续 ${idle[2]} ${idle[3]}无执行进展，已中断；请核实未确认的操作与产物。`;
  const fixed:Record<string,string>={
    '执行超时，结果需核实，不自动重放':'执行超时，结果需核实，不自动重放',
    'Codex 执行超时，请核实原运行':'Codex 执行超时，请核实原运行',
    'Claude Code 执行超时，请核实原运行记录':'Claude Code 执行超时，请核实原运行记录',
    'Pi 事件超过大小限制':'Pi 事件超过大小限制，通信已中断；请核实已产生的文件与操作。',
    'Codex 消息超出限制':'Codex 消息超出限制，通信已中断；请核实已产生的文件与操作。',
    '工具结果未确认':'工具结果未确认；请先核实原操作，勿直接重复执行。',
    'CONTROLLED_FILE_REVIEW_REQUIRED: 原受控文件操作结果待核实，本轮不能安全交接':'原受控文件操作结果待核实，本轮不能安全交接。',
    'Claude Code 未返回终态，请核实原运行记录':'Claude Code 未返回终态，请核实原运行记录',
    'TOOL_REPEAT_BLOCKED: 同一工具同参数连续失败三次，请核实原结果并修正原因。':'同一工具同参数连续失败三次，已停止；请核实原结果并修正原因。',
  };
  if(Object.hasOwn(fixed,error))return fixed[error];
  if(error.startsWith('模型返回长度限制（length），本次回复被截断。')){
    const configured=/配置的最大输出为 (\d+) token。/.exec(error),used=/本次输出 (\d+) token/.exec(error);
    return `模型输出达到长度限制（length），回复被截断。${configured?`配置上限 ${configured[1]} token。`:''}${used?`本次输出 ${used[1]} token。`:''}请核对输出额度及上下文容量，先核实已完成内容。`;
  }
  const exit=/^(Pi 进程已退出|Codex 进程提前退出) \((-?\d+|SIG[A-Z]+)\)$/.exec(error);
  if(exit)return `${exit[1]}（${exit[2]}），未确认正常完成；请核实原运行。`;
  if(/\b(?:401|403)\b|authentication failed|invalid api.?key/i.test(error))return '模型服务认证或访问被拒绝，请检查供应商凭据和访问权限。';
  if(/\b429\b|rate.?limit/i.test(error))return '模型服务限流，请核对供应商额度与请求频率。';
  if(/ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|socket hang up/i.test(error))return '模型连接异常或网络超时，未确认正常完成；请检查连接并核实原运行。';
  return '执行异常，详细原因保留在原运行记录；请核实未确认的操作与产物。';
}
