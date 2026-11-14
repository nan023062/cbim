/**
 * 作用定位：展示本地使用模式与已有 GitHub 反馈连接，区分产品账号与外部服务账号。
 * 设计原因：CBIM 尚无云账号服务，不提供虚假登录按钮；外部授权继续走设备授权与安全存储。
 */
import {GitHubFeedbackSettings} from './GitHubFeedbackSettings';
export function AccountSettings(){
  return <>
    <section className="settings-card" aria-label="CBIM 账号"><div className="settings-account"><span className="settings-avatar" aria-hidden="true">C</span><div><h2>本地用户</h2><p>CBIM Assistant · 本地使用</p></div><span className="settings-tag">无需登录</span></div><p>工作区、会话与偏好保存在这台设备上。当前版本尚未提供 CBIM 云账号登录和跨设备同步。</p></section>
    <div className="settings-section-intro"><h2>外部服务连接</h2><p>连接只授予对应服务的能力，不会登录 CBIM 或同步本地工作区。</p></div>
    <GitHubFeedbackSettings/>
  </>;
}
