/**
 * 作用定位：将对话轮次映射到列表行，提供定位与预览。
 * 设计原因：旧轮次仅在预览时读取，浏览历史不会改变任务状态。
 */
import { useEffect, useId, useState } from 'react';

import type { OfficeMessage } from '../../bridge/contracts/discovery';

// A half cosine has zero slope at both the peak and the edge of the wave.
function markerScale(distance: number): number
{
  const phase = Math.min(Math.abs(distance) / 5, 1) * Math.PI;

  return 0.2 + 0.4 * (1 + Math.cos(phase));
}

export function TurnRail({ project, session, earlier, messages, row, jump, live }: { project: string; session: string; earlier: string[]; messages: OfficeMessage[]; row: number; jump(index: number): void; live?: { text: string; result: string } })
{
  const marks = earlier.map((file, index) => ({ file, index, text: '', result: '' }));
  for (const [i, message] of messages.entries())
  {
    if (message.role === 'user') marks.push({ file: '', index: earlier.length + i, text: message.text, result: '' });
    else if (marks.length && !marks[marks.length - 1].file) marks[marks.length - 1].result = message.text;
  }
  if (live) marks.push({ file: '', index: earlier.length + messages.length, ...live });

  const [hover, setHover] = useState<{ i: number; top: number }>();
  const [archive, setArchive] = useState<{ file: string; text: string; result: string }>();
  const tipId = useId();
  const mark = hover && marks[hover.i];
  const file = mark?.file;
  useEffect(() => { if (!file) return; let current = true; window.desktopMenu.ReadOfficeTurn(project, session, file).then(rows => { if (current) setArchive({ file, text: rows.find(r => r.role === 'user')?.text ?? '', result: rows.filter(r => r.role === 'assistant').map(r => r.text).join('\n') }); }).catch(() => { if (current) setArchive({ file, text: '无法读取历史任务', result: '' }); }); return () => { current = false; }; }, [project, session, file]);
  const preview = file ? archive?.file === file ? archive : undefined : mark;
  const active = marks.reduce((last, m, i) => m.index <= row ? i : last, 0);
  function Show(i: number, button: HTMLButtonElement)
  {
    const container = button.closest('.office-transcript')!.getBoundingClientRect();
    setHover({ i, top: Math.max(4, Math.min(container.height - 104, button.getBoundingClientRect().top - container.top - 38)) });
  }
  if (!marks.length) return null;
  return <><nav className="turn-rail" aria-label="历史任务定位" onMouseLeave={() => setHover(undefined)} onBlur={() => setHover(undefined)} onScroll={() => setHover(undefined)} onKeyDown={e => { if (e.key === 'Escape') setHover(undefined); }}>
    {marks.map((m, i) => <button key={m.file || m.index} type="button" aria-label={'定位第 ' + (i + 1) + ' 个任务'} aria-current={i === active ? 'location' : undefined} aria-describedby={i === hover?.i ? tipId : undefined} onMouseEnter={e => Show(i, e.currentTarget)} onFocus={e => Show(i, e.currentTarget)} onClick={() => jump(m.index)}><i data-motion="turn" style={{ transform: 'scaleX(' + (hover ? markerScale(i - hover.i) : i === active ? 0.65 : 0.23) + ')' }} /></button>)}
  </nav>{mark && hover && <div className="turn-preview" data-motion="popup" id={tipId} role="tooltip" style={{ top: hover.top }}><strong>{preview?.text || (file ? '正在读取历史任务…' : '任务')}</strong><span>{preview ? preview.result || '暂无执行结果' : ''}</span></div>}</>;
}
