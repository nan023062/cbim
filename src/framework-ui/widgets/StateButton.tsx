import type { ButtonHTMLAttributes } from 'react';
import { IconButton } from './IconButton';
import { Button } from './Button';

/** 受控多状态按钮：保持同一原生按钮，由页面选择当前状态和动作。 */
export function StateButton<State extends string>({ iconOnly, state, states, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onClick' | 'type'> & { iconOnly?: boolean; state: State; states: Record<State, Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'title' | 'onClick' | 'type' | 'disabled'> & { label: string }> })
{
  const { label, disabled, ...action } = states[state];

  const Control = iconOnly ? IconButton : Button;
  return <Control {...props} {...action} data-state={state} aria-label={label} disabled={props.disabled || disabled} />;
}
