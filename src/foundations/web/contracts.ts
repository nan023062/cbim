/**
 * 作用定位：基础网页读取能力的输入契约，不含 CBIM 工具、工作区或权限身份。
 * 设计原因：独立使用时也验证 URL 与正文上限；业务层可以另行施加更窄的工具协议。
 */
import {z} from 'zod';
export const pageReadInput=z.object({url:z.string().url().max(2048),maxChars:z.number().int().min(500).max(20000).optional()}).strict();
export type PageReadInput=z.infer<typeof pageReadInput>;
