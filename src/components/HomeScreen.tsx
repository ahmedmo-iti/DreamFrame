import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowUpRight,
  Box,
  Film,
  Layers3,
  PanelsTopLeft,
  Search,
  Sparkles,
} from 'lucide-react';
import img3dRoom from '../assets/images/workflow_gaussian.png';
import img3dModel from '../assets/images/workflow_model.png';
import imgStoryboard from '../assets/images/workflow_storyboard.png';
import imgVideo from '../assets/images/workflow_multishot.png';
import { WorkflowCreationType } from '../types';

interface HomeScreenProps {
  onSelectWorkflow: (workflow: WorkflowCreationType) => void;
}

type FeatureCategory = 'all' | 'moving-image' | '3d';

const FEATURES = [
  {
    id: 'shot' as const,
    title: 'Cinematic Shot Editor',
    eyebrow: 'WAN 2.2 · CONNECTED SEQUENCE',
    description:
      'Plan and edit up to twelve scenes, then render each scene through the connected WAN 2.2 workflow with continuity, custom references, and multi-PC assignment.',
    thumbnail: imgVideo,
    icon: Film,
    category: 'moving-image' as const,
    accent: 'from-violet-500/35 via-fuchsia-500/10 to-transparent',
    ring: 'shadow-[0_0_0_1px_rgba(168,85,247,0.18),0_24px_60px_rgba(67,20,117,0.25)]',
    facts: ['1–12 editable scenes', 'Per-scene reference and prompt', 'Single or multi-PC rendering'],
    cta: 'Open Shot Editor',
    label: 'Scene editing workspace',
  },
  {
    id: 'storyboard' as const,
    title: 'Cinematic Storyboard',
    eyebrow: 'SDXL + IPADAPTER · 4 BEATS',
    description:
      'Shape a beginning, development, turning point, and closing image with a shared storyboard look reference and a clean editorial rhythm.',
    thumbnail: imgStoryboard,
    icon: PanelsTopLeft,
    category: 'moving-image' as const,
    accent: 'from-amber-500/30 via-orange-500/10 to-transparent',
    ring: 'shadow-[0_0_0_1px_rgba(251,191,36,0.18),0_24px_60px_rgba(120,53,15,0.22)]',
    facts: ['4 directed frames', '1–3 sec editorial holds', '12 or 24 FPS animatic'],
    cta: 'Direct Story Beats',
    label: 'Fast visual planning',
  },
  {
    id: 'model' as const,
    title: '3D Model Generation',
    eyebrow: 'TRELLIS.2 · DUAL GLB EXPORT',
    description:
      'Create clean, production-ready 3D assets from a reference image with textured and untextured GLB exports for look-dev and layout.',
    thumbnail: img3dModel,
    icon: Layers3,
    category: '3d' as const,
    accent: 'from-cyan-500/30 via-blue-500/10 to-transparent',
    ring: 'shadow-[0_0_0_1px_rgba(34,211,238,0.16),0_24px_60px_rgba(14,78,110,0.22)]',
    facts: ['Balanced or Hero Detail', 'Textured GLB', 'Untextured GLB'],
    cta: 'Create a 3D Asset',
    label: 'Asset-ready output',
  },
  {
    id: '3d' as const,
    title: '3D Gaussian Splatting',
    eyebrow: 'APPLE SHARP + MOGE-2',
    description:
      'Convert one clean 2:1 panorama into an immersive reconstructed scene with a rich Gaussian output viewer for spatial review.',
    thumbnail: img3dRoom,
    icon: Box,
    category: '3d' as const,
    accent: 'from-emerald-500/28 via-teal-500/10 to-transparent',
    ring: 'shadow-[0_0_0_1px_rgba(16,185,129,0.15),0_24px_60px_rgba(6,78,59,0.24)]',
    facts: ['2:1 panorama input', 'Gaussian PLY output', 'Interactive scene viewer'],
    cta: 'Reconstruct a Scene',
    label: 'Spatial scene capture',
  },
];

