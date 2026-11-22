/** 当前对话的内联审批；重新打开对话时从宿主恢复尚未处理的请求。 */
import { Button, Disclosure, DisclosureSummary } from '../../framework-ui';
import { useEffect, useState } from 'react';
import type { PendingOfficeApproval, OfficeApprovalChoice } from '../../bridge/contracts/discovery';

export function OfficeApprovalCards({ project, session }: { project: string; session: string }) {
  const [rows, setRows] = useState<PendingOfficeApproval[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true, timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const items = await window.desktopMenu.OfficeApprovals(project, session);
        if (live) setRows(prior => prior.length === items.length && prior.every((row, i) => row.id === items[i].id) ? prior : items);
      } catch (e) { if (live) setError(String(e)); }
      finally { if (live) timer = setTimeout(refresh, 700); }
    }
    void refresh();
    return () => { live = false; clearTimeout(timer); };
  }, [project, session]);

  async function decide(id: string, choice: OfficeApprovalChoice) {
    setBusy(id); setError('');
    try {
      await window.desktopMenu.DecideOfficeApproval(project, session, id, choice);
      setRows(items => items.filter(row => row.id !== id));
    } catch (e) { setError(String(e)); }
    finally { setBusy(''); }
  }
  return <>{error && <small role="alert">{error}</small>}{!!rows.length && <section className="office-approvals" aria-label="待确认操作">
    {rows.map(row => <article key={row.id}>
      <strong role="status">等待你确认 · {row.tool}</strong>
      <div>工作目录：{row.root}</div>
      <Disclosure><DisclosureSummary>查看操作参数</DisclosureSummary><pre>{row.detail}</pre></Disclosure>
      <div>始终允许的范围：{row.scope}，仅限本机的这条对话。</div>
      <footer>{([['deny','拒绝'], ['once','仅允许本次'], ['always','此对话始终允许']] as const).map(([choice,label]) =>
        <Button key={choice} disabled={!!busy} onClick={() => void decide(row.id,choice)}>{label}</Button>)}</footer>
    </article>)}
  </section>}</>;
}
