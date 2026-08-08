import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Check, Copy, HardDrive, Workflow as WorkflowIcon } from 'lucide-react';
import type { ProjectItem } from '../types';
import type { GraphJson, GraphNode, PlacedGraph, PlacedNode, PostedGraph } from '../lib/workflowGraph';
import {
  LINK_COLOR,
  NODE_WIDTH,
  collectWeights,
  graphStats,
  isLink,
  linkType,
  placeGraph,
} from '../lib/workflowGraph';

interface WorkflowViewProps {
  project: ProjectItem;
}

const CATEGORY_FILL: Record<string, string> = {
  loader: 'rgba(124,58,237,0.16)',
  patch: 'rgba(56,189,248,0.14)',
  encode: 'rgba(255,169,49,0.14)',
  latent: 'rgba(255,156,249,0.13)',
  sample: 'rgba(16,185,129,0.15)',
  decode: 'rgba(100,181,246,0.14)',
  out: 'rgba(255,255,255,0.09)',
  tool: 'rgba(255,255,255,0.05)',
};

/** Older projects predate graph capture, so their graph is read back out of ComfyUI history. */
async function recoverGraphsFromHistory(project: ProjectItem): Promise<PostedGraph[]> {
  const promptIds = [
    ...(project.generationResult?.shotResults ?? []).map((shot) => ({
      promptId: shot.promptId,
      label: shot.title,
      index: shot.index,
    })),
    ...(project.generationResult?.promptId
      ? [{ promptId: project.generationResult.promptId, label: project.title, index: 0 }]
      : []),
  ].filter((entry, index, all) => entry.promptId && all.findIndex((x) => x.promptId === entry.promptId) === index);

  const readOne = async (entry: { promptId: string; label: string; index: number }): Promise<PostedGraph | null> => {
    try {
      const response = await fetch(`/comfy/history/${encodeURIComponent(entry.promptId)}`, { cache: 'no-store' });
      if (!response.ok) return null;
      const payload = await response.json();
      const item = payload?.[entry.promptId];
      const graph = Array.isArray(item?.prompt) ? item.prompt[2] : undefined;
      if (!graph || typeof graph !== 'object') return null;
      return {
        promptId: entry.promptId,
        label: entry.label,
        engine: 'read back from ComfyUI history',
        shotIndex: entry.index,
        graph: graph as GraphJson,
      };
    } catch {
      return null;
    }
  };

  const recovered: Array<PostedGraph | null> = await Promise.all(promptIds.map(readOne));
  const out: PostedGraph[] = [];
  for (const entry of recovered) if (entry) out.push(entry);
  return out;
}

