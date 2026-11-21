/**
 * 作用定位：Claude 引擎产品的静态身份、图标和协议元数据。
 * 设计原因：以静态数据提供发现信息，浏览目录无需加载 Claude SDK 或启动引擎。
 */
export const manifest = { logo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAABlUlEQVR4nN1aW24DIQxkrT1Vewrz0Z4x/SinSK7VCilUKeVlY2LckSKtlodnwF4MxDnjOHoVPt9evpwi/MetyfHYlfioELBAvsUJLJBvcQMr5GscwRL5EtdiDFgCWBv9hMT5dIuAl+vPc3h/XWXGgTTZZwOkyFNFxPp4/6kJ4BqXdC+YaZwb13AleLZB6eCGGQLSs4CMtsAN2JaxWllr9JH5MRgWUOo4vSu5wuO7nljMyikiDupKXOs8Eh41nMRhoT4lLuIegSygZlgCgRjUUQArlWiN4Ex/KuvA7KcwaC5kMyQkxEecWj5PDfga/seGxjLOkUojvspxs6CRC0mn1ai9H5DILnFCCEgZ5KQSOTgiSKlEK3ehGu+1CwOzGVMJtgv1FqK8rJY+h04m2wM5Fyp13tvkjPaJlyu5LUiTp7THSeFLFrKVh1jLj1VGyEufZID2aAftdDoRoBDhtNlyPyAB89nokR6s3RH4+62l+RmA0QvlneAfuP6aAQsifMbxjwvtLMIXuBVjYEcRvsLJ/J89nHV8A8eH5Rd6cDsWAAAAAElFTkSuQmCC', id: 'claude-code', storageDirectory: 'claude', nativeHistoryFormat: 'claude', label: 'Claude Code', businessTypes: ['代码开发', '代码审查'], supportedApis: ['anthropic-messages'], fallbackApi: 'anthropic-messages' } as const;
