/**
 * 作用定位：模型供应商端点的纯校验，供生成与向量连接共用。
 * 设计原因：不同模型操作保留独立地址和字段，但凭据目标的限制不能因新增操作而放宽。
 */
import {z} from 'zod';
/** 只接收 HTTPS 或本机 HTTP 基址，不接收内嵌凭据、查询参数与片段。 */
export const modelEndpointSchema=z.string().trim().url().refine(value=>{const u=new URL(value);return !u.username&&!u.password&&!u.search&&!u.hash&&(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))},'接口地址须为 HTTPS，或本机 HTTP；不能包含凭据、查询参数或片段');
