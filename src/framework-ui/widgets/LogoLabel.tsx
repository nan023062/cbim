import { useState } from 'react';
import { Icon } from '../icons/Icon';
import type { LogoLabelData } from './logo-label-data';

export interface LogoLabelProps<Id extends string = string> {
  readonly data: LogoLabelData<Id>;
  readonly onActivate?: (id: Id) => void;
}

function Mark({logo}: Pick<LogoLabelData,'logo'>) {
  const [state, setState] = useState<'loading'|'ready'|'failed'>('loading');
  return <span className="resource-logo" aria-hidden="true">
    {state !== 'ready' && <Icon name={logo.fallbackIcon} size={20}/>}
    {logo.src && state !== 'failed' && <img alt="" src={logo.src} style={{visibility:state==='ready'?'visible':'hidden'}}
      onError={()=>setState('failed')} onLoad={e=>{void e.currentTarget.decode().then(()=>setState('ready'),()=>setState('failed'));}}/>}
  </span>;
}

export function LogoLabel<Id extends string>({data,onActivate}: LogoLabelProps<Id>) {
  const tip=data.disabledReason || data.tooltip;
  const contents=<><Mark key={data.logo.src} logo={data.logo}/><span>{data.name}</span></>;
  if(!onActivate)return <span className="logo-label" title={tip}>{contents}</span>;
  return <button type="button" className="logo-label" data-tip={tip} title={tip} aria-label={data.name}
    aria-current={data.selected || undefined} aria-disabled={!!data.disabledReason}
    onClick={()=>{if(!data.disabledReason)onActivate(data.id)}}>{contents}</button>;
}
