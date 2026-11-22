/**
 * 作用定位：Office 权限选择器；展示权限图标、说明行与选中标记，权限状态由 OfficeView 持有。
 * 设计原因：受控组件表达三种权限并保留键盘操作，实际工具授权仍由宿主逐次检查。
 */
import { Button, Icon } from '../../framework-ui';
import { useEffect, useId, useRef, useState } from 'react';


/** 三种权限沿用现有协议值，不因展示调整改变授权。 */
type Permission = 'read' | 'ask' | 'execute';

/** 权限级别对应的图标。 */
const options = [
  { value: 'read', label: '只读访问', icon: 'knowledge', description: '仅查看和分析，不修改文件或执行命令' },
  { value: 'ask', label: '默认权限', icon: 'hand', description: '修改文件和执行命令前请求确认' },
  { value: 'execute', label: '完全访问', icon: 'warning', description: '允许执行和写入，仍遵守工作区边界' },
] as const;

/** 保留键盘选择、焦点返回、外部点击关闭与运行期间禁用行为。 */
export function PermissionPicker({ value, disabled, OnChange }: { value: Permission; disabled: boolean; OnChange(value: Permission): void })
{
  const [open, setOpen] = useState(false);

  const root = useRef<HTMLDivElement>(null);

  const trigger = useRef<HTMLButtonElement>(null);

  const id = useId();

  const current = options.find(option => option.value === value)!;

  useEffect(() => { if (!open) return; root.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus(); const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); }; document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside); }, [open]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  /** 选择或取消后将键盘焦点交回触发按钮。 */
  function Close(): void
  {
    setOpen(false);

    trigger.current?.focus();
  }

  return <div className="office-permission" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => { if (!open) return; if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); Close(); } if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const items = [...root.current!.querySelectorAll<HTMLButtonElement>('[role="option"]')]; const index = items.indexOf(document.activeElement as HTMLButtonElement); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); } }}>
    <Button type="button" className="office-permission-trigger" ref={trigger} aria-label={'执行权限：' + current.label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} title={current.label + ' · ' + current.description} disabled={disabled} data-permission={value} onClick={() => setOpen(!open)} onKeyDown={event => { if (!open && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setOpen(true); } }}><Icon name={current.icon} size={16} /><span>{current.label}</span><span aria-hidden="true">⌄</span></Button>
    {open && <div className="office-permission-menu" id={id} role="listbox" aria-label="执行权限">{options.map(option => <Button type="button" key={option.value} role="option" aria-selected={value === option.value} disabled={disabled} onClick={() => { OnChange(option.value); Close(); }}><Icon name={option.icon} size={18} /><span><b>{option.label}</b><small>{option.description}</small></span>{value === option.value && <Icon name="check" size={16} />}</Button>)}</div>}
  </div>;
}
