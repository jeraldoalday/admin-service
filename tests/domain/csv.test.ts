import { describe, expect, it } from 'vitest';
import { escapeCsvField, toCsv } from '@/lib/csv';

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
