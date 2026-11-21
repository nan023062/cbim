/**
 * 作用定位：基于原生按钮的公共控件，保留键盘、焦点和禁用语义。
 * 设计原因：以 React 封装重复交互而保留原生语义，不承载业务保存或授权状态。
 */
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

/** 通用可激活列表项。内容和行为由调用方注入，行内辅助按钮应作为同级元素。 */
export function ListItem({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>)
{
  return <Button className={'ui-list-item ' + className} {...props} />;
}
