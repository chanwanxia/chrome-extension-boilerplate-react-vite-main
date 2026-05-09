import '@src/Options.css';
import { t } from '@extension/i18n';
import { PROJECT_URL_OBJECT } from '@extension/shared';
import { useStorage, withErrorBoundary, withSuspense } from '@extension/shared/react';
import { exampleThemeStorage } from '@extension/storage';
import { cn, ErrorDisplay, LoadingSpinner, ToggleButton } from '@extension/ui/react';
const Options = () => {
  const { isLight } = useStorage(exampleThemeStorage);
  const logo = isLight ? 'options/logo_horizontal.svg' : 'options/logo_horizontal_dark.svg';
  const goGithubSite = () => chrome.tabs.create(PROJECT_URL_OBJECT);
  return (
    <div className={cn('App', isLight ? 'bg-slate-50 text-gray-900' : 'bg-gray-800 text-gray-100')}>
      <button onClick={goGithubSite}>
        <img src={chrome.runtime.getURL(logo)} className="App-logo" alt="logo" />
      </button>
      <p>
        Edit <code>pages/options/src/Options.jsx</code>
      </p>
      <ToggleButton onClick={exampleThemeStorage.toggle}>{t('toggleTheme')}</ToggleButton>
    </div>
  );
};
export default withErrorBoundary(withSuspense(Options, <LoadingSpinner />), ErrorDisplay);
