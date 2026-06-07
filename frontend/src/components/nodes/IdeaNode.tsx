import { memo, useCallback, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Lightbulb } from 'lucide-react';
import { useUpdateNodeData } from './useUpdateNodeData';

/**
 * IdeaNode - 灵感记录
 * 简单的笔记卡片,可以记录创意/参考链接,作为提示词来源(输出 prompt)
 */
const COLOR = '#94a3b8';

const IdeaNode = (p: NodeProps) => {
  const update = useUpdateNodeData(p.id);
  const d = p.data as any;
  const title = d?.title || '';
  const content = d?.content || '';
  // 输出 prompt 给下游
  const prompt = useMemo(() => {
    if (!title && !content) return '';
    return [title, content].filter(Boolean).join('\n');
  }, [title, content]);

  const onTitle = useCallback((v: string) => update({ title: v, prompt: [v, content].filter(Boolean).join('\n') }), [update, content]);
  const onContent = useCallback((v: string) => update({ content: v, prompt: [title, v].filter(Boolean).join('\n') }), [update, title]);

  return (
    <div
      className={`relative rounded-xl border-2 transition-all ${
        p.selected ? 'shadow-2xl' : 'border-white/15 hover:border-white/30'
      }`}
      style={{
        background: 'rgba(20,20,22,.92)',
        backdropFilter: 'blur(8px)',
        width: 240,
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
          <Lightbulb size={13} />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white">灵感</div>
          <div className="text-[10px] text-white/40">{prompt ? `${prompt.length} 字` : '空'}</div>
        </div>
      </div>

      <div className="p-2.5 space-y-2" onMouseDown={(e) => e.stopPropagation()}>
        <input
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder="标题..."
          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white placeholder-white/30 outline-none focus:border-white/30"
        />
        <textarea
          value={content}
          onChange={(e) => onContent(e.target.value)}
          placeholder="记录灵感、参考链接、关键词..."
          rows={5}
          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-white/30 resize-none leading-relaxed"
        />
      </div>
    </div>
  );
};

export default memo(IdeaNode);
