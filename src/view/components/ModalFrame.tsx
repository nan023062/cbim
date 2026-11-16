/**
 * 作用定位：View 层模态容器，为编辑与预览提供原生焦点约束和关闭后焦点返回。
 * 设计原因：共享可访问性机制；是否允许关闭、草稿确认和在途操作仍由业务调用方决定。
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** onRequestClose 只表达关闭意图；容器不绕过业务的 busy 或未保存确认。 */
export function ModalFrame({ label, onRequestClose, children }: { label: string; onRequestClose: () => void; children: ReactNode })
{
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() =>
  {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () =>
    {
      element?.close();
      if (previous?.isConnected)
        previous.focus()
    };
  }, []);
  return createPortal(<dialog ref={dialog} className="modal-frame" aria-label={label} onCancel={event =>
  {
    event.preventDefault();
    onRequestClose()
  }}>{children}</dialog>, document.body);
}
