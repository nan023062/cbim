import { Button, FieldLabel, Icon, Input, type IconName } from '../../framework-ui';
import { useRef, useState } from 'react';

type LogoProps = { kind: 'skill' | 'workflow'; logo?: string; name: string };

/** Decode failures affect only the current image. Fallbacks follow the desktop text theme. */
export function ResourceLogo(props: LogoProps)
{
  const label = props.name + (props.kind === 'skill' ? '技能图标' : '工作流图标');
  const logo = /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/]+=*$/i.test(props.logo ?? '') ? props.logo : undefined;
  return <LogoFrame key={logo} data={{name:label,logo}} fallback={props.kind==='skill'?'skillBook':'workflow'} />;
}

export function EngineLogo({ src }: { src?: string }) {
  return <span aria-hidden="true"><LogoFrame key={src} data={{name:"",logo:src}} fallback="terminal" /></span>;
}

function LogoFrame({ data, fallback }: { data: {name:string;logo?:string}; fallback: IconName })
{
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  return <span className="resource-logo" role="img" aria-label={data.name}>
    {state !== 'ready' && <Icon name={fallback} size={20} />}
    {data.logo && state !== 'failed' && <img src={data.logo} alt="" width={20} height={20} style={{ visibility: state === 'ready' ? 'visible' : 'hidden' }}
      onError={() => setState('failed')} onLoad={event => { void event.currentTarget.decode().then(() => setState('ready'), () => setState('failed')); }} />}
  </span>;
}

/** Persist self-contained raster logos with the owning object. */
export function ResourceLogoEditor({ kind, logo, name, disabled, onChange }: LogoProps & { disabled: boolean; onChange(value?: string): void })
{
  const [error, setError] = useState('');
  const generation = useRef(0);
  return <div><ResourceLogo key={logo} {...{kind, logo, name}} />
    <FieldLabel>自定义 Logo<Input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={event => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      input.value = '';
      if (!file) return;
      const request = ++generation.current;
      if (file.size > 96 * 1024 || !['image/png','image/jpeg','image/webp'].includes(file.type)) { setError('请选择 96 KiB 以内的 PNG、JPEG 或 WebP 图片。'); return; }
      const reader = new FileReader();
      reader.onerror = () => setError('图片读取失败。');
      reader.onload = () => { if (request === generation.current && input.isConnected) { setError(''); onChange(String(reader.result)); } };
      reader.readAsDataURL(file);
    }} /></FieldLabel>
    <Button type="button" disabled={disabled || !logo} onClick={() => { generation.current++; setError(''); onChange(undefined); }}>恢复默认图标</Button>
    {error && <p role="alert">{error}</p>}</div>;
}
