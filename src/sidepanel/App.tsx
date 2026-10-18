import claudeBrandAsset from '../assets/brands/claude-anthropic.jpg';
import codexBrandAsset from '../assets/brands/codex-openai.jpg';
import githubBrandAsset from '../assets/brands/github.svg';
import netlifyBrandAsset from '../assets/brands/netlify.svg';
import { msg } from '../shared/i18n';
import { useNow } from '../shared/hooks/useNow';
import { GithubConnect } from './components/GithubConnect';
import { Headline } from './components/Headline';
import { NetlifyConnect } from './components/NetlifyConnect';
import { ProviderCard } from './components/ProviderCard';
import { useGithubAuth } from './hooks/useGithubAuth';
import { useNetlifyAuth } from './hooks/useNetlifyAuth';
import { useUsageData } from './hooks/useUsageData';
import './styles/global.css';

/** Opened in its own tab (`?view=full`) rather than the size-capped popup. */
const fullView = new URLSearchParams(window.location.search).get('view') === 'full';
if (fullView) document.documentElement.dataset.view = 'full';

const openFullView = (): void => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('src/sidepanel.html?view=full') });
  window.close();
};

export const App = () => {
  const { usage, loading, refreshing, error, refresh } = useUsageData();
  const githubAuth = useGithubAuth();
  const netlifyAuth = useNetlifyAuth();
  const now = useNow(30_000);

  const initialLoading =
    loading && !usage.claude && !usage.codex && !usage.github && !usage.netlify;
  const netlifyTeams = usage.netlify?.teams ?? [];

  const cards = {
    claude: (
      <ProviderCard
        title="Claude"
        href="https://claude.ai/settings/usage"
        iconSrc={claudeBrandAsset}
        iconAlt="Claude by Anthropic"
        usage={usage.claude}
        loading={initialLoading}
        now={now}
        emptyHint={msg('emptyClaude')}
      />
    ),
    codex: (
      <ProviderCard
        title="Codex"
        href="https://chatgpt.com/codex/settings/usage"
        iconSrc={codexBrandAsset}
        iconAlt="OpenAI"
        usage={usage.codex}
        loading={initialLoading}
        now={now}
        emptyHint={msg('emptyCodex')}
      />
    ),
    netlify: (
      <ProviderCard
        title="Netlify"
        href={
          netlifyTeams.length === 1
            ? `https://app.netlify.com/teams/${netlifyTeams[0].slug}/usage`
            : 'https://app.netlify.com'
        }
        iconSrc={netlifyBrandAsset}
        iconAlt="Netlify"
        usage={usage.netlify}
        loading={initialLoading}
        now={now}
        emptyHint={msg('emptyNetlify')}
        footer={<NetlifyConnect auth={netlifyAuth} usage={usage.netlify} />}
      />
    ),
    github: (
      <ProviderCard
        title="GitHub"
        href="https://github.com/settings/billing/usage"
        iconSrc={githubBrandAsset}
        iconAlt="GitHub"
        usage={usage.github}
        loading={initialLoading}
        now={now}
        emptyHint={msg('emptyGithub')}
        footer={<GithubConnect auth={githubAuth} usage={usage.github} now={now} />}
      />
    ),
  };

  return (
    <main className="au-shell">
      <header className="au-topbar">
        <Headline usage={usage} now={now} />
        <div className="au-topbar__actions">
          {!fullView && (
            <button
              type="button"
              onClick={openFullView}
              className="au-btn-refresh"
              title={msg('openFullView')}
              aria-label={msg('openFullView')}
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
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            </button>
          )}
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
        </div>
      </header>

      {error && (
        <p className="au-error" role="alert">
          {msg('refreshErrorPrefix')} - {error}
        </p>
      )}

      {fullView ? (
        <div className="au-board">
          <section className="au-section">
            <h3 className="au-section__title">{msg('sectionAssistants')}</h3>
            <div className="au-cards au-cards--pair">
              {cards.claude}
              {cards.codex}
            </div>
          </section>
          <section className="au-section">
            <h3 className="au-section__title">{msg('sectionServices')}</h3>
            <div className="au-cards au-cards--pair">
              {cards.github}
              {cards.netlify}
            </div>
          </section>
        </div>
      ) : (
        <div className="au-cards">
          {cards.claude}
          {cards.codex}
          {cards.github}
          {cards.netlify}
        </div>
      )}
    </main>
  );
};
