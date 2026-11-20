/** 可变行高的窗口列表，按可视区域测量条目，聊天模式支持跟随末尾及主动归底。 */
import { useRef, useImperativeHandle, type ReactNode, type Ref } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import './ui.css';

export interface ListHandle { scrollToEnd(): void }

export function WindowList({ count, itemKey, render, initialEnd, listRef, label, firstIndex = 0, onStart }: {
  count: number; itemKey(index: number): string; render(index: number): ReactNode; initialEnd?: boolean;
  listRef?: Ref<ListHandle>; label: string; firstIndex?: number; onStart?(): void;
})
{
  const initial = useRef(initialEnd && count ? { index: count - 1, align: 'end' as const } : 0);
  const following = useRef(!!initialEnd);
  const list = useRef<VirtuosoHandle>(null);
  useImperativeHandle(listRef, () => ({ scrollToEnd: () => { following.current = true; list.current?.scrollToIndex({ index: 'LAST', align: 'end' }); } }), []);
  return <Virtuoso ref={list} className="ui-window-list" aria-label={label} role={initialEnd ? 'log' : 'region'} aria-live="off"
    onScroll={event => { const el = event.currentTarget; following.current = !!initialEnd && el.scrollHeight - el.clientHeight - el.scrollTop <= 4; }}
    totalListHeightChanged={() => { if (following.current) list.current?.scrollToIndex({ index: 'LAST', align: 'end' }); }}
    totalCount={count} firstItemIndex={firstIndex} startReached={onStart} increaseViewportBy={400}
    initialTopMostItemIndex={initial.current} followOutput={initialEnd ? 'auto' : false}
    computeItemKey={index => itemKey(index - firstIndex)} itemContent={index => render(index - firstIndex)} />;
}
