/**
 * 作用定位：多个资源入口订阅同一个宿主队列，离开页面只清理订阅。
 * 设计原因：同一宿主下载队列可被多个页面观察，订阅取消不停止下载，刷新代次避免迟到快照覆盖。
 */
import { useEffect, useState } from 'react';

import type { TransferState } from '../../bridge/contracts/discovery';

export function useTransfers()
{
  const [items, setItems] = useState<TransferState[]>([]);

  useEffect(() => { let sequence = 0; const refresh = () => { const request = ++sequence; void window.desktopMenu.Transfers().then(values => { if (request === sequence) setItems(values); }).catch(() => { }); }; const off = window.desktopMenu.WatchTransfers(refresh); refresh(); return () => { sequence++; off(); }; }, []);

  return items;
}

export function TransferProgress({ item }: { item: TransferState })
{
  const [error, setError] = useState('');

  const percent = Math.floor(item.bytes / item.total * 100);

  return <span role="status">{{ queued: '排队中', downloading: '下载中', verifying: '校验中' }[item.phase]} {percent}%
    <button type="button" onClick={() => void window.desktopMenu.CancelTransfer(item.identity).catch(e => setError(String(e)))}>取消下载</button>{error}</span>;
}
