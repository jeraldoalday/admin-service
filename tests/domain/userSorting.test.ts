import { describe, expect, it } from 'vitest';
import { users } from '@/domain';
import { adminActor } from '../helpers';

const names = (query: Parameters<typeof users.listUsers>[1]): string[] =>
  users.listUsers(adminActor(), query).items.map((user) => user.displayName);

describe('ordering the account list', () => {
  it('defaults to newest first, as it always did', () => {
    expect(names({})).toEqual(['Sam Lee', 'Mira Okafor', 'Raj Patel', 'Dana Diaz', 'Avery Admin']);
  });

  it('orders by display name in both directions', () => {
    expect(names({ sort: 'displayName', direction: 'asc' })).toEqual([
      'Avery Admin',
      'Dana Diaz',
      'Mira Okafor',
      'Raj Patel',
      'Sam Lee',
    ]);
    expect(names({ sort: 'displayName', direction: 'desc' })).toEqual([
      'Sam Lee',
      'Raj Patel',
      'Mira Okafor',
      'Dana Diaz',
      'Avery Admin',
    ]);
  });

  it('orders by email', () => {
    const emails = users
      .listUsers(adminActor(), { sort: 'email', direction: 'asc' })
      .items.map((user) => user.email);

    expect(emails).toEqual([...emails].sort());
  });

  it('puts admins first when ordering by role, whatever their name', () => {
    expect(names({ sort: 'role', direction: 'asc' })[0]).toBe('Avery Admin');
    expect(names({ sort: 'role', direction: 'desc' }).at(-1)).toBe('Avery Admin');
  });

  it('breaks ties on a repeated column with newest first', () => {
    // Four of the five seeded accounts are MEMBERs, so the role column cannot order them.
    const members = names({ sort: 'role', direction: 'asc' }).slice(1);

    expect(members).toEqual(['Sam Lee', 'Mira Okafor', 'Raj Patel', 'Dana Diaz']);
  });

  it('orders the page rather than only the rows on it', () => {
    const firstPage = users.listUsers(adminActor(), {
      sort: 'displayName',
      direction: 'asc',
      page: 1,
      pageSize: 2,
    });
    const secondPage = users.listUsers(adminActor(), {
      sort: 'displayName',
      direction: 'asc',
      page: 2,
      pageSize: 2,
    });

    expect(firstPage.items.map((user) => user.displayName)).toEqual(['Avery Admin', 'Dana Diaz']);
    expect(secondPage.items.map((user) => user.displayName)).toEqual(['Mira Okafor', 'Raj Patel']);
  });

  it('narrows and orders at the same time', () => {
    expect(names({ role: 'MEMBER', sort: 'displayName', direction: 'asc' })).toEqual([
      'Dana Diaz',
      'Mira Okafor',
      'Raj Patel',
      'Sam Lee',
    ]);
  });

  it('hands the export the same order the screen asked for', () => {
    const exported = users
      .listAllUsers(adminActor(), { sort: 'displayName', direction: 'asc' })
      .map((user) => user.displayName);

    expect(exported).toEqual(names({ sort: 'displayName', direction: 'asc' }));
  });

  it('refuses a column it does not know', () => {
    expect(() => users.listUsers(adminActor(), { sort: 'passwordHash' as 'email' })).toThrow(
      'sort:',
    );
  });
});
