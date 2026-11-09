/**
 * 作用定位：无业务状态的 SVG 图标组件。
 * 设计原因：各视图复用一致图标语言；架构图的编辑、删除、传输、展开与字号无需文字占位，权限使用手掌和警告。可访问名称由操作按钮提供。
 */
import React from 'react';
type IconName='hand'|'warning'|'sparkles'|'chat'|'flow'|'team'|'knowledge'|'plus'|'folder'|'clock'|'plug'|'search'|'close'|'chevron'|'menu'|'sun'|'moon'|'arrow'|'check'|'settings';
export function Icon({name,size=18}:{name:IconName|string;size?:number}){
  const paths:Record<string,React.ReactNode>={
    more:<><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></>,
    edit:<><path d="m4 15 11-11 5 5L9 20H4v-5ZM13 6l5 5"/></>,
    trash:<><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></>,
    expand:<path d="m7 8 5-5 5 5M7 16l5 5 5-5M4 12h16"/>,
    collapse:<path d="m7 3 5 5 5-5M7 21l5-5 5 5M4 12h16"/>,
    'text-minus':<path d="m3 19 5-14 5 14M5 14h6M16 12h6"/>,
    'text-plus':<path d="m3 19 5-14 5 14M5 14h6M16 12h6M19 9v6"/>,
    upload:<path d="M4 15v6h16v-6M12 16V3m-5 5 5-5 5 5"/>,
    download:<path d="M4 15v6h16v-6M12 3v13m-5-5 5 5 5-5"/>,
    hand:<><path d="M8 13V6a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v8-6a2 2 0 0 1 4 0v9c0 5-3 7-7 7-3 0-5-2-7-5l-3-4a2 2 0 0 1 3-2l2 2Z"/></>,
    warning:<><path d="M10.3 4a2 2 0 0 1 3.4 0l8 14a2 2 0 0 1-1.7 3H4a2 2 0 0 1-1.7-3Z"/><path d="M12 9v5M12 17h.01"/></>,
    sparkles:<><path d="m10 3 2.5 6.5L19 12l-6.5 2.5L10 21l-2.5-6.5L1 12l6.5-2.5Z"/><path d="m19 1 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z"/></>,
    chat:<><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3H3V6a2 2 0 0 1 2-2Z"/><path d="M8 9h8M8 13h5"/></>,
    flow:<><rect x="8" y="2" width="8" height="5" rx="1"/><rect x="2" y="17" width="7" height="5" rx="1"/><rect x="15" y="17" width="7" height="5" rx="1"/><path d="M12 7v5M5 17v-5h14v5"/></>,
    team:<><circle cx="12" cy="7" r="3"/><path d="M6 21v-3a6 6 0 0 1 12 0v3M4 6a3 3 0 0 0 0 6M20 6a3 3 0 0 1 0 6M2 20v-2a4 4 0 0 1 2-3M22 20v-2a4 4 0 0 0-2-3"/></>,
    knowledge:<><path d="m12 2 10 5-10 5L2 7l10-5Zm-10 10 10 5 10-5M2 17l10 5 10-5"/></>,
    plus:<><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></>,
    folder:<path d="M3 5h6l2 3h10v12H3V5Z"/>,clock:<><circle cx="12" cy="13" r="8"/><path d="M12 8v5l3 2M9 2h6"/></>,
    plug:<><path d="M8 2v6M16 2v6M6 8h12v4a6 6 0 0 1-12 0V8ZM12 18v4"/></>,
    search:<><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></>,close:<path d="m6 6 12 12M6 18 18 6"/>,chevron:<path d="m9 5 7 7-7 7"/>,
    menu:<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></>,sun:<><circle cx="12" cy="12" r="4"/><path d="M12 1v2M12 21v2M1 12h2M21 12h2M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2"/></>,moon:<path d="M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11Z"/>,arrow:<path d="M12 20V4m-6 6 6-6 6 6"/>,check:<path d="m5 12 5 5L20 7"/>,settings:<><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||paths.folder}</svg>
}
