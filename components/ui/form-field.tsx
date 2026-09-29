import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function FormField({ label, error, children, className }: { label: string; error?: string; children: ReactNode; className?: string }) {
  return <label className={cn("block space-y-2 text-sm font-medium text-slate-200", className)}>
    <span className="block">{label}</span>
    {children}
    {error ? <span role="alert" className="block text-xs text-red-300">{error}</span> : null}
  </label>;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("h-11 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20", props.className)} />;
}
