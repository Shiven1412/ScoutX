"use client";

import { useState, useTransition } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

type Result = { error?: string; success?: boolean };
type Action = (data: FormData) => Promise<Result | void>;

export function ActionButton({ action, fields, children, ...buttonProps }: ButtonProps & { action: Action; fields: Record<string, string>; children: React.ReactNode }) {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  return <div className="inline-flex flex-col items-start gap-1"><Button {...buttonProps} type="button" disabled={pending || buttonProps.disabled} onClick={() => {
    setError(undefined);
    const data = new FormData();
    Object.entries(fields).forEach(([key, value]) => data.set(key, value));
    startTransition(async () => {
      const result = await action(data);
      if (result?.error) setError(result.error);
    });
  }}>{pending ? "Working…" : children}</Button>{error && <span role="alert" className="max-w-xs text-xs text-red-300">{error}</span>}</div>;
}
