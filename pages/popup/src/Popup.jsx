import '@src/Popup.css';
import { withErrorBoundary, withSuspense } from '@extension/shared/react';
import { cn, ErrorDisplay, LoadingSpinner } from '@extension/ui/react';

const Popup = () => (
  <div className={cn('App', 'bg-slate-50')}>
    <div>
      <button className={'mr bg-pink-200'}>start recording1</button>
      <button className={'bg-gray-300'}>stop recording</button>
    </div>

    <div className={'mt'}>
      <button className={'mr bg-pink-200'}>copy logs</button>
      <button className={'bg-gray-300'}>clear logs</button>
    </div>

    <div className={'log-container'}></div>
  </div>
);
export default withErrorBoundary(withSuspense(Popup, <LoadingSpinner />), ErrorDisplay);
