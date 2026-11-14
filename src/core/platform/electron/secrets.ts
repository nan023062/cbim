/**
 * 作用定位：用 Electron 系统加密能力保护 LLM 与 GitHub 反馈凭据。
 * 设计原因：平台实现位于 Core Electron 入口，只组合独立 SecretCipher 技术契约；禁止不安全的明文回退。
 */
import {safeStorage} from 'electron';
import type {SecretCipher} from '../../contracts/secrets';
export const systemSecretCipher:SecretCipher={
  available:()=>safeStorage.isEncryptionAvailable()&&(process.platform!=='linux'||safeStorage.getSelectedStorageBackend()!=='basic_text'),
  encrypt:value=>safeStorage.encryptString(value).toString('base64'),
  decrypt:value=>safeStorage.decryptString(Buffer.from(value,'base64')),
};
