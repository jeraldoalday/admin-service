import { recordAuditLog } from './audit';
import { findUserByEmail } from './auth';
import { mutate } from './database';
import { BadRequestError, toErrorMessage } from './errors';
import { requireAdmin, type Actor } from './guards';
import { createId, createToken, nowIso } from './ids';
import { hashPassword } from './password';
import type { UserRecord, UserRole } from './types';
import { importUserRowSchema, parseInput } from './validation';
// The one place the rules reach into `lib/`. CSV is a file format rather than a screen
// concern, and the alternative — parsing in the page and handing the domain a shape it
// cannot check — would put "does this file have an email column?" outside the tested layer.
import { parseCsvDocument, type CsvDataRow } from '@/lib/csv';

/**
 * Bringing a list of accounts in from a file.
 *
 * Provisioning thirty colleagues one form at a time is the kind of work that gets done
 * badly — a mistyped address, a missed row, an afternoon gone — and every organisation
 * already has the list somewhere as a spreadsheet. What makes it safe to accept that file is
 * that the import is allowed to do exactly one thing: create accounts that do not exist yet.
 *
 * It never updates one. An address already registered is skipped and said so, because an
 * import that could write to existing accounts would be a way to rename an administrator, or
 * to change their role, by uploading a file — and the reviewer of that file is looking at
 * names and addresses, not at what the console would do with them.
 */

/**
 * How many accounts one file may bring in.
 *
 * The limit is bcrypt rather than caution: hashing runs on the UI thread here, so a file of
 * a thousand rows would freeze the console for the best part of a minute with nothing on
 * screen to say why. A hundred is a department.
 */
export const MAX_IMPORT_ROWS = 100;

/**
 * The column names each field answers to, most canonical first.
 *
 * A file that came out of somebody else's system calls the name column whatever that system
 * called it, and `normalizeHeader` only folds punctuation and case — it cannot know that
 * "Full Name" and "Display Name" are the same column. Listing the aliases is what keeps the
 * import from making the reader rewrite a header row before it will look at their file.
 */
export const COLUMN_ALIASES = {
  email: ['email', 'emailaddress'],
  displayName: ['name', 'displayname', 'fullname'],
  role: ['role', 'platformrole'],
} as const;

/** What the file must name, whatever it calls it. */
const REQUIRED_FIELDS = ['email', 'displayName'] as const;

type ImportField = keyof typeof COLUMN_ALIASES;

/** The header each field was found under, for the columns the file actually has. */
type ColumnMap = Partial<Record<ImportField, string>>;

function resolveColumns(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  (Object.keys(COLUMN_ALIASES) as ImportField[]).forEach((field) => {
    const found = COLUMN_ALIASES[field].find((alias) => headers.includes(alias));
    if (found) map[field] = found;
  });
  return map;
}

export type ImportRowStatus = 'CREATE' | 'SKIP' | 'ERROR';

/** One row of the file as the console reads it, before anything is written. */
export interface UserImportRow {
  /** The line of the file this came from, so a reader can go and look at it. */
  line: number;
  email: string;
  displayName: string;
  role: UserRole;
  status: ImportRowStatus;
  /** Why it will be skipped or refused; null when it is going to be created. */
  message: string | null;
}

export interface UserImportPlan {
  rows: UserImportRow[];
  create: number;
  skip: number;
  errors: number;
}

/** An account the import created, with the one and only sight of its password. */
export interface ImportedAccount {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  /**
   * Generated here and shown once, exactly as an API key secret is: it is never stored in
   * plaintext, so this return value is the only copy that will ever exist.
   */
  temporaryPassword: string;
}

export interface UserImportResult {
  created: ImportedAccount[];
  skipped: UserImportRow[];
  failed: UserImportRow[];
}

/**
 * A password nobody chose, for an account whose owner has not arrived yet.
 *
 * It is long and random rather than memorable on purpose: it exists to be copied into a
 * message once and changed on first sign-in, and a scheme that made it pronounceable would
 * make it guessable for exactly as long as it stays unchanged.
 */
function generateTemporaryPassword(): string {
  return `tmp-${createToken(9)}`;
}

function readRole(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  // An absent role means "the default", which the schema supplies. An empty cell is the same
  // statement made by a spreadsheet that writes every column whether or not it has a value.
  return value ? value.toUpperCase() : undefined;
}

/**
 * Reads one row, deciding what would happen to it without doing any of it.
 *
 * `seen` carries the addresses earlier rows in the same file already claimed. A file naming
 * one address twice is a mistake in the file, and the second occurrence is reported as an
 * error rather than quietly ignored — the two rows usually differ in the name or the role,
 * and which of them won is not something an import should decide on the reader's behalf.
 */
