import type { ComponentPropsWithRef } from 'react';
import { Button } from './Button';
import { Tooltip } from './Tooltip';

export function IconButton({ title, 'aria-label': label, disabled, className = '', ...props }: ComponentPropsWithRef<'button'>) {
  const name = label || title;
  const hint = disabled && (!title || title === name) ? name + '（当前不可用）' : title || name;
  return <Tooltip text={hint ?? ''} disabledTrigger={disabled}><Button {...props} className={'ui-icon-button ' + className}
    aria-label={name} disabled={disabled} /></Tooltip>;
}