const GraphCanvas: React.FC<{ posted: PostedGraph }> = ({ posted }) => {
  const [picked, setPicked] = useState<string | null>(null);
  const graph: GraphJson = posted.graph;
  const laid: PlacedGraph = useMemo(() => placeGraph(graph), [posted]);
  const placedNodes: PlacedNode[] = Object.values(laid.nodes);
  const chosen: GraphNode | null = picked ? graph[picked] : null;

  const links: React.ReactNode[] = [];
  Object.entries(graph).forEach(([id, node]: [string, GraphNode]) => {
    Object.entries(node.inputs ?? {}).forEach(([name, value]) => {
      if (!isLink(value)) return;
      const from = laid.nodes[value[0]];
      const to = laid.nodes[id];
      if (!from || !to) return;
      const x1 = from.x + NODE_WIDTH;
      const y1 = from.y + from.height / 2;
      const x2 = to.x;
      const y2 = to.y + to.height / 2;
      const bend = Math.max(46, (x2 - x1) * 0.46);
      links.push(
        <path
          key={`${id}-${name}`}
          d={`M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`}
          fill="none"
          strokeWidth={1.4}
          strokeOpacity={0.55}
          stroke={LINK_COLOR[linkType(name)]}
        />,
      );
    });
  });

  return (
    <>
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${laid.width} ${laid.height}`}
          className="w-full min-w-[720px]"
          role="img"
          aria-label={`${posted.label} — ${Object.keys(posted.graph).length} nodes`}
        >
          <g transform={`translate(${laid.offset},0)`}>
            <g>{links}</g>
            {placedNodes.map((node) => (
              <g
                key={node.id}
                onClick={() => setPicked(picked === node.id ? null : node.id)}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={node.x}
                  y={node.y}
                  width={NODE_WIDTH}
                  height={node.height}
                  rx={11}
                  fill={CATEGORY_FILL[node.category] || CATEGORY_FILL.tool}
                  stroke={picked === node.id ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.16)'}
                  strokeWidth={picked === node.id ? 1.6 : 1}
                />
                <text x={node.x + 11} y={node.y + 21} fill="#ffffff" fontSize={10.5} fontWeight={700}>
                  {node.classType.length > 20 ? `${node.classType.slice(0, 19)}…` : node.classType}
                </text>
                {node.rows.map((row, index) => (
                  <text
                    key={index}
                    x={node.x + 11}
                    y={node.y + 38 + index * 13}
                    fill="rgba(255,255,255,0.55)"
                    fontSize={9.5}
                    fontFamily="ui-monospace, monospace"
                  >
                    {row.full && <title>{row.full}</title>}
                    {row.text}
                  </text>
                ))}
                {node.file && (
                  <text
                    x={node.x + 11}
                    y={node.y + node.height - 8}
                    fill="rgba(196,181,253,0.85)"
                    fontSize={9}
                    fontFamily="ui-monospace, monospace"
                  >
                    <title>{node.file}</title>
                    {(() => {
                      const short = node.file.replace(/\.[^.]+$/, '');
                      return short.length > 22 ? `${short.slice(0, 21)}…` : short;
                    })()}
                  </text>
                )}
              </g>
            ))}
          </g>
        </svg>
      </div>

      {chosen && (
        <div className="mt-3 rounded-2xl border border-white/12 bg-black/50 p-4">
          <div className="flex flex-wrap items-center gap-3 border-b border-white/10 pb-2">
            <b className="font-mono text-xs text-white">{chosen.class_type}</b>
            <span className="text-[10px] font-mono text-white/38">node {picked} · every input, as posted</span>
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="ml-auto rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[9px] font-mono uppercase tracking-[0.12em] text-white/55 hover:text-white"
            >
              close
            </button>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {Object.entries(chosen.inputs ?? {}).map(([name, value]) => (
              <div key={name} className="flex items-start gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                <span className="shrink-0 font-mono text-[10px] text-white/40">{name}</span>
                <span className="min-w-0 flex-1 break-words text-right font-mono text-[10px] text-white/75">
                  {isLink(value) ? `← ${graph[value[0]]?.class_type || value[0]}` : String(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
};

export const WorkflowView: React.FC<WorkflowViewProps> = ({ project }) => {
  const [recovered, setRecovered] = useState<PostedGraph[] | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [copied, setCopied] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const stored = project.postedGraphs ?? [];
  const graphs = stored.length > 0 ? stored : recovered ?? [];

  useEffect(() => {
    if (stored.length > 0 || recovered !== null) return;
    setRecovering(true);
    void recoverGraphsFromHistory(project)
      .then(setRecovered)
      .finally(() => setRecovering(false));
  }, [project.id]);

  useEffect(() => {
    setActiveIndex((index) => (index < graphs.length ? index : 0));
  }, [graphs.length]);

  const weights = useMemo(() => collectWeights(graphs), [graphs]);
  const active = graphs[activeIndex];
  const stats = active ? graphStats(active.graph) : { nodes: 0, links: 0 };

  const copyGraph = (posted: PostedGraph) => {
    void navigator.clipboard.writeText(JSON.stringify(posted.graph, null, 2));
    setCopied(posted.promptId);
    window.setTimeout(() => setCopied(''), 1600);
  };

  if (graphs.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/30 p-8 text-center">
        <WorkflowIcon className="mx-auto mb-3 h-8 w-8 text-white/18" />
        <h3 className="text-sm font-bold text-white/80">
          {recovering ? 'Looking for this project’s graphs…' : 'No graph was kept for this project'}
        </h3>
        <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-white/40">
          {recovering
            ? 'Reading them back out of ComfyUI history.'
            : 'Projects rendered before graph capture keep no copy, and ComfyUI history no longer holds these prompts. The next render of this workflow will record its graphs.'}
        </p>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-5">
      <div className="rounded-2xl border border-white/10 bg-[linear-gradient(135deg,rgba(124,58,237,0.10),rgba(255,255,255,0.02))] p-5">
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-violet-200/65">
          <WorkflowIcon className="h-3.5 w-3.5" /> How this project was built
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/55">
          {graphs.length} graph{graphs.length === 1 ? '' : 's'} posted to ComfyUI, naming {weights.length} weight
          file{weights.length === 1 ? '' : 's'}. Each one is the JSON object DreamFrame sent, captured as it was
          dispatched — not a drawing of it.
        </p>
      </div>

      <section className="rounded-2xl border border-white/10 bg-black/30 p-4">
        <div className="mb-3 flex items-center gap-2 border-b border-white/10 pb-2 text-[10px] font-mono uppercase tracking-[0.18em] text-white/45">
          <HardDrive className="h-3.5 w-3.5" /> Weights it named
        </div>
        <div className="flex flex-col gap-1.5">
          {weights.map((weight) => (
            <div key={weight.file} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white/[0.025] px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-white/80">{weight.file}</span>
              <span className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.1em] text-white/45">
                {weight.role}
              </span>
              <span className="font-mono text-[10px] text-white/32">{weight.usedBy.join(' · ')}</span>
              <span className="font-mono text-[10px] text-white/32">loaded {weight.loads}×</span>
            </div>
          ))}
          {weights.length === 0 && (
            <div className="px-1 py-3 text-xs text-white/35">These graphs name no weight file directly.</div>
          )}
        </div>
        <div className="mt-3 flex gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[10px] leading-relaxed text-white/38">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            File sizes are not shown. Reading them means reading your models folder off disk, which the browser
            cannot do — a number here would be a guess.
          </span>
        </div>
      </section>

      {graphs.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-white/35">graph</span>
          {graphs.map((posted, index) => (
            <button
              key={posted.promptId}
              type="button"
              onClick={() => setActiveIndex(index)}
              aria-pressed={index === activeIndex}
              className={`rounded-full px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.12em] transition-all ${
                index === activeIndex
                  ? 'bg-white text-black'
                  : 'border border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.08] hover:text-white'
              }`}
            >
              {posted.label}
            </button>
          ))}
        </div>
      )}

      {active && (
        <section className="rounded-2xl border border-white/10 bg-black/40 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-white/10 pb-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-white">{active.label}</div>
              <div className="mt-0.5 text-[10px] font-mono uppercase tracking-[0.14em] text-white/35">
                {active.engine}
              </div>
            </div>
            <span className="ml-auto font-mono text-[10px] text-white/40">
              {stats.nodes} nodes · {stats.links} links
            </span>
            <button
              type="button"
              onClick={() => copyGraph(active)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[9px] font-mono uppercase tracking-[0.12em] text-white/60 hover:bg-white/[0.09] hover:text-white"
            >
              {copied === active.promptId ? <Check className="h-3 w-3 text-emerald-300" /> : <Copy className="h-3 w-3" />}
              {copied === active.promptId ? 'copied' : 'copy the JSON posted'}
            </button>
          </div>
          <GraphCanvas posted={active} />
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono text-white/40">
        {Object.entries(LINK_COLOR).map(([name, color]) => (
          <span key={name} className="inline-flex items-center gap-1.5">
            <i className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
            {name}
          </span>
        ))}
        <span className="text-white/28">click a node to read every input it was posted with</span>
      </div>
    </motion.div>
  );
};
