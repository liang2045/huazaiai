import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { AlertCircle, Download, Loader2, RotateCcw, Video as VideoIcon, Sparkles, Square, X, ZoomIn, ZoomOut } from 'lucide-react';
import { VIDEO_MODELS, isFalVideoModel, VIDEO_FAL_REGISTRY, VEO_FAL_RATIOS, VEO_FAL_DURATIONS, VEO_FAL_RESOLUTIONS, GROK_FAL_RATIOS, GROK_FAL_RESOLUTIONS } from '../../providers/models';
import { submitVideo, queryVideo, submitVideoFal, queryVideoFal, type VideoSubmitRequest, type VideoFalSubmitRequest } from '../../services/generation';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useHasAutoOutput } from './useHasAutoOutput';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { logBus } from '../../stores/logs';
import { useThemeStore } from '../../stores/theme';
import { useUpstreamMaterials } from './useUpstreamMaterials';
import { useOrderedMaterials } from './useOrderedMaterials';
import MaterialPreviewSection from './MaterialPreviewSection';
import { useDragMaterialStore, type MaterialPayload } from '../../stores/dragMaterial';
import { useMaterialDropTarget } from '../../hooks/useMaterialDropTarget';
import { downloadAsset } from '../../utils/download';

/**
 * VideoNode - 异步视频生成(完全对齐 gpt-image-2-web)
 * 支持:
 *   - Veo 3.1   (kind=veo)      — 13 个子模型 / aspect_ratio(16:9|9:16) / seed / enhance_prompt / enable_upsample / images(≤3)
 *   - Grok Video(kind=grok)     — grok-video-3 / ratio / duration(s) / resolution(480P|720P) / seed / images(≤7)
 *   - Seedance  (kind=seedance) — 零破坏兼容旧 veo 字段
 * 流程: submit → poll(5s 间隔) → 转存 → 展示
 */
