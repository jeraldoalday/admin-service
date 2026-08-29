import { describe, expect, it } from 'vitest';
import {
  escapeCsvField,
  normalizeHeader,
  parseCsv,
  parseCsvDocument,
  scanCsv,
  toCsv,
} from '@/lib/csv';

describe('escapeCsvField', () => {
  it('leaves an ordinary value alone', () => {
    expect(escapeCsvField('user.updated')).toBe('user.updated');
  });

  it('renders nothing for an absent value', () => {
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });

  it('wraps values containing a comma, quote, or newline', () => {
    expect(escapeCsvField('Diaz, Dana')).toBe('"Diaz, Dana"');
    expect(escapeCsvField('a "quoted" word')).toBe('"a ""quoted"" word"');
    expect(escapeCsvField('two\nlines')).toBe('"two\nlines"');
  });

  it('serialises structured metadata as JSON', () => {
    expect(escapeCsvField({ role: 'ADMIN' })).toBe('"{""role"":""ADMIN""}"');
  });

  it('defuses a value a spreadsheet would treat as a formula', () => {
    // An audit entry could carry a display name someone chose; it must not execute.
    expect(escapeCsvField('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(escapeCsvField('+1 555 0100')).toBe("'+1 555 0100");
  });
});

describe('toCsv', () => {
  it('writes a header row followed by the data', () => {
    const rows = [
      { action: 'user.updated', target: 'user' },
      { action: 'team.created', target: 'team' },
    ];

    expect(
      toCsv(rows, [
        { header: 'Action', value: (row) => row.action },
        { header: 'Target', value: (row) => row.target },
      ]),
    ).toBe('Action,Target\r\nuser.updated,user\r\nteam.created,team');
  });

  it('writes just the header when there is nothing to export', () => {
    expect(toCsv([], [{ header: 'Action', value: () => '' }])).toBe('Action');
  });
});

describe('parseCsv', () => {
  it('reads a plain document', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('reads what escapeCsvField writes', () => {
    const written = toCsv(
      [{ name: 'Diaz, Dana', note: 'a "quoted" word\nover two lines' }],
      [
        { header: 'Name', value: (row) => row.name },
        { header: 'Note', value: (row) => row.note },
      ],
    );

    expect(parseCsv(written)).toEqual([
      ['Name', 'Note'],
      ['Diaz, Dana', 'a "quoted" word\nover two lines'],
    ]);
  });

  it('accepts any of the three line endings', () => {
    expect(parseCsv('a\r\nb\nc\rd')).toEqual([['a'], ['b'], ['c'], ['d']]);
  });

  it('ignores blank lines and a trailing newline', () => {
    expect(parseCsv('a,b\r\n\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps an empty cell inside a row', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
  });

  it('drops a byte-order mark left by a spreadsheet', () => {
    expect(parseCsv('﻿email,name')).toEqual([['email', 'name']]);
  });

  it('refuses a file that ends inside a quoted value', () => {
    expect(() => parseCsv('a,"b')).toThrow('unclosed quote');
  });

  it('reads an empty document as nothing at all', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\r\n')).toEqual([]);
  });
});

describe('scanCsv line numbers', () => {
  it('points at the line a record started on', () => {
    const records = scanCsv('email\r\nfirst@example.com\r\n"multi\nline"\r\nlast@example.com');

    expect(records.map((record) => record.line)).toEqual([1, 2, 3, 5]);
  });
});

describe('parseCsvDocument', () => {
  it('keys the rows by their column names', () => {
    const document = parseCsvDocument('Email,Display Name\r\nmira@example.com,Mira');

    expect(document.headers).toEqual(['email', 'displayname']);
    expect(document.rows[0]?.fields).toEqual({
      email: 'mira@example.com',
      displayname: 'Mira',
    });
  });

  it('treats the same column name under three house styles as one column', () => {
    expect(normalizeHeader('Display Name')).toBe('displayname');
    expect(normalizeHeader('display_name')).toBe('displayname');
    expect(normalizeHeader(' displayName ')).toBe('displayname');
  });

  it('fills in a column the row stopped short of', () => {
    const document = parseCsvDocument('email,role\r\nmira@example.com');

    expect(document.rows[0]?.fields).toEqual({ email: 'mira@example.com', role: '' });
  });

  it('keeps the first of two columns sharing a name', () => {
    const document = parseCsvDocument('email,email\r\nfirst@example.com,second@example.com');

    expect(document.rows[0]?.fields.email).toBe('first@example.com');
  });

  it('reads a header-only file as no rows', () => {
    expect(parseCsvDocument('email,name').rows).toEqual([]);
    expect(parseCsvDocument('').headers).toEqual([]);
  });
});
