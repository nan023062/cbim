import type { ComponentPropsWithRef } from 'react';
import { Button } from './Button';

/** 通用可激活列表项。内容和行为由调用方注入，行内辅助按钮应作为同级元素。 */
export function ListItem({ className = '', ...props }: ComponentPropsWithRef<'button'>)
{
  return <Button className={'ui-list-item ' + className} {...props} />;
}
