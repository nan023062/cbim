import assert from 'node:assert/strict';

/**
 * 验收进程的唯一连接所有者。PID 在接入时冻结，正常退出和 UI 安装交接共用收尾，
 * 避免进程已退出后再从 Playwright 读取身份。这里不判断版本、安装成功或业务状态。
 * transport 负责具体调试协议；waitForExit 必须观察真实进程，并响应 AbortSignal。
 */
export class DesktopAcceptanceProcess {
  #transport;
  #waitForExit;
  #record;
  #state = 'active';
  #stopping;
  #disconnected;

  constructor({pid, transport, waitForExit, record = () => {}}) {
    assert.ok(Number.isSafeInteger(pid) && pid > 0, 'Invalid desktop PID');
    Object.defineProperty(this, 'pid', {value: pid, enumerable: true});
    this.#transport = transport;
    this.#waitForExit = waitForExit;
    this.#record = record;
    this.#record({pid, state: 'active', at: new Date().toISOString()});
  }

  get state() { return this.#state; }

  #active() { assert.equal(this.#state, 'active', 'Desktop connection is no longer active'); }
  evaluate(fn) { this.#active(); return this.#transport.evaluate(fn); }
  firstWindow() { this.#active(); return this.#transport.firstWindow(); }

  #disconnect() {
    // 多条失败路径会收敛到这里；释放失败也保留原 promise，绝不重复外部操作。
    return this.#disconnected ??= Promise.resolve().then(() => this.#transport.disconnect());
  }

  /** 正常退出可重复等待；失败/未知的 UI 交接不能被 finally 转成第二次 quit。 */
  close() {
    if (this.#stopping) return this.#stopping;
    return this.#stop(() => this.#transport.quit(), 'normal-quit');
  }

  /** 先开始观察物理退出，再执行一次 UI 动作；失败不重放，不以页面关闭代替安装成功。 */
  exitAfter(action, reason) {
    this.#active();
    return this.#stop(action, reason);
  }

  #stop(action, reason) {
    this.#active();
    this.#state = 'stopping';
    this.#record({pid: this.pid, state: this.#state, reason, at: new Date().toISOString()});
    this.#stopping = this.#finish(action, reason);
    return this.#stopping;
  }

  async #finish(action, reason) {
    const controller = new AbortController();
    // 立即接住早到的失败，避免 UI click 尚未返回时产生未处理拒绝。
    const exited = (async () => {
      try {
        await this.#waitForExit(this.pid, {signal: controller.signal, timeoutMs: 60000});
        return {ok: true};
      } catch (error) { return {ok: false, error}; }
    })();
    let failure;
    try {
      await action();
      // Node inspector 可能阻止进程结束：发出正常退出后先释放连接，再等待物理退出。
      await this.#disconnect();
      const outcome = await exited;
      if (!outcome.ok) throw outcome.error;
      this.#state = 'closed';
      return this.pid;
    } catch (error) {
      failure = error;
      this.#state = 'failed';
      throw error;
    } finally {
      controller.abort();
      await exited;
      try { await this.#disconnect(); }
      catch (error) { if (!failure) throw error; }
      this.#record({pid: this.pid, state: this.#state, reason,
        ...(failure ? {error: String(failure)} : {}), at: new Date().toISOString()});
    }
  }
}
