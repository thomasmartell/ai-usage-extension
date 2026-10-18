import React, { useState } from 'react';
import { msg } from '../../shared/i18n';

interface TokenFormProps {
  hint: string;
  /** Where the user creates the token, opened in a new tab. */
  createUrl: string;
  createLabel: string;
  /** Also ask for an organization login (fine-grained GitHub tokens cannot list orgs). */
  withOrg?: boolean;
  disabled: boolean;
  onSave: (token: string, orgs: string[]) => Promise<void>;
}

/** Paste an access token, and optionally the organization it reads. */
export const TokenForm: React.FC<TokenFormProps> = ({
  hint,
  createUrl,
  createLabel,
  withOrg = false,
  disabled,
  onSave,
}) => {
  const [token, setToken] = useState('');
  const [org, setOrg] = useState('');

  return (
    <form
      className="au-token-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(token, withOrg ? [org] : []);
      }}
    >
      <p className="au-footnote">
        {hint}{' '}
        <a className="au-link" href={createUrl} target="_blank" rel="noreferrer">
          {createLabel}
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
      {withOrg && (
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
      )}
      <button type="submit" className="au-btn" disabled={disabled || !token.trim()}>
        {msg('githubSaveToken')}
      </button>
    </form>
  );
};