export const HomeScreen: React.FC<HomeScreenProps> = ({ onSelectWorkflow }) => {
  const [category, setCategory] = useState<FeatureCategory>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () =>
      FEATURES.filter((feature) => {
        const matchesCategory = category === 'all' || feature.category === category;
        const haystack = `${feature.title} ${feature.eyebrow} ${feature.description} ${feature.facts.join(' ')} ${feature.label}`.toLowerCase();
        return matchesCategory && haystack.includes(query.toLowerCase());
      }),
    [category, query],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.45 }}
      className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6"
    >
      <section className="relative overflow-hidden rounded-[34px] border border-white/12 bg-[linear-gradient(180deg,rgba(10,10,14,0.9),rgba(5,5,8,0.96))] px-6 py-7 shadow-[0_28px_80px_rgba(0,0,0,0.38)] sm:px-8 sm:py-9 lg:px-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(255,255,255,0.08),transparent_24%),radial-gradient(circle_at_85%_10%,rgba(124,58,237,0.24),transparent_32%),radial-gradient(circle_at_70%_80%,rgba(8,145,178,0.14),transparent_28%)]" aria-hidden="true" />
        <div className="relative">
          <div className="max-w-3xl">
            <h1 className="font-grotesk text-4xl font-black tracking-[-0.06em] text-white sm:text-5xl lg:text-[3.5rem] lg:leading-[0.95]">
              Create cinematic video sequences and 3D assets
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-white/58 sm:text-[15px]">
              Cinematic Shot Editor and 3D Model Generation are the main entry points, with Storyboard and Gaussian Splatting available below for supporting tasks.
            </p>
          </div>

          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            <button
              type="button"
              onClick={() => onSelectWorkflow('shot')}
              className="group relative min-h-[310px] overflow-hidden rounded-[28px] border border-violet-300/20 bg-black text-left shadow-[0_24px_70px_rgba(76,29,149,0.28)] transition-all duration-300 hover:-translate-y-1 hover:border-violet-200/35"
            >
              <img src={imgVideo} alt="" className="absolute inset-0 h-full w-full object-cover brightness-[0.62] saturate-[0.9] transition-transform duration-700 group-hover:scale-[1.035]" />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,5,20,0.05),rgba(10,5,20,0.35)_45%,rgba(8,4,16,0.95)_100%)]" />
              <div className="absolute inset-0 bg-gradient-to-br from-violet-500/25 via-transparent to-fuchsia-500/10" />
              <div className="relative flex h-full min-h-[310px] flex-col justify-between p-6 sm:p-7">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/40 px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.18em] text-white/85 backdrop-blur-md">
                    <Film className="h-4 w-4" /> Shot Editor
                  </span>
                  <Sparkles className="h-5 w-5 text-violet-200/80" />
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-violet-200/65">WAN 2.2 · Connected sequence</div>
                  <h2 className="mt-3 max-w-[12ch] font-grotesk text-3xl font-black leading-[0.98] tracking-[-0.05em] text-white sm:text-4xl">Cinematic Shot Editor</h2>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-white/62">Edit scene prompts, references, duration, camera movement, lens, order, and render PC before sending the sequence to WAN 2.2.</p>
                  <div className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-white">Open Shot Editor <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></div>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onSelectWorkflow('model')}
              className="group relative min-h-[310px] overflow-hidden rounded-[28px] border border-cyan-300/20 bg-black text-left shadow-[0_24px_70px_rgba(8,87,118,0.24)] transition-all duration-300 hover:-translate-y-1 hover:border-cyan-200/35"
            >
              <img src={img3dModel} alt="" className="absolute inset-0 h-full w-full object-cover brightness-[0.64] saturate-[0.88] transition-transform duration-700 group-hover:scale-[1.035]" />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,13,18,0.05),rgba(3,13,18,0.34)_45%,rgba(2,10,14,0.95)_100%)]" />
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/22 via-transparent to-blue-500/10" />
              <div className="relative flex h-full min-h-[310px] flex-col justify-between p-6 sm:p-7">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/40 px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.18em] text-white/85 backdrop-blur-md">
                    <Layers3 className="h-4 w-4" /> 3D Model
                  </span>
                  <Sparkles className="h-5 w-5 text-cyan-100/80" />
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-cyan-100/65">TRELLIS.2 · Dual GLB export</div>
                  <h2 className="mt-3 max-w-[12ch] font-grotesk text-3xl font-black leading-[0.98] tracking-[-0.05em] text-white sm:text-4xl">3D Model Generation</h2>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-white/62">Turn a clean reference image into textured and untextured GLB assets with an interactive 3D result viewer.</p>
                  <div className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-white">Create a 3D Asset <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></div>
                </div>
              </div>
            </button>
          </div>

        </div>
      </section>

      <div className="flex flex-col gap-4 rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.02))] p-3.5 shadow-[0_18px_50px_rgba(0,0,0,0.22)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Feature categories">
          {([
            ['all', 'All workflows'],
            ['moving-image', 'Film & Story'],
            ['3d', '3D & Spatial'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setCategory(value)}
              aria-pressed={category === value}
              className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-mono transition-all ${
                category === value
                  ? 'bg-white text-black shadow-[0_6px_18px_rgba(255,255,255,0.12)]'
                  : 'text-white/55 hover:bg-white/[0.055] hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="relative min-w-[250px] sm:max-w-[340px] sm:flex-1 sm:flex-initial">
          <span className="sr-only">Search workflows</span>
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search workflows..."
            className="w-full rounded-xl border border-white/10 bg-black/40 py-2.5 pl-10 pr-4 text-xs text-white outline-none placeholder:text-white/25 focus:border-white/25"
          />
        </label>
      </div>

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2" aria-label="Connected workflows">
        {filtered.length === 0 && (
          <div className="col-span-full rounded-[26px] border border-dashed border-white/12 bg-white/[0.02] px-6 py-16 text-center">
            <Search className="mx-auto h-7 w-7 text-white/25" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-bold text-white/80">No workflow matches that search</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-white/40">Try a creative task such as video, storyboard, model, or Gaussian scene.</p>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setCategory('all');
              }}
              className="mt-5 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-xs font-bold text-white hover:bg-white hover:text-black"
            >
              Show all workflows
            </button>
          </div>
        )}

        {filtered.map((feature, index) => {
          const Icon = feature.icon;
          return (
            <motion.article
              key={feature.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className={`group relative overflow-hidden rounded-[30px] border border-white/12 bg-[linear-gradient(180deg,rgba(13,13,18,0.94),rgba(6,6,9,0.98))] ${feature.ring} transition-all duration-300 hover:-translate-y-1 hover:border-white/20`}
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${feature.accent} opacity-80 transition-opacity duration-500 group-hover:opacity-100`} aria-hidden="true" />
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" aria-hidden="true" />

              <div className="relative grid min-h-[395px] gap-0 sm:grid-cols-[1fr_1.05fr]">
                <div className="relative min-h-[260px] overflow-hidden p-4 sm:min-h-full sm:p-5">
                  <div className="relative h-full overflow-hidden rounded-[24px] border border-white/10 bg-black">
                    <img
                      src={feature.thumbnail}
                      alt=""
                      className="h-full w-full object-cover brightness-[0.78] saturate-[0.86] transition-transform duration-700 group-hover:scale-[1.035]"
                    />
                    <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,4,8,0.15),rgba(4,4,8,0.28)_48%,rgba(4,4,8,0.72)_100%)]" />
                    <div className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-2xl border border-white/12 bg-black/40 px-3 py-2 text-white/82 backdrop-blur-md">
                      <Icon className="h-4.5 w-4.5" />
                      <span className="text-[10px] font-mono uppercase tracking-[0.18em]">{feature.label}</span>
                    </div>
                    <div className="absolute inset-x-4 bottom-4 rounded-[20px] border border-white/10 bg-black/42 p-4 backdrop-blur-md">
                      <div className="text-[9px] font-mono uppercase tracking-[0.22em] text-white/42">Connected engine</div>
                      <div className="mt-1 text-xs font-semibold text-white/92">{feature.eyebrow}</div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col justify-between p-6 pt-2 sm:p-6 sm:pl-2 lg:p-7 lg:pl-3">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-white/38">Workflow</div>
                    <h2 className="mt-3 font-grotesk text-[2rem] font-black leading-[1.02] tracking-[-0.055em] text-white">
                      {feature.title}
                    </h2>
                    <p className="mt-4 max-w-[34ch] text-sm leading-7 text-white/54">{feature.description}</p>

                    <div className="mt-6 flex flex-wrap gap-2.5">
                      {feature.facts.map((fact) => (
                        <span
                          key={fact}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3 py-1.5 text-[11px] font-medium text-white/74"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          {fact}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-8 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => onSelectWorkflow(feature.id)}
                      className="group/cta inline-flex w-full items-center justify-between rounded-2xl border border-white/12 bg-white/[0.055] px-4 py-3.5 text-sm font-semibold text-white transition-all duration-300 hover:border-white/20 hover:bg-white hover:text-black"
                    >
                      <span>{feature.cta}</span>
                      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-current/15 bg-current/5 transition-transform duration-300 group-hover/cta:translate-x-0.5 group-hover/cta:-translate-y-0.5">
                        <ArrowUpRight className="h-4 w-4" />
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </motion.article>
          );
        })}
      </section>
    </motion.div>
  );
};
