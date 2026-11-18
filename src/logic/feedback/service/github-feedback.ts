/**
 * 目录归属：logic/feedback/service；GitHub 反馈与连接。
 * 作用定位：将本机会话的结构化反馈直接写入已连接 GitHub 仓库，保存私有原提交凭证。
 * 设计原因：先 fsync 意图再 POST；连接、账号、仓库和正文指纹在同工作区跨会话防重。保留原主会话归属，丢失回包只查原标记，硬中断后可在新会话核实。
 * 职责边界：只创建 Issue，不读开发进度、不回传链接、不上传整个工程；内容不入本地账本，账本只保留指纹与必要归属。
 * 简化反馈：只要求用户简述，缺项在纯正文协议中规范化后计算指纹；省略、空白和未提供占位不产生不同主栏目。
 */
import fs from 'node:fs/promises';

import path from 'node:path';

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { atomic } from '../../../core/io/text-files';

import { sha256 as hash } from '../../../core/io/digest';

import type { SecretCipher } from '../../../core/io/electron';

import { feedbackInputSchema, feedbackIssue, type FeedbackToolsPort, type FeedbackScope, type FeedbackInput, type FeedbackResult } from '..';

import { acquireLock } from '../../io-errors/locking';

import { GitHubFeedbackAuth, type GitHubFeedbackIdentity } from './github-feedback-auth';

import { githubRequest, type GitHubRequest } from './github-api';

const id = z.string().min(1).max(128),
  digest = z.string().regex(/^[a-f0-9]{64}$/);

const entrySchema = z.object({ operationId: z.string().uuid(), rootSessionId: id, connectionId: z.string().uuid(), accountId: z.number().int().positive(), login: z.string(), repositoryId: z.number().int().positive(), owner: z.string(), repo: z.string(), fingerprint: digest, bodyHash: digest, titleHash: digest, createdAt: z.string().datetime(), status: z.enum(['sending', 'submitted', 'rejected']), issueNumber: z.number().int().positive().optional() }).strict().refine(value => (value.status === 'submitted') === (value.issueNumber !== undefined));

type Entry = z.infer<typeof entrySchema>;

const ledgerSchema = z.object({ version: z.literal(1), workspaceId: id, entries: z.array(entrySchema).max(1000) }).strict();

type Binding =
  {
    workspaceId: string;

    rootSessionId: string
  };

type Ledger = z.infer<typeof ledgerSchema>;

const unknown = () => { throw new Error('GitHub 提交结果待核实，已阻止本工作区继续提交。请调用 cbim_feedback_receipt 核实原提交，不要重新发送'); };

/** 应用级唯一服务；跨进程内核锁保护同一本机账本，进程退出后 sending 仍保持未知。 */
export class GitHubFeedback
{
  /** 与提交服务同生命周期的授权管理器，宿主只通过公开状态和操作连接设置界面。 */
  readonly auth: GitHubFeedbackAuth;

  private queue: Promise<unknown> = Promise.resolve();

  constructor(private directory: string, cipher?: SecretCipher, private request: GitHubRequest = githubRequest, now: () => number = Date.now)
  {
    this.auth = new GitHubFeedbackAuth(path.join(directory, 'connection.json'), cipher, request, now)
  }

  private Serial<T>(work: () => Promise<T>)
  {
    const next = this.queue.then(async () => { await fs.mkdir(this.directory, { recursive: true }); const lock = acquireLock(this.directory, hash(path.resolve(this.directory).toLowerCase()), 'github-feedback'); try { return await work() } finally { lock.Close() } });

    this.queue = next.catch(() => { });

    return next
  }

  private Filename(binding: { workspaceId: string })
  {
    return path.join(this.directory, 'submissions', hash(binding.workspaceId) + '.json')
  }

  private async Read(binding: Binding): Promise<Ledger>
  {
    try
    {
      const parsed = ledgerSchema.safeParse(JSON.parse(await fs.readFile(this.Filename(binding), 'utf8')));

      if (!parsed.success || parsed.data.workspaceId !== binding.workspaceId || new Set(parsed.data.entries.map(e => e.operationId)).size !== parsed.data.entries.length)
        throw Error();

      return parsed.data
    }
    catch (error: any)
    {
      if (error.code === 'ENOENT')
        return { version: 1, workspaceId: binding.workspaceId, entries: [] };

      throw new Error('原反馈提交记录无法读取，未发起新提交，请检查本机记录')
    }
  }

