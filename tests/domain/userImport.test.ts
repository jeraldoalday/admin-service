import { describe, expect, it } from 'vitest';
import { audit, auth, getDatabase, userImport } from '@/domain';
import { adminActor, rajActor } from '../helpers';

const HEADER = 'email,name,role';

function file(...lines: string[]): string {
  return [HEADER, ...lines].join('\r\n');
}

function plan(text: string) {
  return userImport.planUserImport(adminActor(), text);
}

function accountFor(email: string) {
  return getDatabase().users.find((user) => user.email === email);
}

describe('previewing an import', () => {
  it('reads the rows it would create', () => {
    const result = plan(file('noor@example.com,Noor Haddad,MEMBER', 'kai@example.com,Kai Bell,'));

    expect(result.create).toBe(2);
    expect(result.rows[0]).toMatchObject({
      line: 2,
      email: 'noor@example.com',
      displayName: 'Noor Haddad',
      role: 'MEMBER',
      status: 'CREATE',
    });
    // An empty role cell means the default rather than an error: a spreadsheet writes every
    // column whether or not it has a value.
    expect(result.rows[1]?.role).toBe('MEMBER');
  });

  it('writes nothing at all', () => {
    const before = getDatabase().users.length;

    plan(file('noor@example.com,Noor Haddad,ADMIN'));

    expect(getDatabase().users).toHaveLength(before);
    expect(audit.listAllAuditLogs({ search: 'import' })).toHaveLength(0);
  });

  it('accepts a role in any case', () => {
    expect(plan(file('noor@example.com,Noor Haddad,admin')).rows[0]?.role).toBe('ADMIN');
  });

  it('accepts the column names under any house style', () => {
    const result = userImport.planUserImport(
      adminActor(),
      'Email,Display Name\r\nnoor@example.com,Noor Haddad',
    );

    expect(result.create).toBe(1);
  });

  it('skips an address that already has an account', () => {
    const result = plan(file('dana@example.com,Dana Diaz,MEMBER'));

    expect(result.skip).toBe(1);
    expect(result.rows[0]).toMatchObject({
      status: 'SKIP',
      message: 'An account already has this address',
    });
  });

  it('refuses a row missing an address or a name', () => {
    const result = plan(file(',Noor Haddad,MEMBER', 'kai@example.com,,MEMBER'));

    expect(result.errors).toBe(2);
    expect(result.rows[0]?.message).toContain('email');
    expect(result.rows[1]?.message).toContain('displayName');
  });

  it('refuses a role it does not have', () => {
    const result = plan(file('noor@example.com,Noor Haddad,SUPERUSER'));

    expect(result.rows[0]?.status).toBe('ERROR');
    expect(result.rows[0]?.message).toContain('role');
  });

  it('refuses the second of two rows naming the same address', () => {
    const result = plan(
      file('noor@example.com,Noor Haddad,MEMBER', 'noor@example.com,N. Haddad,ADMIN'),
    );

    expect(result.create).toBe(1);
    expect(result.rows[1]?.message).toBe('Repeated in this file — already named on line 2');
  });

  it('points at the line a row came from, quoted newlines included', () => {
    const result = plan(file('"noor@example.com","Haddad,\nNoor",MEMBER', 'kai@example.com,Kai,'));

    expect(result.rows[1]?.line).toBe(4);
  });
});

describe('a file the console cannot read', () => {
  it('refuses one with no email column', () => {
    expect(() => plan('name,role\r\nNoor Haddad,MEMBER')).toThrow('needs a column named email');
  });

  it('names every column it is missing', () => {
    expect(() => plan('role\r\nMEMBER')).toThrow('needs columns named email and name');
  });

  it('refuses an empty file', () => {
    expect(() => plan('')).toThrow('That file is empty.');
  });

  it('refuses one that ends inside a quoted value', () => {
    expect(() => plan(file('noor@example.com,"Noor'))).toThrow('unclosed quote');
  });

  it('refuses one longer than the cap', () => {
    const rows = Array.from(
      { length: userImport.MAX_IMPORT_ROWS + 1 },
      (_, index) => `user${index}@example.com,User ${index},MEMBER`,
    );

    expect(() => plan(file(...rows))).toThrow('is the most that can be imported at once');
  });
});

describe('running an import', () => {
  it('creates the accounts and hands back a password for each', () => {
    const result = userImport.importUsers(
      adminActor(),
      file('noor@example.com,Noor Haddad,ADMIN', 'kai@example.com,Kai Bell,MEMBER'),
    );

    expect(result.created).toHaveLength(2);
    expect(accountFor('noor@example.com')?.role).toBe('ADMIN');
    expect(accountFor('kai@example.com')?.displayName).toBe('Kai Bell');
    expect(result.created[0]?.temporaryPassword).toMatch(/^tmp-[0-9a-f]{18}$/);
    expect(result.created[0]?.temporaryPassword).not.toBe(result.created[1]?.temporaryPassword);
  });

  it('creates accounts that can actually sign in with what it handed back', () => {
    const result = userImport.importUsers(adminActor(), file('noor@example.com,Noor Haddad,'));
    const created = result.created[0];

    const signedIn = auth.loginUser({
      email: 'noor@example.com',
      password: created?.temporaryPassword ?? '',
    });

    expect(signedIn.displayName).toBe('Noor Haddad');
  });

  it('never stores the password it generated', () => {
    const result = userImport.importUsers(adminActor(), file('noor@example.com,Noor Haddad,'));

    expect(accountFor('noor@example.com')?.passwordHash).not.toContain(
      result.created[0]?.temporaryPassword,
    );
  });

  it('leaves an existing account exactly as it was', () => {
    const before = { ...accountFor('dana@example.com') };

    const result = userImport.importUsers(
      adminActor(),
      file('dana@example.com,Someone Else,ADMIN'),
    );

    expect(result.created).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(accountFor('dana@example.com')).toMatchObject({
      displayName: before.displayName,
      role: before.role,
      passwordHash: before.passwordHash,
    });
  });

  it('creates the good rows and reports the rest', () => {
    const result = userImport.importUsers(
      adminActor(),
      file('noor@example.com,Noor Haddad,', 'dana@example.com,Dana,', 'not-an-email,Nobody,'),
    );

    expect(result.created).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
  });

  it('records the batch and each account against the administrator who ran it', () => {
    userImport.importUsers(adminActor(), file('noor@example.com,Noor Haddad,'));

    const batch = audit.listAllAuditLogs({ action: 'user.imported_batch' });
    const one = audit.listAllAuditLogs({ action: 'user.imported' });

    expect(batch[0]?.actorId).toBe(adminActor().id);
    expect(batch[0]?.metadata).toMatchObject({ created: 1, skipped: 0, errors: 0 });
    // Not `user.registered`: an imported account did not bring itself into existence.
    expect(one[0]?.actorId).toBe(adminActor().id);
    expect(audit.listAllAuditLogs({ action: 'user.registered' })).toHaveLength(0);
  });
});

describe('who may import', () => {
  it('refuses a member', () => {
    expect(() => userImport.planUserImport(rajActor(), file('noor@example.com,Noor,'))).toThrow(
      'You do not have permission to perform this action',
    );
    expect(() => userImport.importUsers(rajActor(), file('noor@example.com,Noor,'))).toThrow(
      'You do not have permission to perform this action',
    );
  });
});
