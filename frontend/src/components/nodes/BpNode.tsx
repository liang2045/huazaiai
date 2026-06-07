import { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Map as MapIcon } from 'lucide-react';
import { useUpdateNodeData } from './useUpdateNodeData';

/**
 * BpNode - BP 蓝图
 * 项目蓝图/规划卡片,支持多个步骤条目,作为下游 prompt 源
 */
const COLOR = '#94a3b8';

interface Step {
  id: string;
  text: string;
  done?: boolean;
}

const BpNode = (p: NodeProps) => {
  const update = useUpdateNodeData(p.id);
  const d = p.data as any;
  const title: string = d?.title || '项目蓝图';
  const steps: Step[] = d?.steps || [];

  const buildPrompt = (t: string, ss: Step[]) =>
    [t, ...ss.map((s, i) => `${i + 1}. ${s.text}${s.done ? ' ✓' : ''}`).filter(Boolean)].join('\n');

  const setSteps = useCallback(
    (ss: Step[]) => update({ steps: ss, prompt: buildPrompt(title, ss) }),
    [update, title]
  );
  const setTitle = useCallback(
    (t: string) => update({ title: t, prompt: buildPrompt(t, steps) }),
    [update, steps]
  );
  const addStep = () =>
    setSteps([...steps, { id: Math.random().toString(36).slice(2, 8), text: '' }]);
  const updateStep = (id: string, patch: Partial<Step>) =>
    setSteps(steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const removeStep = (id: string) => setSteps(steps.filter((s) => s.id !== id));

  return (
    <div
      className={`relative rounded-xl border-2 transition-all ${
        p.selected ? 'shadow-2xl' : 'border-white/15 hover:border-white/30'
      }`}
      style={{
        background: 'rgba(20,20,22,.92)',
        backdropFilter: 'blur(8px)',
        width: 280,
        borderColor: p.selected ? COLOR : undefined,
        boxShadow: p.selected ? `0 0 0 1px ${COLOR}, 0 16px 32px rgba(148,163,184,.2)` : undefined,
      }}
    >
      <Handle type="source" position={Position.Right} style={{ background: COLOR, border: 0 }} />

      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ background: 'rgba(148,163,184,.2)', color: '#cbd5e1', boxShadow: `inset 0 0 0 1px ${COLOR}` }}
        >
          <MapIcon size={13} />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white">BP 蓝图</div>
          <div className="text-[10px] text-white/40">
            {steps.filter((s) => s.done).length}/{steps.length}
          </div>
        </div>
      </div>

      <div className="p-2.5 space-y-2" onMouseDown={(e) => e.stopPropagation()}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white outline-none focus:border-white/30"
        />

        <div className="space-y-1.5">
          {steps.map((s, i) => (
            <div key={s.id} className="flex items-center gap-1.5 group">
              <input
                type="checkbox"
                checked={!!s.done}
                onChange={(e) => updateStep(s.id, { done: e.target.checked })}
                className="accent-slate-400"
              />
              <span className="text-[10px] text-white/40 w-4">{i + 1}.</span>
              <input
                value={s.text}
                onChange={(e) => updateStep(s.id, { text: e.target.value })}
                placeholder="步骤..."
                className={`flex-1 bg-white/5 border border-white/10 rounded px-2 py-0.5 text-[11px] outline-none focus:border-white/30 ${
                  s.done ? 'text-white/40 line-through' : 'text-white'
                }`}
              />
              <button
                onClick={() => removeStep(s.id)}
                className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-red-300 text-[10px] px-1"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={addStep}
          className="w-full py-1 rounded text-[11px] bg-white/5 hover:bg-white/10 text-white/60 transition-colors"
        >
          + 添加步骤
        </button>
      </div>
    </div>
  );
};

export default memo(BpNode);
