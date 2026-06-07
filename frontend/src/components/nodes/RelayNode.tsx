import { memo, useEffect, useMemo } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { ArrowRightLeft } from 'lucide-react';
import { useUpdateNodeData } from './useUpdateNodeData';

/**
 * RelayNode - 数据中转
 * 自动透传上游全部可识别的素材字段给下游：
 *   - 文本：prompt / outputText / reply / text
 *   - 图像：imageUrl(单) + imageUrls / urls / generatedImages(多)
 *   - 视频：videoUrl
 *   - 音频：audioUrl
 * 用于跨距离 / 合并多个数据流
 *
 * 稳定性（对齐 §22.2 踩坑）：
 *   1. useEffect deps = [upstreamSignature]，避免无 deps 数组造成 setState 风暴
 *   2. update() 前做 cur/next 深度比较，仅变化时才写回
 */
const COLOR = '#94a3b8';

const pushUnique = (arr: string[], v: any) => {
  if (typeof v !== 'string') return;
  const s = v.trim();
  if (!s) return;
  if (arr.indexOf(s) === -1) arr.push(s);
};

const RelayNode = (p: NodeProps) => {
  const update = useUpdateNodeData(p.id);
  const { getEdges, getNodes } = useReactFlow();
  const d = p.data as any;

  // 计算上游签名 - 仅在上游 data 变化时 effect 才会重跑，
  // 避免原来 useEffect 无 deps 导致的 setState 风暴循环。
  // signature 覆盖所有透传字段，上游任何一项变化都会触发重算。
  const upstreamSignature = useMemo(() => {
    const edges = getEdges();
    const nodes = getNodes();
    const upstreamIds = edges.filter((e) => e.target === p.id).map((e) => e.source);
    return upstreamIds
      .map((uid) => {
        const n = nodes.find((x) => x.id === uid);
        const ud = (n?.data as any) || {};
        const arrLen = (k: string) => (Array.isArray(ud[k]) ? ud[k].length : 0);
        return [
          uid,
          ud.prompt || '',
          ud.outputText || '',
          ud.reply || '',
          ud.text || '',
          ud.imageUrl || '',
          ud.videoUrl || '',
          ud.audioUrl || '',
          arrLen('imageUrls'),
          arrLen('urls'),
          arrLen('generatedImages'),
        ].join('|');
      })
      .join('::');
    // p.data 变化作为一个轻量重算触发点，但计算出的字符串在上游未变时会相等
  }, [p.id, p.data, getEdges, getNodes]);

  // 监听上游变化，自动透传
  useEffect(() => {
    const edges = getEdges();
    const nodes = getNodes();
    const upstreamIds = edges.filter((e) => e.target === p.id).map((e) => e.source);

    // 零上游时主动清理自身透传字段，避免下游读到错乱的残留数据
    if (upstreamIds.length === 0) {
      const cur = JSON.stringify({
        prompt: d?.prompt,
        imageUrl: d?.imageUrl,
        imageUrls: d?.imageUrls,
        urls: d?.urls,
        videoUrl: d?.videoUrl,
        audioUrl: d?.audioUrl,
      });
      const empty = JSON.stringify({});
      if (cur !== empty) {
        update({
          prompt: undefined,
          imageUrl: undefined,
          imageUrls: undefined,
          urls: undefined,
          videoUrl: undefined,
          audioUrl: undefined,
        });
      }
      return;
    }

    const texts: string[] = [];
    const images: string[] = [];
    let videoUrl: string | undefined;
    let audioUrl: string | undefined;

    for (const uid of upstreamIds) {
      const n = nodes.find((x) => x.id === uid);
      const ud = (n?.data as any) || {};
      // 文本：优先取 outputText (OutputNode 手动编辑后的) > reply (LLM) > prompt > text
      pushUnique(texts, ud.outputText);
      pushUnique(texts, ud.reply);
      pushUnique(texts, ud.prompt);
      pushUnique(texts, ud.text);
      // 图像：单 + 多都收集
      pushUnique(images, ud.imageUrl);
      for (const k of ['imageUrls', 'urls', 'generatedImages'] as const) {
        const v = ud[k];
        if (Array.isArray(v)) v.forEach((u: any) => pushUnique(images, u));
      }
      // 视频 / 音频：首个命中为准
      if (!videoUrl && typeof ud.videoUrl === 'string' && ud.videoUrl) videoUrl = ud.videoUrl;
      if (!audioUrl && typeof ud.audioUrl === 'string' && ud.audioUrl) audioUrl = ud.audioUrl;
    }

    const merged: any = {
      prompt: texts.length ? texts.join('\n') : undefined,
      imageUrl: images[0],
      imageUrls: images.length > 1 ? images : undefined,
      urls: images.length > 1 ? images : undefined, // 向后兼容，给老代码读 urls 的地方也能拿到
      videoUrl,
      audioUrl,
    };

    // 仅当变化时才更新，避免循环
    const cur = JSON.stringify({
      prompt: d?.prompt,
      imageUrl: d?.imageUrl,
      imageUrls: d?.imageUrls,
      urls: d?.urls,
      videoUrl: d?.videoUrl,
      audioUrl: d?.audioUrl,
    });
    const next = JSON.stringify({
      prompt: merged.prompt,
      imageUrl: merged.imageUrl,
      imageUrls: merged.imageUrls,
      urls: merged.urls,
      videoUrl: merged.videoUrl,
      audioUrl: merged.audioUrl,
    });
    if (cur !== next) update(merged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upstreamSignature]);

  const upstreamCount = getEdges().filter((e) => e.target === p.id).length;

  // 展示计数
  const imageCount =
    (d?.imageUrl ? 1 : 0) +
    (Array.isArray(d?.imageUrls) ? d.imageUrls.length : 0);
  const hasVideo = !!d?.videoUrl;
  const hasAudio = !!d?.audioUrl;
  const hasText = !!d?.prompt;
  const hasAny = hasText || imageCount > 0 || hasVideo || hasAudio;

  return (
    <div
      className={`relative rounded-xl border-2 transition-all ${
        p.selected ? 'shadow-2xl' : 'border-white/15 hover:border-white/30'
      }`}
      style={{
        background: 'rgba(20,20,22,.92)',
        backdropFilter: 'blur(8px)',
        width: 200,
        borderColor: p.selected ? COLOR : undefined,
        boxShadow: p.selected ? `0 0 0 1px ${COLOR}, 0 16px 32px rgba(148,163,184,.2)` : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: COLOR, border: 0 }} />
      <Handle type="source" position={Position.Right} style={{ background: COLOR, border: 0 }} />

      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ background: 'rgba(148,163,184,.2)', color: '#cbd5e1', boxShadow: `inset 0 0 0 1px ${COLOR}` }}
        >
          <ArrowRightLeft size={13} />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white">中继</div>
          <div className="text-[10px] text-white/40">{upstreamCount} 个上游</div>
        </div>
      </div>

      <div className="p-2 space-y-1 text-[10px] text-white/50">
        {hasText && <div className="truncate">📝 {String(d.prompt).slice(0, 30)}{String(d.prompt).length > 30 ? '…' : ''}</div>}
        {imageCount > 0 && <div>🖼 {imageCount} 张图</div>}
        {hasVideo && <div>🎬 1 个视频</div>}
        {hasAudio && <div>🎵 1 个音频</div>}
        {!hasAny && (
          <div className="text-white/30 italic text-center py-1">无数据透传</div>
        )}
      </div>
    </div>
  );
};

export default memo(RelayNode);
