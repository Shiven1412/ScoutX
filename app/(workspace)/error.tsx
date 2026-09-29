"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return <main className="mx-auto grid min-h-[60vh] max-w-xl place-items-center"><section role="alert" className="w-full rounded-xl border border-red-300/15 bg-slate-900/60 p-6"><p className="text-sm font-semibold text-red-200">Workspace data could not be loaded</p><p className="mt-2 text-sm leading-6 text-slate-400">Try refreshing. If the problem continues, contact your administrator with this reference: {error.digest ?? "unavailable"}.</p><button onClick={reset} className="mt-5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold">Try again</button></section></main>;
}
