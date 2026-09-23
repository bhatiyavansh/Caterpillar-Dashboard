"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- Button */

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded font-semibold tracking-wide transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-cat-500 text-ink-950 hover:bg-cat-400 active:bg-cat-600",
        secondary: "border border-white/10 bg-ink-700 text-zinc-100 hover:bg-ink-600",
        outline: "border border-white/15 bg-transparent text-zinc-200 hover:bg-white/5",
        ghost: "bg-transparent text-zinc-300 hover:bg-white/5",
        danger: "bg-status-crit text-white hover:bg-status-crit/85",
        quiet: "bg-white/5 text-zinc-300 hover:bg-white/10",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-5 text-sm",
        touch: "h-14 px-6 text-base",
        icon: "h-10 w-10",
        "icon-touch": "h-14 w-14",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});

export { buttonVariants };

/* ------------------------------------------------------------------ Card */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("panel-raised", className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-semibold tracking-wide text-zinc-100", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs text-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />;
}

/* ----------------------------------------------------------------- Badge */

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border border-white/15 bg-white/5 px-2 py-0.5",
        "text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300",
        className,
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------- Progress */

export function Progress({
  value,
  className,
  barClassName,
  label,
}: {
  value: number;
  className?: string;
  barClassName?: string;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-white/10", className)}
    >
      <div
        className={cn("h-full rounded-full bg-cat-500 transition-[width] duration-500", barClassName)}
        style={{ width: pct + "%" }}
      />
    </div>
  );
}

/* ---------------------------------------------------------- Form controls */

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          "h-10 rounded border border-white/15 bg-ink-800 px-3 text-sm text-zinc-200 hover:border-white/25",
          className,
        )}
        {...props}
      />
    );
  },
);

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-10 w-full rounded border border-white/15 bg-ink-800 px-3 text-sm text-zinc-200 placeholder:text-muted hover:border-white/25",
          className,
        )}
        {...props}
      />
    );
  },
);

/* ----------------------------------------------------------- Empty state */

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded border border-dashed border-white/12 px-6 py-12 text-center">
      {icon ? <div className="text-muted">{icon}</div> : null}
      <p className="text-sm font-semibold text-zinc-200">{title}</p>
      <p className="max-w-sm text-xs text-muted">{body}</p>
      {action}
    </div>
  );
}

/* --------------------------------------------------------------- Skeleton */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-white/8", className)} />;
}
