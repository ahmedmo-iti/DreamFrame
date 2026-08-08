import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowUpRight,
  Box,
  ChevronDown,
  Copy,
  Film,
  FolderGit2,
  Layers,
  PanelsTopLeft,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { ProjectItem, WorkflowCreationType } from '../types';
import { useDialogA11y } from '../hooks/useDialogA11y';

interface ProjectsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  projects: ProjectItem[];
  onSelectProject: (project: ProjectItem) => void;
  onDeleteProject: (id: string) => void;
  onDuplicateProject: (project: ProjectItem) => void;
  onRerunProject: (project: ProjectItem) => void;
}

const typeLabelMap: Record<WorkflowCreationType, string> = {
  '3d': 'GAUSSIAN SPLAT',
  mesh: 'LEGACY 3D',
  model: '3D MODEL',
  shot: 'SHOT EDITOR VIDEO',
  storyboard: 'STORYBOARD',
  hdri: 'HDRI',
};

function getProjectIcon(type: WorkflowCreationType) {
  if (type === '3d') return Box;
  if (type === 'mesh' || type === 'model') return Layers;
  if (type === 'storyboard') return PanelsTopLeft;
  if (type === 'shot') return Film;
  return FolderGit2;
}

function ProjectSettings({ project }: { project: ProjectItem }) {
  if (project.paramsShot) {
    return (
      <div className="flex flex-col gap-2">
        <SettingRow label="Framing" value={project.paramsShot.aspectRatio} />
        <SettingRow label="Playback" value={`${project.paramsShot.fps} FPS · ${project.paramsShot.continuityMode} continuity`} />
        <div className="mt-1 rounded-xl border border-white/8 bg-black/30 p-3">
          <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-white/30">Shot list</div>
          <div className="mt-2 flex flex-col gap-1.5">
            {project.paramsShot.shots.map((shot, index) => (
              <div key={shot.id || index} className="flex items-center justify-between gap-3 text-[10px] text-white/55">
                <span className="truncate">{index + 1}. {shot.title || `Shot ${index + 1}`}</span>
                <span className="shrink-0 font-mono text-white/35">{shot.duration}s · {shot.focalLength}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (project.paramsStoryboard) {
    return (
      <div className="flex flex-col gap-2">
        <SettingRow label="Reference influence" value={`${Math.round(project.paramsStoryboard.styleInfluence * 100)}%`} />
        <SettingRow label="Editorial timing" value={`${project.paramsStoryboard.holdSeconds}s per frame · ${project.paramsStoryboard.fps} FPS`} />
      </div>
    );
  }

  if (project.paramsMesh) {
    return <SettingRow label="Model detail" value={project.paramsMesh.density === 'Ultra High' ? 'Hero Detail' : 'Balanced'} />;
  }

  if (project.type === '3d') {
    return <SettingRow label="Source requirement" value="2:1 equirectangular panorama" />;
  }

  return <div className="text-[10px] font-mono text-white/35">No saved artist settings are available for this legacy project.</div>;
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-[10px] font-mono">
      <span className="uppercase tracking-wider text-white/30">{label}</span>
      <span className="text-right text-white/60">{value}</span>
    </div>
  );
}

export const ProjectsDrawer: React.FC<ProjectsDrawerProps> = ({
  isOpen,
  onClose,
  projects,
  onSelectProject,
  onDeleteProject,
  onDuplicateProject,
  onRerunProject,
}) => {
  const drawerRef = useRef<HTMLDivElement>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  useDialogA11y(isOpen, drawerRef, onClose);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="projects-title">
          <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-black/80 backdrop-blur-md" aria-label="Close projects" />
          <motion.div ref={drawerRef} initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }} className="relative z-10 flex h-full w-full max-w-md flex-col justify-between overflow-y-auto border-l border-white/10 bg-[#08080a] p-6 shadow-2xl">
            <div className="flex flex-col gap-6">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div className="flex items-center gap-2.5 text-white">
                  <FolderGit2 className="h-5 w-5 text-white/80" aria-hidden="true" />
                  <div>
                    <h2 id="projects-title" className="font-grotesk text-xl font-bold">Projects</h2>
                    <p className="mt-0.5 text-[11px] font-mono text-white/40">Persistent runs, settings, timing, and output links</p>
                  </div>
                </div>
                <button onClick={onClose} className="rounded-full bg-white/5 p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Close projects"><X className="h-4 w-4" /></button>
              </div>

              <div className="flex flex-col gap-4">
                {projects.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-neutral-900/50 px-4 py-16 text-center" role="status">
                    <FolderGit2 className="mb-3 h-8 w-8 text-white/30" />
                    <h3 className="text-sm font-bold text-white/90">No Projects Found</h3>
                    <p className="mt-1 text-xs font-mono leading-relaxed text-white/40">Completed, failed, and cancelled local workflow runs will persist here.</p>
                  </div>
                ) : (
                  projects.map((project) => {
                    const ProjectIcon = getProjectIcon(project.type);
                    const failed = project.status === 'failed';
                    const cancelled = project.status === 'cancelled';
                    const offline = project.outputAvailability === 'offline';
                    const missing = project.outputAvailability === 'missing' || (!project.downloadUrl && project.status === 'completed');
                    const unavailable = failed || cancelled || offline || missing;
                    const statusLabel = cancelled ? 'CANCELLED' : failed ? 'FAILED' : offline ? 'COMFY OFFLINE' : missing ? 'OUTPUT MISSING' : 'OUTPUT READY';
                    const isExpanded = expandedId === project.id;
                    const canRerun = Boolean(project.sourceImage || project.thumbnailUrl) && project.type !== 'hdri';

                    return (
                      <article key={project.id} className="dreamframe-card group flex flex-col gap-3 border border-white/10 p-4 transition-all hover:border-white/25">
                        <button onClick={() => { onSelectProject(project); onClose(); }} className="relative h-32 w-full overflow-hidden rounded-xl bg-black text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" aria-label={`Open ${project.title}`}>
                          {project.thumbnailUrl ? <img src={project.thumbnailUrl} alt="" className="h-full w-full object-cover brightness-90 transition-transform duration-500 group-hover:scale-105" /> : <div className="h-full w-full bg-neutral-950" />}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/20" />
                          <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full border border-white/10 bg-black/70 px-2.5 py-1 text-[10px] font-mono uppercase text-white/80 backdrop-blur-md">
                            <ProjectIcon className="h-3 w-3" /> {typeLabelMap[project.type]}
                          </div>
                          <span className={`absolute bottom-2 left-2 rounded-full border px-2 py-0.5 text-[9px] font-mono font-bold ${unavailable ? 'border-rose-400/30 bg-rose-500/20 text-rose-200' : 'border-emerald-400/30 bg-emerald-500/20 text-emerald-200'}`}>{statusLabel}</span>
                          <span className="absolute bottom-2 right-2 rounded bg-black/60 px-2 py-0.5 text-[9px] font-mono text-white/60">{project.createdAt}</span>
                        </button>

                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-bold text-white">{project.title}</h3>
                            <span className="mt-0.5 block truncate text-[11px] font-mono text-white/50">{project.stats.duration || project.stats.polygonCount || project.stats.resolution || project.stats.filesize || 'Local workflow output'}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setExpandedId((value) => value === project.id ? null : project.id)}
                            aria-expanded={isExpanded}
                            aria-label={`${isExpanded ? 'Hide' : 'Show'} settings for ${project.title}`}
                            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[9px] font-mono text-white/50 hover:text-white"
                          >
                            SETTINGS <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </button>
                        </div>

                        <div className="flex items-center justify-between gap-3 text-[10px] font-mono text-white/35">
                          <span>{project.stats.renderTime ? `RENDER ${project.stats.renderTime}` : 'RENDER TIME NOT RECORDED'}</span>
                          {project.paramsShot?.shots ? <span>{project.paramsShot.shots.length} SHOTS</span> : null}
                        </div>

                        <AnimatePresence initial={false}>
                          {isExpanded && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                              <div className="rounded-xl border border-white/10 bg-white/[0.025] p-3"><ProjectSettings project={project} /></div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {unavailable && <div className="flex items-center gap-2 text-[10px] font-mono text-rose-200/70"><AlertTriangle className="h-3.5 w-3.5" />{project.errorMessage || (cancelled ? 'The artist cancelled this render.' : 'The output file could not be resolved.')}</div>}

                        <div className="grid grid-cols-4 gap-2 border-t border-white/10 pt-3">
                          <ProjectAction label="Open" icon={ArrowUpRight} onClick={() => { onSelectProject(project); onClose(); }} />
                          <ProjectAction label="Rerun" icon={RotateCcw} onClick={() => onRerunProject(project)} disabled={!canRerun} />
                          <ProjectAction label="Copy" icon={Copy} onClick={() => onDuplicateProject(project)} />
                          <ProjectAction label="Delete" icon={Trash2} onClick={() => { if (window.confirm(`Delete project “${project.title}” from DreamFrame? Generated ComfyUI files are not deleted.`)) onDeleteProject(project.id); }} danger />
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-white/10 pt-4 text-[11px] font-mono text-white/40">
              <span>{projects.length} SAVED PROJECT{projects.length === 1 ? '' : 'S'}</span>
              <span>INDEXEDDB ACTIVE</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

function ProjectAction({
  label,
  icon: Icon,
  onClick,
  disabled = false,
  danger = false,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-w-0 flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[9px] font-mono transition-all disabled:cursor-not-allowed disabled:opacity-25 ${danger ? 'border-rose-400/10 bg-rose-500/[0.04] text-rose-200/60 hover:bg-rose-500/10 hover:text-rose-200' : 'border-white/10 bg-white/[0.035] text-white/50 hover:bg-white/10 hover:text-white'}`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="truncate">{label.toUpperCase()}</span>
    </button>
  );
}