  private Save(ledger: Ledger)
  {
    return atomic(this.Filename(ledger), JSON.stringify(ledger))
  }

  /** 仅桌面主会话调用，捕获原目标且每次使用前由工作区所有者检查实例仍有效。 */
  async Prepare(binding: Binding, assertCurrent: () => void): Promise<FeedbackToolsPort | undefined>
  {
    id.parse(binding.workspaceId);

    id.parse(binding.rootSessionId);

    assertCurrent();

    const scope = await this.auth.Capture(binding.workspaceId);

    if (!scope)
      return;

    const fixed = Object.freeze({ ...binding });

    return { scope: Object.freeze(scope), Submit: (input, signal) => this.Submit(fixed, scope, input, signal, assertCurrent), Receipt: signal => this.Receipt(fixed, scope, signal, assertCurrent) };
  }

  private Result(entry: Entry): FeedbackResult
  {
    if (entry.status !== 'submitted' || !entry.issueNumber)
      unknown();

    return { status: 'submitted', operationId: entry.operationId }
  }

  private async Verify(identity: GitHubFeedbackIdentity, signal: AbortSignal)
  {
    const actual = await this.auth.VerifyIdentity(identity.config, identity.token, signal);

    if (actual.accountId !== identity.connection.accountId || actual.repositoryId !== identity.connection.repositoryId)
      throw new Error('GitHub 账号或仓库身份已改变，未提交，请在设置中重新连接');
  }

  /** 串行、单次 POST；sending 是持久写屏障，任何不同调用 ID／正文都不能绕过未知结果。 */
  private Submit(binding: Binding, scope: FeedbackScope, raw: FeedbackInput, signal: AbortSignal, assertCurrent: () => void)
  {
    return this.Serial(() => this.auth.WithConnection(scope, signal, async (identity, bounded) =>
    {
      assertCurrent();

      bounded.throwIfAborted();

      const parsed = feedbackInputSchema.safeParse(raw);

      if (!parsed.success)
        throw new Error('请提供反馈类型和非空简述；补充字段可省略，内容需符合长度限制且不能包含保留标记或额外参数');

      const issue = feedbackIssue(parsed.data);

      if (Buffer.byteLength(issue.body, 'utf8') > 48000)
        throw new Error('反馈正文过长，请缩短上下文后提交');

      const ledger = await this.Read(binding),
        fingerprint = hash(JSON.stringify(issue));

      const pending = ledger.entries.find(entry => entry.status === 'sending');

      if (pending)
      {
        if (pending.fingerprint === fingerprint && pending.repositoryId === scope.repositoryId && pending.accountId === identity.connection.accountId)
          unknown();

        throw new Error('本工作区有另一条待核实反馈，当前内容尚未提交。请先处理原提交，不能把原回执当成本条成功')
      }

      const previous = ledger.entries.find(entry => entry.fingerprint === fingerprint && entry.repositoryId === scope.repositoryId && entry.accountId === identity.connection.accountId && entry.status === 'submitted');

      if (previous)
        return this.Result(previous);

      if (ledger.entries.length >= 1000)
        throw new Error('本工作区反馈记录已达上限，未提交');

      await this.Verify(identity, bounded);

      assertCurrent();

      bounded.throwIfAborted();

      const operationId = randomUUID(),
        body = issue.body + `\n\n<!-- cbim-feedback:${operationId} -->`;

      const entry: Entry = { operationId, rootSessionId: binding.rootSessionId, connectionId: scope.connectionId, accountId: identity.connection.accountId, login: identity.connection.login, repositoryId: scope.repositoryId, owner: scope.owner, repo: scope.repo, fingerprint, bodyHash: hash(body), titleHash: hash(issue.title), createdAt: new Date().toISOString(), status: 'sending' };

      ledger.entries.push(entry);

      await this.Save(ledger);

      // 从意图落盘开始，任何取消或传输异常都保留 sending；未收到可靠拒绝不能断言没有写入。
      let reply,
        issued = false;

      try
      {
        assertCurrent();

        bounded.throwIfAborted();

        issued = true;

        reply = await this.request(`https://api.github.com/repos/${scope.owner}/${scope.repo}/issues`, { method: 'POST', token: identity.token, body: { title: issue.title, body }, signal: bounded })
      }
      catch
      {
        if (!issued)
        {
          entry.status = 'rejected';

          try
          {
            await this.Save(ledger)
          }
          catch
          {
            unknown()
          }

          throw new Error('反馈已取消，尚未向 GitHub 发送')
        }

        unknown();
      }

      if ([400, 401, 403, 404, 410, 422].includes(reply!.status))
      {
        entry.status = 'rejected';

        try
        {
          await this.Save(ledger)
        }
        catch
        {
          unknown()
        }

        throw new Error(`GitHub 拒绝提交（HTTP ${reply!.status}），请检查登录、仓库权限或输入格式后再提交`);
      }

      if (reply!.status !== 201)
        unknown();

      const number = this.IssueNumber(reply!.data, entry);

      if (!number)
        unknown();

      entry.status = 'submitted';

      entry.issueNumber = number;

      try
      {
        await this.Save(ledger)
      }
      catch
      {
        unknown()
      }

      return this.Result(entry);
    }))
  }

