/**
 * 作用定位：设置页的已安装引擎总览，按官方清单展示当前版本、启停和实时运行占用。
 * 设计原因：复用 EngineSettings 的只读快照与轮询；本组件只负责展示和详情导航，不创建下载或安装状态。
 * 状态边界：active 表示当前安装选择；installed 中的历史缓存不等于仍安装。references 是引擎运行引用数，包含依赖占用，不等于任务数。
 */
import {supportedEngines,type LoopEngine,type EnginePackageSettings} from '../../bridge/contracts/engines';

/** 选择条目只切换详情；准备、失败和运行可同时存在，不能互相覆盖或据此启动引擎。 */
export function EngineOverview({state,onSelect}:{state?:EnginePackageSettings;onSelect:(kind:LoopEngine)=>void}){
  if(!state)return null;
  if(!state.managed)return <p>源码开发模式：当前使用源码引擎，正式包管理在安装版中可用。</p>;
  const installed=supportedEngines.flatMap(descriptor=>{
    const item=state.items.find(item=>item.kind===descriptor.id);
    return item?.active?[{descriptor,item,active:item.active}]:[];
  });
  return <section className="engine-overview" aria-label="全部引擎总览">
    <h2>已安装引擎 · {installed.length}</h2>
    {!installed.length?<p>尚未安装引擎，请在上方选择引擎查看详情。</p>:<ul className="engine-overview-list">
      {installed.map(({descriptor,item,active})=><li key={descriptor.id}>
        <button type="button" className="engine-overview-item" aria-label={'查看 '+descriptor.label+' 引擎详情'} onClick={()=>onSelect(descriptor.id)}>
          <strong>{descriptor.label}</strong>
          <span className="engine-overview-version"><span>当前版本 {active.version}</span><small>运行库 {active.nativeVersion}</small></span>
          <span className="engine-overview-state">
            <span>{item.enabled?'已启用':'已停用'}</span>
            <span>{item.references>0?'运行中 · '+item.references+' 个占用':item.preparing?'准备中':item.error?'异常':item.enabled?'空闲':'未运行'}</span>
            {item.preparing&&item.references>0&&<span>准备中</span>}
            {item.preparation?.progress!==undefined&&<small>准备进度 {Math.round(item.preparation.progress)}%</small>}
          </span>
          {item.error&&<span className="engine-overview-error">异常：{item.error}</span>}
        </button>
      </li>)}
    </ul>}
  </section>;
}
