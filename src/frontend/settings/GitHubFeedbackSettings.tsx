/**
 * 作用定位：设置页的 GitHub 反馈连接入口，展示设备授权码及固定目标仓库。
 * 设计原因：预置公开产品连接并折叠维护者配置；一次明确连接即可授权两项 Skill 自动提交，页面只轮询授权状态，不展示反馈结果或处理进度。
 */
import {useEffect,useState} from 'react';
import type {GitHubFeedbackStatus} from '../../bridge/contracts/github-feedback';
const api=window.cbim;
/** 页面卸载停止轮询；返回设置后从后端恢复仍有效的授权会话，设备码不会触发自动外跳。 */
export function GitHubFeedbackSettings(){
  const [status,setStatus]=useState<GitHubFeedbackStatus>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [clientId,setClientId]=useState(''),[owner,setOwner]=useState('nan023062'),[repo,setRepo]=useState('cbim'),[visibility,setVisibility]=useState<'public'|'private'>('public');
  useEffect(()=>{let live=true;void api.call('github.feedback.status').then((value:GitHubFeedbackStatus)=>{if(live){setStatus(value);setClientId(value.config.clientId);setOwner(value.config.owner);setRepo(value.config.repo);setVisibility(value.config.visibility)}}).catch((e:Error)=>{if(live)setError(e.message)});return()=>{live=false}},[]);
  useEffect(()=>{
    if(!status?.flow||busy)return;let live=true;const flow=status.flow;
    const timer=setTimeout(()=>{void api.call('github.feedback.poll',{flowId:flow.id}).then((value:GitHubFeedbackStatus)=>{if(live){setStatus(value);setError('')}}).catch((e:Error)=>{if(live){setStatus(value=>value?{...value,flow:undefined}:value);setError(e.message)}})},Math.max(250,flow.nextPollAt-Date.now()));
    return()=>{live=false;clearTimeout(timer)};
  },[status,busy]);
  async function change(action:'begin'|'cancel'|'disconnect'){
    setBusy(true);setError('');try{setStatus(await api.call(`github.feedback.${action}`,action==='begin'?{clientId:clientId.trim(),owner:owner.trim(),repo:repo.trim(),visibility,autoSubmit:true}:{}))}catch(e:any){setError(e.message)}finally{setBusy(false)}
  }
  const locked=busy||!!status?.flow||!!status?.connected;
  return <section className="repository-settings" aria-label="GitHub 反馈连接"><h2>GitHub 反馈</h2>
    <p>「BUG 反馈」「需求许愿」按你填写的上下文直接创建 Issue，成功后不追加结果消息或处理进度。</p>
    {error&&<p className="shell-alert" role="alert">{error}</p>}
    {!status?<p>正在读取 GitHub 设置…</p>:<>
      {status.connected?<><p>已连接 {status.connected.login} · {status.connected.owner}/{status.connected.repo}</p><p>已允许反馈 Skill 自动提交到此仓库。只读会话仍不能提交。</p><button disabled={busy} onClick={()=>void change('disconnect')}>断开 GitHub 连接</button><p>断开仅移除本机连接；网站上的 OAuth 授权可在 GitHub 设置中撤销。</p></>:<>
        <p>已预置 CBIM 官方反馈连接，点击下方按钮授权自己的 GitHub 账号即可。</p>
        <details><summary>高级连接设置</summary>
        <label>公开 Client ID<input aria-label="GitHub Client ID" value={clientId} disabled={locked} onChange={e=>setClientId(e.target.value)} autoComplete="off"/></label>
        <label>仓库所有者<input aria-label="GitHub 仓库所有者" value={owner} disabled={locked} onChange={e=>setOwner(e.target.value)}/></label>
        <label>仓库名<input aria-label="GitHub 仓库名" value={repo} disabled={locked} onChange={e=>setRepo(e.target.value)}/></label>
        <label>仓库可见性<select aria-label="GitHub 仓库可见性" value={visibility} disabled={locked} onChange={e=>setVisibility(e.target.value as 'public'|'private')}><option value="public">公开仓库（public_repo 权限）</option><option value="private">私有仓库（repo 权限）</option></select></label>
        </details>
        <p>反馈目标：{owner}/{repo}</p>
        {visibility==='public'?<p>提交的内容会公开在此 GitHub 仓库。请只填写愿意公开的上下文。</p>:<p>GitHub OAuth 的 repo 权限覆盖账号可访问的私有仓库；CBIM 的反馈工具只向上面明确连接的仓库提交。</p>}
        {!status.secureStorage&&<p role="alert">系统安全存储不可用，暂不能连接 GitHub。</p>}
        {status.flow?<><p>在 GitHub 登录页输入授权码：<strong>{status.flow.userCode}</strong></p><button disabled={busy} onClick={()=>void api.call('github.feedback.openLogin').catch((e:Error)=>setError(e.message))}>打开 GitHub 授权页</button><button disabled={busy} onClick={()=>void change('cancel')}>取消授权</button><p>等待授权；授权码过期后需重新连接。</p></>:<button className="solid-button" disabled={busy||!status.secureStorage||!clientId.trim()||!owner.trim()||!repo.trim()} onClick={()=>void change('begin')}>连接并允许反馈自动提交</button>}
      </>}
    </>}
  </section>;
}
