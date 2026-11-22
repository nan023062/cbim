import { useId, useState, type ReactNode } from 'react';

/** 触发元素持有焦点；仅跟踪悬停、焦点及 Escape 收起。 */
export function Tooltip({ text, children }: { readonly text:string; readonly children:ReactNode }) {
  const id=useId();
  const [hover,setHover]=useState(false),[focus,setFocus]=useState(false),[dismissed,setDismissed]=useState(false);
  return <span className="ui-tooltip" aria-describedby={id}
    onMouseEnter={()=>{setHover(true);setDismissed(false)}} onMouseLeave={()=>setHover(false)}
    onFocus={()=>{setFocus(true);setDismissed(false)}} onBlur={()=>setFocus(false)}
    onKeyDown={e=>{if(e.key==='Escape')setDismissed(true)}}>
    {children}<span id={id} role="tooltip" hidden={dismissed||(!hover&&!focus)}>{text}</span>
  </span>;
}
