import { cloneElement, useId, useState, type ReactElement } from 'react';

/** 触发元素持有焦点；仅跟踪悬停、焦点及 Escape 收起。 */
export function Tooltip({ text, children }: { readonly text:string; readonly children:ReactElement<{ "aria-describedby"?: string }> }) {
  const id=useId();
  const [hover,setHover]=useState(false),[focus,setFocus]=useState(false),[dismissed,setDismissed]=useState(false);
  return <span className="ui-tooltip"
    onPointerEnter={()=>{setHover(true);setDismissed(false)}} onPointerLeave={()=>setHover(false)}
    onFocus={()=>{setFocus(true);setDismissed(false)}} onBlur={()=>setFocus(false)}
    onKeyDown={e=>{if(e.key==='Escape')setDismissed(true)}}>
    {cloneElement(children, { "aria-describedby": [children.props["aria-describedby"], id].filter(Boolean).join(" ") })}<span id={id} role="tooltip" hidden={dismissed||(!hover&&!focus)}>{text}</span>
  </span>;
}
