import { memo, useCallback, useMemo } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { LayoutGrid, Plus, X } from 'lucide-react';
import { useUpdateNodeData } from './useUpdateNodeData';

/**
 * StoryboardGridNode - 分镜网格
 * 多个分镜单元(每个有标题/描述/参考图占位),输出聚合 prompt
 * 也可以接收上游 imageUrl 自动填入第一个空槽位
 */
const COLOR = '#818cf8';

interface Frame {
  id: string;
  title: string;
  desc: string;
  imageUrl?: string;
}

const StoryboardGridNode = (p: NodeProps) => {
  const update = useUpdateNodeData(p.id);
  const { getEdges, getNodes } = useReactFlow();
  const d = p.data as any;
  const cols: number = d?.cols || 3;
  const frames: Frame[] = d?.frames || [];

  const upstreamImages = useMemo(() => {
    const edges = getEdges();
    const nodes = getNodes();
    const upstreamIds = edges.filter((e) => e.target === p.id).map((e) => e.source);
    const list: string[] = [];
    for (const uid of upstreamIds) {
      const n = nodes.find((x) => x.id === uid);
      const u = (n?.data as any)?.imageUrl;
      if (u) list.push(u);
      const us = (n?.data as any)?.urls;
      if (Array.isArray(us)) list.push(...us);
    }
    return list;
  }, [getEdges, getNodes, p.id, p.data]);

  const buildPrompt = (fs: Frame[]) =>
    fs
      .map((f, i) => `[Scene ${i + 1}] ${f.title}${f.desc ? ` - ${f.desc}` : ''}`)
      .join('\n');

  const setFrames = useCallback((fs: Frame[]) => update({ frames: fs, prompt: buildPrompt(fs) }), [update]);

  const addFrame = () =>
    setFrames([...frames, { id: Math.random().toString(36).slice(2, 8), title: '', desc: '' }]);

  const updFrame = (id: string, patch: Partial<Frame>) =>
    setFrames(frames.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  const removeFrame = (id: string) => setFrames(frames.filter((f) => f.id !== id));

  const fillFromUpstream = (id: string) => {
    const used = new Set(frames.map((f) => f.imageUrl).filter(Boolean));
    const next = upstreamImages.find((u) => !used.has(u));
    if (next) updFrame(id, { imageUrl: next });
  };

  return (
    <div
      className={`relative rounded-xl border-2 transition-all ${
        p.selected ? 'shadow-2xl' : 'border-white/15 hover:border-white/30'
      }`}
      style={{
        background: 'rgba(20,20,22,.92)',
        backdropFilter: 'blur(8px)',
        width: 380,
        borderColor: p.selected ? COLOR : undefined,
        boxShadow: p.selected ? `0 0 0 1px ${COLOR}, 0 16px 32px rgba(129,140,248,.2)` : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: COLOR, border: 0 }} />
      <Handle type="source" position={Position.Right} style={{ background: COLOR, border: 0 }} />

      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ background: 'rgba(129,140,248,.2)', color: '#c7d2fe', boxShadow: `inset 0 0 0 1px ${COLOR}` }}
        >
          <LayoutGrid size={13} />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white">分镜网格</div>
          <div className="text-[10px] text-white/40">{frames.length} 个分镜 · {cols} 列</div>
        </div>
      </div>

      <div className="p-2.5 space-y-2" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-white/50">列数</label>
          <input
            type="number"
            min={1}
            max={6}
            value={cols}
            onChange={(e) => update({ cols: parseInt(e.target.value) || 3 })}
            className="w-14 bg-white/5 border border-white/10 rounded px-2 py-0.5 text-[11px] text-white outline-none focus:border-white/30"
          />
        </div>

        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {frames.map((f, i) => (
            <div key={f.id} className="bg-white/5 border border-white/10 rounded p-1.5 space-y-1 group relative">
              <button
                onClick={() => removeFrame(f.id)}
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500/80 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center"
              >
                <X size={9} />
              </button>
              <div
                className="aspect-video bg-white/5 border border-dashed border-white/10 rounded flex items-center justify-center text-[10px] text-white/30 cursor-pointer hover:bg-white/10"
                onClick={() => fillFromUpstream(f.id)}
              >
                {f.imageUrl ? (
                  <img src={f.imageUrl} alt={`scene ${i + 1}`} className="w-full h-full object-cover rounded" />
                ) : (
                  <span>S{i + 1}</span>
                )}
              </div>
              <input
                value={f.title}
                onChange={(e) => updFrame(f.id, { title: e.target.value })}
                placeholder="标题"
                className="w-full bg-white/0 border-0 px-1 py-0 text-[10px] text-white placeholder-white/30 outline-none"
              />
              <textarea
                value={f.desc}
                onChange={(e) => updFrame(f.id, { desc: e.target.value })}
                placeholder="描述"
                rows={2}
                className="w-full bg-white/0 border-0 px-1 py-0 text-[10px] text-white placeholder-white/30 outline-none resize-none"
              />
            </div>
          ))}
        </div>

        <button
          onClick={addFrame}
          className="w-full py-1 rounded text-[11px] bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-200 transition-colors flex items-center justify-center gap-1"
        >
          <Plus size={11} /> 添加分镜
        </button>
        {upstreamImages.length > 0 && (
          <div className="text-[10px] text-white/40 text-center">
            点击空白槽位从上游取图(剩余 {upstreamImages.length} 张)
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(StoryboardGridNode);
