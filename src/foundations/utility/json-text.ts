/**
 * 作用定位：将给定数据格式化为两空格缩进、末尾换行的 JSON 文本。
 * 设计原因：文件存储与内容指纹需要保持既有文本字节；这里只提供格式化，不决定领域字段或排序。
 */
/**
 * 保留 JSON.stringify 原语义及属性顺序，不作校验、深拷贝或 canonical 排序。
 * 循环引用与 BigInt 仍抛错；顶层不可序列化值沿旧入口行为返回 "undefined\n"，不是合法 JSON。
 */
export function formatJson(value:unknown):string{return JSON.stringify(value,null,2)+'\n'}
