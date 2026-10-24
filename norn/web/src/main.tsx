import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '@primer/primitives/dist/css/primitives.css';
import '@primer/primitives/dist/css/functional/themes/light.css';
import { BaseStyles, ThemeProvider } from '@primer/react';
import './norn.css';
import { usePath } from './router.tsx';
import { Shell } from './screens/Shell.tsx';
import { EcrList } from './screens/EcrList.tsx';
import { EcrPage, type Tab } from './screens/EcrPage.tsx';

// Routes: / is the ECR list; /ecr/ECR-0417 is an ECR (the Conversation tab), with /impact, /impact/cost,
// /changes and /revisions after it; /spike is the SpacetimeDB spike page.
// The spike page lives at /spike. It is loaded only there, so the demo screens never open a
// database connection. No StrictMode: the spike would open its dev connection twice.
const Spike = lazy(() => import('./SpikeRoute.tsx'));

function Routes() {
  const path = usePath();
  const m = /^\/ecr\/([^/]+)(?:\/(impact|changes|revisions)(?:\/([a-z]+))?)?\/?$/.exec(path);
  return (
    <Shell>
      {m ? <EcrPage id={decodeURIComponent(m[1])} tab={(m[2] as Tab | undefined) ?? 'conversation'} check={m[3]} /> : <EcrList />}
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
  return (
    <ThemeProvider colorMode="day" dayScheme="light">
      <BaseStyles>
        <Routes />
      </BaseStyles>
    </ThemeProvider>
  );
}

createRoot(document.getElementById('root')!).render(<Root />);
