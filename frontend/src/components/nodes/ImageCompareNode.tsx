import { memo, useState, useMemo, useCallback } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { GitCompare } from 'lucide-react';

/**
 * ImageCompareNode - 前后对比(纯前端 slider,无后端 op)
 * 接受两个上游图像,左右滑动对比
 * 第一个上游 = before(底图),第二个 = after(覆盖层)
 */
const COLOR = '#fb923c';

const ImageCompareNode = (p: NodeProps) => {
  const { getEdges, getNodes } = useReactFlow();
  const [pos, setPos] = useState(50); // 0-100

  const upstreamImages = useMemo(() => {
    const edges = getEdges();
    const nodes = getNodes();
    const upstreamIds = edges.filter((e) => e.target === p.id).map((e) => e.source);
    const urls: string[] = [];
    for (const uid of upstreamIds) {
      const n = nodes.find((x) => x.id === uid);
      const u = (n?.data as any)?.imageUrl;
      if (u && typeof u === 'string') urls.push(u);
    }
    return urls;
  }, [getEdges, getNodes, p.id, p.data]);

  const before = upstreamImages[0];
  const after = upstreamImages[1];

  const onSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPos(parseInt(e.target.value));
  }, []);

  return (
    <div
      className={`relative rounded-xl border-2 transition-all ${
        p.selected ? 'shadow-2xl' : 'border-white/15 hover:border-white/30'
      }`}
      style={{
        background: 'rgba(20,20,22,.92)',
        backdropFilter: 'blur(8px)',
        width: 320,
        borderColor: p.selected ? COLOR : undefined,
        boxShadow: p.selected ? `0 0 0 1px ${COLOR}, 0 16px 32px rgba(251,146,60,.2)` : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: COLOR, border: 0 }} />

      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ background: 'rgba(251,146,60,.2)', color: '#fed7aa', boxShadow: `inset 0 0 0 1px ${COLOR}` }}
        >
          <GitCompare size={13} />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white">前后对比</div>
          <div className="text-[10px] text-white/40">
            {before && after ? '滑动查看' : '需连接 2 张图'}
          </div>
        </div>
      </div>

      <div className="p-2 space-y-2" onMouseDown={(e) => e.stopPropagation()}>
        {!before ? (
          <div className="aspect-video rounded bg-white/5 border border-dashed border-white/15 flex items-center justify-center text-[10px] text-white/30">
            连接第一张图(before)
          </div>
        ) : !after ? (
          <div className="space-y-1">
            <img src={before} alt="before" className="w-full rounded object-contain" />
            <div className="text-[10px] text-white/40 text-center">连接第二张图(after)</div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative w-full overflow-hidden rounded select-none" style={{ aspectRatio: 'auto' }}>
              <img src={before} alt="before" className="w-full block" draggable={false} />
              <div
                className="absolute inset-y-0 left-0 overflow-hidden pointer-events-none"
                style={{ width: `${pos}%` }}
              >
                <img
                  src={after}
                  alt="after"
                  className="block max-w-none"
                  style={{ width: `${100 / Math.max(pos, 1) * 100}%`, height: '100%', objectFit: 'cover' }}
                  draggable={false}
                />
              </div>
              <div
                className="absolute inset-y-0 w-0.5 bg-white/80 pointer-events-none"
                style={{ left: `calc(${pos}% - 1px)` }}
              />
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={pos}
              onChange={onSliderChange}
              className="w-full accent-orange-400"
            />
            <div className="flex justify-between text-[10px] text-white/40">
              <span>Before</span>
              <span>{pos}%</span>
              <span>After</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(ImageCompareNode);
