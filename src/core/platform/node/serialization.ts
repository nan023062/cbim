/**
 * 作用定位：后端既有 hash/json 名称的兼容适配，格式化来自共享 Core utility，摘要来自独立 Node 入口。
 * 设计原因：知识版本及幂等指纹保留原字节、错误和导入契约；json 直接引用 JsonUtils.formatJson，保持函数身份而不创建第二套算法。
 * 实现形式：仍有真实消费者的兼容导出模块，不保存状态，不包装静态方法。
 */
import {JsonUtils} from '../../utility';

// #region 公开入口

/** 既有业务摘要入口，复用唯一 Node SHA-256 实现。 */
export {sha256 as hash} from './digest';
/** 既有格式化入口，直接保留静态方法身份和原字节协议。 */
export const json = JsonUtils.formatJson;

// #endregion
