import { cloneElement, useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react';

/** Position in the top layer so toolbars, scroll panes and modal dialogs cannot clip hints. */
export function Tooltip({text, children, disabledTrigger}: {text:string; children:ReactElement<{'aria-describedby'?:string}>; disabledTrigger?:boolean}) {
  const id=useId(), anchor=useRef<HTMLSpanElement>(null), tip=useRef<HTMLSpanElement>(null);
  const [hover,setHover]=useState(false),[focus,setFocus]=useState(false),[dismissed,setDismissed]=useState(false);
  const visible=(hover || focus) && !dismissed && Boolean(text);
  useLayoutEffect(()=>{
    const el=tip.current!, trigger=anchor.current!;
    if (!visible) return;
    el.showPopover();
    const place=()=>{const a=trigger.getBoundingClientRect(), t=el.getBoundingClientRect();
      el.style.left=Math.max(4,Math.min(innerWidth-t.width-4,a.left+(a.width-t.width)/2))+'px';
      el.style.top=(a.bottom+6+t.height<=innerHeight-4?a.bottom+6:Math.max(4,a.top-t.height-6))+'px';};
    place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    return ()=>{el.hidePopover();window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[visible,text]);
  return <span ref={anchor} className="ui-tooltip" tabIndex={disabledTrigger?0:undefined} aria-describedby={disabledTrigger?id:undefined}
    onPointerEnter={e=>{if(e.pointerType!=='touch'){setHover(true);setDismissed(false)}}} onPointerLeave={()=>setHover(false)}
    onFocus={()=>{setFocus(true);setDismissed(false)}} onBlur={()=>setFocus(false)}
    onKeyDown={e=>{if(e.key==='Escape'&&visible){e.stopPropagation();e.preventDefault();setDismissed(true)}}}>
    {cloneElement(children,{'aria-describedby':[children.props['aria-describedby'],id].filter(Boolean).join(' ')})}
    <span ref={tip} id={id} role="tooltip" popover="manual">{text}</span>
  </span>;
}
