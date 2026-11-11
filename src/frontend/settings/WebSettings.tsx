/**
 * 作用定位：桌面网页搜索配置，保存 Brave 开关与密钥。
 * 设计原因：密钥输入仅发送给本机安全存储，保存后清空；界面只展示已配置状态，冲突需重新读取。
 */
import {useEffect,useState} from 'react';
import type {SettingsIpcResponses} from '../../bridge/contracts/ipc-settings';
const api=window.cbim;
export function WebSettings(){
  const [settings,setSettings]=useState<SettingsIpcResponses['web.settings']>(),[enabled,setEnabled]=useState(false),[key,setKey]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  function accept(value:SettingsIpcResponses['web.settings']){setSettings(value);setEnabled(value.enabled)}
  useEffect(()=>{let live=true;void api.call('web.settings').then(value=>{if(live)accept(value)}).catch((error:Error)=>{if(live)setMessage(error.message)});return()=>{live=false}},[]);
  async function save(clearKey=false){
    if(!settings)return;setBusy(true);setMessage('');
    try{accept(await api.call('web.configure',{revision:settings.revision,enabled:clearKey?false:enabled,clearKey,apiKey:!clearKey&&key.trim()?key.trim():undefined}));setKey('');setMessage(clearKey?'密钥已移除，搜索已关闭。':'搜索设置已保存。')}
    catch(error){setMessage(error instanceof Error?error.message:String(error));try{accept(await api.call('web.settings'))}catch{}}
    finally{setBusy(false)}
  }
  return <section className="repository-settings"><h2>网页与搜索</h2><p>主 Agent 可读取公开网页。搜索使用 Brave Search API，查询词会发送至该服务；不共享登录 Cookie。</p>
    {!settings?<p role="status">{message||'正在读取搜索设置…'}</p>:<>
      <label><input type="checkbox" checked={enabled} disabled={busy} onChange={event=>setEnabled(event.target.checked)}/>启用 Brave 网页搜索</label>
      <label>API 密钥<input type="password" autoComplete="off" value={key} disabled={busy||!settings.secureStorage} placeholder={settings.hasKey?'已保存；留空保留':'Brave Search API key'} onChange={event=>setKey(event.target.value)}/></label>
      {!settings.secureStorage&&<p>系统安全存储不可用，不能保存或使用密钥。</p>}
      <button disabled={busy||enabled&&!settings.hasKey&&!key.trim()} onClick={()=>void save()}>保存搜索设置</button>
      {settings.hasKey&&<button disabled={busy} onClick={()=>void save(true)}>移除密钥并关闭</button>}
      {message&&<p role="status">{message}</p>}
    </>}
  </section>;
}
