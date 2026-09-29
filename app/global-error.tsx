"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return <html lang="en"><body className="bg-slate-950 text-white"><main className="grid min-h-screen place-items-center px-6"><section className="max-w-md rounded-2xl border border-white/10 bg-slate-900 p-8 text-center"><p className="text-sm font-semibold text-red-300">Something went wrong</p><h1 className="mt-3 text-2xl font-semibold">We couldn’t load this page.</h1><p className="mt-3 text-sm leading-6 text-slate-400">The error has been recorded without sending personal data to the monitoring provider.</p><button className="mt-6 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold" onClick={reset}>Try again</button></section></main></body></html>;
}
