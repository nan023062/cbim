/** 每个项目节点独立保存来源，实例 ID 区分同一模板的多次导入。 */
import {z} from 'zod';

export const marketSource=z.object({resource:z.string().max(48),version:z.string().max(48),digest:z.string().length(64),instance:z.string().uuid(),key:z.string().min(1).max(80),configurationRevision:z.number().int().nonnegative().optional()}).strict();
export type MarketSource=z.infer<typeof marketSource>;