const VideoNode = ({ id, data, selected }: NodeProps) => {
  const update = useUpdateNodeData(id);
  const hasAutoOutput = useHasAutoOutput(id);
  const { getEdges, getNodes } = useReactFlow();
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const pollTimer = useRef<number | null>(null);
  const src = `video:${id.slice(0, 6)}`;

  // 主题适配 (默认科技风深色, 传递给聚合预览区)
  const { theme, style: themeStyle } = useThemeStore();
  const isDark = theme === 'dark';
  const isPixel = themeStyle === 'pixel';

  const d = data as any;
  const previewZoom = typeof d?.previewZoom === 'number' ? d.previewZoom : 1;
  const setPreviewZoom = (next: number) => {
    update({ previewZoom: Math.min(3, Math.max(0.5, Number(next.toFixed(2)))) });
  };
  // 主模型 id (对应 VIDEO_MODELS 项)
  const mainId = d?.mainId || (d?.model && VIDEO_MODELS.find((m) => m.id === d.model || m.apiModelOptions.some((o) => o.value === d.model))?.id) || VIDEO_MODELS[0].id;
  const modelDef = useMemo(() => VIDEO_MODELS.find((m) => m.id === mainId) || VIDEO_MODELS[0], [mainId]);
  const maxRefImages = modelDef.maxRefImages ?? modelDef.maxReferenceImages;
  const supportImages = modelDef.supportImages ?? maxRefImages > 0;
  // 子模型(上游真实 model 名)
  const apiModel: string = d?.model && modelDef.apiModelOptions.some((o) => o.value === d.model) ? d.model : modelDef.apiModelOptions[0].value;
  // 各参数(跳过着调用 update 默认值)
  const ratio: string = d?.ratio || modelDef.defaultRatio;
  const duration: number = d?.duration ?? modelDef.defaultDuration ?? (modelDef.durations?.[0] || 0);
  const resolution: string = d?.resolution || modelDef.defaultResolution || '';
  const seed: number = typeof d?.seed === 'number' ? d.seed : 0;
  const enhancePrompt: boolean = d?.enhancePrompt ?? false;
  const enableUpsample: boolean = d?.enableUpsample ?? false;

  // FAL 专属参数
  const isFal = isFalVideoModel(apiModel);
  const falReg = isFal ? VIDEO_FAL_REGISTRY[apiModel] : null;
  // veo-fal 专属
  const vfRatio: string = d?.vfRatio || '16:9';
  const vfDuration: string = d?.vfDuration || '8s';
  const vfResolution: string = d?.vfResolution || '720p';
  const vfAudio: boolean = d?.vfAudio ?? false;
  const vfSafety: number = d?.vfSafety ?? 4;
  // grok-fal 专属
  const gkfRatio: string = d?.gkfRatio || '16:9';
  const gkfDuration: number = d?.gkfDuration ?? 6;
  const gkfResolution: string = d?.gkfResolution || '720p';

  const status: 'idle' | 'submitting' | 'polling' | 'success' | 'error' = d?.status || 'idle';
  const taskId: string | undefined = d?.taskId;
  const videoUrl: string | undefined = d?.videoUrl;
  const progress: string = d?.progress || '';
  const localPrompt: string = d?.prompt || '';

  // === 上游素材聚合 (跨节点统一机制) ===
  const upstream = useUpstreamMaterials(id);
  const materialOrder: string[] = Array.isArray(d?.materialOrder) ? d.materialOrder : [];
  const orderedTexts = useOrderedMaterials(upstream.texts, materialOrder);
  const orderedImages = useOrderedMaterials(upstream.images, materialOrder);
  const orderedVideos = useOrderedMaterials(upstream.videos, materialOrder);
  const orderedAudios = useOrderedMaterials(upstream.audios, materialOrder);
  const setMaterialOrder = (newOrder: string[]) => update({ materialOrder: newOrder });

  // === 本地拖入参考图 (跨节点 Ctrl 拖拽) ===
  const localRefImages: string[] = Array.isArray(d?.localRefImages) ? d.localRefImages : [];

  // 分组动态跟随子模型: seedance 支持 image/video/audio, 其他 (grok/veo) 仅 image
  const previewGroups = useMemo<ReadonlyArray<'text' | 'image' | 'video' | 'audio'>>(
    () => (modelDef.kind === 'seedance' ? ['text', 'image', 'video', 'audio'] : ['text', 'image']),
    [modelDef.kind],
  );

  // 收集上游 prompt + 参考图 (按用户拖拽顺序), 合并本地拖入参考图
  const collectUpstream = (): { prompt: string; imageUrls: string[] } => {
    const prompts = orderedTexts.map((t) => t.url).filter((s) => !!s);
    const upImageUrls = orderedImages.map((m) => m.url).filter((s) => !!s);
    const merged: string[] = [];
    for (const u of [...upImageUrls, ...localRefImages]) {
      if (u && merged.indexOf(u) === -1) merged.push(u);
    }
    return { prompt: prompts.join('\n').trim(), imageUrls: merged };
  };

  // 本地 URL 转 base64(veo/seedance 路径使用;grok 可直接传 URL)
  const urlToBase64 = async (url: string): Promise<string> => {
    const r = await fetch(url);
    const blob = await r.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const stopPoll = () => {
    if (pollTimer.current) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  useEffect(() => () => stopPoll(), []);

  // 切主模型时重置所有参数为该模型默认值(避免跨模型参数遗留)
  const switchMainModel = (nextId: string) => {
    const def = VIDEO_MODELS.find((m) => m.id === nextId) || VIDEO_MODELS[0];
    update({
      mainId: def.id,
      model: def.apiModelOptions[0].value,
      ratio: def.defaultRatio,
      duration: def.defaultDuration ?? def.durations?.[0],
      resolution: def.defaultResolution || '',
    });
  };

  const startPolling = (tid: string) => {
    stopPoll();
    let elapsed = 0;
    const POLL_INT = 5000;
    const MAX = 480; // 40 分钟
    let lastProgress = '';
    pollTimer.current = window.setInterval(async () => {
      elapsed += 1;
      if (elapsed > MAX) {
        stopPoll();
        update({ status: 'error', error: '轮询超时' });
        setError('轮询超时');
        logBus.error('轮询超时', src);
        return;
      }
      try {
        const r = await queryVideo(tid, apiModel);
        if (r.progress && r.progress !== lastProgress) {
          lastProgress = r.progress;
          logBus.debug(`[${elapsed}/${MAX}] status=${r.status} progress=${r.progress}`, src);
        }
        if (r.status === 'SUCCESS' && r.videoUrl) {
          stopPoll();
          update({ status: 'success', videoUrl: r.videoUrl, progress: '100%' });
          logBus.success(`任务完成 → ${r.videoUrl}`, src);
        } else if (r.status === 'FAILURE') {
          stopPoll();
          const msg = r.failReason || '生成失败';
          update({ status: 'error', error: msg });
          setError(msg);
          logBus.error(`生成失败: ${msg}`, src);
        } else {
          update({ status: 'polling', progress: r.progress || '' });
        }
      } catch (e: any) {
        // 偶尔失败不停止
        console.warn('轮询出错', e?.message);
      }
    }, POLL_INT);
  };

  // FAL 轮询
  const falPollRef = useRef<{ responseUrl?: string; endpoint?: string; requestId?: string } | null>(null);

  const startFalPolling = () => {
    stopPoll();
    let elapsed = 0;
    const POLL_INT = 6000;
    const MAX = 600; // 60分钟
    pollTimer.current = window.setInterval(async () => {
      elapsed += 1;
      if (elapsed > MAX) {
        stopPoll();
        update({ status: 'error', error: 'FAL 轮询超时' });
        setError('FAL 轮询超时');
        logBus.error('FAL 轮询超时', src);
        return;
      }
      try {
        const r = await queryVideoFal(falPollRef.current!);
        if (elapsed % 10 === 0) logBus.debug(`[FAL ${elapsed}/${MAX}] status=${r.status}`, src);
        if (r.status === 'completed' && r.videoUrl) {
          stopPoll();
          update({ status: 'success', videoUrl: r.videoUrl, progress: '100%' });
          logBus.success(`FAL 视频完成 → ${r.videoUrl}`, src);
        } else if (r.status === 'failed') {
          stopPoll();
          const msg = r.error || 'FAL 生成失败';
          update({ status: 'error', error: msg });
          setError(msg);
          logBus.error(`FAL 生成失败: ${msg}`, src);
        } else {
          update({ status: 'polling', progress: `${Math.min(95, Math.round(20 + elapsed / MAX * 75))}%` });
        }
      } catch (e: any) {
        console.warn('FAL 轮询出错', e?.message);
      }
    }, POLL_INT);
  };

  const handleGenerate = async () => {
    setError(null);
    const { prompt: upstreamPrompt, imageUrls } = collectUpstream();
    const finalPrompt = (upstreamPrompt || localPrompt || '').trim();
    if (!finalPrompt) {
      setError('未连接 text 节点也未填写 prompt');
      logBus.error('生成中止: 缺少 prompt', src);
      return;
    }
    update({ status: 'submitting', error: null, videoUrl: null, taskId: null });
    try {
      // === FAL 分支 ===
      if (isFal && falReg) {
        const refs = imageUrls.slice(0, falReg.maxRefImages);
        let images: string[] | undefined;
        if (refs.length > 0) {
          // FAL 参考图直传 URL 或 base64，后端会处理上传
          images = refs;
        }

        const falReq: VideoFalSubmitRequest = { apiModel, prompt: finalPrompt };
        if (images && images.length) falReq.images = images;

        if (falReg.paramKind === 'veo-fal') {
          falReq.aspect_ratio = vfRatio;
          falReq.duration = vfDuration;
          falReq.resolution = vfResolution;
          falReq.generate_audio = vfAudio;
          falReq.safety_tolerance = vfSafety;
        } else if (falReg.paramKind === 'grok-fal') {
          falReq.gkRatio = gkfRatio;
          falReq.gkDuration = gkfDuration;
          falReq.resolution = gkfResolution;
        }

        logBus.info(
          `提交 FAL 视频: ${apiModel} ` +
          (falReg.paramKind === 'veo-fal'
            ? `ratio=${vfRatio} dur=${vfDuration} res=${vfResolution} audio=${vfAudio}`
            : `ratio=${gkfRatio} dur=${gkfDuration}s res=${gkfResolution}`) +
          ` refs=${images?.length || 0} prompt="${finalPrompt.slice(0, 30)}…"`,
          src,
        );

        const r = await submitVideoFal(falReq);
        if (r.sync && r.videoUrl) {
          update({ status: 'success', videoUrl: r.videoUrl, lastPrompt: finalPrompt, progress: '100%' });
          logBus.success(`FAL 同步完成 → ${r.videoUrl}`, src);
        } else {
          falPollRef.current = { responseUrl: r.responseUrl, endpoint: r.endpoint, requestId: r.requestId };
          update({ status: 'polling', lastPrompt: finalPrompt, progress: '15%' });
          logBus.info(`FAL 异步任务 requestId=${r.requestId} 进入轮询…`, src);
          startFalPolling();
        }
        return;
      }

      // === 原有贞贞工坊分支 ===
      // 参考图预处理:
      //   - Grok: 直接传 URL (本地 /files/* 也可,后端会转上游 URL)
      //   - Veo / Seedance: 转 base64
      const refs = imageUrls.slice(0, maxRefImages);
      let images: string[] | undefined;
      if (supportImages && refs.length > 0) {
        if (modelDef.kind === 'grok') {
          images = refs;
        } else {
          const arr: string[] = [];
          for (const u of refs) {
            try { arr.push(await urlToBase64(u)); }
            catch (e) { console.warn('图像编码失败', e); }
          }
          if (arr.length) images = arr;
        }
      }

      // 按 kind 走不同字段(完全对齐 gpt-image-2-web payload)
      const payload: VideoSubmitRequest = { model: apiModel, prompt: finalPrompt };
      if (modelDef.kind === 'grok') {
        payload.ratio = ratio;
        payload.duration = Number(duration) || modelDef.defaultDuration || 15;
        payload.resolution = resolution || modelDef.defaultResolution || '720P';
        if (seed > 0) payload.seed = seed;
      } else {
        // veo / seedance
        payload.aspect_ratio = ratio;
        payload.enhance_prompt = enhancePrompt;
        if (enableUpsample) payload.enable_upsample = true;
        if (seed > 0) payload.seed = seed;
      }
      if (images && images.length) payload.images = images;

      logBus.info(
        `提交任务: kind=${modelDef.kind} model=${apiModel} ratio=${ratio}` +
        (modelDef.kind === 'grok' ? ` duration=${payload.duration}s resolution=${payload.resolution}` : ` enhance=${payload.enhance_prompt}`) +
        ` refs=${images?.length || 0} prompt="${finalPrompt.slice(0, 30)}…"`,
        src,
      );

      const r = await submitVideo(payload);
      update({ status: 'polling', taskId: r.taskId, lastPrompt: finalPrompt, progress: '0%' });
      logBus.info(`异步任务已提交 taskId=${r.taskId} 进入轮询…`, src);
      startPolling(r.taskId);
    } catch (e: any) {
      const msg = e?.message || '提交失败';
      setError(msg);
      update({ status: 'error', error: msg });
      logBus.error(`提交失败: ${msg}`, src);
    }
  };

  const handleStop = () => {
    stopPoll();
    update({ status: 'idle' });
    logBus.warn('用户主动停止', src);
  };

  // 批量运行接入
  useRunTrigger(id, async () => {
    if (status === 'submitting' || status === 'polling') return;
    await handleGenerate();
  });

  // === 跨节点拖拽: source (输出视频可拖出) ===
  const startDrag = useDragMaterialStore((s) => s.start);
  const beginMaterialDrag = (e: React.MouseEvent, payload: MaterialPayload) => {
    if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);
    startDrag(payload, e.clientX, e.clientY);
  };

  // === 跨节点拖拽: target (接收 image → localRefImages, text → prompt) ===
  const handleDrop = (payload: MaterialPayload) => {
    if (payload.kind === 'image' && payload.url) {
      const cur = Array.isArray(d?.localRefImages) ? d.localRefImages : [];
      if (cur.indexOf(payload.url) !== -1) return;
      const cap = (maxRefImages || 7) + 4; // 给本地一些余量
      if (cur.length >= cap) return;
      update({ localRefImages: [...cur, payload.url] });
    } else if (payload.kind === 'text' && typeof payload.text === 'string') {
      update({ prompt: payload.text });
    }
  };
  const { dropProps, isAccepting } = useMaterialDropTarget({
    id,
    accepts: ['image', 'text'],
    onDrop: handleDrop,
  });

  const isBusy = status === 'submitting' || status === 'polling';
  const refsCount = orderedImages.length + localRefImages.length;
  const hasVideoResult = !!videoUrl;
  const layerOnly = hasVideoResult && !selected;
  const handleVisibilityClass = selected ? '!opacity-100' : '!opacity-0 !pointer-events-none';
  const mediaInfo = isFal
    ? (falReg?.paramKind === 'veo-fal' ? `${vfRatio} · ${vfResolution}` : `${gkfRatio} · ${gkfResolution}`)
    : `${ratio} · ${resolution || modelDef.defaultResolution || 'auto'}`;
  const mediaActionClass = `flex h-7 w-7 items-center justify-center rounded-full border shadow-lg backdrop-blur transition ${
    isDark
      ? 'border-white/10 bg-zinc-950/88 text-white/80 hover:bg-zinc-900 hover:text-white'
      : 'border-black/10 bg-white/92 text-zinc-700 hover:bg-white hover:text-zinc-950'
  }`;

  if (layerOnly) {
    return (
      <div
        {...dropProps}
        onClickCapture={() => setMenuOpen(true)}
        className="group relative mt-8 w-[300px] bg-transparent"
        style={{ aspectRatio: ratio?.includes(':') ? ratio.replace(':', '/') : '16 / 9' }}
      >
        <div className="pointer-events-none absolute -top-8 left-0 right-0 z-20 flex items-center justify-between opacity-0 transition-opacity group-hover:opacity-100">
          <div className={`rounded-full border px-2 py-1 text-[10px] shadow-lg backdrop-blur ${
            isDark ? 'border-white/10 bg-zinc-950/88 text-white/65' : 'border-black/10 bg-white/92 text-zinc-600'
          }`}>
            {mediaInfo}
          </div>
          <div className="pointer-events-auto flex items-center gap-1">
            <button type="button" className={mediaActionClass} title="缩小" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPreviewZoom(previewZoom - 0.1); }}><ZoomOut size={13} /></button>
            <button type="button" className={mediaActionClass} title="重置缩放" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPreviewZoom(1); }}><RotateCcw size={13} /></button>
            <button type="button" className={mediaActionClass} title="放大" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPreviewZoom(previewZoom + 0.1); }}><ZoomIn size={13} /></button>
            <button type="button" className={mediaActionClass} title="下载" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); void downloadAsset(videoUrl!, 'video.mp4'); }}><Download size={13} /></button>
          </div>
        </div>
        <Handle type="target" position={Position.Left} className="!bg-rose-400 !border-0 !opacity-0 !pointer-events-none" />
        <Handle type="source" position={Position.Right} className="!bg-rose-400 !border-0 !opacity-0 !pointer-events-none" />
        <video
          src={videoUrl!}
          className="block h-full w-full select-none object-contain"
          style={{ transform: `scale(${previewZoom})`, background: 'transparent' }}
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          data-drag-source
          data-drag-kind="video"
          data-drag-url={videoUrl}
          data-drag-preview={videoUrl}
          data-drag-node-id={id}
          onMouseDown={(e) => beginMaterialDrag(e, { kind: 'video', url: videoUrl!, sourceNodeId: id, previewUrl: videoUrl! })}
        />
      </div>
    );
  }

  return (
    <div
      {...dropProps}
      onClickCapture={() => setMenuOpen(true)}
      className="group relative mt-8 w-[300px] rounded-none bg-transparent transition-all"
      style={{
        background: 'transparent',
        borderRadius: 0,
        outline: 'none',
        outlineOffset: 0,
        boxShadow: isAccepting ? '0 0 0 3px rgba(34,197,94,0.25)' : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} className={`!bg-rose-400 !border-0 ${handleVisibilityClass}`} />
      <Handle type="source" position={Position.Right} className={`!bg-rose-400 !border-0 ${handleVisibilityClass}`} />

      <div className={`pointer-events-none absolute -top-8 left-0 right-0 z-20 flex items-center justify-between transition-opacity ${
        selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      }`}>
        <div className={`rounded-full border px-2 py-1 text-[10px] shadow-lg backdrop-blur ${
          isDark ? 'border-white/10 bg-zinc-950/88 text-white/65' : 'border-black/10 bg-white/92 text-zinc-600'
        }`}>
          {mediaInfo}
        </div>
        {videoUrl && (
          <div className="pointer-events-auto flex items-center gap-1">
            <button type="button" className={mediaActionClass} title="缩小" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPreviewZoom(previewZoom - 0.1); }}><ZoomOut size={13} /></button>
            <button type="button" className={mediaActionClass} title="重置缩放" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPreviewZoom(1); }}><RotateCcw size={13} /></button>
            <button type="button" className={mediaActionClass} title="放大" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPreviewZoom(previewZoom + 0.1); }}><ZoomIn size={13} /></button>
            <button type="button" className={mediaActionClass} title="下载" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); void downloadAsset(videoUrl, 'video.mp4'); }}><Download size={13} /></button>
          </div>
        )}
      </div>

      <div
        className={`${isDark ? 'bg-zinc-950/70' : 'bg-zinc-100'} block w-full overflow-hidden text-left`}
        style={{ aspectRatio: ratio?.includes(':') ? ratio.replace(':', '/') : '16 / 9' }}
        
        title="双击打开视频参数"
      >
        {videoUrl ? (
          <video
            src={videoUrl}
            controls
            className="h-full w-full select-none object-contain"
            style={{ transform: `scale(${previewZoom})` }}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            data-drag-source
            data-drag-kind="video"
            data-drag-url={videoUrl}
            data-drag-preview={videoUrl}
            data-drag-node-id={id}
            onMouseDown={(e) => beginMaterialDrag(e, { kind: 'video', url: videoUrl, sourceNodeId: id, previewUrl: videoUrl })}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center text-white/36">
            {isBusy ? <Loader2 size={22} className="animate-spin" /> : <VideoIcon size={24} />}
            <span className="mt-2 text-xs">Video</span>
          </div>
        )}
      </div>

      {selected && menuOpen && (
        <div
          className={`imade-media-menu absolute left-0 top-[calc(100%+10px)] z-50 w-[340px] rounded-2xl border shadow-2xl nodrag nowheel ${
            isDark ? 'border-white/10 bg-zinc-950/96 text-white' : 'border-black/10 bg-white/98 text-zinc-900'
          }`}
          data-theme={isDark ? 'dark' : 'light'}
          style={{ backdropFilter: 'blur(18px)' }}
          onMouseDown={(e) => e.stopPropagation()}
        >

      <div className={`flex items-center gap-2 border-b px-3 py-2 ${isDark ? 'border-white/10' : 'border-black/10'}`}>
        <div
          className="hidden"
          style={{ background: 'rgba(244,63,94,.2)', color: '#fda4af', boxShadow: 'inset 0 0 0 1px rgba(244,63,94,.45)' }}
        >
          <VideoIcon size={13} />
        </div>
        <div className="flex-1">
          <div className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-zinc-900'}`}>视频</div>
          <div className={isDark ? 'text-[10px] text-white/40' : 'text-[10px] text-zinc-500'}>{modelDef.label} · {modelDef.kind}</div>
        </div>
        {videoUrl && (
          <button
            type="button"
            className={`rounded-md border px-2 py-1 text-[11px] ${
              isDark ? 'border-white/10 bg-white/5 text-white/75 hover:bg-white/10' : 'border-black/10 bg-black/[0.03] text-zinc-700 hover:bg-black/[0.06]'
            }`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); void downloadAsset(videoUrl, 'video.mp4'); }}
          >下载</button>
        )}
      </div>

      <div className="p-2.5 space-y-2 max-h-[70vh] overflow-y-auto" onMouseDown={(e) => e.stopPropagation()}>
        {/* 主模型 */}
        <div>
          <label className="text-[10px] text-white/50 block mb-1">模型类型</label>
          <select
            value={modelDef.id}
            onChange={(e) => switchMainModel(e.target.value)}
            className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
          >
            {VIDEO_MODELS.filter((m) => m.kind !== 'seedance').map((m) => (
              <option key={m.id} value={m.id} className="bg-zinc-900">{m.label}</option>
            ))}
          </select>
        </div>

        {/* 子模型(主项目 veo_model / gk_model) */}
        {modelDef.apiModelOptions.length > 1 && (
          <div>
            <label className="text-[10px] text-white/50 block mb-1">具体模型</label>
            <select
              value={apiModel}
              onChange={(e) => update({ model: e.target.value })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            >
              {modelDef.apiModelOptions.map((o) => (
                <option key={o.value} value={o.value} className="bg-zinc-900">{o.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* === FAL 专属参数面板 === */}
        {isFal && falReg?.paramKind === 'veo-fal' && (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">比例 (FAL)</label>
                <select value={vfRatio} onChange={(e) => update({ vfRatio: e.target.value })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30">
                  {VEO_FAL_RATIOS.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">时长</label>
                <select value={vfDuration} onChange={(e) => update({ vfDuration: e.target.value })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30">
                  {VEO_FAL_DURATIONS.map((d) => <option key={d} value={d} className="bg-zinc-900">{d}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">分辨率</label>
                <select value={vfResolution} onChange={(e) => update({ vfResolution: e.target.value })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30">
                  {VEO_FAL_RESOLUTIONS.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">安全等级</label>
                <select value={String(vfSafety)} onChange={(e) => update({ vfSafety: Number(e.target.value) })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30">
                  {[1,2,3,4,5,6].map((s) => <option key={s} value={s} className="bg-zinc-900">{s}</option>)}
                </select>
              </div>
            </div>
            <label className="flex items-center gap-1 text-[10px] text-white/60 cursor-pointer">
              <input type="checkbox" checked={vfAudio} onChange={(e) => update({ vfAudio: e.target.checked })} className="accent-rose-400" />
              生成音频
            </label>
          </>
        )}

        {isFal && falReg?.paramKind === 'grok-fal' && (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">比例 (FAL)</label>
                <select value={gkfRatio} onChange={(e) => update({ gkfRatio: e.target.value })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30">
                  {GROK_FAL_RATIOS.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">时长(s)</label>
                <input type="number" value={gkfDuration} min={1} max={30} onChange={(e) => update({ gkfDuration: Number(e.target.value) || 6 })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30" />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-white/50 block mb-1">分辨率</label>
              <select value={gkfResolution} onChange={(e) => update({ gkfResolution: e.target.value })} className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30">
                {GROK_FAL_RESOLUTIONS.map((r) => <option key={r} value={r} className="bg-zinc-900">{r}</option>)}
              </select>
            </div>
          </>
        )}

        {/* 比例(非 FAL 时显示原始控件) */}
        {!isFal && (
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className="text-[10px] text-white/50 block mb-1">比例</label>
            <select
              value={ratio}
              onChange={(e) => update({ ratio: e.target.value })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            >
              {modelDef.ratios.map((r) => (
                <option key={r} value={r} className="bg-zinc-900">{r}</option>
              ))}
            </select>
          </div>
          {/* 时长(grok / seedance) */}
          {modelDef.durations && modelDef.durations.length > 0 && (
            <div>
              <label className="text-[10px] text-white/50 block mb-1">时长(s)</label>
              <select
                value={String(duration)}
                onChange={(e) => update({ duration: Number(e.target.value) })}
                className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
              >
                {modelDef.durations.map((s) => (
                  <option key={s} value={s} className="bg-zinc-900">{s}s</option>
                ))}
              </select>
            </div>
          )}
        </div>
        )}

        {/* 分辨率(仅 grok 非FAL) */}
        {!isFal && modelDef.resolutions && modelDef.resolutions.length > 0 && (
          <div>
            <label className="text-[10px] text-white/50 block mb-1">分辨率</label>
            <select
              value={resolution || modelDef.defaultResolution}
              onChange={(e) => update({ resolution: e.target.value })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            >
              {modelDef.resolutions.map((r) => (
                <option key={r} value={r} className="bg-zinc-900">{r}</option>
              ))}
            </select>
          </div>
        )}

        {/* veo 专用选项(非FAL) */}
        {!isFal && modelDef.kind === 'veo' && (
          <div className="grid grid-cols-2 gap-1.5">
            <label className="flex items-center gap-1 text-[10px] text-white/60 cursor-pointer">
              <input
                type="checkbox"
                checked={enhancePrompt}
                onChange={(e) => update({ enhancePrompt: e.target.checked })}
                className="accent-rose-400"
              />
              Enhance Prompt
            </label>
            <label className="flex items-center gap-1 text-[10px] text-white/60 cursor-pointer">
              <input
                type="checkbox"
                checked={enableUpsample}
                onChange={(e) => update({ enableUpsample: e.target.checked })}
                className="accent-rose-400"
              />
              Upsample
            </label>
          </div>
        )}

        {/* Seed(非FAL) */}
        {!isFal && (
        <div>
          <label className="text-[10px] text-white/50 block mb-1">Seed (0=随机)</label>
          <input
            type="number"
            value={seed}
            min={0}
            max={2147483647}
            onChange={(e) => update({ seed: Number(e.target.value) || 0 })}
            className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
          />
        </div>
        )}

        {/* 上游素材聚合预览区 (代替原「参考图(上游)」计数提示) */}
        {supportImages && (
          <MaterialPreviewSection
            texts={orderedTexts}
            images={orderedImages}
            videos={orderedVideos}
            audios={orderedAudios}
            order={materialOrder}
            onReorder={setMaterialOrder}
            selected={!!selected}
            isDark={isDark}
            isPixel={isPixel}
            groups={previewGroups}
            title={`上游素材 · 参考图 ${Math.min(refsCount, maxRefImages)}/${maxRefImages}`}
          />
        )}

        {/* 本地拖入参考图 (Ctrl+拖拽自其他节点) */}
        {supportImages && localRefImages.length > 0 && (
          <div className="rounded border border-emerald-400/30 bg-emerald-500/5 p-1.5">
            <div className="text-[10px] text-emerald-200/80 mb-1">本地拖入参考图 · {localRefImages.length}</div>
            <div className="flex gap-1 flex-wrap">
              {localRefImages.map((u, i) => (
                <div key={i} className="relative w-10 h-10">
                  <img
                    src={u}
                    alt=""
                    draggable={false}
                    onDragStart={(e) => e.preventDefault()}
                    data-drag-source
                    data-drag-kind="image"
                    data-drag-url={u}
                    data-drag-preview={u}
                    data-drag-node-id={id}
                    onMouseDown={(e) => beginMaterialDrag(e, { kind: 'image', url: u, sourceNodeId: id, previewUrl: u })}
                    className="w-10 h-10 object-cover rounded border border-white/10 cursor-grab"
                  />
                  <button
                    onClick={() => update({ localRefImages: localRefImages.filter((x) => x !== u) })}
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center"
                  >
                    <X size={9} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Prompt */}
        <div>
          <label className="text-[10px] text-white/50 block mb-1">本地 Prompt(可选)</label>
          <textarea
            value={localPrompt}
            onChange={(e) => update({ prompt: e.target.value })}
            placeholder="备用:无上游连接时使用"
            className="w-full h-12 resize-none rounded bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-white outline-none focus:border-white/30 placeholder:text-white/30"
          />
        </div>

        {!isBusy ? (
          <button
            onClick={handleGenerate}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-xs font-medium transition-colors"
          >
            <Sparkles size={12} /> 生成
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-zinc-500/20 hover:bg-zinc-500/30 text-zinc-200 text-xs font-medium transition-colors"
          >
            <Square size={11} /> 停止(生成中)
          </button>
        )}

        {isBusy && (
          <div className="flex items-center gap-1 text-[10px] text-rose-200/80">
            <Loader2 size={11} className="animate-spin" />
            生成中
            {taskId && <span className="ml-auto text-white/30">{taskId.slice(0, 10)}…</span>}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-1 text-[10px] text-red-300 bg-red-500/10 border border-red-500/20 rounded px-2 py-1">
            <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}
      </div>

        </div>
      )}

      {false && videoUrl && !hasAutoOutput && (
        <div className="border-t border-white/10 p-2">
          <video
            src={videoUrl}
            controls
            className="w-full rounded"
            style={{ aspectRatio: ratio.replace(':', '/') }}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            data-drag-source
            data-drag-kind="video"
            data-drag-url={videoUrl}
            data-drag-preview={videoUrl}
            data-drag-node-id={id}
            onMouseDown={(e) => beginMaterialDrag(e, { kind: 'video', url: videoUrl, sourceNodeId: id, previewUrl: videoUrl })}
            title="按住 Ctrl 拖拽到其他节点"
          />
        </div>
      )}
    </div>
  );
};

export default memo(VideoNode);
