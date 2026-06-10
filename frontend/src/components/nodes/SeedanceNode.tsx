import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position, useViewport, type NodeProps } from '@xyflow/react';
import { AlertCircle, Download, Loader2, Film, RotateCcw, Sparkles, Square, X, ZoomIn, ZoomOut } from 'lucide-react';
import {
  submitSeedance,
  querySeedance,
  type SeedanceSubmitRequest,
} from '../../services/generation';
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
 * SeedanceNode 鈥?瀛楄妭 Seedance 2.0 瑙嗛鍒嗛暅鑺傜偣
 * 瀹屽叏瀵归綈 gpt-image-2-web runSeedance / pollSeedance:
 *   - 涓婃父 endpoint: /seedance/v3/contents/generations/tasks
 *   - 妯″瀷: doubao-seedance-2-0-260128 / doubao-seedance-2-0-fast-260128
 *   - content[]: text + image_url(role=first_frame|last_frame|reference_image)
 *                + video_url(role=reference_video) + audio_url(role=reference_audio)
 *   - 鍙傛暟: duration / ratio / resolution / generate_audio / return_last_frame
 *           / watermark / web_search(tools) / seed
 *   - 杞: 榛樿 10s 闂撮殧, 鏈€澶?360 娆? *
 * 涓婃父杩炴帴(鏀寔鐨勮緭鍏?:
 *   - text 鑺傜偣 鈫?prompt
 *   - image 鑺傜偣 / upload 鑺傜偣 鈫?reference_image
 *   - 澶氬紶鍚屾椂鍙敤浣?first_frame / last_frame (UI 涓寜椤哄簭鍙栫 1銆? 寮?
 */

const MODEL_OPTIONS = [
  { value: 'doubao-seedance-2-0-fast-260128', label: 'seedance-2-0-fast' },
  { value: 'doubao-seedance-2-0-260128', label: 'seedance-2-0' },
];
const RATIO_OPTIONS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21', 'adaptive'];
const RESOLUTION_OPTIONS = ['480p', '720p', 'native1080p', '1080p', '2k', '4k'];
const DURATION_OPTIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const parseRatio = (value: string | undefined, fallback = '16:9') => {
  const raw = String(value || fallback);
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(raw);
  if (!match) return { w: 16, h: 9 };
  const w = Number(match[1]);
  const h = Number(match[2]);
  return w > 0 && h > 0 ? { w, h } : { w: 16, h: 9 };
};
const seedanceSizeFromConfig = (ratio: string | undefined, resolution: string | undefined) => {
  const { w: rw, h: rh } = parseRatio(ratio);
  const res = String(resolution || '').toLowerCase();
  const longSide = res.includes('4k') ? 3840 : res.includes('2k') ? 2048 : res.includes('1080') ? 1920 : res.includes('480') ? 854 : 1280;
  if (rw >= rh) return { w: longSide, h: Math.round((longSide * rh) / rw) };
  return { w: Math.round((longSide * rw) / rh), h: longSide };
};

const SeedanceNode = ({ id, data, selected }: NodeProps) => {
  const update = useUpdateNodeData(id);
  const hasAutoOutput = useHasAutoOutput(id);
  const { zoom: viewportZoom } = useViewport();
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const pollTimer = useRef<number | null>(null);
  const src = `seedance:${id.slice(0, 6)}`;

  // 涓婚閫傞厤
  const { theme, style: themeStyle } = useThemeStore();
  const isDark = theme === 'dark';
  const isPixel = themeStyle === 'pixel';

  const d = (data as any) || {};
  const previewZoom = typeof d?.previewZoom === 'number' ? d.previewZoom : 1;
  const setPreviewZoom = (next: number) => {
    update({ previewZoom: Math.min(3, Math.max(0.5, Number(next.toFixed(2)))) });
  };
  const model: string = d.model || MODEL_OPTIONS[0].value;
  const duration: number = typeof d.duration === 'number' ? d.duration : 5;
  const ratio: string = d.ratio || '16:9';
  const resolution: string = d.resolution || '720p';
  const generateAudio: boolean = d.generateAudio !== false; // 榛樿 true
  const returnLastFrame: boolean = d.returnLastFrame === true;
  const watermark: boolean = d.watermark === true;
  const webSearch: boolean = d.webSearch === true;
  const seed: number = typeof d.seed === 'number' ? d.seed : -1;
  const maxPoll: number = typeof d.maxPoll === 'number' ? d.maxPoll : 360;
  const pollInt: number = typeof d.pollInt === 'number' ? d.pollInt : 10;
  // 棣?鏈抚浣跨敤妯″紡: 'auto' | 'first' | 'firstlast'
  const frameMode: 'auto' | 'first' | 'firstlast' = d.frameMode || 'auto';

  const status: 'idle' | 'submitting' | 'polling' | 'success' | 'error' = d.status || 'idle';
  const taskId: string | undefined = d.taskId;
  const videoUrl: string | undefined = d.videoUrl;
  const videoWidth = Number(d.videoWidth || d.width || 0);
  const videoHeight = Number(d.videoHeight || d.height || 0);
  const progress: string = d.progress || '';
  const localPrompt: string = d.prompt || '';

  // === 涓婃父绱犳潗鑱氬悎 (璺ㄨ妭鐐圭粺涓€鏈哄埗) ===
  const upstream = useUpstreamMaterials(id);
  const materialOrder: string[] = Array.isArray(d?.materialOrder) ? d.materialOrder : [];
  const orderedTexts = useOrderedMaterials(upstream.texts, materialOrder);
  const orderedImages = useOrderedMaterials(upstream.images, materialOrder);
  const orderedVideos = useOrderedMaterials(upstream.videos, materialOrder);
  const orderedAudios = useOrderedMaterials(upstream.audios, materialOrder);
  const setMaterialOrder = (newOrder: string[]) => update({ materialOrder: newOrder });

  // === 鏈湴鎷栧叆鍙傝€冪礌鏉?(璺ㄨ妭鐐?Ctrl 鎷栨嫿) ===
  const localRefImages: string[] = Array.isArray(d?.localRefImages) ? d.localRefImages : [];
  const localRefVideos: string[] = Array.isArray(d?.localRefVideos) ? d.localRefVideos : [];
  const localRefAudios: string[] = Array.isArray(d?.localRefAudios) ? d.localRefAudios : [];

  // Collect upstream prompt and reference media.
  const collectUpstream = (): {
    prompt: string;
    imageUrls: string[];
    videoUrls: string[];
    audioUrls: string[];
  } => {
    const prompts = orderedTexts.map((t) => t.url).filter((s) => !!s);
    const upImg = orderedImages.map((m) => m.url).filter((s) => !!s);
    const upVid = orderedVideos.map((m) => m.url).filter((s) => !!s);
    const upAud = orderedAudios.map((m) => m.url).filter((s) => !!s);
    const dedupe = (arr: string[]) => {
      const out: string[] = [];
      for (const v of arr) if (v && out.indexOf(v) === -1) out.push(v);
      return out;
    };
    return {
      prompt: prompts.join('\n').trim(),
      imageUrls: dedupe([...upImg, ...localRefImages]),
      videoUrls: dedupe([...upVid, ...localRefVideos]),
      audioUrls: dedupe([...upAud, ...localRefAudios]),
    };
  };

  const stopPoll = () => {
    if (pollTimer.current) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  useEffect(() => () => stopPoll(), []);

  const startPolling = (tid: string) => {
    stopPoll();
    let elapsed = 0;
    const POLL_MS = Math.max(2, pollInt) * 1000;
    const MAX = Math.max(10, maxPoll);
    let lastProgress = '';
    pollTimer.current = window.setInterval(async () => {
      elapsed += 1;
      if (elapsed > MAX) {
        stopPoll();
        update({ status: 'error', error: '杞瓒呮椂' });
        setError('杞瓒呮椂');
        logBus.error(`Seedance 杞瓒呮椂(${MAX}娆?`, src);
        return;
      }
      try {
        const r = await querySeedance(tid);
        // 杩涘害鏉′及绠?(瀵归綈涓婚」鐩? 30 + a*65/max)
        const pct = Math.min(95, Math.round(30 + (elapsed * 65) / MAX));
        if (r.progress && r.progress !== lastProgress) {
          lastProgress = r.progress;
          logBus.debug(`[${elapsed}/${MAX}] status=${r.status} progress=${r.progress}`, src);
        } else if (elapsed % 3 === 0) {
          logBus.debug(`[${elapsed}/${MAX}] status=${r.status}`, src);
        }
        if (r.status === 'succeeded' && r.videoUrl) {
          stopPoll();
          update({ status: 'success', videoUrl: r.videoUrl, progress: '100%' });
          logBus.success(`浠诲姟瀹屾垚 鈫?${r.videoUrl}`, src);
        } else if (r.status === 'failed') {
          stopPoll();
          const msg = r.failReason || '鐢熸垚澶辫触';
          update({ status: 'error', error: msg });
          setError(msg);
          logBus.error(`鐢熸垚澶辫触: ${msg}`, src);
        } else {
          update({ status: 'polling', progress: `${pct}%` });
        }
      } catch (e: any) {
        // 鍋跺彂澶辫触涓嶅仠姝?        console.warn('Seedance 杞鍑洪敊', e?.message);
      }
    }, POLL_MS);
  };

  const handleGenerate = async () => {
    setError(null);
    const { prompt: upstreamPrompt, imageUrls, videoUrls, audioUrls } = collectUpstream();
    const finalPrompt = (upstreamPrompt || localPrompt || '').trim();
    if (!finalPrompt) {
      setError('鏈繛鎺?text 鑺傜偣涔熸湭濉啓 prompt');
      logBus.error('鐢熸垚涓: 缂哄皯 prompt', src);
      return;
    }
    update({ status: 'submitting', error: null, videoUrl: null, taskId: null });

    try {
      // 鎷嗗垎鍙傝€冨浘(瀵归綈涓婚」鐩?sd_firstFrame / sd_lastFrame / sd_refImgs):
      //  - frameMode='auto'(榛樿): 鍏ㄩ儴璧?reference_image
      //  - frameMode='first':   绗?1 寮犱綔涓?firstFrame, 鍏朵綑浣滀负 reference_image
      //  - frameMode='firstlast': 绗?1 寮?first, 绗?2 寮?last, 鍏朵綑浣滀负 reference_image
      let firstFrame: string | undefined;
      let lastFrame: string | undefined;
      let refImages: string[] = [];
      if (frameMode === 'first' && imageUrls.length >= 1) {
        firstFrame = imageUrls[0];
        refImages = imageUrls.slice(1);
      } else if (frameMode === 'firstlast' && imageUrls.length >= 1) {
        firstFrame = imageUrls[0];
        if (imageUrls.length >= 2) lastFrame = imageUrls[1];
        refImages = imageUrls.slice(2);
      } else {
        refImages = imageUrls;
      }

      const payload: SeedanceSubmitRequest = {
        model,
        prompt: finalPrompt,
        duration,
        ratio,
        resolution,
        generate_audio: generateAudio,
        return_last_frame: returnLastFrame,
        watermark,
        web_search: webSearch,
      };
      if (seed !== -1) payload.seed = seed;
      if (firstFrame) payload.firstFrame = firstFrame;
      if (lastFrame) payload.lastFrame = lastFrame;
      if (refImages.length) payload.refImages = refImages;
      if (videoUrls.length) payload.videos = videoUrls;
      if (audioUrls.length) payload.audios = audioUrls;

      logBus.info(
        `鎻愪氦 Seedance2.0: model=${model} ${duration}s ${ratio} ${resolution} ` +
          `audio=${generateAudio} retLast=${returnLastFrame} ` +
          `frame=${frameMode} refs=${refImages.length}` +
          (firstFrame ? ' +first' : '') +
          (lastFrame ? ' +last' : '') +
          (videoUrls.length ? ` +${videoUrls.length}video` : '') +
          (audioUrls.length ? ` +${audioUrls.length}audio` : '') +
          ` prompt="${finalPrompt.slice(0, 30)}鈥?`,
        src,
      );

      const r = await submitSeedance(payload);
      update({ status: 'polling', taskId: r.taskId, lastPrompt: finalPrompt, progress: '15%' });
      logBus.info(`Seedance task submitted, taskId=${r.taskId}`, src);
      startPolling(r.taskId);
    } catch (e: any) {
      const msg = e?.message || '鎻愪氦澶辫触';
      setError(msg);
      update({ status: 'error', error: msg });
      logBus.error(`鎻愪氦澶辫触: ${msg}`, src);
    }
  };

  const handleStop = () => {
    stopPoll();
    update({ status: 'idle' });
    logBus.warn('鐢ㄦ埛涓诲姩鍋滄', src);
  };

  // 鎵归噺杩愯鎺ュ叆
  useRunTrigger(id, async () => {
    if (status === 'submitting' || status === 'polling') return;
    await handleGenerate();
  });

  // === 璺ㄨ妭鐐规嫋鎷? source (杈撳嚭瑙嗛鍙嫋鍑? ===
  const startDrag = useDragMaterialStore((s) => s.start);
  const beginMaterialDrag = (e: React.MouseEvent, payload: MaterialPayload) => {
    if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);
    startDrag(payload, e.clientX, e.clientY);
  };

  // === 璺ㄨ妭鐐规嫋鎷? target (鎺ユ敹 image/video/audio/text) ===
  const handleDrop = (payload: MaterialPayload) => {
    if (payload.kind === 'image' && payload.url) {
      const cur = Array.isArray(d?.localRefImages) ? d.localRefImages : [];
      if (cur.indexOf(payload.url) !== -1) return;
      update({ localRefImages: [...cur, payload.url] });
    } else if (payload.kind === 'video' && payload.url) {
      const cur = Array.isArray(d?.localRefVideos) ? d.localRefVideos : [];
      if (cur.indexOf(payload.url) !== -1) return;
      update({ localRefVideos: [...cur, payload.url] });
    } else if (payload.kind === 'audio' && payload.url) {
      const cur = Array.isArray(d?.localRefAudios) ? d.localRefAudios : [];
      if (cur.indexOf(payload.url) !== -1) return;
      update({ localRefAudios: [...cur, payload.url] });
    } else if (payload.kind === 'text' && typeof payload.text === 'string') {
      update({ prompt: payload.text });
    }
  };
  const { dropProps, isAccepting } = useMaterialDropTarget({
    id,
    accepts: ['image', 'video', 'audio', 'text'],
    onDrop: handleDrop,
  });

  const isBusy = status === 'submitting' || status === 'polling';
  const refsCount = orderedImages.length + localRefImages.length;
  const hasVideoResult = !!videoUrl;
  const layerOnly = hasVideoResult && !selected;
  const handleVisibilityClass = selected ? '!opacity-100' : '!opacity-0 !pointer-events-none';
  const mediaInfo = `${ratio} · ${resolution}`;
  const configVideoSize = seedanceSizeFromConfig(ratio, resolution);
  const videoFrameStyle = videoWidth > 0 && videoHeight > 0
    ? { width: videoWidth, height: videoHeight }
    : { width: configVideoSize.w, height: configVideoSize.h };
  const stableOverlayZoom = Math.max(viewportZoom || 1, 0.01);
  const stableOverlayScale = Math.min(24, Math.max(1, 1 / stableOverlayZoom));
  const syncVideoSize = (video: HTMLVideoElement) => {
    const w = video.videoWidth || 0;
    const h = video.videoHeight || 0;
    if (w > 0 && h > 0 && (w !== videoWidth || h !== videoHeight)) {
      update({ videoWidth: w, videoHeight: h, width: w, height: h });
    }
  };
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
        className="group relative mt-8 overflow-visible rounded-none bg-transparent"
        style={videoFrameStyle}
      >
        <Handle type="target" position={Position.Left} className="!bg-fuchsia-400 !border-0 !opacity-0 !pointer-events-none" />
        <Handle type="source" position={Position.Right} className="!bg-fuchsia-400 !border-0 !opacity-0 !pointer-events-none" />
        <div
          className="pointer-events-none absolute left-0 right-0 z-20 flex items-center justify-between gap-2 opacity-0 transition-opacity group-hover:opacity-100"
          style={{
            top: `${-36 / stableOverlayZoom}px`,
            transform: `scale(${stableOverlayScale})`,
            transformOrigin: 'top left',
          }}
        >
          <span
            className={`max-w-[220px] truncate rounded-full border px-2.5 py-1 text-[13px] leading-[18px] shadow-sm backdrop-blur ${
              isDark ? 'border-white/10 bg-zinc-950/88 text-white/70' : 'border-black/10 bg-white/92 text-zinc-600'
            }`}
          >
            {mediaInfo}
          </span>
          <div className="pointer-events-auto flex items-center gap-1">
            <button type="button" className={mediaActionClass} title="缂╁皬" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPreviewZoom(previewZoom - 0.1); }}>
              <ZoomOut size={14} />
            </button>
            <button type="button" className={mediaActionClass} title="閲嶇疆缂╂斁" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPreviewZoom(1); }}>
              <RotateCcw size={14} />
            </button>
            <button type="button" className={mediaActionClass} title="鏀惧ぇ" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPreviewZoom(previewZoom + 0.1); }}>
              <ZoomIn size={14} />
            </button>
            <button type="button" className={mediaActionClass} title="涓嬭浇" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); void downloadAsset(videoUrl!, 'video.mp4'); }}>
              <Download size={14} />
            </button>
          </div>
        </div>
        <video
          src={videoUrl!}
          className="block h-full w-full select-none object-contain"
          style={{ transform: `scale(${previewZoom})`, background: 'transparent' }}
          draggable={false}
          data-drag-source
          data-drag-kind="video"
          data-drag-url={videoUrl}
          data-drag-preview={videoUrl}
          data-drag-node-id={id}
          onDragStart={(e) => e.preventDefault()}
          onLoadedMetadata={(e) => syncVideoSize(e.currentTarget)}
          onMouseDown={(e) => beginMaterialDrag(e, { kind: 'video', url: videoUrl!, sourceNodeId: id, previewUrl: videoUrl! })}
        />
      </div>
    );
  }

  return (
    <div
      {...dropProps}
      onClickCapture={() => setMenuOpen(true)}
      className="group relative mt-8 overflow-visible rounded-none bg-transparent transition-all"
      style={{
        ...videoFrameStyle,
        background: 'transparent',
        borderRadius: 0,
        outline: 'none',
        outlineOffset: 0,
        boxShadow: isAccepting ? '0 0 0 3px rgba(34,197,94,0.25)' : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} className={`!bg-fuchsia-400 !border-0 ${handleVisibilityClass}`} />
      <Handle type="source" position={Position.Right} className={`!bg-fuchsia-400 !border-0 ${handleVisibilityClass}`} />

      {videoUrl && (
        <div className={`pointer-events-none absolute left-0 right-0 z-20 flex items-center justify-between gap-2 transition-opacity ${
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
          style={{
            top: `${-36 / stableOverlayZoom}px`,
            transform: `scale(${stableOverlayScale})`,
            transformOrigin: 'top left',
          }}
        >
          <span
            className={`max-w-[220px] truncate rounded-full border px-2.5 py-1 text-[13px] leading-[18px] shadow-sm backdrop-blur ${
              isDark ? 'border-white/10 bg-zinc-950/88 text-white/70' : 'border-black/10 bg-white/92 text-zinc-600'
            }`}
          >
            {mediaInfo}
          </span>
          <div className="pointer-events-auto flex items-center gap-1">
            <button type="button" className={mediaActionClass} title="缂╁皬" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPreviewZoom(previewZoom - 0.1); }}>
              <ZoomOut size={14} />
            </button>
            <button type="button" className={mediaActionClass} title="閲嶇疆缂╂斁" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPreviewZoom(1); }}>
              <RotateCcw size={14} />
            </button>
            <button type="button" className={mediaActionClass} title="鏀惧ぇ" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPreviewZoom(previewZoom + 0.1); }}>
              <ZoomIn size={14} />
            </button>
            <button type="button" className={mediaActionClass} title="涓嬭浇" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); void downloadAsset(videoUrl, 'video.mp4'); }}>
              <Download size={14} />
            </button>
          </div>
        </div>
      )}

      <div
        className={`block w-full overflow-hidden text-left ${isDark ? 'bg-zinc-950/70' : 'bg-zinc-100/80'}`}
        style={{ width: '100%', height: '100%' }}
        title="点击打开 SD2.0 设置"
      >
        {videoUrl ? (
          <video
            src={videoUrl}
            controls
            className="h-full w-full object-contain"
            style={{ transform: `scale(${previewZoom})` }}
            draggable={false}
            data-drag-source
            data-drag-kind="video"
            data-drag-url={videoUrl}
            data-drag-preview={videoUrl}
            data-drag-node-id={id}
            onDragStart={(e) => e.preventDefault()}
            onLoadedMetadata={(e) => syncVideoSize(e.currentTarget)}
            onMouseDown={(e) => beginMaterialDrag(e, { kind: 'video', url: videoUrl, sourceNodeId: id, previewUrl: videoUrl })}
          />
        ) : (
          <div className={`flex h-full w-full flex-col items-center justify-center ${isDark ? 'text-white/36' : 'text-zinc-400'}`}>
            <div
              className="flex flex-col items-center justify-center"
              style={{ transform: `scale(${stableOverlayScale})`, transformOrigin: 'center center' }}
            >
              {isBusy ? <Loader2 size={28} className="animate-spin" /> : <Film size={32} />}
              <span className="mt-2 text-[14px] leading-[18px]">SD2.0</span>
            </div>
          </div>
        )}
      </div>

      {false && selected && videoUrl && toolsOpen && (
        <div className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] text-white shadow-xl backdrop-blur nodrag nowheel" onMouseLeave={() => setToolsOpen(false)}>
          <button type="button" className="rounded-full px-2 py-1 hover:bg-white/15" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPreviewZoom(previewZoom - 0.1); }}>缂╁皬</button>
          <button type="button" className="rounded-full px-2 py-1 hover:bg-white/15" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPreviewZoom(1); }}>閲嶇疆</button>
          <button type="button" className="rounded-full px-2 py-1 hover:bg-white/15" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPreviewZoom(previewZoom + 0.1); }}>鏀惧ぇ</button>
          <button type="button" className="rounded-full px-2 py-1 hover:bg-white/15" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); void downloadAsset(videoUrl!, 'video.mp4'); }}>涓嬭浇</button>
        </div>
      )}

      {selected && menuOpen && (
        <div
          className={`imade-media-menu absolute left-0 top-[calc(100%+10px)] z-50 w-[340px] rounded-2xl border shadow-2xl nodrag nowheel ${isDark ? 'border-white/10 bg-zinc-950/96 text-white' : 'border-black/10 bg-white/96 text-zinc-900'}`}
          data-theme={isDark ? 'dark' : 'light'}
          style={{ backdropFilter: 'blur(18px)' }}
          onMouseDown={(e) => e.stopPropagation()}
        >

      <div className={`flex items-center gap-2 border-b px-3 py-2 ${isDark ? 'border-white/10' : 'border-black/10'}`}>
        <div
          className="hidden"
          style={{ background: 'rgba(217,70,239,.2)', color: '#f0abfc', boxShadow: 'inset 0 0 0 1px rgba(217,70,239,.45)' }}
        >
          <Film size={13} />
        </div>
        <div className="flex-1">
          <div className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-zinc-950'}`}>SD2.0</div>
          <div className={`text-[10px] ${isDark ? 'text-white/40' : 'text-zinc-500'}`}>Seedance 2.0 · 节点</div>
        </div>
        {videoUrl && (
          <button
            type="button"
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); void downloadAsset(videoUrl, 'video.mp4'); }}
          >涓嬭浇</button>
        )}
      </div>

      <div className="p-2.5 space-y-2 max-h-[70vh] overflow-y-auto" onMouseDown={(e) => e.stopPropagation()}>
        {/* 妯″瀷 */}
        <div>
          <label className="text-[10px] text-white/50 block mb-1">Model</label>
          <select
            value={model}
            onChange={(e) => update({ model: e.target.value })}
            className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m.value} value={m.value} className="bg-zinc-900">{m.label}</option>
            ))}
          </select>
        </div>

        {/* Duration / Ratio */}
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className="text-[10px] text-white/50 block mb-1">Duration(s)</label>
            <select
              value={String(duration)}
              onChange={(e) => update({ duration: Number(e.target.value) })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            >
              {DURATION_OPTIONS.map((s) => (
                <option key={s} value={s} className="bg-zinc-900">{s}s</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-white/50 block mb-1">Ratio</label>
            <select
              value={ratio}
              onChange={(e) => update({ ratio: e.target.value })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            >
              {RATIO_OPTIONS.map((r) => (
                <option key={r} value={r} className="bg-zinc-900">{r}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Resolution / Seed */}
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className="text-[10px] text-white/50 block mb-1">Resolution</label>
            <select
              value={resolution}
              onChange={(e) => update({ resolution: e.target.value })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            >
              {RESOLUTION_OPTIONS.map((r) => (
                <option key={r} value={r} className="bg-zinc-900">{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-white/50 block mb-1">Seed (-1=闅忔満)</label>
            <input
              type="number"
              value={seed}
              min={-1}
              max={2147483647}
              onChange={(e) => update({ seed: Number(e.target.value) || -1 })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            />
          </div>
        </div>

        {/* 甯т娇鐢ㄦā寮?*/}
        <div>
          <label className="text-[10px] text-white/50 block mb-1">鍙傝€冨浘妯″紡</label>
          <select
            value={frameMode}
            onChange={(e) => update({ frameMode: e.target.value })}
            className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
          >
            <option value="auto" className="bg-zinc-900">鍏ㄩ儴浣滃弬鑰冨浘(auto)</option>
            <option value="first" className="bg-zinc-900">涓婁紶棣栧抚锛堝浘鐢熻棰戯級</option>
            <option value="firstlast" className="bg-zinc-900">首帧 + 尾帧</option>
          </select>
        </div>

        {/* 寮€鍏崇粍 */}
        <div className="grid grid-cols-2 gap-1.5">
          <label className="flex items-center gap-1 text-[10px] text-white/60 cursor-pointer">
            <input
              type="checkbox"
              checked={generateAudio}
              onChange={(e) => update({ generateAudio: e.target.checked })}
              className="accent-fuchsia-400"
            />
            鐢熸垚闊抽
          </label>
          <label className="flex items-center gap-1 text-[10px] text-white/60 cursor-pointer">
            <input
              type="checkbox"
              checked={returnLastFrame}
              onChange={(e) => update({ returnLastFrame: e.target.checked })}
              className="accent-fuchsia-400"
            />
            杩斿洖鏈抚
          </label>
          <label className="flex items-center gap-1 text-[10px] text-white/60 cursor-pointer">
            <input
              type="checkbox"
              checked={webSearch}
              onChange={(e) => update({ webSearch: e.target.checked })}
              className="accent-fuchsia-400"
            />
            Web Search
          </label>
          <label className="flex items-center gap-1 text-[10px] text-white/60 cursor-pointer">
            <input
              type="checkbox"
              checked={watermark}
              onChange={(e) => update({ watermark: e.target.checked })}
              className="accent-fuchsia-400"
            />
            姘村嵃
          </label>
        </div>

        {/* 杞鍙傛暟 */}
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <label className="text-[10px] text-white/50 block mb-1">Max Poll</label>
            <input
              type="number"
              value={maxPoll}
              min={10}
              max={1000}
              onChange={(e) => update({ maxPoll: Math.max(10, Math.min(1000, Number(e.target.value) || 360)) })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            />
          </div>
          <div>
            <label className="text-[10px] text-white/50 block mb-1">Interval(s)</label>
            <input
              type="number"
              value={pollInt}
              min={2}
              max={60}
              onChange={(e) => update({ pollInt: Math.max(2, Math.min(60, Number(e.target.value) || 10)) })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            />
          </div>
        </div>

        {/* 涓婃父绱犳潗鑱氬悎棰勮鍖?(浠ｆ浛鍘熴€屼笂娓稿浘鍍忚鏁般€? Seedance 鏀寔鍥涚被绱犳潗鍏ㄥ紑) */}
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
          groups={['text', 'image', 'video', 'audio']}
          title={`涓婃父绱犳潗 路 鍙傝€冨浘 ${refsCount}`}
        />

        {/* 鏈湴鎷栧叆鍙傝€冪礌鏉?*/}
        {(localRefImages.length + localRefVideos.length + localRefAudios.length) > 0 && (
          <div className="rounded border border-emerald-400/30 bg-emerald-500/5 p-1.5 space-y-1">
            <div className="text-[10px] text-emerald-200/80">
              本地拖入 · 图 {localRefImages.length} · 视 {localRefVideos.length} · 音 {localRefAudios.length}
            </div>
            {localRefImages.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {localRefImages.map((u, i) => (
                  <div key={`i${i}`} className="relative w-10 h-10">
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
            )}
            {localRefVideos.length > 0 && (
              <div className="space-y-1">
                {localRefVideos.map((u, i) => (
                  <div key={`v${i}`} className="flex items-center gap-1">
                    <video
                      src={u}
                      draggable={false}
                      onDragStart={(e) => e.preventDefault()}
                      data-drag-source
                      data-drag-kind="video"
                      data-drag-url={u}
                      data-drag-preview={u}
                      data-drag-node-id={id}
                      onMouseDown={(e) => beginMaterialDrag(e, { kind: 'video', url: u, sourceNodeId: id, previewUrl: u })}
                      className="w-12 h-8 object-cover rounded border border-white/10 cursor-grab"
                    />
                    <span className="flex-1 truncate text-[10px] text-white/50">{u.split('/').pop()}</span>
                    <button
                      onClick={() => update({ localRefVideos: localRefVideos.filter((x) => x !== u) })}
                      className="text-rose-300/60 hover:text-rose-200"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {localRefAudios.length > 0 && (
              <div className="space-y-1">
                {localRefAudios.map((u, i) => (
                  <div key={`a${i}`} className="flex items-center gap-1">
                    <span
                      data-drag-source
                      data-drag-kind="audio"
                      data-drag-url={u}
                      data-drag-node-id={id}
                      onMouseDown={(e) => beginMaterialDrag(e, { kind: 'audio', url: u, sourceNodeId: id, previewUrl: u })}
                      className="text-[14px] cursor-grab"
                      title="鎸変綇 Ctrl 鎷栨嫿"
                    >♪</span>
                    <span className="flex-1 truncate text-[10px] text-white/50">{u.split('/').pop()}</span>
                    <button
                      onClick={() => update({ localRefAudios: localRefAudios.filter((x) => x !== u) })}
                      className="text-rose-300/60 hover:text-rose-200"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Prompt */}
        <div>
          <label className="text-[10px] text-white/50 block mb-1">鏈湴 Prompt(鍙€?</label>
          <textarea
            value={localPrompt}
            onChange={(e) => update({ prompt: e.target.value })}
            placeholder="澶囩敤:鏃犱笂娓歌繛鎺ユ椂浣跨敤"
            className="w-full h-12 resize-none rounded bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-white outline-none focus:border-white/30 placeholder:text-white/30"
          />
        </div>

        {!isBusy ? (
          <button
            onClick={handleGenerate}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-fuchsia-500/20 hover:bg-fuchsia-500/30 text-fuchsia-200 text-xs font-medium transition-colors"
          >
            <Sparkles size={12} /> 鐢熸垚
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-zinc-500/20 hover:bg-zinc-500/30 text-zinc-200 text-xs font-medium transition-colors"
          >
            <Square size={11} /> 鍋滄(鐢熸垚涓?
          </button>
        )}

        {isBusy && (
          <div className="flex items-center gap-1 text-[10px] text-fuchsia-200/80">
            <Loader2 size={11} className="animate-spin" />
            生成中
            {taskId && <span className="ml-auto text-white/30">{taskId.slice(0, 10)}...</span>}
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
            style={{ aspectRatio: ratio === 'adaptive' ? undefined : ratio.replace(':', '/') }}
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

export default memo(SeedanceNode);
