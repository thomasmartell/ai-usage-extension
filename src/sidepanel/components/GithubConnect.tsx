import React, { useState } from 'react';
import { msg } from '../../shared/i18n';
import type { GithubUsage } from '../../shared/types';
import type { GithubAuth } from '../hooks/useGithubAuth';

interface GithubConnectProps {
  auth: GithubAuth;
  usage?: GithubUsage;
  now: number;
}

const openVerification = async (code: string, url: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    // The code stays on screen, so a blocked clipboard only costs a retype.
  }
  await chrome.tabs.create({ url });
};

/** Sign-in, pending-code and signed-in footers for the GitHub card. */
export const GithubConnect: React.FC<GithubConnectProps> = ({ auth, usage, now }) => {
  const { signedIn, deviceFlow, starting, error, signIn, saveToken, signOut } = auth;

  const [tokenFormOpen, setTokenFormOpen] = useState(false);

  if (signedIn) {
    return (
      <>
        {usage && usage.windows.length === 0 && (
          <p className="au-empty">{msg('githubNoBilling')}</p>
        )}
        {usage?.unreadable?.map(({ login, status }) => (
          <p key={login} className="au-footnote">
            {msg('githubUnreadable', [login, String(status)])}
          </p>
        ))}
        <p className="au-footnote au-github__account">
          {usage && <span>{msg('githubSignedInAs', usage.viewer)}</span>}
          <button type="button" className="au-link-btn" onClick={() => void signOut()}>
            {msg('githubSignOut')}
          </button>
        </p>
      </>
    );
  }

  const pending = deviceFlow && !deviceFlow.error && deviceFlow.expiresAt > now ? deviceFlow : null;
  if (pending) {
    return (
      <div className="au-github__pending">
        <p className="au-footnote">{msg('githubEnterCode')}</p>
        <p className="au-github__code">{pending.userCode}</p>
        <button
          type="button"
          className="au-btn"
          onClick={() => void openVerification(pending.userCode, pending.verificationUri)}
        >
          {msg('githubOpenAndCopy')}
        </button>
        <p className="au-footnote au-github__account">
          <span>{msg('githubWaiting')}</span>
          <button type="button" className="au-link-btn" onClick={() => void signOut()}>
            {msg('githubCancel')}
          </button>
        </p>
      </div>
    );
  }

  const failure = error ?? deviceFlow?.error ?? null;
  return (
    <div className="au-github__pending">
      {failure && <p className="au-footnote">{msg('githubSignInFailed', failure)}</p>}
      {tokenFormOpen ? (
        <TokenForm disabled={starting} onSave={saveToken} />
      ) : (
        <div className="au-github__account">
          <button
            type="button"
            className="au-btn"
            disabled={starting}
            onClick={() => void signIn()}
          >
            {msg('githubSignIn')}
          </button>
          <button type="button" className="au-link-btn" onClick={() => setTokenFormOpen(true)}>
            {msg('githubUseToken')}
          </button>
        </div>
      )}
    </div>
  );
};

const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

interface TokenFormProps {
  disabled: boolean;
  onSave: (token: string, orgs: string[]) => Promise<void>;
}

/** Paste a fine-grained token plus the org it belongs to (such tokens cannot list orgs). */
const TokenForm: React.FC<TokenFormProps> = ({ disabled, onSave }) => {
  const [token, setToken] = useState('');
  const [org, setOrg] = useState('');

  return (
    <form
      className="au-github__form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(token, [org]);
      }}
    >
      <p className="au-footnote">
        {msg('githubTokenHint')}{' '}
        <a className="au-footer__link" href={NEW_TOKEN_URL} target="_blank" rel="noreferrer">
          {msg('githubCreateToken')}
        </a>
      </p>
      <input
        className="au-input"
        type="password"
        autoComplete="off"
        placeholder={msg('githubTokenLabel')}
        aria-label={msg('githubTokenLabel')}
        value={token}
        onChange={(event) => setToken(event.target.value)}
      />
      <input
        className="au-input"
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder={msg('githubOrgLabel')}
        aria-label={msg('githubOrgLabel')}
        value={org}
        onChange={(event) => setOrg(event.target.value)}
      />
      <button type="submit" className="au-btn" disabled={disabled || !token.trim()}>
        {msg('githubSaveToken')}
      </button>
    </form>
  );
};
