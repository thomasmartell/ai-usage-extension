import React from 'react';
import { msg } from '../../shared/i18n';
import type { NetlifyAuth } from '../hooks/useNetlifyAuth';
import { TokenForm } from './TokenForm';

const NEW_TOKEN_URL = 'https://app.netlify.com/user/applications#personal-access-tokens';

/** Token form or sign-out footer for the Netlify card. */
export const NetlifyConnect: React.FC<{ auth: NetlifyAuth }> = ({ auth }) => {
  const { signedIn, saving, error, saveToken, signOut } = auth;

  if (signedIn) {
    return (
      <p className="au-footnote au-github__account">
        <span />
        <button type="button" className="au-link-btn" onClick={() => void signOut()}>
          {msg('githubSignOut')}
        </button>
      </p>
    );
  }

  return (
    <>
      {error && <p className="au-footnote">{msg('githubSignInFailed', error)}</p>}
      <TokenForm
        hint=""
        createUrl={NEW_TOKEN_URL}
        createLabel={msg('netlifyCreateToken')}
        disabled={saving}
        onSave={(token) => saveToken(token)}
      />
    </>
  );
};
