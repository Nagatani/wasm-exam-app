import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  ParamsContext,
  RouterContext,
  useLocation,
  useNavigate,
  type NavigateFunction,
  type NavigateOptions,
  type RouterLocation,
} from './routerContext';
import { isNavLinkActive, matchPath } from './routerMatch';

function readWindowLocation(): RouterLocation {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    state: window.history.state,
  };
}

export function BrowserRouter({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<RouterLocation>(readWindowLocation);

  useEffect(() => {
    const onPopState = () => {
      setLocation(readWindowLocation());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback<NavigateFunction>(
    (toOrDelta: string | number, options?: NavigateOptions) => {
      if (typeof toOrDelta === 'number') {
        window.history.go(toOrDelta);
        return;
      }

      const prevPathname = window.location.pathname;
      const nextState = options?.state ?? null;
      if (options?.replace) {
        window.history.replaceState(nextState, '', toOrDelta);
      } else {
        window.history.pushState(nextState, '', toOrDelta);
      }

      const nextLocation = readWindowLocation();
      setLocation(nextLocation);

      if (nextLocation.pathname !== prevPathname) {
        window.scrollTo(0, 0);
      }
    },
    [],
  );

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

const APP_TITLE = 'プログラミング演習システム';

export interface RouteProps {
  path: string;
  element: ReactNode;
  title?: string;
}

export function Route(_props: RouteProps): null {
  return null;
}

function collectRouteElements(children: ReactNode): ReactElement<RouteProps>[] {
  const routes: ReactElement<RouteProps>[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === Fragment) {
      const fragProps = child.props as { children?: ReactNode };
      routes.push(...collectRouteElements(fragProps.children));
      return;
    }
    if (child.type === Route) {
      routes.push(child as ReactElement<RouteProps>);
    }
  });
  return routes;
}

export function Routes({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const routes = collectRouteElements(children);
  const prevPathnameRef = useRef(pathname);
  const [announcement, setAnnouncement] = useState('');

  let matchedRoute: ReactElement<RouteProps> | null = null;
  let matchedParams: Record<string, string> | null = null;

  for (const route of routes) {
    const params = matchPath(route.props.path, pathname);
    if (params !== null) {
      matchedRoute = route;
      matchedParams = params;
      break;
    }
  }

  const pageTitle = matchedRoute?.props.title;

  useEffect(() => {
    document.title = pageTitle ? `${pageTitle} | ${APP_TITLE}` : APP_TITLE;
  }, [pageTitle]);

  useEffect(() => {
    if (prevPathnameRef.current === pathname) return;
    prevPathnameRef.current = pathname;
    setAnnouncement(pageTitle ? `${pageTitle}ページに移動しました` : 'ページを移動しました');
    const raf = requestAnimationFrame(() => {
      document.getElementById('main-content')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [pathname, pageTitle]);

  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
      {matchedRoute && matchedParams ? (
        <ParamsContext.Provider value={matchedParams}>
          {matchedRoute.props.element}
        </ParamsContext.Provider>
      ) : null}
    </>
  );
}

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
  replace?: boolean;
  state?: unknown;
}

function isModifiedEvent(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.metaKey || event.altKey || event.ctrlKey || event.shiftKey;
}

export function Link({ to, replace, state, onClick, target, ...rest }: LinkProps) {
  const navigate = useNavigate();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      (target && target !== '_self') ||
      isModifiedEvent(event)
    ) {
      return;
    }
    event.preventDefault();
    navigate(to, { replace, state });
  }

  return <a href={to} target={target} onClick={handleClick} {...rest} />;
}

export interface NavLinkProps extends Omit<LinkProps, 'className'> {
  end?: boolean;
  className?: string | ((props: { isActive: boolean }) => string);
}

export function NavLink({ to, end = false, className, ...rest }: NavLinkProps) {
  const { pathname } = useLocation();
  const isActive = isNavLinkActive(to, pathname, end);
  const resolvedClassName =
    typeof className === 'function' ? className({ isActive }) : className;

  return (
    <Link
      to={to}
      className={resolvedClassName}
      aria-current={isActive ? 'page' : undefined}
      {...rest}
    />
  );
}

export interface NavigateProps {
  to: string;
  replace?: boolean;
  state?: unknown;
}

export function Navigate({ to, replace, state }: NavigateProps): null {
  const navigate = useNavigate();

  useEffect(() => {
    navigate(to, { replace, state });
  }, [navigate, to, replace, state]);

  return null;
}
