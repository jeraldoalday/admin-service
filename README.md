# admin-service

Internal admin/backoffice console. React, TypeScript, Vite.

Users, teams, invites, fine-grained permissions, API keys, and an audit trail — as a single
React application with no backend to stand up. The domain rules run in the browser against an
in-memory store that mirrors itself into `localStorage`, so the whole console is explorable
from `npm run dev` and the whole test suite runs from `npm test`.

## Stack

- **Runtime**: Node.js 20+, TypeScript (strict mode)
- **UI**: React 19 + React Router 7, built with Vite 7
- **Domain**: plain TypeScript modules, framework-free and independently testable
- **Storage**: in-memory tables persisted to `localStorage`; no database, no server
- **Validation**: zod — the same schemas back the forms and the domain functions
- **Passwords**: bcryptjs hashes; API key secrets are stored as SHA-256 digests
- **Tests**: Vitest + Testing Library (jsdom), no credentials or external services required

## Getting started

```bash
npm install
npm run dev     # http://localhost:5173
```

Demo data is seeded on first run. Sign in as `admin@example.com` — every seeded account
shares the password `password123`, and none of them arrives locked — an account that did
would be one nobody could explore for the first quarter of an hour. Everything you do persists to the browser; **Reset demo
data** in the sidebar puts it back to the seeded dataset and signs you out.

## Scripts

| Script                            | Description                                 |
| --------------------------------- | ------------------------------------------- |
| `npm run dev`                     | Vite dev server with hot module replacement |
| `npm run build`                   | Typecheck and build to `dist/`              |
| `npm run preview`                 | Serve the production build locally          |
| `npm run lint` / `lint:fix`       | ESLint (including the React Hooks rules)    |
| `npm run format` / `format:check` | Prettier                                    |
| `npm run typecheck`               | `tsc` with no emit                          |
| `npm run check`                   | Lint, format, types, and the covered suite  |
| `npm test`                        | Run the test suite once                     |
| `npm run test:watch`              | Run the test suite in watch mode            |
| `npm run test:coverage`           | Coverage report, with thresholds enforced   |

## Screens

| Route             | Access         | What it does                                                             |
| ----------------- | -------------- | ------------------------------------------------------------------------ |
| `/sign-in`        | public         | Sign in or register; the first account ever created becomes an admin     |
| `/`               | signed in      | Overview — your teams, and for admins the platform totals and activity   |
| `/account`        | signed in      | Your name, your password, and the devices signed in as you               |
| `/teams`          | signed in      | Teams you belong to, and the form that creates one                       |
| `/teams/:teamId`  | member         | One team: members, invites, API keys, activity, and settings             |
| `/invites/:token` | signed in      | Accept an invite addressed to your account's email                       |
| `/users`          | platform admin | Every account: search, filter, sort, edit, unlock, delete, batch, import |
| `/audit-logs`     | platform admin | Append-only history of every mutation, filterable by actor and text      |

Team screens only render the sections the caller's permissions cover, and the domain layer
enforces the same rules independently — a screen you can reach still cannot perform an action
you lack the permission for.

## The domain layer

Everything the UI is allowed to know lives under `src/domain/`, deliberately free of React so
the rules can be tested and reasoned about on their own. Each function takes an explicit
`Actor` — the caller on whose behalf it runs — instead of reading an ambient session, which is
what makes a denial as easy to test as a success.

**Accounts.** Passwords are bcrypt-hashed. Sign-in returns the same message whether the email
is unknown or the password is wrong, so the form cannot be used to enumerate accounts.
Deactivated accounts cannot sign in, and an existing session pointing at one is dropped on the
spot rather than at some later expiry. Admins cannot change their own role, deactivate
themselves, or delete their own account. An account manages its own name and password from
`/account`: changing a password requires proving the current one, so a session left open on a
shared machine is not by itself enough to lock its owner out, and the role and active flag
stay where they belong — on the admin screens, as somebody else's decision. Deleting an
account hands over any team it was the sole owner of before it goes, since the rules that
protect a last owner would otherwise leave that team unreachable.

**Batches.** An administrator clearing up after an incident works through a filtered list
rather than a single row, so the users screen can select accounts and activate, deactivate,
unlock, or delete all of them at once. A batch is exactly its parts: every account goes
through the same single-account function the row's own button calls, so the self-protection
rules, the session revocation that rides along with a deactivation, the handover of a team
whose only owner is being deleted, and the per-account audit entries all keep working without
being reimplemented. One account failing does not stop the rest — refusing forty because the
thirty-first was the administrator's own account is a worse answer than doing thirty-nine and
saying which one was refused — and the report says what changed, what was already in that
state, and what was refused, each in the domain's own words. An account already where the
action would put it is reported as needing no change rather than as an error, and nothing is
written for it: a bulk unlock across a page would otherwise stamp the audit log with thirty
entries describing nothing. Selections carry across pages, since a batch is often gathered a
screen at a time, but any change to the filters clears them.

