import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, AppErrorBoundaryState> {
  declare readonly props: Readonly<React.PropsWithChildren>;
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('DreamFrame render error', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-[#040209] p-6 text-white">
        <section className="w-full max-w-xl rounded-3xl border border-rose-400/20 bg-neutral-950 p-7 text-center shadow-2xl" role="alert">
          <AlertTriangle className="mx-auto h-9 w-9 text-rose-300" />
          <h1 className="mt-4 font-grotesk text-2xl font-black">DreamFrame could not display this view</h1>
          <p className="mt-3 text-sm leading-relaxed text-white/55">
            Your saved library remains on this computer. Reload the interface, then reopen the project or asset that caused the problem.
          </p>
          <details className="mt-5 rounded-xl border border-white/10 bg-black/40 p-3 text-left text-xs text-white/45">
            <summary className="cursor-pointer font-mono text-white/65">Technical details</summary>
            <pre className="mt-3 overflow-auto whitespace-pre-wrap">{this.state.error.message}</pre>
          </details>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mx-auto mt-6 flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-bold text-black hover:bg-neutral-200"
          >
            <RotateCcw className="h-4 w-4" /> Reload DreamFrame
          </button>
        </section>
      </main>
    );
  }
}
