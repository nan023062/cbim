import type { ButtonHTMLAttributes } from 'react';
import { UIGraphic } from '../interaction/UIGraphic';
import '../styles/ui.css';

export function Button({ className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <UIGraphic className={'ui-button ' + className} {...props} />;
}
