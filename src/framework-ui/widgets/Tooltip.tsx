import { Popover } from '../containers/Popover';
import { cloneElement, useId, useRef, useState, type ReactElement } from 'react';

/** Position in the top layer so toolbars, scroll panes and modal dialogs cannot clip hints. */
export function Tooltip({text, children, disabledTrigger}: {text:string; children:ReactElement<{'aria-describedby'?:string}>; disabledTrigger?:boolean}) {
  const id=useId(), anchor=useRef<HTMLSpanElement>(null);
  const [hover,setHover]=useState(false),[focus,setFocus]=useState(false),[dismissed,setDismissed]=useState(false);
  const visible=(hover || focus) && !dismissed && Boolean(text);
  return <span ref={anchor} className="ui-tooltip" tabIndex={disabledTrigger?0:undefined} aria-describedby={disabledTrigger?id:undefined}
    onPointerEnter={e=>{if(e.pointerType!=='touch'){setHover(true);setDismissed(false)}}} onPointerLeave={()=>setHover(false)}
    onFocus={()=>{setFocus(true);setDismissed(false)}} onBlur={()=>setFocus(false)}
    onKeyDown={e=>{if(e.key==='Escape'&&visible){const menu=(e.target as HTMLButtonElement).popoverTargetElement; if (!menu?.matches(':popover-open')) {e.stopPropagation();e.preventDefault();} setDismissed(true)}}}>
    {cloneElement(children,{'aria-describedby':[children.props['aria-describedby'],id].filter(Boolean).join(' ')})}
    {visible && <Popover as="span" anchorRef={anchor} id={id} role="tooltip">{text}</Popover>}
  </span>;
}
