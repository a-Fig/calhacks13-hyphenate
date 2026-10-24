import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const subscribe = (cb: () => void) => {
  window.addEventListener('popstate', cb);
  window.addEventListener('nx-nav', cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener('nx-nav', cb);
  };
};

/** The current pathname. */
export const usePath = () => useSyncExternalStore(subscribe, () => window.location.pathname);

export function navigate(to: string) {
  if (to === window.location.pathname) return;
  window.history.pushState({}, '', to);
  window.dispatchEvent(new Event('nx-nav'));
  window.scrollTo({ top: 0 });
}

/** An in-app link: no page load. */
export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={to}
      {...rest}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        navigate(to);
      }}
    />
  );
}