**Imports.** A list of new colleagues usually already exists as a spreadsheet, and typing it
into a form thirty times is where the mistyped address gets made. `/users` reads a CSV — an
`email` and a `name` column, optionally a `role`, under whichever house style the file names
them — and shows a row-by-row preview of what importing it would do before anything is
written, each row against the line of the file it came from. The import may create accounts
and nothing else: an address that already has one is skipped and said so, since an import
that could write to existing accounts would be a way to rename an administrator, or change
their role, by uploading a file whose reviewer is looking at names rather than at what the
console will do with them. There is deliberately no password column — a CSV of plaintext
passwords is a file nobody can safely produce or delete afterwards — so each created account
is given a generated password, handed back exactly once, as an API key secret is. Imported
accounts are created by the administrator who ran the import rather than by themselves, which
is what the audit entry says; registration is the self-service act, and this is not one.

**Sign-in** is throttled and remembered. Five failed attempts inside a quarter of an hour
close an address off, and the refusal is its own error type so the form can say "wait" rather
than "that password is wrong" — telling somebody their correct password is wrong is how a
throttle gets mistaken for a broken account. An address nobody has registered locks exactly
like one that exists, since the form refuses to say which it is looking at and a throttle that
spared unknown addresses would say it on the form's behalf. The lock is derived from the
attempt rows rather than stored as a flag, as an invite's and an API key's expiry are, and
there is deliberately no separate lockout duration: the lock simply _is_ "five failures are
currently in the window", so it opens again as the fifth-newest of them ages out and there is
no second answer to drift from the first. A blocked attempt is recorded but does not count, so
nobody extends their own lockout by continuing to knock, and a deactivated account does not
come back from deactivation locked as well. An admin can open an account early from the users
screen; the cleared failures stay in the table with a timestamp rather than being deleted,
since an unlock that erased the run of failures behind it would leave the next reader unable
to tell a quiet week from a busy one somebody tidied up after.

**Sessions** are what the browser actually holds. It keeps an opaque session id, and whether
that id still opens anything — the expiry, whether it has been revoked, whether the account
behind it still exists and is still active — is read from the store on every render, so a
session revoked from another device takes effect on the next one rather than at some later
token expiry. Each session carries the name of the browser that opened it, worked out from the
user-agent string, because the point is recognition rather than forensics: somebody scanning
the list is looking for the entry that is not theirs. `/account` shows every session ever
opened against the account, ended ones included — a list of only the live ones answers "who is
signed in?" but not "was anybody signed in that I did not recognise?" — and offers both a
per-device revoke and "sign out other devices", which spares the device asking. Changing a
password ends every other session, since somebody changing a password is usually doing it
because they believe somebody else has it. Deactivating an account revokes its sessions and
deleting one takes them with it, and a sweep at boot settles the ones that expired while the
console was closed. A session the sweep settled still reads as expired rather than revoked:
"Revoked" is the word somebody scanning the list for a device that is not theirs is looking
for, so it is reserved for a session somebody actually ended.

**Teams** are a self-service multi-tenancy layer, independent of the platform `role`: any
signed-in user can create a team and becomes its `OWNER`. Team roles (`OWNER`/`ADMIN`/`MEMBER`)
only mean something inside that team. A team always needs at least one owner — the last one
cannot be demoted, removed, or leave — and only an owner can make somebody else one, since
ownership is the part of a team that the grantable permissions deliberately do not cover. Invites are single-use tokens tied to an email address,
expire after seven days, and can only be accepted while signed in as the address they name.
There is no mail transport, so a pending invite's link stays retrievable from the invites tab
for as long as it is valid; accepted, revoked, and expired invites offer none, because their
links are dead. An invite's status is derived as it is read rather than taken from the row, so
one that ages out reads as expired everywhere immediately instead of waiting to be presented;
a sweep at boot then brings the stored rows back in line with what the screens already show.

**Permissions** add resource-scoped access within a team, independent of the coarse team role.
There are five: `MANAGE_TEAM`, `MANAGE_MEMBERS`, `MANAGE_INVITES`, `MANAGE_PERMISSIONS`, and
`MANAGE_API_KEYS`. `OWNER` and `ADMIN` hold all of them by default, `MEMBER` holds none. Grants
are additive: they can extend a member's access but never cut below their role's defaults — so
one member can run invites while everyone else stays a plain member. Team deletion stays a
hardcoded owner-only action, outside the grantable set on purpose.

**API keys** let another service authenticate as a team, with no human session involved. Only
someone holding `MANAGE_API_KEYS` can create, list, revoke, or rotate one. The plaintext secret
(`sk_…`) is returned exactly once, from creation and rotation; only a SHA-256 digest and a
display-safe prefix are stored. Each key carries its own subset of the five permissions, keys
are scoped to one team and rejected against another's data, and rotation kills the old secret
immediately. A key may carry an expiry, and — as with an invite — that expiry is derived as the
key is read rather than taken from the row: a lapsed key reads as `EXPIRED` everywhere at once,
drops out of the active filter, and stops offering rotation, which would otherwise have copied
the dead expiry onto the replacement. A key inside its last week is flagged on screen, since the
useful moment to rotate is before a caller starts failing. The API keys screen includes a panel
that exercises a key against the machine-facing read, so those guarantees are visible rather
than merely documented.

