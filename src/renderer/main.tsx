import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { maybeInstallDemoBridge } from './lib/demo-bootstrap';
import './lib/i18n';
import './index.css';
import { installDebugBridge } from './debug-bridge';

// `?demo=1` on a served page stands in for the Electron bridge, so the renderer
// can be reviewed page by page in a browser. The call is inert in a production
// build — see the `import.meta.env.DEV` guard inside.
maybeInstallDemoBridge();

// Dev-only handle for verification harnesses (see debug-bridge.ts).
installDebugBridge();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
