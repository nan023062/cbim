/**
 * 作用定位：各页面复用的空状态布局。
 * 设计原因：把展示样式与服务状态决策分开，具体文案和动作由调用视图提供。
 */
import React from 'react';
import {Icon} from './Icon';
export function Empty({icon,title,children}:{icon:string;title:string;children?:React.ReactNode}){return <div className="view-empty"><div className="empty-mark"><Icon name={icon} size={28}/></div><h2>{title}</h2><div className="empty-copy">{children}</div></div>}
