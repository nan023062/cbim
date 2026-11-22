import type { HTMLAttributes } from 'react';

/** Native light dismissal, Escape and focus restoration via popoverTarget. */
export function Popover({ as: Element = 'div', ...props }: HTMLAttributes<HTMLElement> & { as?: 'section' | 'div' }) {
  return <Element {...props} popover="auto" />;
}