function planRow(row: CsvDataRow, columns: ColumnMap, seen: Map<string, number>): UserImportRow {
  const cell = (field: ImportField): string => {
    const header = columns[field];
    return header ? (row.fields[header] ?? '') : '';
  };

  const base = {
    line: row.line,
    email: cell('email'),
    displayName: cell('displayName'),
    role: 'MEMBER' as UserRole,
  };

  let parsed;
  try {
    parsed = parseInput(importUserRowSchema, {
      email: cell('email'),
      displayName: cell('displayName'),
      role: readRole(cell('role')),
    });
  } catch (caught) {
    return { ...base, status: 'ERROR', message: toErrorMessage(caught) };
  }

  const resolved = {
    line: row.line,
    email: parsed.email,
    displayName: parsed.displayName,
    role: parsed.role,
  };

  const earlier = seen.get(parsed.email);
  if (earlier !== undefined) {
    return {
      ...resolved,
      status: 'ERROR',
      message: `Repeated in this file — already named on line ${earlier}`,
    };
  }
  seen.set(parsed.email, row.line);

  if (findUserByEmail(parsed.email)) {
    return {
      ...resolved,
      status: 'SKIP',
      message: 'An account already has this address',
    };
  }

  return { ...resolved, status: 'CREATE', message: null };
}

/**
 * Reads a file and says what importing it would do, without writing anything.
 *
 * The preview is the point. Somebody pasting a file they were sent has no way of knowing
 * whether it holds five new colleagues or fifty rows of an address book, and a screen that
 * imports first and reports afterwards leaves them reading the consequences instead of the
 * proposal.
 */
export function planUserImport(actor: Actor, text: string): UserImportPlan {
  requireAdmin(actor);

  let document;
  try {
    document = parseCsvDocument(text);
  } catch (caught) {
    throw new BadRequestError(toErrorMessage(caught));
  }

  if (document.headers.length === 0) {
    throw new BadRequestError('That file is empty.');
  }

  const columns = resolveColumns(document.headers);
  const missing = REQUIRED_FIELDS.filter((field) => !columns[field]);
  if (missing.length > 0) {
    // Named by their canonical alias, which is the one the sample file on the screen uses.
    const names = missing.map((field) => COLUMN_ALIASES[field][0]);
    throw new BadRequestError(
      `That file needs ${names.length === 1 ? 'a column' : 'columns'} named ${names.join(' and ')}.`,
    );
  }

  if (document.rows.length > MAX_IMPORT_ROWS) {
    throw new BadRequestError(
      `That file has ${document.rows.length} rows; ${MAX_IMPORT_ROWS} is the most that can be imported at once.`,
    );
  }

  const seen = new Map<string, number>();
  const rows = document.rows.map((row) => planRow(row, columns, seen));

  return {
    rows,
    create: rows.filter((row) => row.status === 'CREATE').length,
    skip: rows.filter((row) => row.status === 'SKIP').length,
    errors: rows.filter((row) => row.status === 'ERROR').length,
  };
}

/**
 * Imports the rows that a plan of the same file says can be created.
 *
 * The plan is rebuilt here rather than passed in from the screen. Between the preview and
 * the confirmation somebody else may have registered one of these addresses, and a plan the
 * caller holds is a description of a store that has since moved on — trusting it is how an
 * import ends up writing a second account against an address that now has one.
 *
 * Accounts are created directly rather than through `registerUser`, which is the one place
 * this deliberately does not reuse the single-account path: registration is a self-service
 * act, so it makes the new account its own audit actor and cannot set a role. An imported
 * account was provisioned by an administrator, and the log should say who.
 */
export function importUsers(actor: Actor, text: string): UserImportResult {
  const admin = requireAdmin(actor);
  const plan = planUserImport(admin, text);

  const created = plan.rows
    .filter((row) => row.status === 'CREATE')
    .map((row) => createImportedAccount(admin, row));

  recordAuditLog({
    actorId: admin.id,
    action: 'user.imported_batch',
    targetType: 'user',
    targetId: null,
    metadata: {
      created: created.length,
      skipped: plan.skip,
      errors: plan.errors,
      emails: created.map((account) => account.email),
    },
  });

  return {
    created,
    skipped: plan.rows.filter((row) => row.status === 'SKIP'),
    failed: plan.rows.filter((row) => row.status === 'ERROR'),
  };
}

function createImportedAccount(admin: Actor, row: UserImportRow): ImportedAccount {
  const temporaryPassword = generateTemporaryPassword();

  const record = mutate((db) => {
    const timestamp = nowIso();
    const user: UserRecord = {
      id: createId(),
      email: row.email,
      passwordHash: hashPassword(temporaryPassword),
      displayName: row.displayName,
      role: row.role,
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.users.push(user);
    return user;
  });

  recordAuditLog({
    actorId: admin.id,
    action: 'user.imported',
    targetType: 'user',
    targetId: record.id,
    metadata: { email: record.email, role: record.role },
  });

  return {
    id: record.id,
    email: record.email,
    displayName: record.displayName,
    role: record.role,
    temporaryPassword,
  };
}
