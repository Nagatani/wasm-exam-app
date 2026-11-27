import { createContext, useContext } from 'react';

export interface RouterLocation {
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
}

export interface NavigateOptions {
  replace?: boolean;
  state?: unknown;
}

export interface NavigateFunction {
  (to: string, options?: NavigateOptions): void;
  (delta: number): void;
}

export interface RouterContextValue {
  location: RouterLocation;
  navigate: NavigateFunction;
}

export const RouterContext = createContext<RouterContextValue | null>(null);
export const ParamsContext = createContext<Record<string, string>>({});

export function useRouterContext(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) {
    throw new Error('Router hooks must be used inside <BrowserRouter>.');
  }
  return ctx;
}

export function useLocation(): RouterLocation {
  return useRouterContext().location;
}

export function useNavigate(): NavigateFunction {
  return useRouterContext().navigate;
}

export function useParams<
  T extends Record<string, string | undefined> = Record<string, string | undefined>,
>(): Readonly<Partial<T>> {
  return useContext(ParamsContext) as Readonly<Partial<T>>;
}
