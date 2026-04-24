// ═════════════════════════════════════════════════════════════════════
// Operations → Stages Mapper
//
// Drag-and-drop board where each stage is a bucket and operations are
// chips you drop into the bucket they belong to. Once mapped, the smart
// auto-routing knows: "worker clocked in on 'Tumble Deburring' → move
// the job to the Deburring stage."
//
// Design rules:
//   • One operation can only belong to one stage (dragging moves it).
//   • Operations not yet mapped live in an "Unmapped" bucket at the top —
//     this is the TODO list for the admin.
//   • Clicking a chip also moves it (mobile-friendly — long-press opens
//     a picker of target stages).
//   • Completed-marker stages are shown but greyed — you don't usually
//     clock in on "Completed", it's just the terminus.
// ═════════════════════════════════════════════════════════════════════

import React, { useMemo, useState } from 'react';
import { GripVertical, AlertTriangle, CheckCircle2, Zap } from 'lucide-react';
import type { JobStage, SystemSettings } from '../types';
import { Overlay } from './Overlay';

interface Props {
  settings: SystemSettings;
  setSettings: (s: SystemSettings) => void;
}

// Soft pastel tints per stage — keeps columns visually distinct without
// fighting the stage's own color which is used on chips/badges.
const STAGE_BG = 'bg-zinc-900/40';

