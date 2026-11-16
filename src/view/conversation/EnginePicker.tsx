/**
 * 作用定位：对话中的唯一引擎选择与安装菜单，消费桌面受管引擎状态。
 * 设计原因：浏览不安装、安装不选择；真实进度由宿主持有，关闭菜单不会取消或重复下载。
 */
import { useEffect, useId, useRef, useState } from 'react';
import { engineLabel, loopEngineSchema, type LoopEngine } from '../../bridge/contracts/engines';
import type { ManagedEngineStatus } from '../../bridge/contracts/desktop-updates';
import { Icon } from '../components/Icon';
import './engine-picker.css';

const api = window.cbim;

const labels: Record<ManagedEngineStatus['state'], string> = { install: '可安装', update: '可更新', ready: '已安装', preparing: '正在准备', failed: '准备失败', unavailable: '暂不可用', bundled: '随应用提供' };

/** 所有支持引擎始终可查看；仅选择受父级配置锁影响，准备请求严格绑定行内 engine。 */
export function EnginePicker({ value, onChange, onConfigure, disabled = false }: { onConfigure?: () => void; value: LoopEngine; onChange: (value: string) => void; disabled?: boolean })
{
  const [open, setOpen] = useState(false),
    [items, setItems] = useState<ManagedEngineStatus[]>([]),
    [error, setError] = useState('');
  const [pending, setPending] = useState<LoopEngine[]>([]);
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    alive = useRef(true),
    locks = useRef(new Set<LoopEngine>()),
    epoch = useRef(0),
    id = useId();
  useEffect(() =>
  {
    alive.current = true;
    return () =>
    {
      alive.current = false;
      epoch.current++
    }
  }, []);
  useEffect(() =>
  {
    if (!open)
      return;
    let cancelled = false,
      reading = false;
    const read = async () =>
    {
      if (reading)
        return;
      reading = true;
      const revision = epoch.current;
      try
      {
        const result = await api.call('desktop.engines.status');
        if (!cancelled && revision === epoch.current)
        {
          setItems(result);
          setError('')
        }
      }
      catch
      {
        if (!cancelled && revision === epoch.current)
          setError('无法读取引擎状态，请关闭菜单后重新打开。')
      }
      finally
      {
        reading = false
      }
    };
    void read();
    const timer = setInterval(() => void read(), 1000);
    const outside = (event: PointerEvent) =>
    {
      if (!root.current?.contains(event.target as Node))
        setOpen(false)
    };
    // 准备按钮切换为进度环时焦点可能落到 body；Escape 仍须能关闭并返回触发器。
    const escape = (event: KeyboardEvent) =>
    {
      if (event.key === 'Escape')
      {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus()
      }
    };
    document.addEventListener('keydown', escape);
    document.addEventListener('pointerdown', outside);
    root.current?.querySelector<HTMLElement>('[data-engine-choice]')?.focus();
    return () =>
    {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape)
    };
  }, [open]);
  async function prepare(engine: LoopEngine)
  {
    if (locks.current.has(engine))
      return;
    locks.current.add(engine);
    epoch.current++;
    setPending([...locks.current]);
    setError('');
    try
    {
      const result = await api.call('desktop.engines.prepare', { engine });
      if (alive.current)
        setItems(current => [...current.filter(s => s.engine !== engine), result])
    }
    catch
    {
      if (alive.current)
        setError(engineLabel(engine) + ' 准备未完成，请核对该行状态后重试。')
    }
    finally
    {
      locks.current.delete(engine);
      epoch.current++;
      if (alive.current)
        setPending([...locks.current])
    }
  }
  function close()
  {
    setOpen(false);
    trigger.current?.focus()
  }
  return <div ref={root} className="composer-picker right engine-picker" onKeyDown={event =>
  {
    if (event.key === 'Escape' && open)
    {
      event.preventDefault();
      event.stopPropagation();
      close()
    }
    if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))
    {
      const buttons = [...root.current!.querySelectorAll<HTMLButtonElement>('.engine-picker-panel button:not(:disabled)')];
      if (!buttons.length)
        return;
      event.preventDefault();
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (i + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
    }
    if (event.key === 'Tab' && open)
    {
      const nodes = [...root.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if (event.shiftKey && document.activeElement === nodes[0] || !event.shiftKey && document.activeElement === nodes.at(-1))
        setOpen(false)
    }
  }}>
    <button ref={trigger} className="composer-chip" aria-label="Loop 引擎" aria-haspopup="dialog" aria-expanded={open} aria-controls={id} title="选择引擎、安装或更新运行包" onClick={() => setOpen(!open)}><Icon name="settings" size={14} /><span>{engineLabel(value)}</span><span className="chip-chevron">⌄</span></button>
    {open && <div id={id} className="composer-picker-panel engine-picker-panel" role="dialog" aria-label="引擎选择与安装">
      <p className="engine-menu-note">本机引擎 · 安装或更新不改变正在运行的任务</p>
      {loopEngineSchema.options.map(engine =>
      {
        const item = items.find(s => s.engine === engine),
          working = pending.includes(engine) || item?.state === 'preparing',
          available = !!item && ['ready', 'bundled'].includes(item.state),
          progress = item?.progress;
        return <div className="engine-picker-row" key={engine}>
          <button data-engine-choice aria-label={engineLabel(engine)} aria-pressed={engine === value} disabled={disabled || !available || working} title={disabled ? '当前配置正在保存，请稍后选择' : !available ? '安装完成后可选择此引擎' : '用于后续执行'} onClick={() =>
          {
            onChange(engine);
            close()
          }}><Icon name={engine === value ? 'check' : 'settings'} size={16} /><span><b>{engineLabel(engine)}</b><small>{item ? labels[item.state] : '正在读取状态…'}{item?.installedVersion ? ' · ' + item.installedVersion : ''}{item?.version && item.state !== 'ready' ? ' → ' + item.version : ''}</small></span></button>
          {working ? <span className="engine-progress" role="progressbar" aria-label={engineLabel(engine) + ' 准备进度'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number.isFinite(progress) ? progress : undefined} title={Number.isFinite(progress) ? Math.round(progress!) + '%' : '正在准备，进度待确认'}><svg viewBox="0 0 36 36" className={Number.isFinite(progress) ? '' : 'indeterminate'}><circle cx="18" cy="18" r="15" className="track" /><circle cx="18" cy="18" r="15" pathLength="100" strokeDasharray={Number.isFinite(progress) ? '100' : '25 75'} strokeDashoffset={Number.isFinite(progress) ? 100 - progress! : 0} /></svg><small>{Number.isFinite(progress) ? Math.round(progress!) + '%' : '准备中'}</small></span> : item && ['install', 'update', 'failed'].includes(item.state) ? <button className="engine-install" onClick={() => void prepare(engine)}><Icon name={item.state === 'update' ? 'refresh' : 'download'} size={16} />{item.state === 'update' ? '更新' : item.state === 'failed' ? '重试' : '安装'}</button> : null}
          {item?.error && <small className="engine-error" role="status">{item.error}</small>}
        </div>
      })}
      {onConfigure && <button disabled={disabled} onClick={() =>
      {
        close();
        onConfigure()
      }}>配置当前引擎模型</button>}
      {error && <p role="alert">{error}</p>}<p className="engine-menu-note">仅使用当前应用签名清单中的兼容版本。</p>
    </div>}
  </div>;
}
