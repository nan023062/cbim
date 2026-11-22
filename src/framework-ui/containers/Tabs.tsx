/**
 * 作用定位：单选页签与面板，支持方向键、Home/End 和面板活动订阅。
 * 设计原因：页签选择与键盘焦点在组件边界协作，面板通过 Screen 控制可见期订阅。
 */
import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { Button } from '../widgets/Button';

import { Screen } from './Panel';

import { nextFocusIndex } from '../interaction/GraphSystem';

export function Tabs({ label, items, value, onChange }: { label: string; items: readonly { id: string; label: ReactNode; content: ReactNode; buttonProps?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled' | 'role' | 'id' | 'tabIndex'> }[]; value: string; onChange: (id: string) => void })
{
  const group = useId();

  return <div className="ui-tabs"><div role="tablist" aria-label={label}>{items.map((item, index) => <Button {...item.buttonProps} key={item.id} role="tab" id={group + '-tab-' + item.id} aria-controls={group + '-panel-' + item.id} aria-selected={value === item.id} tabIndex={value === item.id ? 0 : -1} onClick={event => { item.buttonProps?.onClick?.(event); if (!event.defaultPrevented) onChange(item.id); }} onKeyDown={event => { item.buttonProps?.onKeyDown?.(event); if (event.defaultPrevented) return; const next = nextFocusIndex(event.key, index, items.length); if (next === undefined) return; event.preventDefault(); onChange(items[next].id); document.getElementById(group + '-tab-' + items[next].id)?.focus(); }}>{item.label}</Button>)}</div>
    {items.map(item => <Screen key={item.id} active={value === item.id} role="tabpanel" id={group + '-panel-' + item.id} aria-labelledby={group + '-tab-' + item.id}>{item.content}</Screen>)}</div>;
}
