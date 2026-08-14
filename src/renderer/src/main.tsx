import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './styles/tokens.css';
import './styles/workspace.css';
import './styles/action-center.css';
import './styles/lifecycle.css';
import './styles/motion.css';
import './styles/responsive.css';

document.documentElement.dataset.ui = 'refined';

const root = document.getElementById('root');
if (!root) throw new Error('Renderer root is missing');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
