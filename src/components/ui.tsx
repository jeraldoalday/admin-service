import type { ReactNode } from 'react';

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

export function Toolbar({ children }: { children: ReactNode }): ReactNode {
  return <div className="toolbar">{children}</div>;
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="modal__backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
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
