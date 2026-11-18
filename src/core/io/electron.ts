/**
 * 作用定位：用 Electron 系统加密能力保护 模型、网页搜索和 GitHub 反馈凭据。
 * 设计原因：宿主注入系统加密对象，业务侧仅引用同文件的类型。
 */
import { safeStorage } from 'electron';

/** 模型、网页搜索和反馈服务使用的系统凭据加解密能力。 */
export interface SecretCipher
{
  /** 系统可安全保存凭据时返回 true。 */
  Available(): boolean;

  /** 将明文加密为可持久化的密文。 */
  Encrypt(value: string): string;

  /** 使用当前系统凭据存储解密。 */
  Decrypt(value: string): string;
}

/** 由桌面宿主注入，拒绝使用 Linux 明文存储后端。 */
export const systemSecretCipher: SecretCipher = { Available: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'), Encrypt: (value) => safeStorage.encryptString(value).toString('base64'), Decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64')), };
