/** 实例内的同步变更通知；观察者故障不能中断已经提交的业务状态。 */
export function changeEvents<T>()
{
  const listeners = new Set<(event: T) => void>();
  return {
    Subscribe(listener: (event: T) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    Emit(event: T) {
      for (const listener of [...listeners]) {
        if (!listeners.has(listener)) continue;
        try { listener(event); } catch (error) { console.error('Runtime change listener failed', error); }
      }
    }
  };
}
