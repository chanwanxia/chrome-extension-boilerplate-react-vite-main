import initClient from '../initializers/init-client.js';
(() => {
  let pendingReload = false;
  initClient({
    // @ts-expect-error That's because of the dynamic code loading
    id: __HMR_ID,
    onUpdate: () => {
      // disable reload when tab is hidden
      if (document.hidden) {
        pendingReload = true;
        return;
      }
      reload();
    },
  });
  // reload
  const reload = () => {
    pendingReload = false;
    window.location.reload();
  };
  // reload when tab is visible
  const reloadWhenTabIsVisible = () => {
    if (!document.hidden && pendingReload) {
      reload();
    }
  };
  document.addEventListener('visibilitychange', reloadWhenTabIsVisible);
})();
