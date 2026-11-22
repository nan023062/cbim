import type { ComponentPropsWithRef } from 'react';

/** Native button activation, focus and disabled semantics. */
export function UIGraphic({ type = 'button', ...props }: ComponentPropsWithRef<'button'>) {
  return <button type={type} {...props} />;
}
