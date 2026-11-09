/**
 * 作用定位：业务图与团队树共用的局部展开、折叠和字号图标操作。
 * 设计原因：只接收视图回调，不读取或修改业务状态；按钮保留可访问名称与边界禁用，窄栏可自然换行到图内右侧。
 */
import {Icon} from './Icon';
import './graph-view-controls.css';
/** zoom 是显示像素，仅限制本次视图；回调不提交知识或执行操作。 */
export function GraphViewControls({label,smallerLabel,largerLabel,zoom,onZoom,onExpand,onCollapse}:{label:string;smallerLabel:string;largerLabel:string;zoom:number;onZoom:(value:number)=>void;onExpand:()=>void;onCollapse:()=>void}){
  return <div className="graph-view-controls" role="group" aria-label={label}>
    <button title="全部展开" aria-label="全部展开" onClick={onExpand}><Icon name="expand" size={17}/></button>
    <button title="全部折叠" aria-label="全部折叠" onClick={onCollapse}><Icon name="collapse" size={17}/></button>
    <button title={smallerLabel} aria-label={smallerLabel} disabled={zoom<=12} onClick={()=>onZoom(Math.max(12,zoom-1))}><Icon name="text-minus" size={17}/></button>
    <button title={largerLabel} aria-label={largerLabel} disabled={zoom>=20} onClick={()=>onZoom(Math.min(20,zoom+1))}><Icon name="text-plus" size={17}/></button>
  </div>;
}
