/**
 * 作用定位：模型、网页和其他配置服务共用的凭据加解密技术端口。
 * 设计原因：业务决定何时解析凭据，宿主提供系统加密；端口不依赖模型业务或具体平台。
 */
/** 不可用时调用方必须拒绝保存密钥，不能自动回退明文。 */
export interface SecretCipher {available():boolean;encrypt(value:string):string;decrypt(value:string):string}
