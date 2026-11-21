/**
 * 作用定位：单选页签与面板，支持方向键、Home/End 和面板活动订阅。
 * 设计原因：页签选择与键盘焦点在组件边界协作，面板通过 Screen 控制可见期订阅。
 */
import { useId, type ReactNode } from 'react';

import { Button } from './controls';

import { Screen } from './screen';

export function Tabs({ label, items, value, onChange }: { label: string; items: readonly { id: string; label: string; content: ReactNode }[]; value: string; onChange(id: string): void })
{
  const group = useId();

  return <div className="ui-tabs"><div role="tablist" aria-label={label}>{items.map((item, index) => <Button key={item.id} role="tab" id={group + '-tab-' + item.id} aria-controls={group + '-panel-' + item.id} aria-selected={value === item.id} tabIndex={value === item.id ? 0 : -1} onClick={() => onChange(item.id)} onKeyDown={event => { const next = { ArrowRight: (index + 1) % items.length, ArrowLeft: (index + items.length - 1) % items.length, Home: 0, End: items.length - 1 }[event.key]; if (next === undefined) return; event.preventDefault(); onChange(items[next].id); document.getElementById(group + '-tab-' + items[next].id)?.focus(); }}>{item.label}</Button>)}</div>
    {items.map(item => <Screen key={item.id} active={value === item.id} role="tabpanel" id={group + '-panel-' + item.id} aria-labelledby={group + '-tab-' + item.id}>{item.content}</Screen>)}</div>;
}
