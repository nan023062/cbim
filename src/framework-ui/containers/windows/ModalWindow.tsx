import { useLayoutEffect, useRef, type ComponentPropsWithoutRef } from 'react';

/** Mounting opens a modal; unmounting releases focus back to its opener. */
export function ModalWindow(props: Omit<ComponentPropsWithoutRef<'dialog'>, 'open'>) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog {...props} ref={ref} />;
}
