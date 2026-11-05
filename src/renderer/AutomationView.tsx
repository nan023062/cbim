import React from 'react';
import type {Snapshot,WorkspaceView} from '../shared/types';

export function AutomationView({workspace,snapshot}:{workspace:WorkspaceView;snapshot?:Snapshot}){
  const workflows=snapshot?.workspaceId===workspace.id?snapshot.files.filter(f=>f.path.endsWith('/workflow.md')):[];
  return <div className="view-page workspace-automation" data-workspace-id={workspace.id}>
    <div className="view-heading"><div><p className="overline">{workspace.name} / 团队工作流</p><h1>自动化</h1><p>当前工作区内，多工种团队协作的工作流。</p></div></div>
    <div className="inline-note">当前可查看工作流定义；定时触发与自动执行尚未接入。</div>
    {workspace.state!=='running'?<p>打开此工作区后加载自动化定义。</p>:!snapshot?<p>正在读取工作区知识…</p>:!workflows.length?<div className="view-empty"><h2>此工作区尚未定义工作流</h2><p>团队的模块 Workflow 将显示在这里。</p></div>:<div className="definition-grid">{workflows.map(f=><article className="definition-card" key={f.path}><h3>{f.text.match(/^#\s+(.+)/m)?.[1]||f.path.split('/').at(-2)}</h3><p>{f.path}</p><span className="subtle-badge">工作流定义</span></article>)}</div>}
  </div>
}
