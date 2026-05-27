import '@src/index.css';
import Popup from '@src/Popup';
import { createRoot } from 'react-dom/client';

/**
 * popup 页面入口初始化：挂载 React 根节点并渲染 Popup。
 */
const init = () => {
  const appContainer = document.querySelector('#app-container');
  if (!appContainer) {
    throw new Error('Can not find #app-container');
  }
  const root = createRoot(appContainer);
  root.render(<Popup />);
};
init();
