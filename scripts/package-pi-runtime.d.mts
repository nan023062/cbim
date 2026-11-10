/** 复制已安装的 Pi 生产依赖到独立资源目录，并生成版本清单。 */
export function packagePiRuntime(destination:string):Promise<void>;
export function packageClaudeRuntime(destination:string):Promise<void>;
export function packageCodexRuntime(destination:string):Promise<void>;
