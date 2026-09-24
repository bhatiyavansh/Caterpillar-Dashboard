/**
 * The type for an icon passed around as a value.
 *
 * `React.ElementType` looks like the obvious choice and is why these call sites
 * failed to type check: with no type argument it resolves its props to `never`,
 * so passing `className` or `aria-hidden` is an error. Every icon in this
 * codebase is an SVG component, so saying that directly is both accurate and
 * assignable.
 */
import type * as React from "react";

export type IconComponent = React.ComponentType<React.SVGProps<SVGSVGElement>>;
