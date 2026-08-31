import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { DEMO_TOTP_SECRET, getDatabase, totp, twoFactor } from '@/domain';
import { DEMO_PASSWORD, adminActor, danaActor, rajActor } from '../helpers';
import { renderApp } from '../renderApp';

function card(): HTMLElement {
  return screen
    .getByRole('heading', { name: 'Two-step verification' })
    .closest('section') as HTMLElement;
}

/** The secret the console just generated, which is what a phone would have scanned. */
function pendingSecret(userId: string): string {
  return getDatabase().twoFactor.find((record) => record.userId === userId)?.secret ?? '';
}

describe('setting two-step verification up', () => {
  it('walks from off, through a setup key, to a set of recovery codes', async () => {
    const dana = danaActor();
    const { user } = renderApp({ route: '/account', userId: dana.id });

    expect(within(card()).getByText('Off')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set up two-step verification' }));

    expect(within(card()).getByText('Setup key')).toBeInTheDocument();
    // Still off until a code proves the phone and the console agree.
    expect(twoFactor.isTwoFactorEnabled(dana.id)).toBe(false);

    await user.type(
      screen.getByLabelText('Code from your authenticator'),
      totp.currentCode(pendingSecret(dana.id)),
    );
    await user.click(screen.getByRole('button', { name: 'Confirm and turn on' }));

    expect(await within(card()).findByRole('status')).toHaveTextContent(
      'only time they can be shown',
    );
    expect(twoFactor.isTwoFactorEnabled(dana.id)).toBe(true);
    expect(within(card()).getAllByRole('listitem')).toHaveLength(twoFactor.RECOVERY_CODE_COUNT);
  });

  it('shows the setup key in groups, so it can be typed in by hand', async () => {
    const dana = danaActor();
    const { user } = renderApp({ route: '/account', userId: dana.id });
    await user.click(screen.getByRole('button', { name: 'Set up two-step verification' }));

    const key = within(card()).getByText(/^[A-Z2-7]{4} /);
    expect(key.textContent?.replace(/ /g, '')).toBe(pendingSecret(dana.id).replace(/=+$/, ''));
  });

  it('keeps the enrolment open when the code is wrong', async () => {
    const dana = danaActor();
    const { user } = renderApp({ route: '/account', userId: dana.id });
    await user.click(screen.getByRole('button', { name: 'Set up two-step verification' }));

    await user.type(screen.getByLabelText('Code from your authenticator'), '000000');
    await user.click(screen.getByRole('button', { name: 'Confirm and turn on' }));

    expect(await within(card()).findByRole('alert')).toHaveTextContent('That code is not right');
    expect(screen.getByRole('button', { name: 'Confirm and turn on' })).toBeInTheDocument();
    expect(twoFactor.isTwoFactorEnabled(dana.id)).toBe(false);
  });

  it('offers to start again on an enrolment that was abandoned half-finished', () => {
    const dana = danaActor();
    twoFactor.beginTwoFactorEnrolment(dana);
    renderApp({ route: '/account', userId: dana.id });

    expect(within(card()).getByText('Half set up')).toBeInTheDocument();
    expect(within(card()).getByText(/still all that is needed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start again' })).toBeInTheDocument();
  });
});

describe('an account that already has one', () => {
  it('says when it was turned on and how many recovery codes are left', () => {
    renderApp({ route: '/account', userId: rajActor().id });

    expect(within(card()).getByText('On')).toBeInTheDocument();
    // The seed spends one of the ten, which is what makes the counter worth showing.
    expect(within(card()).getByText(/9 of 10/)).toBeInTheDocument();
  });

  it('mints a new set of codes for a password', async () => {
    const { user } = renderApp({ route: '/account', userId: rajActor().id });

    await user.click(screen.getByRole('button', { name: 'New recovery codes' }));
    await user.type(screen.getByLabelText('Your password'), DEMO_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Generate new codes' }));

    expect(await within(card()).findByRole('status')).toHaveTextContent(
      'only time they can be shown',
    );
    expect(within(card()).getAllByRole('listitem')).toHaveLength(twoFactor.RECOVERY_CODE_COUNT);
  });

  it('refuses to turn off on the wrong password', async () => {
    const { user } = renderApp({ route: '/account', userId: rajActor().id });

    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    await user.type(screen.getByLabelText('Your password'), 'not-the-password');
    await user.click(screen.getByRole('button', { name: 'Turn off two-step verification' }));

    expect(await within(card()).findByRole('alert')).toHaveTextContent(
      'Your password is incorrect',
    );
    expect(twoFactor.isTwoFactorEnabled(rajActor().id)).toBe(true);
  });

  it('turns off on the right one, and takes the recovery codes with it', async () => {
    const raj = rajActor();
    const { user } = renderApp({ route: '/account', userId: raj.id });

    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    await user.type(screen.getByLabelText('Your password'), DEMO_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Turn off two-step verification' }));

    expect(await within(card()).findByRole('status')).toHaveTextContent('no longer work');
    expect(twoFactor.isTwoFactorEnabled(raj.id)).toBe(false);
    expect(getDatabase().recoveryCodes.filter((code) => code.userId === raj.id)).toHaveLength(0);
  });
});

describe('the users screen', () => {
  it('shows which accounts have one and lets an admin clear it', async () => {
    const { user } = renderApp({ route: '/users', userId: adminActor().id });
    const row = screen.getByText('raj@example.com').closest('tr') as HTMLElement;

    expect(within(row).getByText('On')).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: 'Reset two-step' }));
    await user.click(within(row).getByRole('button', { name: 'Confirm reset' }));

    expect(twoFactor.isTwoFactorEnabled(rajActor().id)).toBe(false);
    expect(screen.queryByRole('button', { name: 'Reset two-step' })).not.toBeInTheDocument();
  });

  it('filters down to the accounts still on a password alone', async () => {
    const { user } = renderApp({ route: '/users', userId: adminActor().id });

    await user.selectOptions(screen.getByLabelText('Two-step'), 'true');
    expect(screen.getByText('raj@example.com')).toBeInTheDocument();
    expect(screen.queryByText('dana@example.com')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Two-step'), 'false');
    expect(screen.queryByText('raj@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('dana@example.com')).toBeInTheDocument();
  });
});

describe('the sign-in card', () => {
  it('prints the code the seeded authenticator is currently showing', () => {
    renderApp({ route: '/sign-in' });

    expect(screen.getByText(totp.currentCode(DEMO_TOTP_SECRET))).toBeInTheDocument();
  });
});
