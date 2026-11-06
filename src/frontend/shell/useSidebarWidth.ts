/**
 * 作用定位：管理侧边栏宽度、拖动与键盘调整，并在本地保留布局。
 * 设计原因：参照 Cindy 的 260px 默认宽度和 4px 拖动边缘；不改变工作区选中或服务状态。
 */
import {useEffect,useState,type PointerEvent,type KeyboardEvent} from 'react';
const clamp=(width:number)=>Math.max(200,Math.min(420,width));
export function useSidebarWidth(){
  const [width,setWidth]=useState(()=>{try{const value=Number(localStorage.getItem('cbim.sidebar.width'));return value>=200&&value<=420?value:260}catch{return 260}});
  useEffect(()=>{try{localStorage.setItem('cbim.sidebar.width',String(width))}catch{/* 布局不可持久化时仍保留当前会话宽度 */}},[width]);
  return {width,handle:{role:'separator',tabIndex:0,'aria-label':'调整侧边栏宽度','aria-orientation':'vertical' as const,'aria-valuemin':200,'aria-valuemax':420,'aria-valuenow':width,
    onPointerDown:(e:PointerEvent<HTMLDivElement>)=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId)},
    onPointerMove:(e:PointerEvent<HTMLDivElement>)=>{if(e.currentTarget.hasPointerCapture(e.pointerId))setWidth(clamp(e.clientX))},
    onPointerUp:(e:PointerEvent<HTMLDivElement>)=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)},
    onDoubleClick:()=>setWidth(260),onKeyDown:(e:KeyboardEvent<HTMLDivElement>)=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();setWidth(w=>clamp(w+(e.key==='ArrowRight'?10:-10)))}else if(e.key==='Home'){e.preventDefault();setWidth(260)}},
  }};
}
