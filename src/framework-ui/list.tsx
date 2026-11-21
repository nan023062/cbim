/**
 * 作用定位：可变行高的窗口列表，按可视区域测量条目，聊天模式支持跟随末尾及主动归底。
 * 设计原因：虚拟列表只管理可视条目和滚动位置，历史数据及任务生命周期由上层持有。
 */
import { useRef, useImperativeHandle, type ReactNode, type Ref } from 'react';

import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';

import './ui.css';

export interface ListHandle
{
  scrollToRow(index: number): void

  scrollToEnd(): void
}

export function WindowList({ count, itemKey, render, initialEnd, listRef, label, firstIndex = 0, scrollbarVisible, onStart }: { count: number; itemKey(index: number): string; render(index: number): ReactNode; initialEnd?: boolean; listRef?: Ref<ListHandle>; label: string; firstIndex?: number; scrollbarVisible?: boolean; onStart?(): void; })
{
  const initial = useRef(initialEnd && count ? { index: count - 1, align: 'end' as const } : 0);

  const following = useRef(!!initialEnd);

  const list = useRef<VirtuosoHandle>(null);

  useImperativeHandle(listRef, () => ({ scrollToRow: index => { following.current = false; list.current?.scrollToIndex({ index, align: 'start' }); }, scrollToEnd: () => { following.current = true; list.current?.scrollToIndex({ index: 'LAST', align: 'end' }); } }), []);

  return <Virtuoso ref={list} className="ui-window-list" data-ui-scrollbar-fade={scrollbarVisible} aria-label={label} role={initialEnd ? 'log' : 'region'} aria-live="off"
    onScroll={event => { const el = event.currentTarget; following.current = !!initialEnd && el.scrollHeight - el.clientHeight - el.scrollTop <= 4; }}
    totalListHeightChanged={() => { if (following.current) list.current?.scrollToIndex({ index: 'LAST', align: 'end' }); }}
    totalCount={count} firstItemIndex={firstIndex} startReached={onStart} increaseViewportBy={400}
    initialTopMostItemIndex={initial.current} followOutput={initialEnd ? 'auto' : false}
    computeItemKey={index => itemKey(index - firstIndex)} itemContent={index => render(index - firstIndex)} />;
}
