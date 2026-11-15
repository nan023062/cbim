/** 复制已安装的 Pi 生产依赖到独立资源目录，并生成版本清单。 */
export function packagePiRuntime(destination:string):Promise<void>;
export function packageClaudeRuntime(destination:string):Promise<void>;
export function packageCodexRuntime(destination:string):Promise<void>;
export function packageMemoryRuntime(destination:string):Promise<void>;
export const officialEngineBuilders:Readonly<Record<'pi'|'claude-code'|'codex'|'memory',{directory:string;build:(destination:string)=>Promise<void>}>>;
export function packageOfficialEngineRuntimes(root:string):Promise<void>;
