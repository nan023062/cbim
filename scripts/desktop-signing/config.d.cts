export interface SigningConfig {
  thumbprint: string;
  publisherName: string;
  signTool: string;
  store: 'CurrentUser' | 'LocalMachine';
  timestampUrl: string;
}
export function signingConfig(env?: NodeJS.ProcessEnv): SigningConfig;
export function updaterConfigYaml(version: string, publisherName: string): string;
