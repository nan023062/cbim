/**
 * 作用定位：侧栏用户栏右侧的更新图标，提供版本 tooltip、真实准备进度和显式安装操作。
 * 设计原因：入口常驻而不占用菜单；未就绪时仍可键盘聚焦查看状态，但不会下载、排队或安装。
 * 生命周期：tooltip 使用视口内的独立浮层；完整进度与呼吸提示只属于已验证的 ready 快照。
 * 仅展示 CBIM 应用更新；引擎的准备、失败和管理统一归引擎详情。
 */
import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from '../components/Icon';
import type {SoftwareUpdateController} from './useSoftwareUpdates';
import {updateButtonState} from './update-button-state';
import './software-updates.css';

/** 点击是用户对已准备候选的安装授权；重复操作还会被 controller 与后端状态机拒绝。 */
export function SoftwareUpdateButton({updates}:{updates:SoftwareUpdateController}){
  const button=useRef<HTMLButtonElement>(null),id=useId();
  const [open,setOpen]=useState(false),[position,setPosition]=useState({left:12,bottom:52});
  const view=updateButtonState(updates.status,updates.pending,updates.error);
  useEffect(()=>{
    if(!open)return;
    const place=()=>{const rect=button.current?.getBoundingClientRect();if(!rect)return;
      const width=Math.min(280,window.innerWidth-24);
      setPosition({left:Math.max(12,Math.min(rect.right-width,window.innerWidth-width-12)),bottom:window.innerHeight-rect.top+8});
    };
    place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true)};
  },[open]);
  return <span className="software-update-anchor" onPointerEnter={()=>setOpen(true)} onPointerLeave={()=>setOpen(false)}>
    <button ref={button} className={'icon-button software-update-button'+(view.ready?' is-ready':'')+(view.active?' is-active':'')}
      aria-label="版本与更新" aria-describedby={open?id:undefined} aria-disabled={!view.canInstall} aria-busy={view.active||updates.pending}
      onFocus={()=>setOpen(true)} onBlur={()=>setOpen(false)} onKeyDown={event=>{if(event.key==='Escape'){setOpen(false);event.stopPropagation()}}}
      onClick={()=>{if(view.canInstall)void updates.act('install')}}>
      <Icon name="arrow" size={16}/>
      {(view.active||view.ready)&&<svg className={'software-update-ring'+(view.progress===undefined?' is-indeterminate':'')} viewBox="0 0 36 36"
        role="progressbar" aria-label="更新准备进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.progress}>
        <circle className="software-update-track" cx="18" cy="18" r="16"/>
        <circle className="software-update-value" cx="18" cy="18" r="16" pathLength="100" strokeDasharray={view.progress===undefined?'25 75':'100'} strokeDashoffset={view.progress===undefined?0:100-view.progress}/>
      </svg>}
    </button>
    {open&&createPortal(<div id={id} role="tooltip" className="software-update-tooltip" style={position}>
      <strong>{view.current}</strong><span>{view.target}</span><span>{view.description}</span>
      {view.ready&&<small>会结束当前任务并重启，请先保存未提交的编辑。</small>}
      {view.error&&<span className="software-update-tooltip-error">{view.error}</span>}
    </div>,document.body)}
  </span>;
}
