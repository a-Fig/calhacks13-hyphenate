// The skeleton's spike page (norn/NOTES.md), unchanged, served at /spike. The Playwright spikes in
// ../spike open this route.
import { NornProvider } from './store.tsx';
import { App } from './App.tsx';
import './styles.css';

export default function SpikeRoute() {
  return (
    <NornProvider>
      <App />
    </NornProvider>
  );
}
