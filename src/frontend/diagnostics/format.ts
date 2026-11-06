/**
 * 作用定位：资料文件；不直接执行应用逻辑。
 * 设计原因：状态和日志共用纯格式化函数，避免两个视图相互导入形成循环。
 */

export function formatBytes(bytes:number){if(bytes<1024)return `${Math.round(bytes)} B`;if(bytes<1024*1024)return `${(bytes/1024).toFixed(1)} KB`;return `${(bytes/1024/1024).toFixed(1)} MB`}
