import type { ComponentPropsWithRef } from 'react';
import { UIGraphic } from '../interaction/UIGraphic';
import '../styles/ui.css';

export function Button({ className = '', ...props }: ComponentPropsWithRef<'button'>) {
  return <UIGraphic className={'ui-button ' + className} {...props} />;
}
