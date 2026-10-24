import { createRoot } from 'react-dom/client';
import { NornProvider } from './store.tsx';
import { App } from './App.tsx';
import './styles.css';

// No StrictMode: it would open the dev connection twice.
createRoot(document.getElementById('root')!).render(
  <NornProvider>
    <App />
  </NornProvider>
);
