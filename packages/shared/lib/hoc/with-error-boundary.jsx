import { ErrorBoundary } from 'react-error-boundary';
export const withErrorBoundary = (Component, FallbackComponent) =>
  function WithErrorBoundary(props) {
    return (
      <ErrorBoundary FallbackComponent={FallbackComponent}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
