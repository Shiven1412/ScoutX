import Link from "next/link";

export default function NotFound() {
  return <main className="grid min-h-screen place-items-center px-6"><div className="max-w-md text-center"><p className="text-sm font-semibold text-violet-300">404 · Not found</p><h1 className="mt-3 text-3xl font-semibold">This page isn’t here</h1><p className="mt-3 text-sm leading-6 text-slate-400">The address may have changed, or you may not have access to the resource.</p><Link href="/" className="mt-6 inline-flex rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold">Return home</Link></div></main>;
}
