import '@src/Panel.css';
import { t } from '@extension/i18n';
import { PROJECT_URL_OBJECT } from '@extension/shared';
import { useStorage, withErrorBoundary, withSuspense } from '@extension/shared/react';
import { exampleThemeStorage } from '@extension/storage';
import { cn, ErrorDisplay, LoadingSpinner, ToggleButton } from '@extension/ui/react';
const Panel = () => {
  const { isLight } = useStorage(exampleThemeStorage);
  const logo = isLight ? 'devtools-panel/logo_horizontal.svg' : 'devtools-panel/logo_horizontal_dark.svg';
  const goGithubSite = () => chrome.tabs.create(PROJECT_URL_OBJECT);
  return (
    <div className={cn('App', isLight ? 'bg-slate-50' : 'bg-gray-800')}>
      <header className={cn('App-header', isLight ? 'text-gray-900' : 'text-gray-100')}>
        <button onClick={goGithubSite}>
          <img src={chrome.runtime.getURL(logo)} className="App-logo" alt="logo" />
        </button>
        <p>
          Edit <code>pages/devtools-panel/src/Panel.jsx</code>
        </p>
        <ToggleButton className={'mt-4'}>{t('toggleTheme')}</ToggleButton>
      </header>
    </div>
  );
};
export default withErrorBoundary(withSuspense(Panel, <LoadingSpinner />), ErrorDisplay);
