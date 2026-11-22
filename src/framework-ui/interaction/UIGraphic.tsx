import type { ButtonHTMLAttributes } from 'react';

/** Native button activation, focus and disabled semantics. */
export function UIGraphic({ type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} {...props} />;
}
