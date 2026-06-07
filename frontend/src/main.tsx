import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './utils/reactFlowZoomDefaults';
import App from './App';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
