import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './norn.css';
import { usePath } from './router.tsx';
import { Shell } from './screens/Shell.tsx';
import { EcrList } from './screens/EcrList.tsx';
import { EcrPage } from './screens/EcrPage.tsx';

// The SpacetimeDB spike page lives at /spike. It is loaded only there, so the demo screens never open a
// database connection. No StrictMode: the spike would open its dev connection twice.
const Spike = lazy(() => import('./SpikeRoute.tsx'));

function Routes() {
  const path = usePath();
  const ecr = /^\/ecr\/([^/]+)\/?$/.exec(path);
  return (
    <Shell>
      {ecr ? <EcrPage id={decodeURIComponent(ecr[1])} /> : <EcrList />}
    </Shell>
  );
}

function Root() {
  if (window.location.pathname.startsWith('/spike')) {
    return (
      <Suspense fallback={null}>
        <Spike />
      </Suspense>
    );
  }
  return <Routes />;
}

createRoot(document.getElementById('root')!).render(<Root />);
