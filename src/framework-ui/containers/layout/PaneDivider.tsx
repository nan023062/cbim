import { useContext, useRef } from 'react';
import { Panes, type Side } from './panes';

export function PaneDivider({ side, label, controls }: { side: Side; label: string; controls: string })
{
  const panes = useContext(Panes);

  const drag = useRef<
    {
      x: number;

      width: number
    } | undefined>(undefined);

  if (!panes)
    return null;

  const { width, min, max, Change } = panes[side];

  const sign = side === 'left' ? 1 : -1;

  return <div className="ui-pane-divider" data-side={side} role="separator" aria-orientation="vertical" aria-label={label} aria-controls={controls} aria-valuemin={min} aria-valuemax={max} aria-valuenow={width} tabIndex={0}
    onPointerDown={e => { if (e.button !== 0) return; drag.current = { x: e.clientX, width }; e.currentTarget.setPointerCapture(e.pointerId); }}
    onPointerMove={e => { if (drag.current && e.currentTarget.hasPointerCapture(e.pointerId)) Change(drag.current.width + sign * (e.clientX - drag.current.x)); }}
    onLostPointerCapture={() => { drag.current = undefined; }} onDoubleClick={() => Change()}
    onKeyDown={e => { if (e.key === 'Home') Change(); else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') Change(width + sign * (e.key === 'ArrowRight' ? 10 : -10)); else return; e.preventDefault(); }} />;
}
