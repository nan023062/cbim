/**
 * 作用定位：定义办公室内长期存在的 Agent 逻辑对话身份，供调度登记、持久化和对话导航共用。
 * 设计原因：一个主会话中的同一角色只有一个子会话；任务运行、原生上下文和权限租约仍保留各自身份，不能拿执行通道数量当作团队人数。
 * 职责边界：这里只登记身份，不复制消息正文、不恢复模型、不授予执行许可。旧日志缺省时不伪造历史绑定。
 */
import {z} from 'zod';
import {fail} from '../../../core/errors';

const id=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
export const teamSessionSchema=z.object({
  workspaceId:id,rootSessionId:id,sessionId:id,
  teamId:z.string().trim().min(1).max(512),agentId:z.string().trim().min(1).max(512),
  createdAt:z.string().datetime(),
}).strict();
/** 主、子 Agent 使用同一身份模型；rootSessionId 是办公室边界，sessionId 是长期对话身份而非原生线程 ID。 */
export type TeamSession=z.infer<typeof teamSessionSchema>;

/** 验证并追加身份；已登记身份不可重绑，重复的相同登记幂等，跨办公室的同名角色相互独立。 */
export function appendTeamSessions(previous:readonly TeamSession[],updates:readonly TeamSession[],workspaceId:string):TeamSession[]{
  const next=previous.map(item=>({...item})),ids=new Set<string>();
  for(const raw of updates){
    const parsed=teamSessionSchema.safeParse(raw);
    if(!parsed.success||raw.workspaceId!==workspaceId||ids.has(raw.sessionId))fail('TEAM_SESSION_INVALID','团队对话身份无效、重复或不属于当前工作区');
    ids.add(raw.sessionId);
    const sameId=next.find(item=>item.sessionId===raw.sessionId);
    const sameRole=next.find(item=>item.rootSessionId===raw.rootSessionId&&item.agentId===raw.agentId);
    if(sameId){
      if(Object.keys(parsed.data).some(key=>sameId[key as keyof TeamSession]!==raw[key as keyof TeamSession]))fail('TEAM_SESSION_CONFLICT','已登记的团队对话不能更换办公室或 Agent');
    }else{
      if(sameRole)fail('TEAM_SESSION_CONFLICT','同一办公室的 Agent 已有独立对话');
      next.push({...parsed.data});
    }
  }
  return next;
}
