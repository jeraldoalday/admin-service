import { useState, type ChangeEvent, type ReactNode } from 'react';
import { useActor } from '@/app/sessionContext';
import { DataTable } from '@/components/DataTable';
import { Badge, ErrorNotice, Field, Modal, SuccessNotice } from '@/components/ui';
import {
  toErrorMessage,
  userImport,
  type ImportRowStatus,
  type UserImportPlan,
  type UserImportResult,
} from '@/domain';
import { downloadTextFile, toCsv } from '@/lib/csv';

/** The shape of a file that will work, shown before anybody has to guess at one. */
const SAMPLE =
  'email,name,role\nnoor@example.com,Noor Haddad,MEMBER\nkai@example.com,Kai Bell,ADMIN';

const STATUS_TONE: Record<ImportRowStatus, 'positive' | 'neutral' | 'danger'> = {
  CREATE: 'positive',
  SKIP: 'neutral',
  ERROR: 'danger',
};

const STATUS_LABEL: Record<ImportRowStatus, string> = {
  CREATE: 'Create',
  SKIP: 'Skip',
  ERROR: 'Error',
};

const PREVIEW_COLUMNS = [
  { label: 'Line' },
  { label: 'Email' },
  { label: 'Name' },
  { label: 'Role' },
  { label: 'Outcome' },
];

/**
 * Importing a list of accounts, in two steps that cannot be collapsed into one.
 *
 * The first step reads the file and says what it would do; only then does the second offer
 * to do it. Somebody pasting a file they were sent has no way of knowing whether it holds
 * five new colleagues or fifty rows of an old address book, and a screen that imports first
 * and reports afterwards leaves them reading the consequences rather than the proposal.
 */
export function ImportUsersDialog({ onClose }: { onClose: () => void }): ReactNode {
  const actor = useActor();
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<UserImportPlan | null>(null);
  const [result, setResult] = useState<UserImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function readFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    file
      .text()
      .then((contents) => {
        setText(contents);
        setPlan(null);
        setResult(null);
      })
      .catch(() => setError('That file could not be read.'));
  }

  function preview(): void {
    setError(null);
    setResult(null);
    try {
      setPlan(userImport.planUserImport(actor, text));
    } catch (caught) {
      setPlan(null);
      setError(toErrorMessage(caught));
    }
  }

  function runImport(): void {
    setError(null);
    try {
      setResult(userImport.importUsers(actor, text));
      setPlan(null);
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  return (
    <Modal title="Import accounts" onClose={onClose}>
      <div className="form">
        {result ? (
          <ImportReport result={result} onClose={onClose} />
        ) : (
          <>
            <p className="card__description">
              A CSV with an <code>email</code> and a <code>name</code> column, and optionally a{' '}
              <code>role</code>. Existing accounts are left alone. Each new account is given a
              password you will see once.
            </p>

            <Field label="CSV file">
              <input type="file" accept=".csv,text/csv,text/plain" onChange={readFile} />
            </Field>

            <Field label="Or paste the rows">
              <textarea
                rows={6}
                value={text}
                placeholder={SAMPLE}
                spellCheck={false}
                onChange={(event) => {
                  setText(event.target.value);
                  // A plan describes the text it was built from. Editing the text makes it a
                  // description of something that is no longer on screen.
                  setPlan(null);
                  setResult(null);
                }}
              />
            </Field>

            <ErrorNotice error={error} />

            {plan && <ImportPreview plan={plan} />}

            <div className="form__actions">
              <button type="button" className="button button--ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="button"
                onClick={preview}
                disabled={text.trim() === ''}
              >
                Check file
              </button>
              <button
                type="button"
                className="button button--primary"
                onClick={runImport}
                disabled={!plan || plan.create === 0}
              >
                {plan
                  ? `Import ${plan.create} ${plan.create === 1 ? 'account' : 'accounts'}`
                  : 'Import'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function ImportPreview({ plan }: { plan: UserImportPlan }): ReactNode {
  return (
    <div className="import-preview">
      <p className={`notice ${plan.errors > 0 ? 'notice--warning' : 'notice--success'}`}>
        {plan.create} to create · {plan.skip} already here · {plan.errors} that cannot be read
      </p>

      <DataTable columns={PREVIEW_COLUMNS}>
        {plan.rows.map((row) => (
          <tr key={row.line}>
            <td className="cell--muted">{row.line}</td>
            <td>{row.email || '—'}</td>
            <td>{row.displayName || '—'}</td>
            <td className="cell--muted">{row.role}</td>
            <td>
              <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
              {row.message && <span className="cell--tag">{row.message}</span>}
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

/**
 * What the import did, and the only sight anybody gets of the passwords it generated.
 *
 * The download is offered rather than assumed: these are credentials, and a file of them
 * appearing in a downloads folder unasked is not a favour. But they exist nowhere else — the
 * store holds only their hashes — so the offer has to be made before this closes.
 */
function ImportReport({
  result,
  onClose,
}: {
  result: UserImportResult;
  onClose: () => void;
}): ReactNode {
  function download(): void {
    const csv = toCsv(result.created, [
      { header: 'Email', value: (row) => row.email },
      { header: 'Name', value: (row) => row.displayName },
      { header: 'Role', value: (row) => row.role },
      { header: 'Temporary password', value: (row) => row.temporaryPassword },
    ]);
    downloadTextFile('imported-accounts.csv', csv, 'text/csv');
  }

  return (
    <>
      <SuccessNotice>
        Created {result.created.length} {result.created.length === 1 ? 'account' : 'accounts'}.
        {result.skipped.length > 0 && ` ${result.skipped.length} already had an account.`}
        {result.failed.length > 0 && ` ${result.failed.length} could not be read.`}
      </SuccessNotice>

      {result.created.length > 0 && (
        <>
          <p className="notice notice--warning">
            These passwords are shown once and are not stored. Copy them now.
          </p>
          <DataTable columns={[{ label: 'Email' }, { label: 'Temporary password' }]}>
            {result.created.map((account) => (
              <tr key={account.id}>
                <td>{account.email}</td>
                <td>
                  <code>{account.temporaryPassword}</code>
                </td>
              </tr>
            ))}
          </DataTable>
        </>
      )}

      <div className="form__actions">
        {result.created.length > 0 && (
          <button type="button" className="button" onClick={download}>
            Download passwords
          </button>
        )}
        <button type="button" className="button button--primary" onClick={onClose}>
          Done
        </button>
      </div>
    </>
  );
}
