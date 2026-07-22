import { ApiError } from '../api/client.js';
import { getCurrentUser, login, logout, onSessionChange, register, restoreSession } from './session.js';
import { syncAfterLogin } from '../sync/sync.js';
import { _resetDbForTests as clearLocalCache } from '../db.js';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}

export interface AuthPanelCallbacks {
  /** Called after a successful login/register + sync, so the caller can refresh the rest of the UI. */
  onSignedIn: () => Promise<void>;
  /** Called after logout (and local cache clear), so the caller can refresh back to guest state. */
  onSignedOut: () => Promise<void>;
  showToast: (message: string, tone?: 'ok' | 'warn') => void;
}

function closeAuthModal(): void {
  document.querySelector<HTMLElement>('#modal-root')?.replaceChildren();
}

function openAuthForm(mode: 'login' | 'register', callbacks: AuthPanelCallbacks): void {
  const root = document.querySelector<HTMLElement>('#modal-root');
  if (!root) return;

  const emailInput = el('input', { type: 'email', placeholder: 'Email', autocomplete: 'email' });
  const passwordInput = el('input', {
    type: 'password',
    placeholder: 'Password (min. 10 characters)',
    autocomplete: mode === 'login' ? 'current-password' : 'new-password',
  });
  const errorMsg = el('div', { class: 'auth-error' }, []);

  const submitBtn = el('button', { class: 'btn-import' }, [mode === 'login' ? 'Sign in' : 'Create account']);
  const switchBtn = el('button', { class: 'btn-secondary' }, [
    mode === 'login' ? "Don't have an account? Register" : 'Already have an account? Sign in',
  ]);
  const cancelBtn = el('button', { class: 'btn-secondary' }, ['Cancel']);

  submitBtn.addEventListener('click', async () => {
    errorMsg.textContent = '';
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      errorMsg.textContent = 'Email and password are required.';
      return;
    }
    submitBtn.setAttribute('disabled', 'true');
    try {
      const user = mode === 'login' ? await login(email, password) : await register(email, password);

      // Push whatever's in the guest-mode local cache up, then pull the
      // authoritative merged state back down (see sync/sync.ts). This is
      // the moment "local-first" becomes "cloud-synced".
      const { pushed, pulledCount } = await syncAfterLogin();
      closeAuthModal();
      callbacks.showToast(
        `Signed in as ${user.email}. Synced ${pushed.rowsNew} local transaction(s), ${pulledCount} total now on this device.`,
      );
      await callbacks.onSignedIn();
    } catch (err) {
      submitBtn.removeAttribute('disabled');
      if (err instanceof ApiError) {
        errorMsg.textContent = err.message;
      } else {
        errorMsg.textContent = 'Something went wrong. Check your connection and try again.';
      }
    }
  });

  switchBtn.addEventListener('click', () => openAuthForm(mode === 'login' ? 'register' : 'login', callbacks));
  cancelBtn.addEventListener('click', closeAuthModal);

  const dialog = el('div', { class: 'modal-dialog auth-dialog' }, [
    el('div', { class: 'section-label' }, [mode === 'login' ? 'Sign in' : 'Create account']),
    el('div', { class: 'manual-form auth-form' }, [emailInput, passwordInput]),
    errorMsg,
    el('div', { class: 'modal-actions' }, [submitBtn, cancelBtn]),
    switchBtn,
  ]);
  const overlay = el('div', { class: 'modal-overlay' }, [dialog]);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeAuthModal();
  });
  root.replaceChildren(overlay);
}

/**
 * Renders the account control in the top bar: "Sign in" when signed out,
 * or an email badge + "Sign out" when signed in. Also attempts to restore
 * a session from the refresh cookie on mount (page reload case).
 */
export function mountAuthControl(container: HTMLElement, callbacks: AuthPanelCallbacks): void {
  const render = () => {
    container.innerHTML = '';
    const user = getCurrentUser();

    if (!user) {
      const signInBtn = el('button', { class: 'btn-secondary' }, ['Sign in']);
      signInBtn.addEventListener('click', () => openAuthForm('login', callbacks));
      container.append(signInBtn);
      return;
    }

    const badge = el('span', { class: 'account-badge' }, [user.email]);
    const signOutBtn = el('button', { class: 'btn-secondary' }, ['Sign out']);
    signOutBtn.addEventListener('click', async () => {
      await logout();
      // Signing out on a shared device shouldn't leave the previous
      // account's data sitting in the local cache for the next person.
      await clearLocalCache();
      callbacks.showToast('Signed out. Local data cleared from this device.');
      await callbacks.onSignedOut();
    });
    container.append(badge, signOutBtn);
  };

  onSessionChange(render);
  render();

  void (async () => {
    const restored = await restoreSession();
    if (restored) {
      const { pulledCount } = await syncAfterLogin();
      callbacks.showToast(`Welcome back — ${pulledCount} transactions synced.`);
      await callbacks.onSignedIn();
    }
  })();
}
