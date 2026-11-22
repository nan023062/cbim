/**
 * 作用定位：对话输入框及可用 Skill 的斜杠命令补全 React 组件。
 * 设计原因：选择只编辑草稿，提交由父页面负责；命令目录与宿主解析共享规则，避免显示可用而执行越界。
 */
import { Popover, ScrollWindow, Button, Icon, TextArea } from '../../framework-ui';
import { useId, useRef, useState, useEffect } from 'react';

import { ResourceLogo } from '../shared/ResourceLogo';
import { SkillCommands, type AgentConfiguration } from '../../bridge/contracts/discovery';


export function SkillInput({ value, skills, loading, disabled, running, OnChange, OnSubmit, OnRefresh }: { value: string; skills: NonNullable<AgentConfiguration['skills']>; loading: boolean; disabled: boolean; running: boolean; OnChange(text: string): void; OnSubmit(): void; OnRefresh(): void })
{
  const input = useRef<HTMLTextAreaElement>(null);

  const list = useRef<HTMLDivElement>(null);

  const listId = useId();

  const [caret, setCaret] = useState(0);

  const [active, setActive] = useState(0);

  const [dismissed, setDismissed] = useState(false);

  const [focused, setFocused] = useState(false);

  const before = value.slice(0, caret);

  const match = /(?:^|\s)\/([^\s/]*)$/.exec(before);

  const start = match ? caret - match[1].length - 1 : -1;

  const prefix = start < 0 ? '' : value.slice(0, start).trim();

  const prefixIsCommands = !prefix || prefix.split(/\s+/).every(token => token.startsWith('/skill:'));

  const open = focused && !dismissed && !!match && prefixIsCommands;

  const query = (match?.[1] ?? '').replace(/^skill:/, '').toLocaleLowerCase();

  const entries = SkillCommands.List(skills).filter(item => (item.name + ' ' + item.command).toLocaleLowerCase().includes(query));

  const index = Math.min(active, Math.max(0, entries.length - 1));

  useEffect(() => { const container = list.current; const item = container?.querySelector<HTMLElement>('[aria-selected=true]'); if (open && container && item) { const top = item.offsetTop - container.offsetTop; if (top < container.scrollTop) container.scrollTop = top; else if (top + item.offsetHeight > container.scrollTop + container.clientHeight) container.scrollTop = top + item.offsetHeight - container.clientHeight; } }, [open, index]);

  function Choose(command: string)
  {
    if (start < 0)
      return;

    const end = caret + (value.slice(caret).match(/^\S*/)?.[0].length ?? 0);

    const suffix = value.slice(end).replace(/^ /, '');

    const next = value.slice(0, start) + command + ' ' + suffix;

    if (next.length > 32000)
      return;

    OnChange(next);

    setDismissed(true);

    const position = start + command.length + 1;

    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(position, position); setCaret(position); });
  }

  return <div className="skill-input">
    {open && <Popover anchorRef={input} matchWidth className="skill-command-menu"><header><strong>可用 Skills</strong><span>选择后发送才执行</span></header><div {...ScrollWindow.native} ref={list} id={listId} role="listbox" aria-label="可用 Skill 命令">{loading ? <p role="status">正在读取可用清单…</p> : entries.length ? entries.map((entry, i) => <Button type="button" role="option" id={listId + '-' + i} aria-selected={index === i} key={entry.id} tabIndex={-1} onPointerDown={event => event.preventDefault()} onClick={() => Choose(entry.command)} onMouseMove={() => setActive(i)}><ResourceLogo kind="skill" name={entry.name} logo={skills.find(skill => skill.id === entry.id)?.logo} /><span><b>{entry.name}</b><small>{entry.command}</small></span><span className="skill-enter">↵</span></Button>) : <p role="status">{skills.length ? '没有匹配的 Skill' : '暂无可用 Skill，请先在 ＋ → Skills 中配置。'}</p>}</div><footer>↑↓ 选择 · Enter / Tab 补全 · Esc 关闭</footer></Popover>}
    <TextArea ref={input} id="office-message" aria-label="任务目标或补充消息" aria-autocomplete="list" aria-controls={open ? listId : undefined} aria-expanded={open} aria-activedescendant={open && !loading && entries.length ? listId + '-' + index : undefined} placeholder={running ? '输入下一条指令，/ 选择技能…' : '继续聊一聊，/ 选择技能…'} rows={3} maxLength={32000} disabled={disabled} value={value}
      onFocus={() => { setFocused(true); OnRefresh(); }} onBlur={() => setFocused(false)}
      onSelect={event => setCaret(event.currentTarget.selectionStart)}
      onChange={event => { OnChange(event.target.value); setCaret(event.target.selectionStart); setActive(0); setDismissed(false); }}
      onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (open) { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissed(true); return; } if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); if (entries.length) setActive((index + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length); return; } if (event.key === 'Enter' || event.key === 'Tab') { if (!event.shiftKey && !event.ctrlKey && !event.metaKey) { event.preventDefault(); if (!loading && entries[index]) Choose(entries[index].command); return; } } } if (event.key === 'Enter' && !event.shiftKey && !event.altKey) { event.preventDefault(); if (!open && !disabled && value.trim()) OnSubmit(); } }} />
  </div>;
}
