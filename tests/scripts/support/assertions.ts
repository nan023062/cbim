/** 纯断言支持：不构造应用或读写数据；缺少预期真实回执时立即失败。 */
export function required<T>(value:T|null|undefined):T {
  if(value===undefined||value===null)throw Error('Expected a present result');
  return value;
}
