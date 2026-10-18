import claudeBrandAsset from '../assets/brands/claude-anthropic.jpg';
import codexBrandAsset from '../assets/brands/codex-openai.jpg';
import githubBrandAsset from '../assets/brands/github.svg';
import { msg } from '../shared/i18n';
import { useNow } from '../shared/hooks/useNow';
import { GithubConnect } from './components/GithubConnect';
import { Headline } from './components/Headline';
import { ProviderCard } from './components/ProviderCard';
import { useGithubAuth } from './hooks/useGithubAuth';
import { useUsageData } from './hooks/useUsageData';
import './styles/global.css';

export const App = () => {
  const { usage, loading, refreshing, error, refresh } = useUsageData();
  const githubAuth = useGithubAuth();
  const now = useNow(30_000);

  const initialLoading = loading && !usage.claude && !usage.codex && !usage.github;

  return (
    <main className="au-shell">
      <header className="au-topbar">
        <Headline usage={usage} now={now} />
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
        <ProviderCard
          title="GitHub"
          iconSrc={githubBrandAsset}
          iconAlt="GitHub"
          usage={usage.github}
          loading={initialLoading}
          now={now}
          emptyHint={msg('emptyGithub')}
          footer={<GithubConnect auth={githubAuth} usage={usage.github} now={now} />}
        />
      </div>
    </main>
  );
};
