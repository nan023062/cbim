/**
 * 作用定位：项目导航的纯契约；删除为可恢复的列表状态，不删除工程文件与对话历史。
 * 设计原因：列表显示状态与项目实体分离，导航移除不隐含删除磁盘数据。
 */
import { z } from 'zod';

/** 项目或会话身份必须由宿主验证归属。 */
export const navigationChangeSchema = z.object({ revision: z.number().int().nonnegative(), project: z.string().regex(/^[a-f0-9]{64}$/), session: z.string().uuid().optional(), action: z.enum(['rename', 'pin', 'archive', 'restore', 'remove', 'move']), name: z.string().trim().min(1).max(80).optional(), value: z.boolean().optional(), before: z.string().optional() }).strict();

export type NavigationChange = z.infer<typeof navigationChangeSchema>;

/** 列表状态使用稳定身份，独立于内容和执行实例。 */
export interface NavigationSession
{
  id: string;

  title: string;

  renamed?: boolean;

  updated: number;

  pinned: boolean;

  archived: boolean;

  removed: boolean;

  running: boolean;

  queued: number;

  attention: boolean;
}

export interface NavigationProject
{
  id: string;

  name: string;

  path: string;

  pinned: boolean;

  removed: boolean;

  sessions: NavigationSession[];

  error?: string;
}

export interface NavigationSnapshot
{
  revision: number;

  projects: NavigationProject[];
}
