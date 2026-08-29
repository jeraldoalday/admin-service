import { describe, expect, it } from 'vitest';
import {
  API_KEY_STATUSES,
  BULK_USER_ACTIONS,
  INVITE_STATUSES,
  SESSION_STATUSES,
  SIGN_IN_OUTCOMES,
  TEAM_PERMISSIONS,
  TEAM_ROLES,
  USER_ROLES,
} from '@/domain';
import {
  apiKeyStatusEnum,
  bulkUserActionEnum,
  inviteStatusEnum,
  sessionStatusEnum,
  signInOutcomeEnum,
  teamPermissionEnum,
  teamRoleEnum,
  userRoleEnum,
} from '@/domain/validation';

/**
 * The schemas are built from the lists in `types.ts`, and the union types are derived from
 * the same lists. This is the test that keeps that true: it fails the moment a value is
 * added to one description of a set and not the other, which is the failure a second copy of
 * a list is otherwise very good at hiding.
 */
const PAIRS = [
  ['user roles', USER_ROLES, userRoleEnum],
  ['team roles', TEAM_ROLES, teamRoleEnum],
  ['invite statuses', INVITE_STATUSES, inviteStatusEnum],
  ['API key statuses', API_KEY_STATUSES, apiKeyStatusEnum],
  ['session statuses', SESSION_STATUSES, sessionStatusEnum],
  ['sign-in outcomes', SIGN_IN_OUTCOMES, signInOutcomeEnum],
  ['team permissions', TEAM_PERMISSIONS, teamPermissionEnum],
  ['bulk actions', BULK_USER_ACTIONS, bulkUserActionEnum],
] as const;

describe('the enumerated sets', () => {
  PAIRS.forEach(([name, values, schema]) => {
    it(`describes ${name} the same way in the types and the schema`, () => {
      expect(schema.options).toEqual([...values]);
      values.forEach((value) => {
        expect(schema.safeParse(value).success).toBe(true);
      });
      expect(schema.safeParse('NOT_A_REAL_VALUE').success).toBe(false);
    });
  });

  it('holds every list frozen against a stray push', () => {
    // These are read directly by the guards and rendered directly by the screens; nothing
    // should be able to add a role or a permission to the console at runtime.
    PAIRS.forEach(([, values]) => {
      expect(() => (values as unknown as string[]).push('SNEAKY')).toThrow();
    });
  });
});
