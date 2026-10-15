import claudeBrandAsset from '../assets/brands/claude-anthropic.jpg';
import codexBrandAsset from '../assets/brands/codex-openai.jpg';
import { msg } from '../shared/i18n';
import { codexDiagnostics, DIAGNOSTIC_BUILD } from '../shared/diagnostics';
import { useNow } from '../shared/hooks/useNow';
import { ProviderCard } from './components/ProviderCard';
import { useUsageData } from './hooks/useUsageData';
import './styles/global.css';

export const App = () => {
  const {
    usage,
    claudeOverlayEnabled,
    codexOverlayEnabled,
    settingsExpanded,
    loading,
    refreshing,
    error,
    refresh,
    setClaudeOverlayEnabled,
    setCodexOverlayEnabled,
    setSettingsExpanded,
  } = useUsageData();
  const now = useNow(30_000);

  const initialLoading = loading && !usage.claude && !usage.codex;

  return (
    <main className="au-shell">
      <header className="au-topbar">
        <div>
          <h2 className="au-title">{msg('popupTitle')}</h2>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className={`au-btn-refresh ${refreshing ? 'au-btn-refresh--spin' : ''}`}
          title={msg('refreshUsage')}
          aria-label={msg('refreshUsage')}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="au-icon-refresh"
          >
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <polyline points="21 3 21 8 16 8" />
          </svg>
        </button>
      </header>

      {error && (
        <p className="au-error" role="alert">
          {msg('refreshErrorPrefix')} - {error}
        </p>
      )}

      <div className="au-cards">
        <ProviderCard
          title="Claude"
          iconSrc={claudeBrandAsset}
          iconAlt="Claude by Anthropic"
          usage={usage.claude}
          loading={initialLoading}
          now={now}
          emptyHint={msg('emptyClaude')}
        />
        <ProviderCard
          title="Codex"
          iconSrc={codexBrandAsset}
          iconAlt="OpenAI"
          usage={usage.codex}
          loading={initialLoading}
          now={now}
          emptyHint={msg('emptyCodex')}
        />
      </div>

      <section className="au-settings">
        <button
          type="button"
          className="au-settings__summary"
          onClick={() => setSettingsExpanded(!settingsExpanded)}
          aria-expanded={settingsExpanded}
          aria-controls="au-settings-panel"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="au-settings__icon"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
          </svg>
          <span className="au-settings__title">{msg('settingsLabel')}</span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`au-settings__chevron ${
              settingsExpanded ? 'au-settings__chevron--open' : ''
            }`}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {settingsExpanded && (
          <div className="au-settings__panel" id="au-settings-panel">
            <div className="au-overlay-toggle">
              <p className="au-overlay-toggle__label">{msg('overlayToggleLabel')}</p>
              <label className="au-switch" aria-label={msg('overlayToggleLabel')}>
                <input
                  type="checkbox"
                  checked={claudeOverlayEnabled || codexOverlayEnabled}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setClaudeOverlayEnabled(checked);
                    setCodexOverlayEnabled(checked);
                  }}
                />
                <span className="au-switch__slider" />
              </label>
            </div>
          </div>
        )}
      </section>

      <details className="au-diagnostics">
        <summary>Quota diagnostics · {DIAGNOSTIC_BUILD}</summary>
        <p>Quota values and anonymous account fingerprints only. No passwords or tokens.</p>
        <pre>{JSON.stringify(codexDiagnostics(usage.codex), null, 2)}</pre>
      </details>

      <footer className="au-footer">
        <a
          className="au-footer__link"
          href="https://github.com/cupcakedev/ai-usage-extension"
          target="_blank"
          rel="noreferrer"
        >
          {msg('sourceCode')}
        </a>
        <span aria-hidden="true">·</span>
        <span>{msg('github')}</span>
      </footer>
    </main>
  );
};
