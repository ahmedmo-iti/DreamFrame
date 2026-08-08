import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FolderGit2, HardDrive, Menu, X, Home, LayoutGrid, FolderOpen, Database, CheckCircle2, AlertTriangle, ListOrdered, Layers } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useDialogA11y } from '../hooks/useDialogA11y';
import { activeTaskCount, getTaskSnapshot, subscribeToTasks } from '../lib/taskStore';

interface HeaderProps {
  onGoHome: () => void;
  onGoLanding?: () => void;
  onOpenProjects: () => void;
  onGoAssets?: () => void;
  onGoTasks?: () => void;
  onGoEdit?: () => void;
  activeWorkflow: string;
  projectCount: number;
  libraryStatus?: 'loading' | 'saved' | 'error';
}

export const Header: React.FC<HeaderProps> = ({
  onGoHome,
  onGoLanding,
  onOpenProjects,
  onGoAssets,
  onGoTasks,
  onGoEdit,
  activeWorkflow,
  projectCount,
  libraryStatus = 'saved',
}) => {
  const taskState = useSyncExternalStore(subscribeToTasks, getTaskSnapshot, getTaskSnapshot);
  const activeTasks = activeTaskCount(taskState);
  const [isLocalMenuOpen, setIsLocalMenuOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const localMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (localMenuRef.current && !localMenuRef.current.contains(event.target as Node)) setIsLocalMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsLocalMenuOpen(false);
        setIsMobileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useDialogA11y(isMobileMenuOpen, mobileMenuRef, () => setIsMobileMenuOpen(false));

  const closeAndRun = (action?: () => void) => {
    setIsMobileMenuOpen(false);
    action?.();
  };

  const navButtonClass = (active: boolean) =>
    `relative py-1 transition-all cursor-pointer hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white ${
      active ? 'text-white font-bold' : 'text-white/75'
    }`;

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only fixed left-4 top-4 z-[100] rounded-lg bg-white px-4 py-2 text-sm font-bold text-black"
      >
        Skip to content
      </a>

      <header className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between relative z-40 select-none">
        <button
          onClick={onGoLanding || onGoHome}
          className="flex items-center gap-3 text-left group cursor-pointer rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          aria-label="Go to DreamFrame overview"
        >
          <span className="font-black text-2xl tracking-tighter text-white leading-none drop-shadow-[0_0_10px_rgba(255,255,255,0.4)]">DF</span>
        </button>

        <nav className="hidden md:flex items-center gap-8 text-xs tracking-wider uppercase font-medium" aria-label="Primary navigation">
          {onGoLanding && (
            <button onClick={onGoLanding} className={navButtonClass(activeWorkflow === 'landing')} aria-current={activeWorkflow === 'landing' ? 'page' : undefined}>
              OVERVIEW
              {activeWorkflow === 'landing' && <motion.span layoutId="activeTabIndicator" className="absolute -bottom-1 left-0 right-0 h-0.5 bg-white rounded-full" />}
            </button>
          )}
          <button onClick={onGoHome} className={navButtonClass(activeWorkflow === 'home')} aria-current={activeWorkflow === 'home' ? 'page' : undefined}>
            FEATURES
            {activeWorkflow === 'home' && <motion.span layoutId="activeTabIndicator" className="absolute -bottom-1 left-0 right-0 h-0.5 bg-white rounded-full" />}
          </button>
          <button onClick={onGoAssets} className={navButtonClass(activeWorkflow === 'assets')} aria-current={activeWorkflow === 'assets' ? 'page' : undefined}>
            ASSETS
            {activeWorkflow === 'assets' && <motion.span layoutId="activeTabIndicator" className="absolute -bottom-1 left-0 right-0 h-0.5 bg-white rounded-full" />}
          </button>
          <button
            onClick={onGoEdit}
            className={navButtonClass(activeWorkflow === 'edit')}
            aria-current={activeWorkflow === 'edit' ? 'page' : undefined}
          >
            EDIT
            {activeWorkflow === 'edit' && <motion.span layoutId="activeTabIndicator" className="absolute -bottom-1 left-0 right-0 h-0.5 bg-white rounded-full" />}
          </button>
          <button
            onClick={onGoTasks}
            className={`${navButtonClass(activeWorkflow === 'tasks')} flex items-center gap-1.5`}
            aria-current={activeWorkflow === 'tasks' ? 'page' : undefined}
            aria-label={activeTasks > 0 ? `Tasks, ${activeTasks} in progress` : 'Tasks'}
          >
            TASKS
            {activeTasks > 0 && (
              <span className="rounded bg-violet-500 px-1.5 text-[10px] font-mono font-bold text-white">{activeTasks}</span>
            )}
            {activeWorkflow === 'tasks' && <motion.span layoutId="activeTabIndicator" className="absolute -bottom-1 left-0 right-0 h-0.5 bg-white rounded-full" />}
          </button>
        </nav>

        <div className="hidden md:flex items-center gap-6 text-xs tracking-wider uppercase relative" ref={localMenuRef}>
          <button
            onClick={onOpenProjects}
            className="flex items-center gap-1.5 text-white/70 hover:text-white transition-colors rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            aria-label={`Open Projects, ${projectCount} saved`}
          >
            <FolderGit2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>PROJECTS</span>
            <span className="text-[10px] font-mono px-1.5 rounded bg-white/10 text-white font-bold">{projectCount}</span>
          </button>

          <button
            onClick={() => setIsLocalMenuOpen((value) => !value)}
            aria-expanded={isLocalMenuOpen}
            aria-controls="local-workspace-menu"
            className="flex items-center gap-1.5 text-white/70 hover:text-white transition-colors rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            <HardDrive className="w-4 h-4" aria-hidden="true" />
            <span>LOCAL</span>
          </button>

          <AnimatePresence>
            {isLocalMenuOpen && (
              <motion.div
                id="local-workspace-menu"
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                role="status"
                className="absolute top-full right-0 mt-3 w-72 rounded-2xl bg-neutral-900/95 border border-white/20 p-4 shadow-2xl backdrop-blur-2xl z-50 text-left"
              >
                <div className="flex items-center gap-3 pb-3 border-b border-white/10">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-400/30 flex items-center justify-center">
                    <Database className="w-5 h-5 text-emerald-300" aria-hidden="true" />
                  </div>
                  <div>
                    <div className="font-bold text-sm text-white">Local Workspace</div>
                    <div className="text-[11px] font-mono text-white/50">ComfyUI + IndexedDB library</div>
                  </div>
                </div>
                <div className="mt-3 rounded-xl bg-white/5 border border-white/10 p-3 text-[11px] font-mono">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-white/55">LIBRARY STORAGE</span>
                    <span className={`flex items-center gap-1.5 font-bold ${libraryStatus === 'error' ? 'text-amber-300' : 'text-emerald-300'}`}>
                      {libraryStatus === 'error' ? <AlertTriangle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                      {libraryStatus === 'loading' ? 'SAVING' : libraryStatus === 'error' ? 'SAVE ERROR' : 'SAVED'}
                    </span>
                  </div>
                  <p className="mt-2 leading-relaxed text-white/45">Projects and asset metadata persist on this computer. Generated files remain in the ComfyUI output folder.</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className="md:hidden rounded-xl border border-white/15 bg-white/5 p-2.5 text-white/80 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          aria-label="Open navigation menu"
          aria-expanded={isMobileMenuOpen}
          aria-controls="mobile-navigation"
        >
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>
      </header>

      <AnimatePresence>
        {isMobileMenuOpen && (
          <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              aria-label="Close navigation menu"
            />
            <motion.div
              ref={mobileMenuRef}
              id="mobile-navigation"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="absolute right-0 top-0 h-full w-[min(88vw,360px)] border-l border-white/10 bg-[#08080a] p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <span className="font-grotesk text-xl font-bold">DreamFrame</span>
                <button onClick={() => setIsMobileMenuOpen(false)} className="rounded-full bg-white/5 p-2 text-white/70" aria-label="Close navigation menu">
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
              <nav className="mt-6 flex flex-col gap-2" aria-label="Mobile navigation">
                {onGoLanding && <MobileNavButton icon={Home} label="Overview" onClick={() => closeAndRun(onGoLanding)} />}
                <MobileNavButton icon={LayoutGrid} label="Features" onClick={() => closeAndRun(onGoHome)} />
                <MobileNavButton icon={FolderOpen} label="Assets" onClick={() => closeAndRun(onGoAssets)} />
                <MobileNavButton icon={Layers} label="Edit" onClick={() => closeAndRun(onGoEdit)} />
                <MobileNavButton
                  icon={ListOrdered}
                  label={activeTasks > 0 ? `Tasks (${activeTasks})` : 'Tasks'}
                  onClick={() => closeAndRun(onGoTasks)}
                />
                <MobileNavButton icon={FolderGit2} label={`Projects (${projectCount})`} onClick={() => closeAndRun(onOpenProjects)} />
              </nav>
              <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-4 text-xs font-mono text-white/50">
                <div className="flex items-center gap-2 text-white/80"><HardDrive className="w-4 h-4" /> Local workspace</div>
                <p className="mt-2 leading-relaxed">Library status: {libraryStatus === 'loading' ? 'saving' : libraryStatus}.</p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};

function MobileNavButton({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm font-medium text-white/85 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
      <Icon className="w-4 h-4" aria-hidden="true" />
      {label}
    </button>
  );
}
