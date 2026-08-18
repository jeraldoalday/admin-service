import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { auth } from '@/domain';
import { danaActor, DEMO_PASSWORD } from '../helpers';
import { renderApp } from '../renderApp';

function openAccount() {
  return renderApp({ route: '/account', userId: danaActor().id });
}

describe('the account screen', () => {
  it('shows what the signed-in account is and what it can reach', () => {
    openAccount();

    // The sidebar carries the signed-in email too, so this looks at the screen itself.
    const main = within(screen.getByRole('main'));
    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument();
    expect(main.getByText('dana@example.com')).toBeInTheDocument();
    expect(main.getByText(/Member — team screens are scoped/)).toBeInTheDocument();
  });

  it('renames the account and reflects it in the sidebar straight away', async () => {
    const { user } = openAccount();

    const field = screen.getByLabelText('Display name');
    await user.clear(field);
    await user.type(field, 'Dana D.');
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    expect(await screen.findByRole('status')).toHaveTextContent('display name has been updated');
    expect(screen.getByText('Dana D.')).toBeInTheDocument();
    expect(auth.findUserById(danaActor().id)?.displayName).toBe('Dana D.');
  });

  it('reports a rename the domain refuses', async () => {
    const { user } = openAccount();

    await user.clear(screen.getByLabelText('Display name'));
    await user.type(screen.getByLabelText('Display name'), '   ');
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Display name is required');
  });

  it('changes the password and clears the form behind it', async () => {
    const { user } = openAccount();

    await user.type(screen.getByLabelText('Current password'), DEMO_PASSWORD);
    await user.type(screen.getByLabelText('New password'), 'a-longer-secret');
    await user.type(screen.getByLabelText('Confirm new password'), 'a-longer-secret');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('status')).toHaveTextContent('password has been changed');
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(auth.loginUser({ email: 'dana@example.com', password: 'a-longer-secret' }).id).toBe(
      danaActor().id,
    );
  });

  it('refuses the change when the current password is wrong', async () => {
    const { user } = openAccount();

    await user.type(screen.getByLabelText('Current password'), 'not-the-password');
    await user.type(screen.getByLabelText('New password'), 'a-longer-secret');
    await user.type(screen.getByLabelText('Confirm new password'), 'a-longer-secret');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your current password is incorrect',
    );
    expect(screen.getByLabelText('Current password')).toHaveValue('not-the-password');
  });

  it('reports a confirmation that does not match', async () => {
    const { user } = openAccount();

    await user.type(screen.getByLabelText('Current password'), DEMO_PASSWORD);
    await user.type(screen.getByLabelText('New password'), 'a-longer-secret');
    await user.type(screen.getByLabelText('Confirm new password'), 'a-different-secret');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The new passwords do not match');
  });
});
