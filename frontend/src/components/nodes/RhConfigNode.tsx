import { memo, useEffect, useMemo, useState } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { Plus, Settings2, Trash2, RefreshCw } from 'lucide-react';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useThemeStore } from '../../stores/theme';

/**
 * RhConfigNode 条目
 * - text/number：fieldValue 是纯文本
 * - image/video/audio：fieldValue 是 url（本地 /files/output/* 或远程 https://...）
 *   提交时由 RunningHubNode 负责先调 /runninghub/upload-asset
 *   转成 RH 内部 fileName 后才写入真实 nodeInfoList。
 * - sourceFromUpstream=true：从上游节点自动提取对应 kind 的 url
 */
interface NodeInfo {
  nodeId: string;
  fieldName: string;
  fieldValue: string;
  valueType?: 'text' | 'number' | 'image' | 'video' | 'audio';
  sourceFromUpstream?: boolean;
}

const MEDIA_TYPES = new Set(['image', 'video', 'audio']);

/**
 * 从上游节点 data 中提取对应 kind 的第一个 url。
 * 兼容 imageUrl/imageUrls[]/urls[]/generatedImages[]/videoUrl/audioUrl。
 */
function extractUpstreamUrl(d: any, kind: 'image' | 'video' | 'audio'): string {
  if (!d) return '';
  if (kind === 'image') {
    if (typeof d.imageUrl === 'string' && d.imageUrl) return d.imageUrl;
    if (Array.isArray(d.imageUrls) && d.imageUrls[0]) return d.imageUrls[0];
    if (Array.isArray(d.urls) && d.urls[0]) return d.urls[0];
    if (Array.isArray(d.generatedImages) && d.generatedImages[0]) return d.generatedImages[0];
    // upload 节点
    if (d.uploadType === 'image' && typeof d.url === 'string') return d.url;
  } else if (kind === 'video') {
    if (typeof d.videoUrl === 'string' && d.videoUrl) return d.videoUrl;
    if (d.uploadType === 'video' && typeof d.url === 'string') return d.url;
  } else if (kind === 'audio') {
    if (typeof d.audioUrl === 'string' && d.audioUrl) return d.audioUrl;
    if (d.uploadType === 'audio' && typeof d.url === 'string') return d.url;
  }
  return '';
}

/**
 * RhConfigNode - RunningHub 工作流参数注入
 * 多条 nodeId / fieldName / fieldValue 三元组,作为 nodeInfoList 输出给 RunningHubNode
 * 收包含 valueType 标记供下游决定是否需要转 fileName
 * 上游接入: 左侧 target Handle 接受任意产出 url 节点 (image/video/audio/upload 等)
 */
