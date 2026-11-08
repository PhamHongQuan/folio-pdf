import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// Stylesheets are loaded by each UI (ClassicView / kit/KitView) while it is shown.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
