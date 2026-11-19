import type { RuntimeOptions } from '../../src/logic/execution/rules/runtime/runtime';
import type { AgentEngine } from '../../src/logic/execution/rules/types';

/** 注入测试引擎以观察真实运行时的创建、取消与销毁请求。 */
export function fixtureEngines(create: (context: Parameters<RuntimeOptions['engines']['Create']>[0]) => AgentEngine): RuntimeOptions['engines']
{
  return {
    Create(context) {
      const engine = create(context);
      return {
        kind: engine.kind,
        async Open(context, signal) {
          const stop = () => { void engine.stop(); };
          signal.addEventListener('abort', stop, { once: true });
          try { await engine.start(context); } finally { signal.removeEventListener('abort', stop); }
          return { kind: engine.kind, supportsAppend: !!engine.steer,
            Submit: input => ({ turnId: context.runId, done: engine.run(input) }),
            Append: (_id, input, images, signal) => engine.steer!(input, images, signal),
            Stop: () => engine.stop(), Subscribe: () => () => {},
          };
        },
        Close: () => engine.close(),
      };
    },
  };
}