  /** 核实严格匹配原账号、不可变仓库 ID、标题／正文指纹和隐藏标记；不查开发处理状态。 */
  private IssueNumber(value: unknown, entry: Entry): number | undefined
  {
    const parsed = z.object({ number: z.number().int().positive(), title: z.string(), body: z.string(), html_url: z.string(), url: z.string(), user: z.object({ id: z.number().int().positive() }), pull_request: z.unknown().optional() }).safeParse(value);

    if (!parsed.success)
      return;

    const issue = parsed.data;

    if (issue.pull_request !== undefined || issue.user.id !== entry.accountId || hash(issue.title) !== entry.titleHash || hash(issue.body) !== entry.bodyHash || !issue.body.endsWith(`<!-- cbim-feedback:${entry.operationId} -->`))
      return;

    const target = `${entry.owner}/${entry.repo}`.toLowerCase();

    if (issue.html_url.toLowerCase() !== `https://github.com/${target}/issues/${issue.number}` || issue.url.toLowerCase() !== `https://api.github.com/repos/${target}/issues/${issue.number}`)
      return;

    return issue.number;
  }

  private Receipt(binding: Binding, scope: FeedbackScope, signal: AbortSignal, assertCurrent: () => void)
  {
    return this.Serial(() => this.auth.WithConnection(scope, signal, async (identity, bounded) =>
    {
      assertCurrent();

      const ledger = await this.Read(binding),
        entry = ledger.entries.find(entry => entry.status === 'sending') ?? ledger.entries.filter(entry => entry.rootSessionId === binding.rootSessionId).at(-1);

      if (!entry)
        throw new Error('本会话没有已发起的反馈提交');

      if (entry.accountId !== identity.connection.accountId || entry.repositoryId !== scope.repositoryId || entry.owner !== scope.owner || entry.repo !== scope.repo)
        throw new Error('请连接原账号和原仓库后核实，不能把原提交改投其它目标');

      if (entry.status === 'submitted')
        return this.Result(entry);

      if (entry.status === 'rejected')
        throw new Error('原反馈已被 GitHub 明确拒绝，尚未提交');

      await this.Verify(identity, bounded);

      // 最多核实最近 500 条原作者 Issue；未找到不是“未写入”证明，超范围仍保持未知。
      for (let page = 1; page <= 5; page++)
      {
        assertCurrent();

        bounded.throwIfAborted();

        const reply = await this.request(`https://api.github.com/repos/${entry.owner}/${entry.repo}/issues?state=all&creator=${encodeURIComponent(identity.connection.login)}&sort=created&direction=desc&per_page=100&page=${page}`, { method: 'GET', token: identity.token, signal: bounded });

        if (reply.status !== 200 || !Array.isArray(reply.data) || reply.data.length > 100)
          unknown();

        const matches = (reply.data as unknown[]).map(value => this.IssueNumber(value, entry)).filter((value): value is number => !!value);

        if (matches.length > 1)
          unknown();

        if (matches.length === 1)
        {
          entry.status = 'submitted';

          entry.issueNumber = matches[0];

          try
          {
            await this.Save(ledger)
          }
          catch
          {
            unknown()
          }

          return this.Result(entry)
        }

        if ((reply.data as unknown[]).length < 100)
          break;
      }

      return unknown();
    }))
  }

  /** 先取消授权与连接请求，再等待提交队列退出；保留 sending，不能把关闭视为未提交。 */
  async Close()
  {
    await this.auth.Close();

    await this.queue
  }
}
