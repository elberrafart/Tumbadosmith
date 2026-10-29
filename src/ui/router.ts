// Minimal screen router: each screen renders into the root and returns a cleanup.

export type Route =
  | { name: 'home' }
  | { name: 'menu' }
  | { name: 'tuner' }
  | { name: 'riffs' }
  | { name: 'play'; chartId: string; mode: 'play' | 'practice' }
  | { name: 'results'; chartId: string; mode: 'play' | 'practice'; result: import('../game/session').SessionResult; newBest: boolean }
  | { name: 'settings'; from: 'home' | 'menu' }
  | { name: 'calibrate' };

export type Screen = (root: HTMLElement, route: Route) => (() => void) | void;

const screens = new Map<Route['name'], Screen>();
let root: HTMLElement;
let cleanup: (() => void) | void;
let current: Route = { name: 'home' };

export function register(name: Route['name'], screen: Screen): void {
  screens.set(name, screen);
}

export function mount(el: HTMLElement): void {
  root = el;
}

export function navigate(route: Route): void {
  if (typeof cleanup === 'function') cleanup();
  current = route;
  root.replaceChildren();
  root.dataset.screen = route.name;
  window.scrollTo(0, 0);
  cleanup = screens.get(route.name)?.(root, route);
}

/** Re-render the current screen (e.g. after a language change). */
export function refresh(): void {
  navigate(current);
}
