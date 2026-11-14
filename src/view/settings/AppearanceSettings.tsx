/**
 * 作用定位：设置中心的主题、阅读字号与动效偏好，消费外壳唯一的外观控制器。
 * 设计原因：修改即时预览并保存到本机；明确字号作用范围，恢复默认只影响外观。
 */
import {Icon} from '../components/Icon';
import type {AppearanceController} from './useAppearance';
import type {AppearancePreferences,ThemePreference} from './appearance-state';
export function AppearanceSettings({appearance}:{appearance:AppearanceController}){
  const {value,update,error}=appearance;
  return <>
    <section className="settings-card" aria-labelledby="appearance-theme"><h2 id="appearance-theme">显示模式</h2><p>为工作空间选择舒适的配色。</p>
      <div className="theme-options" role="group" aria-label="显示模式">{([{id:'light',label:'浅色',icon:'sun'},{id:'dark',label:'深色',icon:'moon'},{id:'system',label:'跟随系统',icon:'settings'}] as const).map(item=><button key={item.id} type="button" className="theme-option" aria-pressed={value.theme===item.id} onClick={()=>update({theme:item.id as ThemePreference})}><span className={'theme-miniature theme-miniature-'+item.id} aria-hidden="true"><span/><span><i/><i/><i/></span></span><span><Icon name={item.icon} size={16}/>{item.label}{value.theme===item.id&&<Icon name="check" size={14}/>}</span></button>)}</div>
      <p className="settings-hint">{value.theme==='system'?`跟随系统，当前为${appearance.resolvedTheme==='dark'?'深色':'浅色'}。`:'也可以从左下角用户菜单快速切换深浅模式。'}</p>
    </section>
    <section className="settings-card" aria-labelledby="appearance-reading"><h2 id="appearance-reading">阅读体验</h2>
      <div className="settings-row"><div><label htmlFor="appearance-text">对话正文字号</label><p>调整用户消息和 Agent 回复，菜单字号保持不变。</p></div><select id="appearance-text" value={value.textSize} onChange={e=>update({textSize:Number(e.target.value) as AppearancePreferences['textSize']})}><option value={13}>紧凑 · 13 px</option><option value={15}>默认 · 15 px</option><option value={17}>大字 · 17 px</option></select></div>
      <div className="settings-row"><div><label htmlFor="appearance-code">代码块字号</label><p>调整对话中的代码块，不影响行内代码和工具日志。</p></div><select id="appearance-code" value={value.codeSize} onChange={e=>update({codeSize:Number(e.target.value) as AppearancePreferences['codeSize']})}><option value={12}>默认 · 12 px</option><option value={14}>中号 · 14 px</option><option value={16}>大字 · 16 px</option></select></div>
      <div className="appearance-reading-preview" aria-label="阅读效果预览"><span>预览</span><p>把目标交给团队，让每一次协作都有清晰的进展。</p><pre><code>{'const team = "CBIM";\nawait teamWork(goal);'}</code></pre></div>
    </section>
    <section className="settings-card" aria-labelledby="appearance-motion"><h2 id="appearance-motion">动态效果</h2><div className="settings-row"><div><label htmlFor="appearance-motion-switch">减少动态效果</label><p>停用界面动画与过渡。关闭此项时，仍尊重系统的减少动态效果设置。</p></div><input id="appearance-motion-switch" type="checkbox" role="switch" checked={value.reduceMotion} onChange={e=>update({reduceMotion:e.target.checked})}/></div></section>
    {error?<div className="settings-message" role="alert"><p>{error}</p><button onClick={appearance.retry}>重试保存外观</button></div>:<p className="settings-hint">外观偏好自动保存在这台设备上。</p>}
    <button className="settings-reset" onClick={appearance.reset}>恢复默认外观</button>
  </>;
}
