import { memo, useMemo } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { MonitorPlay, Download } from 'lucide-react';

/**
 * VideoOutputNode - 视频结果展示
 * 接收上游 imageUrl(视频 URL)/ urls,大尺寸播放
 * 仅作为终端展示,不再向下游传递
 */
const COLOR = '#94a3b8';

const isVideoUrl = (u: string) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u);

const VideoOutputNode = (p: NodeProps) => {
  const { getEdges, getNodes } = useReactFlow();

  const upstreamMedia = useMemo(() => {
    const edges = getEdges();
    const nodes = getNodes();
    const upstreamIds = edges.filter((e) => e.target === p.id).map((e) => e.source);
    const list: string[] = [];
    for (const uid of upstreamIds) {
      const n = nodes.find((x) => x.id === uid);
      const ud = (n?.data as any) || {};
      if (ud.imageUrl) list.push(String(ud.imageUrl));
      if (Array.isArray(ud.urls)) list.push(...ud.urls);
    }
    return list;
  }, [getEdges, getNodes, p.id, p.data]);

  return (
    <div
      className={`relative rounded-xl border-2 transition-all ${
        p.selected ? 'shadow-2xl' : 'border-white/15 hover:border-white/30'
      }`}
      style={{
        background: 'rgba(20,20,22,.92)',
        backdropFilter: 'blur(8px)',
        width: 360,
        borderColor: p.selected ? COLOR : undefined,
        boxShadow: p.selected ? `0 0 0 1px ${COLOR}, 0 16px 32px rgba(148,163,184,.2)` : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: COLOR, border: 0 }} />

      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ background: 'rgba(148,163,184,.2)', color: '#cbd5e1', boxShadow: `inset 0 0 0 1px ${COLOR}` }}
        >
          <MonitorPlay size={13} />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white">视频输出</div>
          <div className="text-[10px] text-white/40">{upstreamMedia.length} 项</div>
        </div>
      </div>

      <div className="p-2 space-y-2">
        {upstreamMedia.length === 0 ? (
          <div className="aspect-video rounded bg-white/5 border border-dashed border-white/15 flex items-center justify-center text-[11px] text-white/30">
            连接 视频/视频结果 节点
          </div>
        ) : (
          upstreamMedia.map((u, i) => (
            <div key={i} className="space-y-1">
              {isVideoUrl(u) ? (
                <video src={u} controls className="w-full rounded bg-black" />
              ) : (
                <img src={u} alt={`媒体 ${i + 1}`} className="w-full rounded object-contain" />
              )}
              <div className="flex justify-between items-center text-[10px] text-white/40">
                <span className="truncate flex-1">{u.split('/').pop()}</span>
                <a
                  href={u}
                  download
                  className="flex items-center gap-0.5 text-white/60 hover:text-white px-1.5 py-0.5 rounded hover:bg-white/10"
                >
                  <Download size={10} /> 下载
                </a>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default memo(VideoOutputNode);
