/**
 * 作用定位：单次 Agent 调用内的问答暂停和结果交接，不创建新 Agent 或执行循环。
 * 设计原因：父引擎不能在等待工具时回答；将问题作为中间回包交给父级，再通过答复工具唤醒原等待。
 */
import { questionInput, questionResultForInput, type QuestionInput, type QuestionResult } from '../tools/rules/questions';

import type { ToolResult } from '../tools/rules/results';

function deferred<T>()
{
  let resolve!: (value: T) => void,
    reject!: (error: unknown) => void;

  const promise = new Promise<T>((a, b) => { resolve = a; reject = b });

  void promise.catch(() => { });

  return { promise, resolve, reject }
}

function error(code: string, message: string)
{
  return Object.assign(Error(message), { code })
}

/** 一次只保留一个原题；发布端使用独立快照。答案先持久记录再消费，重复答案返回原回包，不唤醒第二次。 */
export class AgentCallExchange
{
  private frame = deferred<ToolResult>();

  private pending?:
    {
      id: string;

      input: QuestionInput;

      answer: ReturnType<typeof deferred<QuestionResult>>
    };

  private readonly replies = new Map<string,
    {
      fingerprint: string;

      result: Promise<ToolResult>
    }>();

  private sequence = 0;

  private ended = false;

  yielded = false;

  constructor(private readonly publish: (phase: 'waiting' | 'running', questionId: string, input?: QuestionInput, answer?: QuestionResult) => Promise<ToolResult>)
  {
  }

  Waiting()
  {
    return !!this.pending
  }

  Wait()
  {
    return this.frame.promise
  }

  async Ask(raw: unknown, signal: AbortSignal): Promise<QuestionResult>
  {
    signal.throwIfAborted();

    if (this.ended || this.pending)
      throw error('AGENT_QUESTION_BUSY', '调用已结束或仍有未答问题');

    const input = questionInput.parse(raw),
      id = String(++this.sequence),
      answer = deferred<QuestionResult>();

    this.pending = { id, input, answer };

    const abort = () => answer.reject(error('AGENT_CALL_CANCELLED', '原求助已取消，不能用空答案续跑'));

    signal.addEventListener('abort', abort, { once: true });

    try
    {
      // 发布端只取得快照，不能在落盘后改写本调用校验答案时使用的原题。
      const result = await this.publish('waiting', id, structuredClone(input));

      signal.throwIfAborted();

      this.yielded = true;

      this.frame.resolve(result);

      return await answer.promise;
    }
    finally
    {
      signal.removeEventListener('abort', abort);

      if (this.pending?.id === id)
        this.pending = undefined
    }
  }

  /** questionId 在原调用内唯一；不同答案不得重用已消费问题，新轮问题必须使用新 ID。 */
  Reply(questionId: string, raw: unknown): Promise<ToolResult>
  {
    const fingerprint = JSON.stringify(raw),
      old = this.replies.get(questionId);

    if (old)
    {
      if (old.fingerprint !== fingerprint)
        return Promise.reject(error('AGENT_REPLY_CONFLICT', '原问题已收到不同答案'));

      return old.result
    }

    if (this.ended || this.pending?.id !== questionId)
      return Promise.reject(error('AGENT_QUESTION_STALE', '原问题不存在或已结束，未重建执行'));

    const pending = this.pending,
      answer = questionResultForInput(pending.input).parse(raw);

    const next = deferred<ToolResult>();

    const result = (async () =>
    {
      // 记录与消费共享语义而不共享可变引用，防止发布适配器污染已校验答案。
      await this.publish('running', questionId, undefined, structuredClone(answer));

      if (this.ended || this.pending !== pending)
        throw error('AGENT_QUESTION_STALE', '原问题已取消');

      this.frame = next;

      this.pending = undefined;

      pending.answer.resolve(answer);

      return next.promise;
    })();

    this.replies.set(questionId, { fingerprint, result });

    void result.catch(() => { });

    return result;
  }

  Finish(result: ToolResult)
  {
    this.ended = true;

    this.pending?.answer.reject(error('AGENT_CALL_CLOSED', '原执行已结束'));

    this.pending = undefined;

    this.frame.resolve(result)
  }

  Fail(reason: unknown)
  {
    this.ended = true;

    this.pending?.answer.reject(reason);

    this.pending = undefined;

    this.frame.reject(reason)
  }
}
