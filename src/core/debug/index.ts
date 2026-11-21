/**
 * 作用定位：输出供开发者阅读的控制台诊断，保留宿主的参数格式化。
 * 设计原因：无状态转发诊断参数，日志内容和是否输出由调用者决定，不引入文件系统依赖。
 */
export function logDiagnostic(...values: unknown[]): void
{
  console.log(...values);
}
