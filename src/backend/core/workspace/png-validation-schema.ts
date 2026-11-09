/**
 * 作用定位：冻结静态 PNG 的精确尺寸、通道要求和资源上限，供知识声明、运行端口与公开结果共用。
 * 设计原因：图像条件必须预先声明；纯协议不加载 Node 解压或桌面依赖，实际像素解码留在可信平台。
 * 职责边界：只支持8位非交错RGB/RGBA；编码及尺寸符合不能证明视觉质量或业务语义。
 */
import {z} from 'zod';

/** 文件为压缩字节，宽高为像素；像素上限约束实际解压及还原缓冲，不按声明尺寸信任分配。 */
export const pngValidationLimits={fileBytes:1024*1024,dimension:4096,pixels:1048576,chunks:1024} as const;
/** 宽高和原始采样通道必须精确匹配；不接受范围猜测、外部解码器或颜色转换参数。 */
export const pngImageSchema=z.object({width:z.number().int().min(1).max(pngValidationLimits.dimension),height:z.number().int().min(1).max(pngValidationLimits.dimension),colorType:z.enum(['rgb','rgba'])}).strict().refine(value=>value.width*value.height<=pngValidationLimits.pixels,'PNG声明超过像素上限');
export type PngImageSchema=z.infer<typeof pngImageSchema>;
export type PngValidationIssueCode='png_invalid'|'png_unsupported'|'png_dimensions'|'png_color';
/** 诊断只含固定位置与规则名，不返回像素、文本块、压缩正文或解码器异常。 */
export interface PngValidationOutcome {outcome:'passed'|'rejected';issues:Array<{code:PngValidationIssueCode;instancePath:string;keyword?:string}>}
