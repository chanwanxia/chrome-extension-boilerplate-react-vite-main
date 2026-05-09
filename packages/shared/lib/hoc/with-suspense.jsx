import { Suspense } from 'react';
export const withSuspense = (Component, SuspenseComponent) => props => (
  <Suspense fallback={SuspenseComponent}>
    <Component {...props} />
  </Suspense>
);
