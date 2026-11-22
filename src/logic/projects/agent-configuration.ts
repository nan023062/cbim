/**
 * 作用定位：配置边界只接受能力选择，不接受账号凭据或权限覆盖。
 * 设计原因：严格 Schema 固定模型、技能和连接器选择边界，防止设置请求携带额外执行权。
 */
import { z } from 'zod';

export type { AgentConfiguration } from '../../framework/cability/team';

/** 选择项只传递标识和显示状态；调用意图留在视图事件中。 */
export function engineLogoLabel<Id extends string>(id: Id, name: string, src?: string, selected?: boolean, disabledReason?: string)
{
  return Object.freeze({ id, name, logo: Object.freeze({ src, fallbackIcon: 'terminal' }), tooltip: disabledReason || name, selected, disabledReason });
}

export const agentConfigurationSchema = z.object({ model: z.object({ engine: z.string().trim().min(1).max(48), profileId: z.string().trim().min(1).max(160), modelId: z.string().trim().min(1).max(160) }).strict().optional(), skills: z.array(z.object({ logo: z.string().max(132000).optional(), id: z.string().min(1).max(100), name: z.string().trim().min(1).max(100), content: z.string().trim().min(1).max(32000) }).strict()).max(32).default([]), connectorIds: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,47}$/)).max(32).default([]), }).strict().superRefine((value, ctx) => { if (new Set(value.skills.map(skill => skill.id)).size !== value.skills.length || new Set(value.connectorIds).size !== value.connectorIds.length) ctx.addIssue({ code: 'custom', message: 'Skill 或连接器身份重复' }); });

/** 成员与主会话的独立保存目标。 */
export const agentSettingsTargetSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('member'), id: z.string().min(1).max(2048) }).strict(), z.object({ kind: z.literal('main'), id: z.string().uuid() }).strict()]);

export type AgentSettingsTarget = z.infer<typeof agentSettingsTargetSchema>;

/** 主动调用命令与可用清单共用解析规则，技能正文只由宿主从配置快照取得。 */
export class SkillCommands
{
  private constructor()
  {
  }

  /** 命令使用可读名称，重名附加身份后缀；排队后始终对提交时快照解析。 */
  public static List(skills: readonly { id: string; name: string; content: string }[] = [])
  {
    const bases = skills.map(skill => skill.name.normalize('NFKC').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'skill');

    return skills.map((skill, index) => ({ id: skill.id, name: skill.name, command: '/skill:' + bases[index] + (bases.filter(base => base === bases[index]).length > 1 ? '~' + encodeURIComponent(skill.id) : '') }));
  }

  /** 只解析消息开头的显式 skill 命令；正文、路径和代码中的斜杠保持普通文本。 */
  public static Resolve(text: string, skills: readonly { id: string; name: string; content: string }[] = [])
  {
    let remaining = text.trimStart();

    const selected = new Map<string,
      {
        id: string;

        name: string;

        content: string
      }>();

    while (remaining.startsWith('/skill:'))
    {
      const match = /^\/skill:([^\s]+)(?:\s+|$)/.exec(remaining);

      if (!match)
        throw Error('请选择一个可用 Skill');

      const entry = SkillCommands.List(skills).find(item => item.command === '/skill:' + match[1]);

      const skill = skills.find(item => item.id === entry?.id);

      if (!skill)
        throw Error('该 Skill 不在当前可用清单中，请重新选择');

      selected.set(skill.id, skill);

      remaining = remaining.slice(match[0].length);
    }

    return { text: remaining, skills: [...selected.values()] };
  }

  /** 插入当前任务时只展开显式选择，配置列表本身从不作为待执行指令。 */
  public static Expand(text: string, skills: readonly { id: string; name: string; content: string }[] = [])
  {
    const resolved = SkillCommands.Resolve(text, skills);

    if (!resolved.skills.length)
      return text;

    return JSON.stringify({ userRequest: resolved.text, requestedSkills: resolved.skills, instruction: '用户明确要求本次使用这些技能；只应用所列正文，不扩大工具或 Office 权限。' });
  }
}