**The audit log** is append-only, written by the domain layer rather than by the screens, which
is what makes it a complete record instead of a sample. Every user, team, membership, invite,
permission, session, and API key mutation lands in it — registration included, since the
account that brings itself into existence is exactly the one a reader should not have to take
on trust. It filters by action, by target type, by actor,
by free text over the action, target, and metadata, and by date range, where a bare calendar
date names the whole day it stands for rather than the instant it begins. An actor is shown by
the account's current name and email, resolved as the log is read — the entry itself is never
rewritten when somebody renames themselves, and an entry left behind by a deleted account stays
reachable by its id.

Entries carry the team they belong to, stamped at write time rather than inferred on read,
which is what makes a team's own slice of the log readable by the people who run that team
without widening what anybody can see. The platform log at `/audit-logs` stays admin-only; the
**Activity** tab on a team screen shows that team's entries to a caller holding `MANAGE_TEAM`,
with the same filters and its own export.

**Exports** cover everything the current filters match, from the audit log, a team's activity,
and the account list alike — not the page on screen, and not the first hundred rows either,
since each reads through an unpaginated query that shares its filters with the paged one.
Ordering travels with those filters, so a file arrives in the order the screen asked for rather
than one the reader has to redo by hand. Fields are quoted per RFC 4180, and values that begin
with `=`, `+`, `-`, or `@` are prefixed, so a spreadsheet reads a user-chosen display name as
text rather than as a formula. The same module reads a CSV back — quoted values with commas
and newlines in them, any of the three line endings, a byte-order mark left by Excel — and
carries the line each record started on rather than its index, because a quoted value can
span lines and "line 27" is something a reader can go and look at.

Failures use the same error types the rules always had — `BadRequestError`, `Unauthorized`,
`Forbidden`, `NotFound`, `Conflict` — and screens render them in place instead of unmounting.

## Project layout

```
index.html               Vite entry document
src/
  main.tsx               Boots the store, mounts the router
  App.tsx                Routes and the auth/admin route guards
  styles.css             Design tokens and component styles (light + dark)
  app/
    boot.ts              Restore-or-seed sequence at startup
    session.tsx          Signed-in identity, standing in for the JWT pair
    sessionContext.ts    Session context and the useSession/useActor hooks
    store.ts             Subscribes screens to the store's revision counter
  components/            Layout, table, and form primitives
  pages/                 One module per screen; team/ holds the team tabs
    AccountPage.tsx      Self-service name, password, and security
    account/             The signed-in devices and sign-in history cards
    users/               The batch action bar and the CSV import dialog
    team/ActivityTab.tsx One team's slice of the audit log
  lib/
    format.ts            Date and permission formatting
    csv.ts               RFC 4180 serialisation, both directions
    device.ts            A readable name for the browser a session was opened from
  domain/
    types.ts             Entities, roles, permissions, role defaults
    database.ts          The tables, persistence, and change notification
    guards.ts            Actor, admin, membership, and permission checks
    auth.ts users.ts teams.ts permissions.ts apiKeys.ts audit.ts
    userImport.ts        Reading a list of accounts in from a file
    sessions.ts          Signed-in sessions: opening, resolving, revoking, sweeping
    lockout.ts           Sign-in attempts and the throttle derived from them
    service.ts           The machine-facing, API-key-authenticated surface
    seed.ts              Demo dataset
    sha256.ts            Synchronous digest for API key lookup
    validation.ts        zod schemas shared by forms and domain functions
tests/
  domain/                Rules, guards, persistence, and boot
  lib/                   The pure helpers, checked against real inputs
  ui/                    Whole-app tests driving the real screens
```

## Tests

```bash
npm test
```

Every test builds the demo dataset fresh with persistence switched off, so the suite touches no
files, no network, and no browser storage, and no test can leak state into the next. The UI
tests mount the real application — real routes, real session provider, real domain layer — and
drive it the way a person would; nothing is mocked. The SHA-256 implementation is checked
against `node:crypto` directly, since API key lookup depends on the two agreeing.

`npm run test:coverage` reports on the domain and app layers and fails below its thresholds —
currently around 98.3% of statements and 93.1% of branches, with the thresholds set just under
that so a real regression trips them and an ordinary refactor does not. `npm run check` runs
lint, formatting, types, and that covered suite in one pass, which is exactly what CI runs.
The screens are covered through the whole-app tests rather than by chasing a number.

## Status

The service this console grew out of was an Express + Prisma API; that history is in the git
log. The domain rules came across intact — the guards, the last-owner rules, the invite
lifecycle, the additive permission model, the write-once API key secrets — and now run in the
browser instead of behind HTTP.
