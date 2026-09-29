import type { ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonStyles = cva("inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:pointer-events-none disabled:opacity-50", {
  variants: {
    variant: {
      primary: "bg-violet-600 text-white hover:bg-violet-500",
      secondary: "border border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08]",
      ghost: "text-slate-300 hover:bg-white/[0.06] hover:text-white",
      danger: "bg-red-600 text-white hover:bg-red-500",
    },
    size: { default: "", sm: "h-8 px-3 text-xs", lg: "h-12 px-5" },
  },
  defaultVariants: { variant: "primary", size: "default" },
});

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonStyles>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonStyles({ variant, size }), className)} {...props} />;
}

export { buttonStyles };