export const OperationsStageMapper: React.FC<Props> = ({ settings, setSettings }) => {
  const stages: JobStage[] = (settings.jobStages || []).slice().sort((a, b) => a.order - b.order);
  const allOps: string[] = (settings.customOperations || []).slice().sort((a, b) => a.localeCompare(b));

  // Which stage (if any) is each operation currently mapped to?
  const opToStageId = useMemo(() => {
    const map = new Map<string, string>();
    for (const stage of stages) {
      for (const op of stage.operations || []) {
        if (!map.has(op)) map.set(op, stage.id);
      }
    }
    return map;
  }, [stages]);

  const unmapped = useMemo(() => allOps.filter(op => !opToStageId.has(op)), [allOps, opToStageId]);

  // Drag state (HTML5 DnD) + separate "tap" state for mobile.
  const [dragOp, setDragOp] = useState<string | null>(null);
  const [hoverStageId, setHoverStageId] = useState<string | null>(null);
  const [pickerOp, setPickerOp] = useState<string | null>(null); // mobile/tap flow

  const moveOp = (op: string, toStageId: string | null) => {
    const nextStages: JobStage[] = stages.map(stage => {
      const existing = new Set(stage.operations || []);
      existing.delete(op); // strip from every stage first
      if (stage.id === toStageId) existing.add(op);
      return { ...stage, operations: Array.from(existing).sort((a, b) => a.localeCompare(b)) };
    });
    setSettings({ ...settings, jobStages: nextStages });
  };

  const onDrop = (e: React.DragEvent, stageId: string | null) => {
    e.preventDefault();
    const op = e.dataTransfer.getData('text/operation') || dragOp;
    setDragOp(null);
    setHoverStageId(null);
    if (op) moveOp(op, stageId);
  };

  const mappedCount = allOps.length - unmapped.length;

  if (stages.length === 0) {
    return (
      <div className="bg-zinc-900/50 border border-dashed border-white/10 rounded-2xl p-6 text-center">
        <p className="text-sm text-zinc-400 font-bold">No workflow stages yet</p>
        <p className="text-[11px] text-zinc-600 mt-1">Add stages above first, then map operations into them.</p>
      </div>
    );
  }

  if (allOps.length === 0) {
    return (
      <div className="bg-zinc-900/50 border border-dashed border-white/10 rounded-2xl p-6 text-center">
        <p className="text-sm text-zinc-400 font-bold">No operations yet</p>
        <p className="text-[11px] text-zinc-600 mt-1">Add operations above first, then drag them into stages.</p>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-white flex items-center gap-2">
            <Zap className="w-4 h-4 text-blue-400" aria-hidden="true" />
            Operations → Stages
          </h4>
          <p className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">
            Drag each operation into the stage it belongs to. When a worker clocks in, the job auto-advances to that stage.
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Mapped</p>
          <p className={`text-sm font-black tabular ${mappedCount === allOps.length ? 'text-emerald-400' : 'text-blue-400'}`}>
            {mappedCount} / {allOps.length}
          </p>
        </div>
      </div>

      {/* Unmapped bucket — prominent at the top when there are unmapped ops */}
      {unmapped.length > 0 && (
        <div
          onDragOver={(e) => { e.preventDefault(); setHoverStageId('__unmapped__'); }}
          onDragLeave={() => setHoverStageId(prev => prev === '__unmapped__' ? null : prev)}
          onDrop={(e) => onDrop(e, null)}
          className={`rounded-xl border p-3 transition-colors ${hoverStageId === '__unmapped__' ? 'bg-amber-500/10 border-amber-500/40' : 'bg-amber-500/5 border-amber-500/20'}`}
        >
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
            <p className="text-[11px] font-black text-amber-300 uppercase tracking-widest">
              Not yet mapped · {unmapped.length}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {unmapped.map(op => (
              <OpChip
                key={op}
                op={op}
                onDragStart={(e) => { setDragOp(op); e.dataTransfer.setData('text/operation', op); e.dataTransfer.effectAllowed = 'move'; }}
                onDragEnd={() => { setDragOp(null); setHoverStageId(null); }}
                onTap={() => setPickerOp(op)}
                dragging={dragOp === op}
                tint="amber"
              />
            ))}
          </div>
        </div>
      )}

      {unmapped.length === 0 && (
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
          <p className="text-[11px] font-black text-emerald-300">All operations are mapped — auto-routing is fully configured.</p>
        </div>
      )}

      {/* Stage columns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {stages.map(stage => {
          const opsHere = (stage.operations || []).filter(op => allOps.includes(op));
          const isHover = hoverStageId === stage.id;
          const isTerminus = !!stage.isComplete;
          return (
            <div
              key={stage.id}
              onDragOver={(e) => { if (!isTerminus) { e.preventDefault(); setHoverStageId(stage.id); } }}
              onDragLeave={() => setHoverStageId(prev => prev === stage.id ? null : prev)}
              onDrop={(e) => !isTerminus && onDrop(e, stage.id)}
              className={`rounded-xl border transition-all ${isTerminus ? 'opacity-50' : ''} ${isHover ? 'ring-1' : ''} ${STAGE_BG}`}
              style={{
                borderColor: isHover ? stage.color : `${stage.color}30`,
                boxShadow: isHover ? `0 0 0 1px ${stage.color}40` : undefined,
              }}
            >
              {/* Column header */}
              <div className="px-3 py-2 border-b flex items-center justify-between gap-2" style={{ borderColor: `${stage.color}20` }}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: stage.color, boxShadow: `0 0 6px ${stage.color}80` }} />
                  <span className="text-xs font-black text-white uppercase tracking-wider truncate">{stage.label}</span>
                  {isTerminus && <span className="text-[9px] font-bold text-zinc-500 italic">(complete)</span>}
                </div>
                <span
                  className="text-[10px] font-mono font-bold tabular px-1.5 py-0.5 rounded border shrink-0"
                  style={{ color: stage.color, background: `${stage.color}15`, borderColor: `${stage.color}40` }}
                >
                  {opsHere.length}
                </span>
              </div>

              {/* Chips */}
              <div className="p-2 min-h-[54px]">
                {opsHere.length === 0 ? (
                  <p className="text-[10px] italic text-zinc-600 py-3 text-center">
                    {isTerminus ? 'No operations (terminal stage)' : 'Drop operations here'}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {opsHere.map(op => (
                      <OpChip
                        key={op}
                        op={op}
                        onDragStart={(e) => { setDragOp(op); e.dataTransfer.setData('text/operation', op); e.dataTransfer.effectAllowed = 'move'; }}
                        onDragEnd={() => { setDragOp(null); setHoverStageId(null); }}
                        onTap={() => setPickerOp(op)}
                        dragging={dragOp === op}
                        color={stage.color}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Mobile fallback: tap a chip → modal picker of target stages */}
      {pickerOp && (
        <Overlay open onClose={() => setPickerOp(null)} ariaLabel="Move operation to stage" zIndex={200} backdrop="bg-black/70 backdrop-blur-sm" padding="p-0 sm:p-4">
          <div
            className="w-full sm:max-w-md bg-zinc-950 border border-white/10 rounded-t-2xl sm:rounded-2xl p-4 space-y-2 self-end sm:self-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Move operation</p>
            <p className="text-lg font-black text-white">{pickerOp}</p>
            <p className="text-[11px] text-zinc-500">Pick a stage to assign it to:</p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => { moveOp(pickerOp, null); setPickerOp(null); }}
                className="bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 rounded-lg px-3 py-2 text-xs font-bold"
              >
                Unmapped
              </button>
              {stages.filter(s => !s.isComplete).map(stage => (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() => { moveOp(pickerOp, stage.id); setPickerOp(null); }}
                  className="rounded-lg px-3 py-2 text-xs font-bold border transition-colors hover:brightness-125 text-left truncate"
                  style={{ background: `${stage.color}15`, borderColor: `${stage.color}40`, color: stage.color }}
                >
                  {stage.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPickerOp(null)}
              className="w-full text-xs text-zinc-500 hover:text-white py-2 mt-1"
            >
              Cancel
            </button>
          </div>
        </Overlay>
      )}
    </div>
  );
};

// ── One draggable operation chip ──
const OpChip: React.FC<{
  op: string;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onTap: () => void;
  dragging: boolean;
  color?: string;
  tint?: 'amber';
}> = ({ op, onDragStart, onDragEnd, onTap, dragging, color, tint }) => {
  const baseCls = 'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold cursor-grab active:cursor-grabbing select-none transition-all';
  const tintCls = tint === 'amber'
    ? 'bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20'
    : '';
  const style = color && !tint
    ? { background: `${color}12`, border: `1px solid ${color}40`, color }
    : undefined;
  return (
    <span
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onTap}
      className={`${baseCls} ${tintCls} ${dragging ? 'opacity-40 scale-95' : 'hover:brightness-125'}`}
      style={style}
      title="Drag to a stage — or tap to pick"
    >
      <GripVertical className="w-2.5 h-2.5 opacity-50" aria-hidden="true" />
      {op}
    </span>
  );
};
