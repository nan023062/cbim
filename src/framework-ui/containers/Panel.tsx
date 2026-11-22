/**
 * 作用定位：页面生命周期与公共布局。页面隐藏时释放活动订阅，恢复显示时重新连接。
 * 设计原因：显示状态控制订阅接入与清理，页面隐藏不意味着取消后台任务。
 */
import { createContext, useContext, useEffect, type HTMLAttributes, type EffectCallback, type DependencyList } from 'react';

import '../styles/ui.css';

const Visibility = createContext(true);

export function Screen({ active = true, className = '', children, ...props }: HTMLAttributes<HTMLElement> & { active?: boolean })
{
  const visible = useContext(Visibility) && active;

  return <Visibility.Provider value={visible}><section {...props} hidden={!visible} className={'ui-screen ' + className}>{children}</section></Visibility.Provider>;
}

/** 订阅在页面激活时建立，隐藏、依赖变更和卸载时由 React 执行清理函数。 */
export function useScreenEffect(effect: EffectCallback, dependencies: DependencyList)
{
  const visible = useContext(Visibility);

  useEffect(() => { if (visible) return effect(); }, [visible, ...dependencies]);
}
