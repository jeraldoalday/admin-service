import { useState, type ReactNode } from 'react';
import { useActor } from '@/app/sessionContext';
import { Badge, ErrorNotice, Modal } from '@/components/ui';
import {
  toErrorMessage,
  users,
  type BulkUserAction,
  type BulkUserActionResult,
  type BulkUserOutcome,
} from '@/domain';

/** The verb on the button, and the sentence the confirmation asks. */
const ACTIONS: Record<
  BulkUserAction,
  { label: string; question: (count: string) => string; danger: boolean }
> = {
  activate: {
    label: 'Activate',
    question: (count) => `Activate ${count}? They will be able to sign in again.`,
    danger: false,
  },
  deactivate: {
    label: 'Deactivate',
    question: (count) =>
      `Deactivate ${count}? They will be signed out everywhere and unable to sign back in.`,
    danger: true,
  },
  unlock: {
    label: 'Unlock',
    question: (count) =>
      `Unlock ${count}? The failed attempts stay in the sign-in history; they simply stop ` +
      `holding the account shut.`,
    danger: false,
  },
  delete: {
    label: 'Delete',
    question: (count) =>
      `Delete ${count}? This cannot be undone. A team whose only owner is being deleted is ` +
      `handed to its longest-standing member.`,
    danger: true,
  },
};

function countAccounts(count: number): string {
  return count === 1 ? '1 account' : `${count} accounts`;
}

/**
 * The past tense of each action, for the line that reports what happened. "Deactivated 3
 * accounts" is a sentence somebody can check against what they meant to do; "Bulk action
 * completed: 3" is not.
 */
const DONE: Record<BulkUserAction, string> = {
  activate: 'Activated',
  deactivate: 'Deactivated',
  unlock: 'Unlocked',
  delete: 'Deleted',
};

/**
 * The selection toolbar over the accounts table.
 *
 * It stays out of the way until something is selected, and then says exactly how much is
 * selected before offering anything that acts on it — a count is the one thing a reader
 * needs to catch the mis-click where a "select all" landed on more than they meant.
 */
export function BulkActionBar({
  selectedIds,
  onClear,
  onApplied,
}: {
  selectedIds: string[];
  onClear: () => void;
  onApplied: () => void;
}): ReactNode {
  const actor = useActor();
  const [pending, setPending] = useState<BulkUserAction | null>(null);
  const [result, setResult] = useState<BulkUserActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function apply(action: BulkUserAction): void {
    setError(null);
    try {
      setResult(users.bulkUpdateUsers(actor, { action, userIds: selectedIds }));
      setPending(null);
      // The selection is dropped whether or not every account in it worked: half of them may
      // no longer exist, and a stale selection is the fastest way to apply the next action
      // to something the reader can no longer see.
      onApplied();
    } catch (caught) {
      setPending(null);
      setResult(null);
      setError(toErrorMessage(caught));
    }
  }

  return (
    <>
      {selectedIds.length > 0 && (
        <div className="bulk-bar" role="group" aria-label="Bulk actions">
          <span className="bulk-bar__count">{countAccounts(selectedIds.length)} selected</span>
          <div className="bulk-bar__actions">
            {(Object.keys(ACTIONS) as BulkUserAction[]).map((action) => (
              <button
                key={action}
                type="button"
                className={`button ${ACTIONS[action].danger ? 'button--danger' : 'button--ghost'}`}
                onClick={() => {
                  setResult(null);
                  setError(null);
                  setPending(action);
                }}
              >
                {ACTIONS[action].label}
              </button>
            ))}
            <button type="button" className="button button--ghost" onClick={onClear}>
              Clear selection
            </button>
          </div>
        </div>
      )}

      <ErrorNotice error={error} />
      {result && <BulkResultNotice result={result} />}

      {pending && (
        <Modal
          title={`${ACTIONS[pending].label} ${countAccounts(selectedIds.length)}`}
          onClose={() => setPending(null)}
        >
          <div className="form">
            <p className="card__description">
              {ACTIONS[pending].question(countAccounts(selectedIds.length))}
            </p>
            <div className="form__actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setPending(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`button ${ACTIONS[pending].danger ? 'button--danger' : 'button--primary'}`}
                onClick={() => apply(pending)}
              >
                {ACTIONS[pending].label} {countAccounts(selectedIds.length)}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * What the batch did, in three parts that are deliberately not merged.
 *
 * The headline counts what changed. Anything left alone because it was already in that state
 * is listed separately and quietly — it is not an error, and treating it as one is how an
 * error list stops being read. Anything actually refused is listed with the reason the
 * domain gave, since "your own account cannot be deleted" is the whole answer and paraphrasing
 * it would only lose detail.
 */
function BulkResultNotice({ result }: { result: BulkUserActionResult }): ReactNode {
  const { action, changed, unchanged, failed } = result;

  return (
    <div className="bulk-result" role="status">
      <p className={`notice ${failed.length > 0 ? 'notice--warning' : 'notice--success'}`}>
        {DONE[action]} {countAccounts(changed.length)}.
        {unchanged.length > 0 && ` ${countAccounts(unchanged.length)} needed no change.`}
        {failed.length > 0 && ` ${countAccounts(failed.length)} could not be changed.`}
      </p>

      {failed.length > 0 && <OutcomeList title="Refused" tone="danger" outcomes={failed} />}
      {unchanged.length > 0 && (
        <OutcomeList title="Left alone" tone="neutral" outcomes={unchanged} />
      )}
    </div>
  );
}

function OutcomeList({
  title,
  tone,
  outcomes,
}: {
  title: string;
  tone: 'danger' | 'neutral';
  outcomes: BulkUserOutcome[];
}): ReactNode {
  return (
    <div className="bulk-result__group">
      <Badge tone={tone}>{title}</Badge>
      <ul className="bulk-result__list">
        {outcomes.map((outcome) => (
          <li key={outcome.userId}>
            <span className="bulk-result__who">{outcome.displayName}</span>
            <span className="cell--muted"> — {outcome.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
