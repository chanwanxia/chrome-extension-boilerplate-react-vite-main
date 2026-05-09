import '@src/Popup.css';
import { useBiliScraper } from './bilibili/useBiliScraper';
import { withErrorBoundary, withSuspense } from '@extension/shared/react';
import { cn, ErrorDisplay, LoadingSpinner } from '@extension/ui/react';
const Popup = () => {
  const { currentPageUrl, isBiliPage, isButtonDisabled, isLoading, handleScrapeBiliData } = useBiliScraper();
  return (
    <div className={cn('App', 'bg-slate-50')}>
      <header className={cn('App-header', 'text-gray-900')}>
        <button
          className={cn(
            'mt-4 rounded px-4 py-1 font-bold shadow transition-all',
            isButtonDisabled
              ? 'cursor-not-allowed bg-gray-300 text-gray-500'
              : 'bg-pink-200 text-black hover:scale-105',
          )}
          onClick={handleScrapeBiliData}
          disabled={isButtonDisabled}>
          {isLoading ? '获取中...' : '获取bilibili数据'}
        </button>
        {!isBiliPage && currentPageUrl && (
          <p className="mt-2 text-xs text-red-500">仅在 search.bilibili.com 页面可用</p>
        )}
      </header>
    </div>
  );
};
export default withErrorBoundary(withSuspense(Popup, <LoadingSpinner />), ErrorDisplay);
