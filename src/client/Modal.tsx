import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export function Modal({ title, onClose, busy, children }: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    dialog.current?.showModal();
    heading.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog ref={dialog} aria-labelledby="modal-title" onCancel={event => {
      event.preventDefault();
      if (!busy) onClose();
    }}>
      <h2 tabIndex={-1} ref={heading} id="modal-title">{title}</h2>
      {children}
    </dialog>
  );
}
