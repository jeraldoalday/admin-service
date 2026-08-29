import { useEffect, useRef, type ReactNode } from 'react';

export function Card({
  title,
  description,
  actions,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}): ReactNode {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card__header">
          <div>
            {title && <h2 className="card__title">{title}</h2>}
            {description && <p className="card__description">{description}</p>}
          </div>
          {actions && <div className="card__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'positive' | 'warning' | 'danger' | 'accent';
  children: ReactNode;
}): ReactNode {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function EmptyState({ children }: { children: ReactNode }): ReactNode {
  return <p className="empty-state">{children}</p>;
}

/** Renders a domain failure in place. Nothing is shown when there is no error to report. */
export function ErrorNotice({ error }: { error: string | null }): ReactNode {
  if (!error) return null;
  return (
    <p className="notice notice--error" role="alert">
      {error}
    </p>
  );
}

export function SuccessNotice({ children }: { children: ReactNode }): ReactNode {
  return (
    <p className="notice notice--success" role="status">
      {children}
    </p>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}): ReactNode {
  // The hint sits outside the <label> on purpose: nesting it there would fold the hint text
  // into the control's accessible name, so screen readers would announce the whole sentence
  // every time focus lands on the input.
  return (
    <div className="field">
      <label className="field__control">
        <span className="field__label">{label}</span>
        {children}
      </label>
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  );
}

/**
 * A labelled group of controls. A `<label>` may only name one control, so wrapping a set of
 * checkboxes in one would give every box in the group the same sprawling accessible name;
 * `fieldset`/`legend` is the element pair that actually names a group.
 */
export function FieldGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <fieldset className="field field--group">
      <legend className="field__label">{label}</legend>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </fieldset>
  );
}

/**
 * A checkbox that can say "some of these", which is the state a select-all control is in for
 * most of the time anybody is using it.
 *
 * `indeterminate` is a DOM property rather than an attribute, so React cannot set it from
 * JSX and it has to be written to the node. It is worth the ref: a header checkbox that
 * shows only ticked or unticked tells a reader who has selected three rows out of ten that
 * they have selected none, and the whole point of the control is to say how much is held.
 */
export function TriStateCheckbox({
  checked,
  indeterminate,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  label: string;
  onChange: () => void;
}): ReactNode {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [checked, indeterminate]);

  return (
    <input ref={ref} type="checkbox" checked={checked} aria-label={label} onChange={onChange} />
  );
}

export function Toolbar({ children }: { children: ReactNode }): ReactNode {
  return <div className="toolbar">{children}</div>;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * A dialog that behaves like one for someone not using a mouse.
 *
 * `aria-modal` tells a screen reader that the rest of the page is inert, but it does not make
 * it so: without the handling below, Tab walked straight out of the dialog into the screen
 * behind it, Escape did nothing, and closing left focus on the document body — so the reader
 * had to find their way back to the row they had been editing. Focus enters on open, cycles
 * inside while open, and returns to whatever opened the dialog when it closes.
 */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}): ReactNode {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Callers pass an inline arrow, so the prop is a new function on every render. Reading it
  // through a ref keeps the listener below mounted once instead of being torn down and
  // re-attached — and re-stealing focus — each time the dialog re-renders.
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;

    // Focus the dialog itself rather than its first control: a screen reader then announces
    // what just opened, and Tab walks the dialog from the top instead of dropping the reader
    // into the middle of a form whose heading they never heard.
    dialog?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const edge = event.shiftKey ? focusable[0] : focusable[focusable.length - 1];
      if (!edge || document.activeElement !== edge) return;

      event.preventDefault();
      (event.shiftKey ? focusable[focusable.length - 1] : focusable[0])?.focus();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      opener?.focus?.();
    };
  }, []);

  return (
    <div className="modal__backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="modal__header">
          <h2>{title}</h2>
          <button type="button" className="button button--ghost" onClick={onClose}>
            Close
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
