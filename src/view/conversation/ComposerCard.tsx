/**
 * 作用定位：从 Cindy ComposerCard 移植的统一输入卡片与内容间距。
 * 设计原因：保留原组件 framed/props 契约和 86px 最小高度，Tailwind 与主题变量适配为 CBIM CSS。
 * 来源：makecindy/cindy，Apache-2.0；Copyright 2026 XD Inc.；本文件已为 CBIM 修改，见 legal/cindy-NOTICE。
 */
import type {ComponentProps} from 'react';
export const COMPOSER_CONTENT_CLASS='cindy-composer-content';
export function ComposerCard({framed=true,className='',...props}:ComponentProps<'div'>&{framed?:boolean}){
  return <div {...props} className={[framed?'chat-input-card':'',className].filter(Boolean).join(' ')}/>;
}
