import type { ButtonHTMLAttributes } from 'react';
import { Button } from './Button';

export function Toggle({ checked, onChange, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'onClick'> & { checked: boolean; onChange: (value: boolean) => void })
{
  return <Button {...props} role="switch" aria-checked={checked} onClick={() => onChange(!checked)} />;
}
