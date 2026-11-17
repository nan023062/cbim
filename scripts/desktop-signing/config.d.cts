export interface SigningConfig {
  thumbprint: string;
  publisherName: string;
  signTool: string;
  store: 'CurrentUser' | 'LocalMachine';
  timestampUrl: string;
}
export function signingConfig(env?: NodeJS.ProcessEnv): SigningConfig;
export function desktopSigningMode(env?: NodeJS.ProcessEnv): 'signed' | 'unsigned';
/** 读取构建显式指定的发布正文；保留内容，缺失或空正文直接拒绝。 */
export function desktopReleaseNotes(env?: NodeJS.ProcessEnv): string;
export function updaterConfigYaml(version: string, publisherName?: string, mode?: 'signed' | 'unsigned'): string;
