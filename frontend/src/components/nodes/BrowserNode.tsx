import { memo, useState, useEffect } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Globe2, ExternalLink, RefreshCw } from 'lucide-react';
import { useUpdateNodeData } from './useUpdateNodeData';

/**
 * BrowserNode - 网页内嵌
 * 通过 iframe 嵌入任意 URL,作为参考资料/在线资源浏览
 * 注意:很多站点设置了 X-Frame-Options/CSP,无法被 iframe,提示用户使用"新窗口打开"
 */
const COLOR = '#fb923c';
const W = 360;

const BrowserNode = (p: NodeProps) => {
  const update = useUpdateNodeData(p.id);
  const d = p.data as any;
  const url: string = d?.url || '';
  const [draft, setDraft] = useState(url);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setDraft(url);
  }, [url]);

  const normalize = (u: string) => {
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) return `https://${u}`;
    return u;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    update({ url: normalize(draft) });
  };

  return (
    <div
      className={`relative rounded-xl border-2 transition-all ${
        p.selected ? 'shadow-2xl' : 'border-white/15 hover:border-white/30'
      }`}
      style={{
        background: 'rgba(20,20,22,.92)',
        backdropFilter: 'blur(8px)',
        width: W,
        borderColor: p.selected ? COLOR : undefined,
        boxShadow: p.selected ? `0 0 0 1px ${COLOR}, 0 16px 32px rgba(251,146,60,.2)` : undefined,
      }}
    >
      <Handle type="source" position={Position.Right} style={{ background: COLOR, border: 0 }} />

      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ background: 'rgba(251,146,60,.2)', color: '#fed7aa', boxShadow: `inset 0 0 0 1px ${COLOR}` }}
        >
          <Globe2 size={13} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white">浏览器</div>
          <div className="text-[10px] text-white/40 truncate">{url || '未加载'}</div>
        </div>
      </div>

      <div className="p-2 space-y-2" onMouseDown={(e) => e.stopPropagation()}>
        <form onSubmit={submit} className="flex items-center gap-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="https://example.com"
            className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-[11px] text-white placeholder-white/30 outline-none focus:border-white/30"
          />
          <button
            type="submit"
            className="px-2 py-1 rounded bg-orange-500/20 hover:bg-orange-500/30 text-orange-200 text-[11px]"
          >
            访问
          </button>
        </form>

        {url && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setReload((n) => n + 1)}
              className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-white/70 text-[10px] flex items-center gap-1"
              title="刷新"
            >
              <RefreshCw size={10} /> 刷新
            </button>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-white/70 text-[10px] flex items-center gap-1"
              title="新窗口打开"
            >
              <ExternalLink size={10} /> 新窗口
            </a>
          </div>
        )}

        {url ? (
          <div className="rounded overflow-hidden border border-white/10 bg-white/5">
            <iframe
              key={reload}
              src={url}
              title="browser"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
              className="w-full block"
              style={{ height: 280, background: 'white' }}
            />
            <div className="text-[9px] text-white/40 px-2 py-1 leading-tight">
              ⚠ 部分站点设置了反嵌入(X-Frame-Options),如显示空白请用"新窗口"
            </div>
          </div>
        ) : (
          <div className="aspect-video rounded bg-white/5 border border-dashed border-white/10 flex items-center justify-center text-[11px] text-white/30">
            输入网址后点访问
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(BrowserNode);
