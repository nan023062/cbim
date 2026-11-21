/**
 * 作用定位：右侧扩展区持有本窗口的标签列表，折叠时保留当前选择。
 * 设计原因：标签与展开状态属于当前窗口，界面占位不代表已实现外部浏览器自动化。
 */
import { useRef, useState } from 'react';

import { Icon } from '../shared/Icon';

export function ExtensionPanel({ open }: { open: boolean })
{
  const [tabs, setTabs] = useState([1]);

  const [active, setActive] = useState(1);

  const [maximized, setMaximized] = useState(false);

  const nextId = useRef(2);

  function addTab()
  {
    const id = nextId.current++;

    setTabs([...tabs, id]);

    setActive(id);
  }

  function closeTab(id: number)
  {
    const remaining = tabs.filter(tab => tab !== id);

    setTabs(remaining);

    if (active === id)
      setActive(remaining[Math.max(0, tabs.indexOf(id) - 1)] ?? 0);
  }

  return <aside id="extension-panel" className="desktop-extension" data-maximized={maximized} hidden={!open} aria-label="扩展面板">
    <header>
      <div className="extension-strip" role="tablist" aria-label="扩展标签">
        {tabs.map(id => <div key={id} className={active === id ? 'chosen' : ''}>
          <button role="tab" aria-selected={active === id} onClick={() => setActive(id)}><Icon name="globe" size={15} />{id === 1 ? '新标签页' : '新标签页 ' + id}</button>
          <button aria-label={'关闭标签 ' + id} onClick={() => closeTab(id)}><Icon name="close" size={12} /></button>
        </div>)}
      </div>
      <button aria-label="新增标签页" onClick={addTab}><Icon name="plus" size={16} /></button>
      <button className="panel-size" aria-label={maximized ? '恢复面板宽度' : '最大化面板'} aria-pressed={maximized} onClick={() => setMaximized(!maximized)}><Icon name={maximized ? 'collapse' : 'expand'} size={15} /></button>
    </header>
    <div className="extension-address" role="toolbar" aria-label="网页导航">
      <button disabled aria-label="后退">←</button><button disabled aria-label="前进">→</button>
      <input disabled aria-label="网址" placeholder="搜索或输入网址" />
      <button disabled aria-label="刷新"><Icon name="retry" size={15} /></button>
      <button disabled aria-label="更多网页操作"><Icon name="more" size={15} /></button>
    </div>
    <div className="extension-placeholder" role="tabpanel"><Icon name="browser" size={44} />
      <span>{active ? '输入网址，或打开对话中的链接' : '暂无标签页'}</span>
    </div>
  </aside>;
}
