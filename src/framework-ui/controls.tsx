/** 基于原生按钮的公共控件，保留键盘、焦点和禁用语义。 */
import type { ButtonHTMLAttributes } from 'react';
import './ui.css';

export function Button({ type = 'button', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>)
{
  return <button type={type} className={'ui-button ' + className} {...props} />;
}

export function Toggle({ checked, onChange, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'onClick'> & { checked: boolean; onChange(value: boolean): void })
{
  return <Button {...props} role="switch" aria-checked={checked} onClick={() => onChange(!checked)} />;
}