const RhConfigNode = ({ id, data, selected }: NodeProps) => {
  const update = useUpdateNodeData(id);
  const { getEdges, getNodes } = useReactFlow();
  const d = data as any;
  const { style } = useThemeStore();
  const isPixel = style === 'pixel';
  const [list, setList] = useState<NodeInfo[]>(() => {
    const arr = d?.nodeInfoList;
    if (Array.isArray(arr)) return arr.map((x: any) => ({
      nodeId: x?.nodeId || '',
      fieldName: x?.fieldName || '',
      fieldValue: x?.fieldValue ?? '',
      valueType: x?.valueType || 'text',
      sourceFromUpstream: !!x?.sourceFromUpstream,
    }));
    return [];
  });

  const sync = (next: NodeInfo[]) => {
    setList(next);
    update({ nodeInfoList: next });
  };

  const add = () => sync([...list, { nodeId: '', fieldName: '', fieldValue: '', valueType: 'text', sourceFromUpstream: false }]);
  const remove = (i: number) => sync(list.filter((_, idx) => idx !== i));
  const updateAt = (i: number, patch: Partial<NodeInfo>) =>
    sync(list.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  // ----- 上游节点提取 -----
  const upstreamNodes = useMemo(() => {
    const edges = getEdges();
    const nodes = getNodes();
    const upIds = edges.filter((e) => e.target === id).map((e) => e.source);
    return upIds.map((uid) => nodes.find((n) => n.id === uid)).filter(Boolean) as any[];
  // 依赖 d 改变重新提取（节点 data 变动 → 连接变动 → React 重渲染 → useMemo 重计）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, d]);

  /**
   * 为某条目从上游节点中匹配一个符合 valueType 的 url。
   * 策略：递减检查上游节点顺序，选中第一个包含该 kind 的 url。
   */
  const findUpstreamUrl = (kind: 'image' | 'video' | 'audio'): string => {
    for (const n of upstreamNodes) {
      const u = extractUpstreamUrl(n.data, kind);
      if (u) return u;
    }
    return '';
  };

  // 启用 sourceFromUpstream 的条目自动同步上游 url
  useEffect(() => {
    let changed = false;
    const next = list.map((it) => {
      if (it.sourceFromUpstream && it.valueType && MEDIA_TYPES.has(it.valueType)) {
        const u = findUpstreamUrl(it.valueType as any);
        if (u && u !== it.fieldValue) {
          changed = true;
          return { ...it, fieldValue: u };
        }
      }
      return it;
    });
    if (changed) sync(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upstreamNodes, list.length]);

  return (
    <div
      className={`relative rounded-xl border-2 transition-all w-[320px] ${
        selected ? 'border-cyan-400 shadow-2xl shadow-cyan-500/20' : 'border-white/15 hover:border-white/30'
      }`}
      style={{
        // 像素风：不透明背景 + 取消 backdrop blur，避免亚像素渲染导致文字发虚
        background: isPixel ? 'var(--px-surface)' : 'rgba(20,20,22,.92)',
        backdropFilter: isPixel ? 'none' : 'blur(8px)',
        color: isPixel ? 'var(--px-ink)' : undefined,
      }}
    >
      {/* 左侧 target Handle: 接受上游 image/video/audio/upload 节点 */}
      <Handle type="target" position={Position.Left} className="!bg-cyan-400 !border-0" />
      <Handle type="source" position={Position.Right} className="!bg-cyan-400 !border-0" />

      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ background: 'rgba(6,182,212,.2)', color: '#67e8f9', boxShadow: 'inset 0 0 0 1px rgba(6,182,212,.45)' }}
        >
          <Settings2 size={13} />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white">RH 配置</div>
          <div className="text-[10px] text-white/40">
            注入 {list.length} 个参数 · 上游 {upstreamNodes.length} 节点
          </div>
        </div>
      </div>

      <div className="p-2.5 space-y-2 max-h-[420px] overflow-auto" onMouseDown={(e) => e.stopPropagation()}>
        {list.length === 0 && (
          <div className="text-[10px] text-white/40 text-center py-2">点击 + 添加节点参数</div>
        )}
        {list.map((item, i) => {
          const isMedia = !!item.valueType && MEDIA_TYPES.has(item.valueType);
          return (
            <div key={i} className="rounded border border-white/10 bg-white/5 p-2 space-y-1">
              <div className="flex items-center justify-between">
                <div className="text-[10px] text-white/50">#{i + 1}</div>
                <button
                  onClick={() => remove(i)}
                  className="text-red-300/70 hover:text-red-300"
                  title="删除"
                >
                  <Trash2 size={10} />
                </button>
              </div>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={item.nodeId}
                  onChange={(e) => updateAt(i, { nodeId: e.target.value })}
                  placeholder="nodeId(如 6)"
                  className="flex-1 rounded bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-white outline-none focus:border-white/30 placeholder:text-white/30"
                />
                <select
                  value={item.valueType || 'text'}
                  onChange={(e) => updateAt(i, { valueType: e.target.value as NodeInfo['valueType'] })}
                  className="rounded bg-white/5 border border-white/10 px-1 py-1 text-[10px] text-white outline-none focus:border-white/30"
                  title="参数类型"
                >
                  <option value="text">text</option>
                  <option value="number">number</option>
                  <option value="image">image</option>
                  <option value="video">video</option>
                  <option value="audio">audio</option>
                </select>
              </div>
              <input
                type="text"
                value={item.fieldName}
                onChange={(e) => updateAt(i, { fieldName: e.target.value })}
                placeholder="fieldName(如 prompt / image / file)"
                className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-white outline-none focus:border-white/30 placeholder:text-white/30"
              />
              {isMedia ? (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px]">
                    <label className="flex items-center gap-1 text-cyan-200/80 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!item.sourceFromUpstream}
                        onChange={(e) => updateAt(i, { sourceFromUpstream: e.target.checked })}
                        className="accent-cyan-400"
                      />
                      从上游自动获取
                    </label>
                    {item.sourceFromUpstream && (
                      <button
                        onClick={() => {
                          const u = findUpstreamUrl(item.valueType as any);
                          if (u) updateAt(i, { fieldValue: u });
                        }}
                        className="flex items-center gap-1 text-cyan-200/80 hover:text-cyan-100"
                        title="重新同步上游 url"
                      >
                        <RefreshCw size={9} /> 同步
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={item.fieldValue}
                    onChange={(e) => updateAt(i, { fieldValue: e.target.value })}
                    placeholder={item.sourceFromUpstream ? '(从上游自动填入)' : `${item.valueType} url 或 fileName`}
                    readOnly={!!item.sourceFromUpstream}
                    className={`w-full rounded border px-2 py-1 text-[11px] text-white outline-none placeholder:text-white/30 ${
                      item.sourceFromUpstream
                        ? 'bg-cyan-500/5 border-cyan-500/20 cursor-not-allowed'
                        : 'bg-white/5 border-white/10 focus:border-white/30'
                    }`}
                  />
                  {/\.(png|jpe?g|webp|gif|bmp)$/i.test(item.fieldValue) && (
                    <img
                      src={item.fieldValue}
                      alt="预览"
                      className="w-full max-h-24 object-contain rounded border border-white/10"
                    />
                  )}
                  <div className="text-[9px] text-white/30">
                    提交时自动调 RH /upload 转换为 fileName
                  </div>
                </div>
              ) : (
                <textarea
                  value={item.fieldValue}
                  onChange={(e) => updateAt(i, { fieldValue: e.target.value })}
                  placeholder="fieldValue"
                  className="w-full h-12 resize-none rounded bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-white outline-none focus:border-white/30 placeholder:text-white/30"
                />
              )}
            </div>
          );
        })}
        <button
          onClick={add}
          className="w-full flex items-center justify-center gap-1 py-1.5 rounded border border-dashed border-white/20 hover:border-white/40 text-white/60 hover:text-white text-xs transition-colors"
        >
          <Plus size={11} /> 添加参数
        </button>
      </div>
    </div>
  );
};

export default memo(RhConfigNode);
