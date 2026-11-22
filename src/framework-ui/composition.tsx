import type { HTMLAttributes } from 'react';
export { Screen as Panel, useScreenEffect } from './containers/Panel';
export { ConfirmWindow as Window } from './containers/windows/ConfirmWindow';
export { Tabs } from './containers/Tabs';
export { ThreePaneLayout } from './containers/layout/ThreePaneLayout';
export { PaneDivider } from './containers/layout/PaneDivider';

/** 组合一组局部内容，语义和标题由调用方提供。 */
export function Widget(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props}/>;
}
