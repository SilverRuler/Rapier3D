import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import SandboxApp from './SandboxApp';
import './index.css';

const isSandbox = import.meta.env.VITE_APP_MODE === 'sandbox';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isSandbox ? <SandboxApp /> : <App />}
  </React.StrictMode>
);
