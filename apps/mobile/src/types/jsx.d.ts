/**
 * Global `JSX` namespace shim for React 19 (`@types/react@19`).
 *
 * React 19's type definitions removed the ambient global `JSX` namespace
 * that `@types/react@18` used to declare. The scoped `React.JSX` namespace
 * is now the source of truth. The Disney World Tracker screens and themed
 * primitives use the bare `JSX.Element` return annotation in dozens of
 * places (and `expo-linear-gradient`'s class component is validated against
 * `JSX.ElementClass`), so rather than rewrite every `JSX.X` reference to
 * `React.JSX.X`, this shim re-exposes the global `JSX` namespace as a thin
 * alias over `React.JSX`.
 *
 * This mirrors the migration approach the React team documents for SDKs that
 * still rely on the global namespace: alias the global to `React.JSX` so
 * existing annotations keep resolving. Remove this file if/when all source
 * is migrated to `React.JSX.*` directly.
 */
import type * as React from 'react';

declare global {
  namespace JSX {
    type ElementType = React.JSX.ElementType;
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface Element extends React.JSX.Element {}
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface ElementClass extends React.JSX.ElementClass {}
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface ElementAttributesProperty extends React.JSX.ElementAttributesProperty {}
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface ElementChildrenAttribute extends React.JSX.ElementChildrenAttribute {}
    type LibraryManagedAttributes<C, P> = React.JSX.LibraryManagedAttributes<C, P>;
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface IntrinsicAttributes extends React.JSX.IntrinsicAttributes {}
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface IntrinsicClassAttributes<T> extends React.JSX.IntrinsicClassAttributes<T> {}
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface IntrinsicElements extends React.JSX.IntrinsicElements {}
  }
}
