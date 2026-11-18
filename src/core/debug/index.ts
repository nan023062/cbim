/** 输出供开发者阅读的控制台诊断，保留宿主的参数格式化。 */
export function logDiagnostic(...values: unknown[]): void
{
  console.log(...values);
}
