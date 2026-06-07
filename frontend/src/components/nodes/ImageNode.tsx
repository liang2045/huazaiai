import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, useReactFlow, useViewport, type Node, type NodeProps } from '@xyflow/react';
import { AlertCircle, ChevronDown, CopyPlus, Download, Ellipsis, Expand, Image as ImageIcon, Loader2, Plus, RotateCcw, Sparkles, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useUpstreamMaterials, type Material } from './useUpstreamMaterials';
import { useOrderedMaterials } from './useOrderedMaterials';
import {
  IMAGE_MODELS,
  FAL_REGISTRY,
  GPT_FAL_SIZES,
  NBPRO_FAL_RATIOS,
  NBPRO_FAL_RESOLUTIONS,
  isFalModel,
  MJ_VERSIONS,
  MJ_RATIOS,
  MJ_SPEEDS,
  MJ_SVS,
  DEFAULT_MJ_VERSION,
  DEFAULT_MJ_RATIO,
  DEFAULT_MJ_SPEED,
} from '../../providers/models';
import {
  submitImageAsync,
  queryImageStatus,
  submitImageFal,
  queryImageFal,
  uploadFile,
  submitMjImagine,
  queryMjTask,
  uploadMjImage,
  buildMjPrompt,
  type MjSpeed,
} from '../../services/generation';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useHasAutoOutput } from './useHasAutoOutput';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { useThemeStore } from '../../stores/theme';
import { logBus } from '../../stores/logs';
import { MATERIAL_DROP_EVENT, useDragMaterialStore, type MaterialPayload } from '../../stores/dragMaterial';
import { useMaterialDropTarget } from '../../hooks/useMaterialDropTarget';
import { downloadAsset } from '../../utils/download';
import { useApiKeysStore } from '../../stores/apiKeys';
import { getGptImagePixelSize, isGptImageSizeKind } from '../../utils/imageSizes';

const COMPACT_MEDIA_WIDTH = 240;
const PREVIEW_ZOOM_STEP = 0.25;
const GENERATION_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const LEGACY_GPT_IMAGE_MODELS = new Set(['gpt-image-2-all-fal']);
const normalizeImageApiModel = (value: string) => (
  LEGACY_GPT_IMAGE_MODELS.has(value) ? 'gpt-image-2' : value
);
const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
};
const hasConfiguredKey = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
const getImageModelKeyGroup = (apiModel: string, paramKind?: string) => {
  const m = String(apiModel || '').toLowerCase();
  if (paramKind === 'mj' || m.includes('midjourney') || /\bmj[-_/]/.test(m) || m === 'mj') return 'mj';
  if (paramKind === 'banana-ratio' || m.includes('nano-banana')) return 'banana';
  if (paramKind === 'gpt-size' || m.includes('gpt-image')) return 'gpt';
  return 'other';
};

/**
 * ImageNode - 图像生成(ZhenzhenMagic)
 * 多 TAB 切换:GPT2 / 香蕉2 / 香蕉Pro,参数与主项目 gpt-image-2-web 对齐
 * 参数:模型 TAB / 比例 / 尺寸 / 多张参考图 / 本地 prompt
 * 上游 text 节点 → prompt(优先);上游 image 节点 → 参考图(并入 references)
 */
const ImageNode = ({ id, data, selected }: NodeProps) => {
  const update = useUpdateNodeData(id);
  const hasAutoOutput = useHasAutoOutput(id);
  const { getEdges, getNodes, setNodes, setEdges } = useReactFlow();
  const { zoom: viewportZoom } = useViewport();
  const { style, theme } = useThemeStore();
  const isPixel = style === 'pixel';
  const isDark = theme === 'dark';
  // 主参考图(referenceImages)上传入口 - 与下面 MJ sref/oref 上传隔离
  const mainFileInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // MJ 上传时区分 sref 还是 oref(共用 fileInputRef)
  const mjUploadKindRef = useRef<'sref' | 'oref'>('sref');

  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [referenceMenuOpen, setReferenceMenuOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [keepMenuAfterReferencePick, setKeepMenuAfterReferencePick] = useState(false);
  const [localGenerating, setLocalGenerating] = useState(false);
  const [imageToolMenu, setImageToolMenu] = useState<null | 'same' | 'expand'>(null);
  const bringNodeToFront = () => {
    setNodes((nodes) => {
      const current = nodes.find((n) => n.id === id);
      if (!current) return nodes;
      const maxZ = nodes.reduce((max, n) => Math.max(max, Number(n.zIndex || 0)), 0);
      if (Number(current.zIndex || 0) >= maxZ) return nodes;
      return nodes.map((n) => (n.id === id ? { ...n, zIndex: maxZ + 10 } : n));
    });
  };
  const openMenu = () => {
    bringNodeToFront();
    setMenuOpen(true);
  };
  const d = data as any;
  const previewZoom = typeof d?.previewZoom === 'number' ? d.previewZoom : 1;
  const setPreviewZoom = (next: number) => {
    update({ previewZoom: Math.min(3, Math.max(0.5, Number(next.toFixed(2)))) });
  };
  const model = d?.model || IMAGE_MODELS[0].id;
  const modelDef = useMemo(() => IMAGE_MODELS.find((m) => m.id === model) || IMAGE_MODELS[0], [model]);

  const aspectRatio = d?.aspectRatio || modelDef.defaultAspectRatio;
  const sizeLevel = d?.sizeLevel || modelDef.defaultSize;
  // 子模型变体(对齐 gpt-image-2-web 的 g_model/n_model)
  const storedApiModel = d?.apiModel || modelDef.apiModel;
  const apiModel = normalizeImageApiModel(storedApiModel);
  const apiSettings = useApiKeysStore((s) => s.settings);
  const selectedModelOptionLabel = useMemo(() => {
    const opt = modelDef.apiModelOptions.find((item) => normalizeImageApiModel(item.value) === apiModel);
    return opt?.label || modelDef.label;
  }, [apiModel, modelDef]);
  const availableImageModelOptions = useMemo(() => {
    const hasGeneralKey = hasConfiguredKey(apiSettings.zhenzhenApiKey);
    const groupKeys = {
      gpt: hasConfiguredKey(apiSettings.gptImageApiKey),
      banana: hasConfiguredKey(apiSettings.nanoBananaApiKey),
      mj: hasConfiguredKey(apiSettings.mjApiKey),
    };
    const hasAnySpecificImageKey = groupKeys.gpt || groupKeys.banana || groupKeys.mj;
    const canShowGroup = (group: string) => {
      if (group === 'gpt') return groupKeys.gpt || (!hasAnySpecificImageKey && hasGeneralKey);
      if (group === 'banana') return groupKeys.banana || (!hasAnySpecificImageKey && hasGeneralKey);
      if (group === 'mj') return groupKeys.mj || (!hasAnySpecificImageKey && hasGeneralKey);
      return hasGeneralKey || !hasAnySpecificImageKey;
    };

    return IMAGE_MODELS.flatMap((m) =>
      m.apiModelOptions.map((opt) => ({
        id: `${m.id}:${opt.value}`,
        modelId: m.id,
        apiModel: opt.value,
        label: opt.label,
        description: m.description,
        group: getImageModelKeyGroup(opt.value, m.paramKind),
      })),
    ).filter((item) => canShowGroup(item.group));
  }, [apiSettings.gptImageApiKey, apiSettings.mjApiKey, apiSettings.nanoBananaApiKey, apiSettings.zhenzhenApiKey]);

  // ========== FAL 渠道识别及参数(不影响其他模型) ==========
  const isFal = isFalModel(apiModel);
  const falDef = isFal ? FAL_REGISTRY[apiModel] : undefined;
  const falKind = falDef?.paramKind; // 'gpt-fal' | 'nbpro-fal'
  // FAL 参数(默认对齐主项目初始值)
  // gpt-fal: mode/size/quality/n/format/sync/customW/customH
  const falMode: 'edit' | 'gen' = d?.falMode || 'edit';
  const falSize: string = d?.falSize || 'auto';
  const falCustomW = clampInt(d?.falCustomW ?? d?.customWidth, 256, 4096, 1024);
  const falCustomH = clampInt(d?.falCustomH ?? d?.customHeight, 256, 4096, 1024);
  const falQuality: 'low' | 'medium' | 'high' | 'auto' = d?.falQuality || 'medium';
  const falN = clampInt(d?.falN, 1, 10, 1);
  const falFormat: 'png' | 'jpeg' | 'webp' = d?.falFormat || 'png';
  const falSync: boolean = d?.falSync === true;
  // nbpro-fal: aspect_ratio/resolution/safety/imgMode/webSearch/sysPrompt/seed
  const nbAspect: string = d?.nbAspect || 'auto';
  const nbResolution: string = d?.nbResolution || '2K';
  const nbSafety: string = d?.nbSafety || '4';
  const nbImgMode: 'image_url' | 'base64' = d?.nbImgMode || 'image_url';
  const nbWebSearch: boolean = d?.nbWebSearch === true;
  const nbSysPrompt: string = d?.nbSysPrompt || '';
  const nbSeed: number = d?.nbSeed ?? 0;

  // ========== MJ 渠道识别及参数(完全对齐 gpt-image-2-web mj_* 控件 L1552~L1580) ==========
  const isMj = modelDef.paramKind === 'mj';
  const showGptSizeControls = !isMj && (!isFal || falKind === 'gpt-fal');
  const mjVersion: string = d?.mjVersion || DEFAULT_MJ_VERSION;
  const mjAr: string = d?.mjAr || DEFAULT_MJ_RATIO;
  const mjSpeed: MjSpeed = (d?.mjSpeed as MjSpeed) || DEFAULT_MJ_SPEED;
  const mjC: number = d?.mjC ?? 0;
  const mjS: number = d?.mjS ?? 0;
  const mjIw: number = d?.mjIw ?? 0;
  const mjSw: number = d?.mjSw ?? 0;
  const mjSv: string = d?.mjSv || '1';
  const mjNo: string = d?.mjNo || '';
  const mjSeed: number = d?.mjSeed ?? 0;
  const mjMaxPoll: number = d?.mjMaxPoll ?? 300;
  const mjPollInt: number = d?.mjPollInt ?? 3;
  const mjSrefImages: string[] = Array.isArray(d?.mjSrefImages) ? d.mjSrefImages : [];
  const mjOrefImages: string[] = Array.isArray(d?.mjOrefImages) ? d.mjOrefImages : [];
  const MJ_REF_MAX = 2; // sref 与 oref 各最多 2 张

  // 参考图上限(FAL 使用 FAL_REGISTRY.maxRefs,其他走原设计)
  const maxRefs = falDef?.maxRefs ?? modelDef.maxReferenceImages;
  const status: 'idle' | 'generating' | 'success' | 'error' = d?.status || 'idle';
  const isGenerating = status === 'generating' || localGenerating;
  const imageUrl = d?.imageUrl as string | undefined;
  const hasImageResult = !!imageUrl;
  const generationLocked = hasImageResult;
  const generateDisabled = isGenerating || generationLocked;
  const generateButtonLabel = generationLocked ? '已生成' : (isGenerating ? '生成中' : '生成');
  const imageWidth = Number(d?.imageWidth || 0);
  const imageHeight = Number(d?.imageHeight || 0);
  const hasTrueImageSize = hasImageResult && imageWidth > 0 && imageHeight > 0;
  const layerOnly = hasImageResult && !selected;
  const handleVisibilityClass = selected ? '!opacity-100' : '!opacity-0 !pointer-events-none';
  const stableMenuZoom = Math.max(viewportZoom || 1, 0.01);
  const stableMenuScale = 1 / stableMenuZoom;
  const stableMenuOffset = 10 / stableMenuZoom;
  const imageResolutionInfo = hasTrueImageSize ? `${imageWidth}×${imageHeight}` : '';
  const generatedImageName = String(
    d?.imageName ||
      d?.fileName ||
      d?.filename ||
      (imageUrl
        ? (() => {
            try {
              const clean = imageUrl.split('?')[0].split('#')[0];
              const last = clean.split('/').filter(Boolean).pop() || '';
              return decodeURIComponent(last) || '生成图片';
            } catch {
              return '生成图片';
            }
          })()
        : '生成图片'),
  );
  const generatedImageMeta = `${generatedImageName} · ${imageResolutionInfo || '尺寸读取中'}`;
  const requestedGptImageSize = getGptImagePixelSize(aspectRatio, sizeLevel);
  const standardImageSizeLabel = isGptImageSizeKind(modelDef.paramKind)
    ? `${requestedGptImageSize} · ${falN}张`
    : `${aspectRatio}/${sizeLevel} · ${falN}张`;
  const mediaInfo = isFal
    ? (falKind === 'gpt-fal'
      ? (imageResolutionInfo ? `${imageResolutionInfo} · ${falN}张` : `${aspectRatio}/${sizeLevel} · ${falN}张`)
      : (imageResolutionInfo ? `${imageResolutionInfo} · ${nbResolution}` : `${nbAspect}/${nbResolution}`))
    : isMj
      ? (imageResolutionInfo ? `${imageResolutionInfo} · ${mjVersion}` : `${mjAr} · ${mjVersion}`)
      : (imageResolutionInfo ? `${imageResolutionInfo} · ${falN}张` : standardImageSizeLabel);
  const currentSizeLabel = String(
    isFal && falKind === 'nbpro-fal'
      ? nbResolution
      : isFal && falKind === 'gpt-fal' && falSize !== 'auto'
        ? (falSize === 'custom' ? `${falCustomW}x${falCustomH}` : falSize)
        : sizeLevel,
  ).toUpperCase();
  const settingsAspectLabel = isMj
    ? mjAr
    : isFal && falKind === 'nbpro-fal'
      ? `${nbAspect}(${currentSizeLabel})`
      : `${aspectRatio}(${currentSizeLabel})`;
  const imageFrameStyle = { width: COMPACT_MEDIA_WIDTH };
  const imageBodyStyle = hasTrueImageSize
    ? { aspectRatio: `${imageWidth} / ${imageHeight}`, borderRadius: 0 }
    : { aspectRatio: aspectRatio?.includes(':') ? aspectRatio.replace(':', '/') : '1 / 1', borderRadius: 0 };
  const syncNaturalImageSize = (img: HTMLImageElement) => {
    const width = img.naturalWidth || 0;
    const height = img.naturalHeight || 0;
    if (width > 0 && height > 0 && (width !== imageWidth || height !== imageHeight)) {
      update({ imageWidth: width, imageHeight: height });
    }
  };
  const imagePatchFromResult = (url: string, result?: { images?: Array<{ url?: string; width?: number; height?: number }> }) => {
    const info = result?.images?.find((it) => it?.url === url) || result?.images?.[0];
    const width = Number(info?.width || 0);
    const height = Number(info?.height || 0);
    return {
      imageUrl: url,
      imageWidth: width > 0 ? width : undefined,
      imageHeight: height > 0 ? height : undefined,
    };
  };
  const createSiblingResultNode = (
    patch: Record<string, any>,
    finalPrompt: string,
    usedI2I: boolean,
  ) => {
    setNodes((nodes) => {
      const source = nodes.find((n) => n.id === id);
      if (!source) return nodes;
      const sourceData = { ...((source.data as any) || {}) };
      [
        'imageUrl',
        'imageUrls',
        'imageWidth',
        'imageHeight',
        'status',
        'progress',
        'error',
        'taskId',
        'falResponseUrl',
        'falEndpoint',
      ].forEach((key) => delete sourceData[key]);

      const parentId = (source as any).parentId as string | undefined;
      const measured = (source as any).measured || {};
      const sourceW = Number((source as any).width || measured.width || COMPACT_MEDIA_WIDTH);
      const sourceH = Number((source as any).height || measured.height || COMPACT_MEDIA_WIDTH);
      const sameParent = (n: Node) => ((n as any).parentId || undefined) === parentId;
      const isOccupied = (x: number, y: number) =>
        nodes.some((n) => {
          if (n.id === id || !sameParent(n)) return false;
          const nx = Number(n.position?.x || 0);
          const ny = Number(n.position?.y || 0);
          return Math.abs(nx - x) < 32 && Math.abs(ny - y) < 32;
        });

      const x = source.position.x + sourceW + 40;
      let y = source.position.y;
      for (let i = 0; i < 20 && isOccupied(x, y); i += 1) y += 40;
      const maxZ = nodes.reduce((max, n) => Math.max(max, Number(n.zIndex || 0)), 0);
      const type = source.type || 'image';
      const newNode: Node = {
        id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type,
        position: { x, y },
        zIndex: maxZ + 10,
        data: {
          ...sourceData,
          status: 'success',
          progress: '100%',
          ...patch,
          lastPrompt: finalPrompt,
          usedI2I,
        },
      };
      if (parentId) {
        (newNode as any).parentId = parentId;
      }
      return [...nodes, newNode];
    });
  };
  const createReferencedDraftNode = (kind: 'same' | 'expand', nextAspectRatio?: string) => {
    if (!imageUrl) return;
    setNodes((nodes) => {
      const source = nodes.find((n) => n.id === id);
      if (!source) return nodes;
      const measured = (source as any).measured || {};
      const sourceW = Number((source as any).width || measured.width || COMPACT_MEDIA_WIDTH);
      const sourceH = Number((source as any).height || measured.height || COMPACT_MEDIA_WIDTH);
      const x = source.position.x + sourceW + 56;
      let y = source.position.y;
      const parentId = (source as any).parentId as string | undefined;
      const sameParent = (n: Node) => ((n as any).parentId || undefined) === parentId;
      const isOccupied = (px: number, py: number) =>
        nodes.some((n) => {
          if (n.id === id || !sameParent(n)) return false;
          return Math.abs(Number(n.position?.x || 0) - px) < 40 && Math.abs(Number(n.position?.y || 0) - py) < 40;
        });
      for (let i = 0; i < 20 && isOccupied(x, y); i += 1) y += 44;
      const maxZ = nodes.reduce((max, n) => Math.max(max, Number(n.zIndex || 0)), 0);
      const sourceData = { ...((source.data as any) || {}) };
      [
        'imageUrl',
        'imageUrls',
        'imageWidth',
        'imageHeight',
        'status',
        'progress',
        'error',
        'taskId',
        'falResponseUrl',
        'falEndpoint',
      ].forEach((key) => delete sourceData[key]);
      const promptPrefix = kind === 'expand' ? '在保持主体和风格一致的前提下扩展画面' : '参考这张图片，生成同款风格和主体气质的新图';
      const newNode: Node = {
        id: `image-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'image',
        position: { x, y },
        zIndex: maxZ + 10,
        selected: true,
        data: {
          ...sourceData,
          prompt: sourceData.prompt || sourceData.lastPrompt || promptPrefix,
          referenceImages: [imageUrl],
          materialOrder: [`local::image:${imageUrl}`],
          aspectRatio: nextAspectRatio || sourceData.aspectRatio || aspectRatio,
          status: 'idle',
          progress: undefined,
          error: null,
        },
      };
      if (parentId) (newNode as any).parentId = parentId;
      return [...nodes.map((n) => ({ ...n, selected: false })), newNode as any];
    });
    setImageToolMenu(null);
    setMenuOpen(false);
  };
  const duplicateAsDraftNode = () => {
    setNodes((nodes) => {
      const source = nodes.find((n) => n.id === id);
      if (!source) return nodes;
      const measured = (source as any).measured || {};
      const sourceW = Number((source as any).width || measured.width || COMPACT_MEDIA_WIDTH);
      const sourceH = Number((source as any).height || measured.height || COMPACT_MEDIA_WIDTH);
      const parentId = (source as any).parentId as string | undefined;
      const sameParent = (n: Node) => ((n as any).parentId || undefined) === parentId;
      const isOccupied = (px: number, py: number) =>
        nodes.some((n) => {
          if (n.id === id || !sameParent(n)) return false;
          return Math.abs(Number(n.position?.x || 0) - px) < 40 && Math.abs(Number(n.position?.y || 0) - py) < 40;
        });
      const x = source.position.x + sourceW + 56;
      let y = source.position.y;
      for (let i = 0; i < 20 && isOccupied(x, y); i += 1) y += 44;
      const maxZ = nodes.reduce((max, n) => Math.max(max, Number(n.zIndex || 0)), 0);
      const sourceData = { ...((source.data as any) || {}) };
      [
        'imageUrl',
        'imageUrls',
        'imageWidth',
        'imageHeight',
        'imageName',
        'status',
        'progress',
        'error',
        'taskId',
        'falResponseUrl',
        'falEndpoint',
        'usedI2I',
      ].forEach((key) => delete sourceData[key]);
      if (!sourceData.prompt && (source.data as any)?.lastPrompt) {
        sourceData.prompt = (source.data as any).lastPrompt;
      }
      const newNode: Node = {
        id: `image-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: source.type || 'image',
        position: { x, y },
        zIndex: maxZ + 10,
        selected: true,
        data: {
          ...sourceData,
          status: 'idle',
          progress: undefined,
          error: null,
        },
      };
      if (parentId) (newNode as any).parentId = parentId;
      return [...nodes.map((n) => ({ ...n, selected: false })), newNode as any];
    });
    setImageToolMenu(null);
    setMenuOpen(false);
  };
  const mediaActionClass = `flex h-7 w-7 items-center justify-center rounded-full border shadow-lg backdrop-blur transition ${
    isDark
      ? 'border-white/10 bg-zinc-950/88 text-white/80 hover:bg-zinc-900 hover:text-white'
      : 'border-black/10 bg-white/92 text-zinc-700 hover:bg-white hover:text-zinc-950'
  }`;
  const localPrompt = d?.prompt || '';
  // 节点内本地上传的参考图(除了上游接入的,这里是手动上传)
  const refImages: string[] = Array.isArray(d?.referenceImages) ? d.referenceImages : [];

  // ============ 上游素材聚合 (新机制) ============
  const upstream = useUpstreamMaterials(id);
  const localImageMaterials: Material[] = useMemo(
    () =>
      refImages.map((url, i) => ({
        id: `local::image:${url}`,
        kind: 'image' as const,
        url,
        sourceNodeId: id,
        origin: 'local' as const,
        label: `本地${i + 1}`,
      })),
    [refImages, id],
  );
  const allImagesUnordered = useMemo(
    () => [...localImageMaterials, ...upstream.images],
    [localImageMaterials, upstream.images],
  );
  const materialOrder: string[] = Array.isArray(d?.materialOrder) ? d.materialOrder : [];
  const orderedImages = useOrderedMaterials(allImagesUnordered, materialOrder);
  const orderedTexts = useOrderedMaterials(upstream.texts, materialOrder);
  const isGptStandardPath = isGptImageSizeKind(modelDef.paramKind) && apiModel.includes('gpt-image-2') && !apiModel.includes('-fal');
  const blocksGpt4kEdit = (refCount: number) => isGptStandardPath && String(sizeLevel).toUpperCase() === '4K' && refCount > 0;
  const gpt4kEditMessage = 'gpt-image-2 带参考图编辑时暂不提交 4K，容易被上游扣费后返回失败。请切换到 2K 后再生成。';
  const activeReferenceCount = orderedImages.slice(0, maxRefs).length;
  const blockedByGpt4kEdit = blocksGpt4kEdit(activeReferenceCount);
  const isBlockedGpt4kSizeOption = (value: string) =>
    isGptStandardPath && activeReferenceCount > 0 && String(value).toUpperCase() === '4K';
  const handleRemoveMaterial = (m: Material) => {
    if (m.origin === 'local') {
      update({
        referenceImages: refImages.filter((u) => u !== m.url),
        materialOrder: materialOrder.filter((key) => key !== m.id),
      });
      return;
    }

    setEdges((eds) =>
      eds.filter((edge) => !(edge.source === m.sourceNodeId && edge.target === id)),
    );
    update({ materialOrder: materialOrder.filter((key) => key !== m.id) });
  };

  // 切换模型时,如果当前比例/尺寸不在新模型选项里则重置
  const switchModel = (mId: string, nextApiModel?: string) => {
    const newDef = IMAGE_MODELS.find((m) => m.id === mId) || IMAGE_MODELS[0];
    const patch: any = { model: mId, apiModel: nextApiModel || newDef.apiModel };
    if (newDef.paramKind === 'mj') {
      if (!d?.mjVersion) patch.mjVersion = DEFAULT_MJ_VERSION;
      if (!d?.mjAr) patch.mjAr = DEFAULT_MJ_RATIO;
      if (!d?.mjSpeed) patch.mjSpeed = DEFAULT_MJ_SPEED;
      if (d?.mjSv === undefined) patch.mjSv = '1';
    } else {
      if (!newDef.aspectRatios.includes(aspectRatio)) patch.aspectRatio = newDef.defaultAspectRatio;
      if (!newDef.sizes.includes(sizeLevel)) patch.sizeLevel = newDef.defaultSize;
    }
    update(patch);
  };

  // 从上游节点 + 本地上传按用户排序后的顺序聚合 prompt + 参考图
  // 注意: 此处只输出已合并、已排序的列表, 不再原地从 edges/nodes 二次收集
  const collectUpstream = (): { prompt: string; images: string[] } => {
    const prompts = orderedTexts.map((t) => t.url).filter((s) => !!s);
    const images: string[] = [];
    for (const m of orderedImages) {
      if (typeof m.url === 'string' && m.url) images.push(m.url);
    }
    void getEdges;
    void getNodes;
    return {
      prompt: prompts.join('\n').trim(),
      images: images.slice(0, modelDef.maxReferenceImages),
    };
  };

  // 手动上传主参考图 (走 mainFileInputRef, 与 MJ sref/oref 隔离)
  const handlePickFile = () => mainFileInputRef.current?.click();
  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setError(null);
    try {
      const remain = maxRefs - refImages.length;
      const accepted = files.slice(0, Math.max(0, remain));
      const uploaded: string[] = [];
      for (const f of accepted) {
        const r = await uploadFile(f);
        uploaded.push(r.url);
      }
      update({ referenceImages: [...refImages, ...uploaded] });
    } catch (err: any) {
      setError(err?.message || '上传失败');
    } finally {
      if (mainFileInputRef.current) mainFileInputRef.current.value = '';
    }
  };

  // ========== MJ 参考图上传(sref/oref)与移除 ==========
  const handleMjPick = (kind: 'sref' | 'oref') => {
    mjUploadKindRef.current = kind;
    fileInputRef.current?.click();
  };
  const handleMjFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setError(null);
    try {
      const kind = mjUploadKindRef.current;
      const cur = kind === 'sref' ? mjSrefImages : mjOrefImages;
      const remain = MJ_REF_MAX - cur.length;
      const accepted = files.slice(0, Math.max(0, remain));
      const uploaded: string[] = [];
      for (const f of accepted) {
        const url = await uploadMjImage(f, mjSpeed);
        if (url) uploaded.push(url);
      }
      if (kind === 'sref') update({ mjSrefImages: [...cur, ...uploaded] });
      else update({ mjOrefImages: [...cur, ...uploaded] });
    } catch (err: any) {
      setError(err?.message || 'MJ 参考图上传失败');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };
  const removeMjRef = (kind: 'sref' | 'oref', idx: number) => {
    if (kind === 'sref') update({ mjSrefImages: mjSrefImages.filter((_, i) => i !== idx) });
    else update({ mjOrefImages: mjOrefImages.filter((_, i) => i !== idx) });
  };

  const handleGenerate = async () => {
    setError(null);
    if (generationLocked) {
      const msg = '当前节点已有生成结果，已阻止重复生成以避免重复扣费。';
      setError(msg);
      logBus.warn(msg, `image:${id.slice(0, 6)}`);
      return;
    }
    const { prompt: upstreamPrompt, images: upstreamImages } = collectUpstream();
    const finalPrompt = (upstreamPrompt || localPrompt || '').trim();
    const src = `image:${id.slice(0, 6)}`;
    if (!finalPrompt) {
      setError('未连接 text 节点也未填写 prompt');
      logBus.error('生成中止: 缺少 prompt', src);
      return;
    }
    const allRefs = upstreamImages.slice(0, maxRefs);
    if (blocksGpt4kEdit(allRefs.length)) {
      setError(gpt4kEditMessage);
      logBus.warn(gpt4kEditMessage, src);
      update({ status: 'error', error: gpt4kEditMessage });
      return;
    }
    const generateIntoSibling = false;
    const setProgress = (patch: Record<string, any>) => {
      if (!generateIntoSibling) update(patch);
    };
    const commitResult = (
      url: string,
      result: { images?: Array<{ url?: string; width?: number; height?: number }> } | undefined,
      usedI2I: boolean,
    ) => {
      const patch = imagePatchFromResult(url, result);
      if (generateIntoSibling) {
        createSiblingResultNode(patch, finalPrompt, usedI2I);
      } else {
        update({
          status: 'success',
          progress: '100%',
          ...patch,
          lastPrompt: finalPrompt,
          usedI2I,
        });
      }
    };
    const commitResults = (
      urls: string[],
      result: { images?: Array<{ url?: string; width?: number; height?: number }> } | undefined,
      usedI2I: boolean,
    ) => {
      const validUrls = urls.filter(Boolean);
      if (!validUrls.length) return;
      validUrls.forEach((url, index) => {
        const single = {
          images: result?.images?.filter((it) => it?.url === url),
        };
        if (!generateIntoSibling && index === 0) {
          commitResult(url, result, usedI2I);
        } else {
          const patch = imagePatchFromResult(url, single.images?.length ? single : result);
          createSiblingResultNode(patch, finalPrompt, usedI2I);
        }
      });
    };
    if (generateIntoSibling) {
      setLocalGenerating(true);
    } else {
      update({ status: 'generating', progress: '0%', error: null });
    }
    try {
      // collectUpstream 已返回「本地上传 + 上游接入」按用户拖拽顺序合并后的列表,
      // 这里不再二次叠加 refImages, 避免本地参考图重复传递。
      const allRefs = upstreamImages.slice(0, maxRefs);

      // ============ MJ 路径(对齐 gpt-image-2-web runMJ L4437~L4716) ============
      if (isMj) {
        logBus.info(
          `MJ提交: version=${mjVersion} ar=${mjAr} speed=${mjSpeed} ref=${allRefs.length} sref=${mjSrefImages.length} oref=${mjOrefImages.length} prompt="${finalPrompt.slice(0, 60)}${finalPrompt.length > 60 ? '…' : ''}"`,
          src,
        );
        // 主参考图(垫图): 将 URL 转 base64(主项目只接受 base64Array,上游节点输出的 imageUrl 需下载转换)
        const base64Array: string[] = [];
        for (const u of allRefs) {
          try {
            const resp = await fetch(u);
            const blob = await resp.blob();
            const dataUrl: string = await new Promise((resolve, reject) => {
              const fr = new FileReader();
              fr.onload = () => resolve(String(fr.result || ''));
              fr.onerror = () => reject(new Error('读取失败'));
              fr.readAsDataURL(blob);
            });
            base64Array.push(dataUrl);
          } catch (err: any) {
            logBus.warn(`MJ 主参考图转 base64 失败,跳过: ${u}`, src);
          }
        }
        // sref/oref 允许多张(buildMjPrompt 会为每个 URL 各追加一个 flag)
        const fullPrompt = buildMjPrompt({
          prompt: finalPrompt,
          model: mjVersion,
          ar: mjAr,
          c: mjC || undefined,
          s: mjS || undefined,
          iw: mjIw || undefined,
          sw: mjSw || undefined,
          sv: mjSv || undefined,
          no: mjNo || undefined,
          srefUrls: mjSrefImages,
          orefUrls: mjOrefImages,
        });
        const submit = await submitMjImagine({
          prompt: fullPrompt,
          ar: mjAr,
          c: mjC || undefined,
          s: mjS || undefined,
          iw: mjIw || undefined,
          sw: mjSw || undefined,
          sv: mjSv || undefined,
          no: mjNo || undefined,
          seed: mjSeed || undefined,
          speed: mjSpeed,
          base64Array,
          remix: true,
        });
        const taskId = submit.taskId;
        logBus.info(`MJ 任务已提交 taskId=${taskId} fullPrompt="${fullPrompt.slice(0, 120)}${fullPrompt.length > 120 ? '…' : ''}"`, src);
        setProgress({ progress: '15%', taskId });
        const maxPoll = Math.max(10, Math.min(2000, mjMaxPoll || 300));
        const interval = Math.max(1, Math.min(30, mjPollInt || 3)) * 1000;
        for (let i = 0; i < maxPoll; i++) {
          await new Promise((r) => setTimeout(r, interval));
          const q = await queryMjTask(taskId, mjSpeed);
          if (q.status === 'FAILURE') {
            throw new Error(`MJ 失败: ${q.failReason || '未知错误'}`);
          }
          if (q.progress) {
            const pct = parseInt(String(q.progress)) || 0;
            const out = `${Math.min(99, 15 + Math.floor(pct * 0.85))}%`;
            setProgress({ progress: out });
            if (i % 3 === 2) logBus.debug(`[${i + 1}/${maxPoll}] MJ progress=${q.progress} status=${q.status}`, src);
          }
          if (q.status === 'SUCCESS') {
            const main = q.imageUrl || '';
            const grid = q.imageUrls || [];
            const all = grid.length ? grid : (main ? [main] : []);
            if (!all.length) {
              // 调试：上游字段名可能变化，把原始报文打到日志便于定位
              try {
                const dump = JSON.stringify(q.raw)?.slice(0, 800) || String(q.raw);
                logBus.warn(`MJ 任务完成但未拿到 imageUrl/imageUrls，raw=${dump}`, src);
              } catch {}
              throw new Error('MJ 任务完成但未返回图片');
            }
            const final = main || all[0];
            logBus.success(`MJ 任务完成 → ${final}` + (grid.length ? ` (含 ${grid.length} 张子图)` : ''), src);
            commitResult(final, { images: [{ url: final }] }, allRefs.length > 0 || mjSrefImages.length > 0 || mjOrefImages.length > 0);
            return;
          }
        }
        throw new Error(`MJ 轮询超时: ${maxPoll} 次 × ${interval / 1000}s`);
      }

      // ============ FAL 路径(对齐 gpt-image-2-web runGPTFal / runNanoFal) ============
      if (isFal && falDef) {
        const sizeDesc = falKind === 'gpt-fal'
          ? (falSize === 'custom' ? `custom ${falCustomW}x${falCustomH}` : `${aspectRatio}/${sizeLevel}`)
          : `${nbAspect}/${nbResolution}`;
        logBus.info(
          `FAL提交: model=${apiModel} kind=${falKind} size=${sizeDesc} 参考图=${allRefs.length} prompt="${finalPrompt.slice(0, 60)}${finalPrompt.length > 60 ? '…' : ''}"`,
          src,
        );
        const submit = await submitImageFal({
          apiModel,
          prompt: finalPrompt,
          images: allRefs,
          n: falKind === 'gpt-fal' ? falN : (d?.falN ?? 1),
          format: falFormat,
          sync: falSync,
          // gpt-fal
          mode: falKind === 'gpt-fal' ? falMode : undefined,
          size: falKind === 'gpt-fal' ? falSize : undefined,
          customW: falKind === 'gpt-fal' && falSize === 'custom' ? falCustomW : undefined,
          customH: falKind === 'gpt-fal' && falSize === 'custom' ? falCustomH : undefined,
          quality: falKind === 'gpt-fal' ? falQuality : undefined,
          aspect_ratio: falKind === 'gpt-fal' ? aspectRatio : (falKind === 'nbpro-fal' ? nbAspect : undefined),
          // nbpro-fal
          resolution: falKind === 'gpt-fal' ? sizeLevel : (falKind === 'nbpro-fal' ? nbResolution : undefined),
          safety_tolerance: falKind === 'nbpro-fal' ? nbSafety : undefined,
          seed: falKind === 'nbpro-fal' && nbSeed > 0 ? nbSeed : undefined,
          system_prompt: falKind === 'nbpro-fal' ? nbSysPrompt : undefined,
          enable_web_search: falKind === 'nbpro-fal' ? nbWebSearch : undefined,
          image_mode: falKind === 'nbpro-fal' ? nbImgMode : undefined,
        });

        // 同步完成
        if (submit.sync && submit.urls && submit.urls.length) {
          logBus.success(`FAL同步返回 ${submit.urls.length} 张 → ${submit.urls[0]}`, src);
          commitResults(submit.urls, submit, allRefs.length > 0);
          return;
        }

        // 异步轮询(主项目默认 maxPoll=1200, pollInt=3s; 这里按 2h 上限会太长,采用 600×3s=30min)
        const { requestId, responseUrl, endpoint } = submit;
        if (!requestId || !responseUrl) throw new Error('FAL 提交后未获得 request_id/response_url');
        logBus.info(`FAL异步任务已提交 requestId=${requestId}`, src);
        setProgress({
          progress: '5%',
          taskId: requestId,
          falResponseUrl: responseUrl,
          falEndpoint: endpoint,
        });
        const maxPoll = 600;
        const interval = 3000;
        for (let i = 0; i < maxPoll; i++) {
          await new Promise((r) => setTimeout(r, interval));
          const q = await queryImageFal({ responseUrl, endpoint, requestId });
          const st = String(q.status || '').toLowerCase();
          if (st === 'completed') {
            const urls = q.urls || [];
            if (!urls.length) throw new Error('FAL 任务完成但未返回图片');
            logBus.success(`FAL 任务完成 ${urls.length} 张 → ${urls[0]}`, src);
            commitResults(urls, q, allRefs.length > 0);
            return;
          }
          if (st === 'failed') {
            throw new Error(q.error || 'FAL 任务失败');
          }
          // 进度估算(15% 起步,到 95% 上限)
          const pct = Math.min(95, 15 + Math.floor((i / maxPoll) * 80));
          if (i % 5 === 4) {
            setProgress({ progress: `${pct}%` });
            logBus.debug(`[${i + 1}/${maxPoll}] FAL 轮询 status=${q.falStatus || 'IN_QUEUE'}`, src);
          }
        }
        throw new Error(`FAL 超时: ${(maxPoll * interval) / 1000}s 未完成`);
      }

      // ============ 原有标准路径(GPT2 standard / nano-banana / nano-banana-pro 未动) ============
      const standardPixelSize = isGptImageSizeKind(modelDef.paramKind) ? requestedGptImageSize : undefined;
      const standardSizeDesc = standardPixelSize || `${aspectRatio}/${sizeLevel}`;
      logBus.info(
        `提交任务: model=${apiModel} 比例=${aspectRatio} 尺寸=${standardSizeDesc} 张数=${falN} 参考图=${allRefs.length} prompt="${finalPrompt.slice(0, 60)}${finalPrompt.length > 60 ? '…' : ''}"`,
        src,
      );
      const submit = await submitImageAsync({
        model: modelDef.id,
        apiModel: apiModel,
        paramKind: modelDef.paramKind,
        prompt: finalPrompt,
        aspect_ratio: aspectRatio,
        image_size: sizeLevel,
        size: standardPixelSize,
        images: allRefs,
        n: falN,
      });

      // 分支一:同步完成
      if (submit.sync && submit.urls && submit.urls.length) {
        logBus.success(`同步返回 ${submit.urls.length} 张 → ${submit.urls[0]}`, src);
        commitResults(submit.urls, submit, allRefs.length > 0);
        return;
      }

      // 分支二:异步任务 → 轮询状态(对齐主项目 gpt-image-2-web pollTask)
      const taskId = submit.taskId;
      if (!taskId) throw new Error('未获取到 taskId 且无同步结果');
      logBus.info(`异步任务已提交 taskId=${taskId} 进入轮询…`, src);
      setProgress({ progress: submit.progress || '5%', taskId });
      // GPT2 / nano-banana / nano-banana-pro 标准路径轮询上限:
      //   maxPoll × interval = 1800 × 2s = 3600s = 60 分钟(避免复杂 prompt / 多参考图任务被 120s 提前中断)
      const maxPoll = 1800;     // 最多 1800 次
      const interval = 2000;    // 每 2 秒一次
      let lastProg = '5%';
      let lastStatusKey = '';
      let stagnantPolls = 0;
      const stalledQueueLimit = 90;
      for (let i = 0; i < maxPoll; i++) {
        await new Promise((r) => setTimeout(r, interval));
        const q = await queryImageStatus(taskId, apiModel);
        const st = String(q.status || '').toLowerCase();
        const statusKey = `${st}:${q.progress || ''}`;
        if (statusKey === lastStatusKey) stagnantPolls += 1;
        else {
          stagnantPolls = 0;
          lastStatusKey = statusKey;
        }
        if (['queued', 'in_queue', 'not_start', 'not_started'].includes(st) && stagnantPolls >= stalledQueueLimit) {
          throw new Error('上游任务长时间停在队列中，请稍后重试或切换 gpt-image-2 标准路径重新生成');
        }
        if (q.progress && q.progress !== lastProg) {
          lastProg = q.progress;
          setProgress({ progress: q.progress });
          logBus.debug(`[${i + 1}/${maxPoll}] status=${q.status} progress=${q.progress}`, src);
        }
        if (st === 'completed' || st === 'success' || st === 'done') {
          const urls = q.urls || [];
          if (!urls.length) throw new Error('任务完成但未返回图片');
          logBus.success(`任务完成 ${urls.length} 张 → ${urls[0]}`, src);
          commitResults(urls, q, allRefs.length > 0);
          return;
        }
        if (st === 'failed' || st === 'failure' || st === 'error') {
          throw new Error(q.error || '任务失败');
        }
      }
      throw new Error(`超时:${maxPoll * interval / 1000}s 未完成`);
    } catch (e: any) {
      const msg = e?.message || '生成失败';
      setError(msg);
      logBus.error(`生成失败: ${msg}`, src);
      if (!generateIntoSibling) update({ status: 'error', error: msg });
    } finally {
      if (generateIntoSibling) setLocalGenerating(false);
    }
  };

  // 接入运行总线,供批量运行调起
  useRunTrigger(id, handleGenerate);

  // === 跨节点拖拽: source (从输出图 Ctrl+拖出) ===
  const startDrag = useDragMaterialStore((s) => s.start);
  const referencePickTargetId = useDragMaterialStore((s) => s.referencePickTargetId);
  const startReferencePick = useDragMaterialStore((s) => s.startReferencePick);
  const endReferencePick = useDragMaterialStore((s) => s.endReferencePick);
  const isPickingReference = referencePickTargetId === id;
  const beginMaterialDrag = (e: React.MouseEvent, payload: MaterialPayload) => {
    if (e.button !== 0) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);
    startDrag(payload, e.clientX, e.clientY);
  };

  // === 跨节点拖拽: target (接收图像 → 追加到 referenceImages; 接收文本 → 替换 prompt) ===
  const handleDrop = (payload: MaterialPayload) => {
    if (payload.kind === 'image' && payload.url) {
      const cur = Array.isArray(d?.referenceImages) ? d.referenceImages : [];
      if (cur.indexOf(payload.url) !== -1) {
        setKeepMenuAfterReferencePick(true);
        openMenu();
        if (referencePickTargetId === id) endReferencePick();
        return;
      }
      if (cur.length >= maxRefs) {
        setKeepMenuAfterReferencePick(true);
        openMenu();
        if (referencePickTargetId === id) endReferencePick();
        return;
      }
      update({ referenceImages: [...cur, payload.url] });
      setKeepMenuAfterReferencePick(true);
      openMenu();
      if (referencePickTargetId === id) endReferencePick();
    } else if (payload.kind === 'text' && typeof payload.text === 'string') {
      update({ prompt: payload.text });
    }
  };
  const { dropProps, isAccepting } = useMaterialDropTarget({
    id,
    accepts: ['image', 'text'],
    onDrop: handleDrop,
  });
  const handleStartCanvasReferencePick = () => {
    setReferenceMenuOpen(false);
    setKeepMenuAfterReferencePick(true);
    openMenu();
    startReferencePick(id);
  };
  const handleCanvasReferenceSourceClick = (e: React.MouseEvent, payload: MaterialPayload) => {
    if (!referencePickTargetId || payload.kind !== 'image' || !payload.url) return false;
    e.preventDefault();
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent(MATERIAL_DROP_EVENT, {
      detail: { targetNodeId: referencePickTargetId, payload },
    }));
    return true;
  };
  const keepMenuInteraction = (event?: React.SyntheticEvent, stop = true) => {
    if (stop) event?.stopPropagation();
    setMenuOpen(true);
    setKeepMenuAfterReferencePick(true);
  };
  const showAdvancedImageOptions = false;
  const showMenu = !hasImageResult && (selected || menuOpen || isPickingReference || keepMenuAfterReferencePick);
  const imageToolButtonClass = 'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-[12px] font-medium text-zinc-700 transition hover:bg-zinc-100 active:bg-zinc-200';
  const imageToolIconButtonClass = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-zinc-700 transition hover:bg-zinc-100 active:bg-zinc-200';
  const imageToolDividerClass = 'imade-image-toolbar-divider mx-0.5 h-6 w-px shrink-0 bg-zinc-200';
  const renderGeneratedImageToolbar = () => {
    if (!selected || !imageUrl) return null;
    return (
      <div
        className="nodrag nopan absolute left-1/2 z-[160] flex h-11 items-center overflow-visible rounded-2xl border border-zinc-200 bg-white text-zinc-800 shadow-[0_10px_32px_rgba(15,23,42,0.16)]"
        style={{
          top: `${-62 / stableMenuZoom}px`,
          transform: `translateX(-50%) scale(${stableMenuScale})`,
          transformOrigin: 'top center',
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button type="button" className={imageToolButtonClass} title="生成同款草稿" onClick={() => setImageToolMenu((v) => (v === 'same' ? null : 'same'))}>
          <CopyPlus size={14} />
          <span>同款</span>
        </button>
        <button type="button" className={imageToolButtonClass} title="扩图草稿" onClick={() => setImageToolMenu((v) => (v === 'expand' ? null : 'expand'))}>
          <Expand size={14} />
          <span>扩图</span>
        </button>
        <button type="button" className={imageToolIconButtonClass} title="缩小" onClick={() => setPreviewZoom(previewZoom - PREVIEW_ZOOM_STEP)}>
          <ZoomOut size={14} />
        </button>
        <button type="button" className={imageToolIconButtonClass} title="重置缩放" onClick={() => setPreviewZoom(1)}>
          <RotateCcw size={14} />
        </button>
        <button type="button" className={imageToolIconButtonClass} title="放大" onClick={() => setPreviewZoom(previewZoom + PREVIEW_ZOOM_STEP)}>
          <ZoomIn size={14} />
        </button>
        <button type="button" className={imageToolIconButtonClass} title="下载" onClick={() => void downloadAsset(imageUrl, 'image.png')}>
          <Download size={14} />
        </button>
        {imageToolMenu && (
          <div
            className={`absolute left-0 top-10 w-56 rounded-2xl border p-2 text-xs shadow-2xl ${
              isDark ? 'border-white/10 bg-zinc-950 text-white' : 'border-black/10 bg-white text-zinc-900'
            }`}
          >
            {imageToolMenu === 'same' ? (
              <>
                <div className="px-2 py-1.5 font-semibold">同款生成</div>
                <button
                  type="button"
                  className={`mt-1 flex w-full items-center rounded-xl px-3 py-2 text-left ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
                  onClick={() => createReferencedDraftNode('same')}
                >
                  创建同款草稿
                </button>
                <div className={isDark ? 'px-2 py-1 text-[11px] text-white/45' : 'px-2 py-1 text-[11px] text-zinc-500'}>
                  只创建带参考图的新节点，不自动扣费生成。
                </div>
              </>
            ) : (
              <>
                <div className="px-2 py-1.5 font-semibold">扩图比例</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {['原比例', '1:1', '4:5', '3:4', '4:3', '16:9', '9:16', '3:2', '2:3'].map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={`rounded-lg border px-2 py-1.5 ${isDark ? 'border-white/10 hover:bg-white/10' : 'border-black/10 hover:bg-black/5'}`}
                      onClick={() => createReferencedDraftNode('expand', r === '原比例' ? aspectRatio : r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  };
  const renderGeneratedImageToolbarV2 = () => {
    if (!selected || !imageUrl) return null;
    return (
      <div
        className="nodrag nopan absolute left-1/2 z-[180] flex h-11 items-center overflow-visible rounded-2xl border border-zinc-200 bg-white text-zinc-800 shadow-[0_10px_32px_rgba(15,23,42,0.16)]"
        style={{
          top: `${-62 / stableMenuZoom}px`,
          transform: `translateX(-50%) scale(${stableMenuScale})`,
          transformOrigin: 'top center',
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button type="button" className={`${imageToolButtonClass} rounded-l-2xl`} title="快捷编辑" onClick={() => setImageToolMenu((v) => (v === 'same' ? null : 'same'))}>
          <Sparkles size={15} />
          <span>快捷编辑</span>
          <span className="text-[11px] text-zinc-400">Tab</span>
        </button>
        <div className={imageToolDividerClass} />
        <button type="button" className={imageToolButtonClass} title="生成同款草稿" onClick={() => setImageToolMenu((v) => (v === 'same' ? null : 'same'))}>
          <CopyPlus size={14} />
          <span>同款</span>
        </button>
        <button type="button" className={imageToolButtonClass} title="创建扩图草稿" onClick={() => setImageToolMenu((v) => (v === 'expand' ? null : 'expand'))}>
          <Expand size={14} />
          <span>扩图</span>
        </button>
        <button type="button" className={imageToolButtonClass} title="缩小预览" onClick={() => setPreviewZoom(previewZoom - PREVIEW_ZOOM_STEP)}>
          <ZoomOut size={14} />
          <span>缩小</span>
        </button>
        <button type="button" className={imageToolButtonClass} title="重置缩放" onClick={() => setPreviewZoom(1)}>
          <RotateCcw size={14} />
          <span>重置</span>
        </button>
        <button type="button" className={imageToolButtonClass} title="放大预览" onClick={() => setPreviewZoom(previewZoom + PREVIEW_ZOOM_STEP)}>
          <ZoomIn size={14} />
          <span>放大</span>
        </button>
        <div className={imageToolDividerClass} />
        <button type="button" className={imageToolIconButtonClass} title="更多">
          <span className="text-lg leading-none">...</span>
        </button>
        <div className={imageToolDividerClass} />
        <button type="button" className={`${imageToolIconButtonClass} rounded-r-2xl`} title="下载" onClick={() => void downloadAsset(imageUrl, 'image.png')}>
          <Download size={15} />
        </button>
        {imageToolMenu && (
          <div className="absolute left-0 top-12 w-64 rounded-2xl border border-zinc-200 bg-white p-2 text-xs text-zinc-900 shadow-2xl">
            {imageToolMenu === 'same' ? (
              <>
                <div className="px-2 py-1.5 font-semibold">同款生成</div>
                <button
                  type="button"
                  className="mt-1 flex w-full items-center rounded-xl px-3 py-2 text-left hover:bg-zinc-100"
                  onClick={() => createReferencedDraftNode('same')}
                >
                  创建同款草稿
                </button>
                <div className="px-2 py-1 text-[11px] text-zinc-500">
                  只创建带参考图的新节点，不会自动生成或扣费。
                </div>
              </>
            ) : (
              <>
                <div className="px-2 py-1.5 font-semibold">扩图比例</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {['原比例', '1:1', '4:5', '3:4', '4:3', '16:9', '9:16', '3:2', '2:3'].map((r) => (
                    <button
                      key={r}
                      type="button"
                      className="rounded-lg border border-zinc-200 px-2 py-1.5 hover:bg-zinc-100"
                      onClick={() => createReferencedDraftNode('expand', r === '原比例' ? aspectRatio : r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  };
  const renderGeneratedImageToolbarV3 = () => {
    if (!selected || !imageUrl) return null;
    return (
      <>
        <div
          className="imade-image-toolbar nodrag nopan absolute left-1/2 z-[190] flex h-10 items-center gap-1 overflow-visible rounded-full border border-zinc-200/90 bg-white/95 px-1.5 text-zinc-800 shadow-[0_14px_38px_rgba(15,23,42,0.18)] backdrop-blur-xl"
          style={{
            top: `${-58 / stableMenuZoom}px`,
            transform: `translateX(-50%) scale(${stableMenuScale})`,
            transformOrigin: 'top center',
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button type="button" className={imageToolButtonClass} onClick={duplicateAsDraftNode}>
            <CopyPlus size={14} />
            <span>同款</span>
          </button>
          <div className={imageToolDividerClass} />
          <button type="button" className={imageToolIconButtonClass} onClick={() => setPreviewZoom(previewZoom - PREVIEW_ZOOM_STEP)}>
            <ZoomOut size={14} />
          </button>
          <button type="button" className={imageToolIconButtonClass} onClick={() => setPreviewZoom(1)}>
            <RotateCcw size={14} />
          </button>
          <button type="button" className={imageToolIconButtonClass} onClick={() => setPreviewZoom(previewZoom + PREVIEW_ZOOM_STEP)}>
            <ZoomIn size={14} />
          </button>
          <div className={imageToolDividerClass} />
          <button type="button" className={imageToolIconButtonClass} onClick={() => void downloadAsset(imageUrl, generatedImageName || 'image.png')}>
            <Download size={15} />
          </button>
        </div>
        <div
          className="imade-image-meta nodrag nopan pointer-events-none absolute left-1/2 z-[185] max-w-[320px] truncate rounded-full px-2.5 py-1 text-[11px]"
          style={{
            top: `${-15 / stableMenuZoom}px`,
            transform: `translateX(-50%) scale(${stableMenuScale})`,
            transformOrigin: 'top center',
          }}
        >
          {generatedImageMeta}
        </div>
      </>
    );
  };
  const selectNodeBehindMenu = (event: React.PointerEvent | React.MouseEvent) => {
    const menuEl = menuRef.current;
    const stack = document.elementsFromPoint(event.clientX, event.clientY);
    for (const el of stack) {
      if (!(el instanceof HTMLElement)) continue;
      if (menuEl?.contains(el)) continue;
      const nodeEl = el.closest('.react-flow__node') as HTMLElement | null;
      const nodeId = nodeEl?.getAttribute('data-id');
      if (!nodeId || nodeId === id) continue;
      event.preventDefault();
      event.stopPropagation();
      setReferenceMenuOpen(false);
      setSettingsMenuOpen(false);
      setModelMenuOpen(false);
      setKeepMenuAfterReferencePick(false);
      setMenuOpen(false);
      setNodes((nodes) =>
        nodes.map((node) => ({
          ...node,
          selected: node.id === nodeId,
          zIndex: node.id === nodeId
            ? Math.max(...nodes.map((n) => Number(n.zIndex || 0)), 0) + 10
            : node.zIndex,
        })),
      );
      return true;
    }
    return false;
  };

  useEffect(() => {
    if (!menuOpen && !referenceMenuOpen && !settingsMenuOpen && !modelMenuOpen) return;
    const closeFloatingMenus = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) {
        if (!target.closest('[data-popup-keep-open]')) {
          setReferenceMenuOpen(false);
          setSettingsMenuOpen(false);
          setModelMenuOpen(false);
        }
        return;
      }
      if (rootRef.current?.contains(target)) {
        setReferenceMenuOpen(false);
        setSettingsMenuOpen(false);
        setModelMenuOpen(false);
        return;
      }
      if (isPickingReference) {
        setReferenceMenuOpen(false);
        setSettingsMenuOpen(false);
        setModelMenuOpen(false);
        return;
      }
      setReferenceMenuOpen(false);
      setSettingsMenuOpen(false);
      setModelMenuOpen(false);
      setKeepMenuAfterReferencePick(false);
      setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setReferenceMenuOpen(false);
      setSettingsMenuOpen(false);
      setModelMenuOpen(false);
      setKeepMenuAfterReferencePick(false);
      setMenuOpen(false);
    };
    window.addEventListener('mousedown', closeFloatingMenus, true);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('mousedown', closeFloatingMenus, true);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen, referenceMenuOpen, settingsMenuOpen, modelMenuOpen, isPickingReference]);

  if (layerOnly) {
    return (
      <div
        ref={rootRef}
        className="imade-image-layer group relative mt-8 overflow-visible rounded-none bg-transparent"
        onClickCapture={openMenu}
        style={{
          ...imageFrameStyle,
          border: 0,
          borderRadius: 0,
          boxShadow: 'none',
          ...(isAccepting ? { outline: '2px solid #22c55e', boxShadow: '0 0 0 3px rgba(34,197,94,0.25)' } : null),
        }}
        {...dropProps}
      >
        <div className="hidden">
          <div className={`rounded-full border px-2 py-1 text-[10px] shadow-lg backdrop-blur ${
            isDark ? 'border-white/10 bg-zinc-950/88 text-white/65' : 'border-black/10 bg-white/92 text-zinc-600'
          }`}>
            {mediaInfo}
          </div>
          <div className="pointer-events-auto flex items-center gap-1">
            <button type="button" className={mediaActionClass} title="缩小" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPreviewZoom(previewZoom - PREVIEW_ZOOM_STEP); }}><ZoomOut size={13} /></button>
            <button type="button" className={mediaActionClass} title="重置缩放" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPreviewZoom(1); }}><RotateCcw size={13} /></button>
            <button type="button" className={mediaActionClass} title="放大" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPreviewZoom(previewZoom + PREVIEW_ZOOM_STEP); }}><ZoomIn size={13} /></button>
            <button type="button" className={mediaActionClass} title="下载" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); void downloadAsset(imageUrl!, 'image.png'); }}><Download size={13} /></button>
          </div>
        </div>
        <Handle type="target" position={Position.Left} className="!bg-amber-400 !border-0 !opacity-0 !pointer-events-none" style={{ top: '50%' }} />
        <Handle type="source" position={Position.Right} className="!bg-amber-400 !border-0 !opacity-0 !pointer-events-none" style={{ top: '50%' }} />

        <img
          src={imageUrl!}
          alt="Preview"
          className={`block w-full select-none object-contain ${hasTrueImageSize ? 'h-full' : 'h-auto'}`}
          style={{ borderRadius: 0, boxShadow: 'none', transform: `scale(${previewZoom})`, transformOrigin: 'center center' }}
          onLoad={(e) => syncNaturalImageSize(e.currentTarget)}
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          data-drag-source
          data-drag-kind="image"
          data-drag-url={imageUrl}
          data-drag-preview={imageUrl}
          data-drag-node-id={id}
          onClick={(e) =>
            handleCanvasReferenceSourceClick(e, { kind: 'image', url: imageUrl!, sourceNodeId: id, previewUrl: imageUrl! })
          }
          onMouseDown={(e) =>
            beginMaterialDrag(e, { kind: 'image', url: imageUrl!, sourceNodeId: id, previewUrl: imageUrl! })
          }
        />
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="group relative mt-8 rounded-none bg-transparent"
      onClickCapture={openMenu}
      style={{
        ...imageFrameStyle,
        background: 'transparent',
        borderRadius: 0,
        outline: 'none',
        outlineOffset: 0,
        ...(isAccepting ? { boxShadow: '0 0 0 3px rgba(34,197,94,0.25)' } : null),
      }}
      {...dropProps}
    >
      <Handle type="target" position={Position.Left} className={`!bg-amber-400 !border-0 ${handleVisibilityClass}`} style={{ top: '50%' }} />
      <Handle type="source" position={Position.Right} className={`!bg-amber-400 !border-0 ${handleVisibilityClass}`} style={{ top: '50%' }} />

      {renderGeneratedImageToolbarV3()}

      <div className={`pointer-events-none absolute -top-8 left-0 right-0 z-20 flex items-center justify-between transition-opacity ${
        selected && !imageUrl ? 'opacity-100' : 'opacity-0'
      }`}>
        <div className={`rounded-full border px-2 py-1 text-[10px] shadow-lg backdrop-blur ${
          isDark ? 'border-white/10 bg-zinc-950/88 text-white/65' : 'border-black/10 bg-white/92 text-zinc-600'
        }`}>
          {mediaInfo}
        </div>
        {imageUrl && !selected && (
          <div className="pointer-events-auto flex items-center gap-1">
            <button type="button" className={mediaActionClass} title="缩小" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPreviewZoom(previewZoom - PREVIEW_ZOOM_STEP); }}><ZoomOut size={13} /></button>
            <button type="button" className={mediaActionClass} title="重置缩放" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPreviewZoom(1); }}><RotateCcw size={13} /></button>
            <button type="button" className={mediaActionClass} title="放大" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setPreviewZoom(previewZoom + PREVIEW_ZOOM_STEP); }}><ZoomIn size={13} /></button>
            <button type="button" className={mediaActionClass} title="下载" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); void downloadAsset(imageUrl, 'image.png'); }}><Download size={13} /></button>
          </div>
        )}
      </div>

      <div
        className={`block w-full overflow-hidden text-left transition-colors ${
          imageUrl
            ? 'bg-transparent text-inherit shadow-none'
            : isDark
              ? 'bg-white/20 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),0_10px_24px_rgba(0,0,0,0.18)]'
              : 'bg-white/20 text-zinc-900 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08),0_6px_18px_rgba(0,0,0,0.08)]'
        }`}
        style={imageBodyStyle}
        
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt="Preview"
            className="h-full w-full select-none object-contain"
            style={{ borderRadius: 0, transform: `scale(${previewZoom})`, transformOrigin: 'center center' }}
            onLoad={(e) => syncNaturalImageSize(e.currentTarget)}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            data-drag-source
            data-drag-kind="image"
            data-drag-url={imageUrl}
            data-drag-preview={imageUrl}
            data-drag-node-id={id}
            onClick={(e) =>
              handleCanvasReferenceSourceClick(e, { kind: 'image', url: imageUrl, sourceNodeId: id, previewUrl: imageUrl })
            }
            onMouseDown={(e) =>
              beginMaterialDrag(e, { kind: 'image', url: imageUrl, sourceNodeId: id, previewUrl: imageUrl })
            }
          />
        ) : (
          <div className={`flex h-full w-full flex-col items-center justify-center ${
            isDark ? 'text-white/78' : 'text-zinc-600'
          }`}>
            {isGenerating ? (
              <Loader2 size={22} className="animate-spin text-amber-300" />
            ) : (
              <ImageIcon size={24} className={isDark ? 'text-amber-200' : 'text-amber-600'} />
            )}
            <span className="mt-2 text-xs font-medium">Image</span>
          </div>
        )}
      </div>

      {showMenu && (
        <div
          ref={menuRef}
          className={`imade-media-menu absolute z-50 w-[520px] rounded-[24px] border shadow-2xl nodrag nopan nowheel ${
            isDark ? 'border-white/12 bg-[#242424] text-white' : 'border-black/10 bg-white text-zinc-900'
          }`}
          data-theme={isDark ? 'dark' : 'light'}
          style={{
            left: '50%',
            top: `calc(100% + ${stableMenuOffset}px)`,
            transform: `translateX(-50%) scale(${stableMenuScale})`,
            transformOrigin: 'top center',
            boxShadow: isDark
              ? '0 24px 80px rgba(0,0,0,.48), inset 0 1px 0 rgba(255,255,255,.06)'
              : '0 24px 70px rgba(22,24,30,.16), inset 0 1px 0 rgba(255,255,255,.9)',
          }}
          onPointerDownCapture={(e) => {
            keepMenuInteraction(e, true);
          }}
          onMouseDownCapture={(e) => {
            keepMenuInteraction(e, true);
          }}
          onClickCapture={(e) => {
            keepMenuInteraction(e, false);
          }}
          onMouseDown={(e) => {
            keepMenuInteraction(e);
            const target = e.target as HTMLElement;
            if (!target.closest('[data-popup-keep-open]')) {
              setReferenceMenuOpen(false);
              setSettingsMenuOpen(false);
              setModelMenuOpen(false);
            }
          }}
          onClick={(e) => {
            keepMenuInteraction(e);
          }}
        >
          <div className="relative p-3">
            {modelDef.supportsReference && (
              <div className="mb-3 flex items-center gap-2">
                {orderedImages.slice(0, maxRefs).map((m) => (
                  <div
                    key={m.id}
                    className={`imade-ref-thumb relative h-14 w-14 overflow-visible rounded-2xl border ${
                      isDark ? 'border-white/10 bg-white/6' : 'border-black/8 bg-zinc-100'
                    }`}
                    title={m.label || '参考图'}
                  >
                    <img src={m.url} alt={m.label || '参考图'} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveMaterial(m);
                      }}
                      className="imade-ref-remove absolute -right-1 -top-1 z-[120] flex h-5 w-5 items-center justify-center rounded-full bg-white text-zinc-700 opacity-0 shadow-lg ring-1 ring-black/10 transition hover:bg-red-500 hover:text-white"
                      title={m.origin === 'local' ? '移除参考图' : '断开参考图连线'}
                    >
                      <X size={12} strokeWidth={2.2} />
                    </button>
                  </div>
                ))}
                {orderedImages.length < maxRefs && (
                  <div className="relative h-14 w-14" data-popup-keep-open>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setReferenceMenuOpen((v) => !v);
                        setSettingsMenuOpen(false);
                        setModelMenuOpen(false);
                      }}
                      className={`flex h-14 w-14 flex-col items-center justify-center rounded-2xl text-[11px] transition ${
                        isDark
                          ? 'bg-white/7 text-white/55 hover:bg-white/12 hover:text-white/80'
                          : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800'
                      }`}
                      title="添加参考图"
                    >
                      <ImageIcon size={15} />
                      <span className="mt-1">参考图</span>
                    </button>

                    {referenceMenuOpen && (
                      <div
                        className={`absolute bottom-full left-0 z-[80] mb-2 w-40 rounded-2xl border p-1 text-[12px] shadow-xl ${
                          isDark ? 'border-white/10 bg-[#1f1f1f] text-white' : 'border-black/10 bg-white text-zinc-800'
                        }`}
                      >
                        <button
                          type="button"
                          className={`flex w-full items-center rounded-xl px-3 py-2 text-left ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setReferenceMenuOpen(false);
                            handlePickFile();
                          }}
                        >
                          本地上传
                        </button>
                        <button
                          type="button"
                          className={`flex w-full items-center rounded-xl px-3 py-2 text-left ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartCanvasReferencePick();
                          }}
                        >
                          画布选择
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {isPickingReference && (
              <div className={`mb-3 rounded-2xl border px-3 py-2 text-xs ${
                isDark ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100' : 'border-emerald-500/25 bg-emerald-50 text-emerald-700'
              }`}>
                请点击画布上的图片作为参考图
              </div>
            )}

            <textarea
              value={localPrompt}
              onChange={(e) => update({ prompt: e.target.value })}
              placeholder="今天我们要创作什么"
              className={`h-24 w-full resize-none rounded-2xl border-0 bg-transparent px-1 py-1 text-sm leading-6 outline-none ${
                isDark ? 'text-white placeholder:text-white/35' : 'text-zinc-900 placeholder:text-zinc-400'
              }`}
            />

            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="relative flex items-center gap-2">
                <button
                  type="button"
                  data-popup-keep-open
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSettingsMenuOpen((v) => !v);
                    setModelMenuOpen(false);
                    setReferenceMenuOpen(false);
                  }}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs transition ${
                    isDark ? 'bg-white/8 text-white/80 hover:bg-white/13' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                  }`}
                >
                  <span>{falQuality === 'high' ? '高' : falQuality === 'low' ? '低' : falQuality === 'auto' ? '自动' : '中'}</span>
                  <span>·</span>
                  <span>{settingsAspectLabel}</span>
                  <span>·</span>
                  <span>{falN || 1} 张</span>
                  <ChevronDown size={13} className={settingsMenuOpen ? 'rotate-180 transition' : 'transition'} />
                </button>

                {settingsMenuOpen && (
                  <div
                    data-popup-keep-open
                    className={`absolute bottom-10 left-0 z-[90] max-h-[70vh] w-[318px] overflow-y-auto rounded-3xl border p-4 text-xs shadow-2xl ${
                      isDark ? 'border-white/10 bg-[#1f1f1f] text-white' : 'border-black/10 bg-white text-zinc-900'
                    }`}
                  >
                    <div className="mb-3 text-sm font-semibold">图像设置</div>
                    <div className={`mb-2 text-xs ${isDark ? 'text-white/62' : 'text-zinc-600'}`}>质量</div>
                    <div className="mb-4 grid grid-cols-4 gap-2">
                      {[
                        ['auto', '自动'],
                        ['high', '高'],
                        ['medium', '中'],
                        ['low', '低'],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => update({ falQuality: value })}
                          className={`h-8 rounded-full border text-xs ${
                            falQuality === value
                              ? isDark ? 'border-white/70 bg-white/14 text-white' : 'border-zinc-950 bg-zinc-950 text-white'
                              : isDark ? 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10' : 'border-black/10 bg-white text-zinc-700 hover:bg-zinc-50'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {!isMj && (
                      <>
                        <div className={`mb-2 text-xs ${isDark ? 'text-white/62' : 'text-zinc-600'}`}>生成数量</div>
                        <div className="mb-4 grid grid-cols-5 gap-2">
                          {GENERATION_COUNT_OPTIONS.map((count) => (
                            <button
                              key={count}
                              type="button"
                              onClick={() => update({ falN: count })}
                              className={`h-8 rounded-full border text-xs ${
                                falN === count
                                  ? isDark ? 'border-white/70 bg-white/14 text-white' : 'border-zinc-950 bg-zinc-950 text-white'
                                  : isDark ? 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10' : 'border-black/10 bg-white text-zinc-700 hover:bg-zinc-50'
                              }`}
                            >
                              {count}张
                            </button>
                          ))}
                        </div>
                      </>
                    )}

                    {!isMj && showGptSizeControls && (
                      <>
                        <div className={`mb-2 text-xs ${isDark ? 'text-white/62' : 'text-zinc-600'}`}>尺寸</div>
                        <div className="mb-4 grid grid-cols-3 gap-2">
                          {modelDef.sizes.map((s) => {
                            const blocked = isBlockedGpt4kSizeOption(s);
                            return (
                              <button
                                key={s}
                                type="button"
                                disabled={blocked}
                                title={blocked ? gpt4kEditMessage : s}
                                onClick={() => {
                                  if (!blocked) update({ sizeLevel: s });
                                }}
                                className={`h-9 rounded-xl border text-xs ${
                                  blocked
                                    ? isDark ? 'cursor-not-allowed border-white/6 bg-white/[0.03] text-white/25' : 'cursor-not-allowed border-black/5 bg-zinc-50 text-zinc-300'
                                    : sizeLevel === s
                                      ? isDark ? 'border-white/70 bg-white/14 text-white' : 'border-zinc-950 bg-zinc-950 text-white'
                                      : isDark ? 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10' : 'border-black/10 bg-white text-zinc-700 hover:bg-zinc-50'
                                }`}
                              >
                                {s}
                              </button>
                            );
                          })}
                        </div>
                        {blockedByGpt4kEdit && (
                          <div className={isDark ? 'mb-3 rounded-xl border border-amber-300/15 bg-amber-300/10 px-3 py-2 text-[11px] text-amber-100' : 'mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800'}>
                            {gpt4kEditMessage}
                          </div>
                        )}
                      </>
                    )}

                    <div className={`mb-2 text-xs ${isDark ? 'text-white/62' : 'text-zinc-600'}`}>宽高比</div>
                    <div className="grid grid-cols-4 gap-2">
                      {(isMj ? MJ_RATIOS : isFal && falKind === 'nbpro-fal' ? NBPRO_FAL_RATIOS : modelDef.aspectRatios).map((r) => {
                        const active = isMj ? mjAr === r : isFal && falKind === 'nbpro-fal' ? nbAspect === r : aspectRatio === r;
                        const gptPixelLabel = !isMj && isGptImageSizeKind(modelDef.paramKind) ? getGptImagePixelSize(r, sizeLevel) : '';
                        return (
                          <button
                            key={r}
                            type="button"
                            onClick={() => {
                              if (isMj) update({ mjAr: r });
                              else if (isFal && falKind === 'nbpro-fal') update({ nbAspect: r });
                              else update({ aspectRatio: r });
                            }}
                            className={`flex h-12 flex-col items-center justify-center rounded-xl border text-xs ${
                              active
                                ? isDark ? 'border-white/70 bg-white/14 text-white' : 'border-zinc-950 bg-zinc-950 text-white'
                                : isDark ? 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10' : 'border-black/10 bg-white text-zinc-700 hover:bg-zinc-50'
                          }`}
                        >
                          <span>{r}</span>
                          {gptPixelLabel && <span className={isDark ? 'mt-0.5 text-[9px] text-white/45' : 'mt-0.5 text-[9px] text-zinc-500'}>{gptPixelLabel}</span>}
                        </button>
                      );
                    })}
                    </div>
                  </div>
                )}
              </div>

              <div className="relative ml-auto flex items-center gap-2">
                <button
                  type="button"
                  data-popup-keep-open
                  onClick={(e) => {
                    e.stopPropagation();
                    setModelMenuOpen((v) => !v);
                    setSettingsMenuOpen(false);
                    setReferenceMenuOpen(false);
                  }}
                  className={`inline-flex h-8 max-w-[170px] items-center gap-1.5 rounded-full px-3 text-xs transition ${
                    isDark ? 'bg-white/8 text-white/80 hover:bg-white/13' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                  }`}
                  title={selectedModelOptionLabel}
                >
                  <Sparkles size={13} />
                  <span className="truncate">{selectedModelOptionLabel}</span>
                  <ChevronDown size={13} className={modelMenuOpen ? 'rotate-180 transition' : 'transition'} />
                </button>

                {modelMenuOpen && (
                  <div
                    data-popup-keep-open
                    className={`absolute bottom-10 right-0 z-[90] w-52 rounded-2xl border p-1.5 text-xs shadow-2xl ${
                      isDark ? 'border-white/10 bg-[#1f1f1f] text-white' : 'border-black/10 bg-white text-zinc-900'
                    }`}
                  >
                    {availableImageModelOptions.map((item) => {
                      const active = item.modelId === model && normalizeImageApiModel(item.apiModel) === apiModel;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            switchModel(item.modelId, item.apiModel);
                            setModelMenuOpen(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition ${
                            active
                              ? isDark ? 'bg-white/12 text-white' : 'bg-zinc-100 text-zinc-950'
                              : isDark ? 'text-white/72 hover:bg-white/8 hover:text-white' : 'text-zinc-700 hover:bg-zinc-50'
                          }`}
                          title={item.description}
                        >
                          <span className="truncate">{item.label}</span>
                          {active && <span className={isDark ? 'text-white/45' : 'text-zinc-400'}>✓</span>}
                        </button>
                      );
                    })}
                    {!availableImageModelOptions.length && (
                      <div className={isDark ? 'px-3 py-3 text-white/45' : 'px-3 py-3 text-zinc-500'}>
                        请先在设置中填写图像模型 API Key
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generateDisabled}
                  className={`inline-flex h-8 min-w-12 items-center justify-center gap-1 rounded-full px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    isDark ? 'bg-[#f3f0e8] text-black shadow-[0_1px_0_rgba(255,255,255,.35)_inset] hover:bg-white' : 'bg-zinc-950 text-white hover:bg-zinc-800'
                  }`}
                  style={{
                    background: isDark ? '#f3f0e8' : '#111111',
                    color: isDark ? '#09090b' : '#ffffff',
                    border: isDark ? '1px solid rgba(255,255,255,.28)' : '1px solid rgba(0,0,0,.18)',
                    boxShadow: isDark
                      ? '0 1px 0 rgba(255,255,255,.38) inset, 0 8px 22px rgba(0,0,0,.22)'
                      : '0 8px 20px rgba(0,0,0,.16)',
                  }}
                  title={generationLocked ? '当前节点已有生成结果' : '生成'}
                >
                  {isGenerating && !generationLocked ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  <span>{generateButtonLabel}</span>
                </button>
              </div>
            </div>

            {error && (
              <div className={`mt-3 flex items-start gap-1 rounded-2xl border px-3 py-2 text-xs ${
                isDark ? 'border-red-300/20 bg-red-400/10 text-red-200' : 'border-red-200 bg-red-50 text-red-700'
              }`}>
                <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                <span className="break-all">{error}</span>
              </div>
            )}

            <input
              ref={mainFileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFiles}
              className="hidden"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleMjFiles}
              className="hidden"
            />
          </div>
        </div>
      )}

      {false && selected && menuOpen && (
        <div
          className={`imade-media-menu absolute top-[calc(100%+10px)] z-50 w-[360px] rounded-2xl border shadow-2xl nodrag nowheel ${
            isDark ? 'border-white/10 bg-zinc-950/96 text-white' : 'border-black/10 bg-white/98 text-zinc-900'
          }`}
          data-theme={isDark ? 'dark' : 'light'}
          style={{
            backdropFilter: 'blur(18px)',
            left: '50%',
            top: `calc(100% + ${stableMenuOffset}px)`,
            transform: `translateX(-50%) scale(${stableMenuScale})`,
            transformOrigin: 'top center',
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >

      {/* 头部 */}
      <div className={`flex items-center gap-2 border-b px-3 py-2 ${isDark ? 'border-white/10' : 'border-black/10'}`}>
        <div
          className="hidden"
          style={{ background: 'rgba(245,158,11,.2)', color: '#fcd34d', boxShadow: 'inset 0 0 0 1px rgba(245,158,11,.45)' }}
        >
          <ImageIcon size={13} />
        </div>
        <div className="flex-1">
          <div className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-zinc-900'}`}>图像</div>
          <div className={isDark ? 'text-[10px] text-white/40' : 'text-[10px] text-zinc-500'}>{modelDef.label} · {modelDef.description}</div>
        </div>
        {imageUrl && (
          <button
            type="button"
            className={`rounded-md border px-2 py-1 text-[11px] ${
              isDark ? 'border-white/10 bg-white/5 text-white/75 hover:bg-white/10' : 'border-black/10 bg-black/[0.03] text-zinc-700 hover:bg-black/[0.06]'
            }`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); void downloadAsset(imageUrl!, 'image.png'); }}
          >下载</button>
        )}
      </div>

      {/* 配置区 */}
      <div className="p-2.5 space-y-2 max-h-[70vh] overflow-y-auto" onMouseDown={(e) => e.stopPropagation()}>
        {/* 模型 TAB 切换(对应主项目 gpt-image-2-web Tab 0/1/2) */}
        <div>
          <label className="text-[10px] text-white/50 block mb-1">模型</label>
          <div
            className={`flex gap-0.5 p-0.5 rounded ${isPixel ? '' : 'bg-white/5'}`}
            style={isPixel ? { background: 'var(--px-muted)', border: '1.5px solid var(--px-ink)' } : undefined}
          >
            {IMAGE_MODELS.map((m) => {
              const isActive = m.id === model;
              return (
                <button
                  key={m.id}
                  onClick={() => switchModel(m.id)}
                  title={m.description}
                  className={`flex-1 py-1 text-[10px] font-semibold rounded transition-all ${
                    isActive ? 'bg-amber-500/30 text-amber-200' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                  style={
                    isPixel && isActive
                      ? { background: 'var(--px-yellow)', color: 'var(--px-ink)', border: '1.5px solid var(--px-ink)', boxShadow: '1px 1px 0 var(--px-ink)' }
                      : isPixel ? { color: 'var(--px-ink-soft)' } : undefined
                  }
                >
                  {m.tabLabel}
                </button>
              );
            })}
          </div>
        </div>

        {/* 子模型选择(对齐主项目 Tab 内的 model 下拉) - MJ 模式隐藏(用下面专属版本选择) */}
        {!isMj && (
          <div>
            <label className="text-[10px] text-white/50 block mb-1">具体模型</label>
            <select
              value={apiModel}
              onChange={(e) => update({ apiModel: e.target.value })}
              style={{ background: '#18181b', color: '#ffffff' }}
              className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
            >
              {modelDef.apiModelOptions.map((opt) => (
                <option key={opt.value} value={opt.value} style={{ background: '#18181b', color: '#ffffff' }}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* 比例 + 尺寸 并排(非 FAL 且非 MJ 模型) */}
        {showGptSizeControls && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-white/50 block mb-1">比例</label>
              <select
                value={aspectRatio}
                onChange={(e) => update({ aspectRatio: e.target.value })}
                style={{ background: '#18181b', color: '#ffffff' }}
                className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
              >
                {modelDef.aspectRatios.map((r) => (
                  <option key={r} value={r} style={{ background: '#18181b', color: '#ffffff' }}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-white/50 block mb-1">尺寸</label>
              <select
                value={sizeLevel}
                onChange={(e) => update({ sizeLevel: e.target.value })}
                style={{ background: '#18181b', color: '#ffffff' }}
                className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
              >
                {modelDef.sizes.map((s) => (
                  <option key={s} value={s} style={{ background: '#18181b', color: '#ffffff' }}>{s}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* ========== FAL 专属参数面板(完全对齐 gpt-image-2-web gf_panel / nano_fal_panel) ========== */}
        {showAdvancedImageOptions && isFal && falKind === 'gpt-fal' && (
          <div className="space-y-2 rounded border border-blue-400/30 bg-blue-500/5 p-2">
            <div className="text-[10px] text-blue-300 font-semibold tracking-wide">
              💡 FAL Queue API · openai/gpt-image-2
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">Mode</label>
                <select
                  value={falMode}
                  onChange={(e) => update({ falMode: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  <option value="edit" style={{ background: '#18181b', color: '#ffffff' }}>Edit</option>
                  <option value="gen" style={{ background: '#18181b', color: '#ffffff' }}>Generate</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">Size Override</label>
                <select
                  value={falSize}
                  onChange={(e) => update({ falSize: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  {GPT_FAL_SIZES.filter((s) => s.value === 'auto' || s.value === 'custom').map((s) => (
                    <option key={s.value} value={s.value} style={{ background: '#18181b', color: '#ffffff' }}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>
            {falSize === 'custom' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">Width (≈1 6倍)</label>
                  <input
                    type="number" min={256} max={3840} step={16}
                    value={falCustomW}
                    onChange={(e) => update({ falCustomW: parseInt(e.target.value) || 0 })}
                    style={{ background: '#18181b', color: '#ffffff' }}
                    className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-white/50 block mb-1">Height (≈1 6倍)</label>
                  <input
                    type="number" min={256} max={3840} step={16}
                    value={falCustomH}
                    onChange={(e) => update({ falCustomH: parseInt(e.target.value) || 0 })}
                    style={{ background: '#18181b', color: '#ffffff' }}
                    className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                  />
                </div>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">Quality</label>
                <select
                  value={falQuality}
                  onChange={(e) => update({ falQuality: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  <option value="low" style={{ background: '#18181b', color: '#ffffff' }}>Low</option>
                  <option value="medium" style={{ background: '#18181b', color: '#ffffff' }}>Medium</option>
                  <option value="high" style={{ background: '#18181b', color: '#ffffff' }}>High</option>
                  <option value="auto" style={{ background: '#18181b', color: '#ffffff' }}>Auto</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">N</label>
                <input
                  type="number" min={1} max={4}
                  value={falN}
                  onChange={(e) => update({ falN: Math.max(1, Math.min(4, parseInt(e.target.value) || 1)) })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">Format</label>
                <select
                  value={falFormat}
                  onChange={(e) => update({ falFormat: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  <option value="png" style={{ background: '#18181b', color: '#ffffff' }}>PNG</option>
                  <option value="jpeg" style={{ background: '#18181b', color: '#ffffff' }}>JPEG</option>
                  <option value="webp" style={{ background: '#18181b', color: '#ffffff' }}>WebP</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-1.5 text-[10px] text-white/60">
              <input
                type="checkbox"
                checked={falSync}
                onChange={(e) => update({ falSync: e.target.checked })}
              />
              <span>同步模式 (sync_mode: 适合快速返回场景)</span>
            </label>
          </div>
        )}

        {showAdvancedImageOptions && isFal && falKind === 'nbpro-fal' && (
          <div className="space-y-2 rounded border border-blue-400/30 bg-blue-500/5 p-2">
            <div className="text-[10px] text-blue-300 font-semibold tracking-wide">
              💡 FAL Queue API · fal-ai/nano-banana-pro/edit (需参考图)
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">N</label>
                <input
                  type="number" min={1} max={4}
                  value={falN}
                  onChange={(e) => update({ falN: Math.max(1, Math.min(4, parseInt(e.target.value) || 1)) })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">Aspect</label>
                <select
                  value={nbAspect}
                  onChange={(e) => update({ nbAspect: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  {NBPRO_FAL_RATIOS.map((r) => (
                    <option key={r} value={r} style={{ background: '#18181b', color: '#ffffff' }}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">Resolution</label>
                <select
                  value={nbResolution}
                  onChange={(e) => update({ nbResolution: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  {NBPRO_FAL_RESOLUTIONS.map((r) => (
                    <option key={r} value={r} style={{ background: '#18181b', color: '#ffffff' }}>{r}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">Format</label>
                <select
                  value={falFormat}
                  onChange={(e) => update({ falFormat: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  <option value="png" style={{ background: '#18181b', color: '#ffffff' }}>PNG</option>
                  <option value="jpeg" style={{ background: '#18181b', color: '#ffffff' }}>JPEG</option>
                  <option value="webp" style={{ background: '#18181b', color: '#ffffff' }}>WebP</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">Safety</label>
                <select
                  value={nbSafety}
                  onChange={(e) => update({ nbSafety: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  <option value="1" style={{ background: '#18181b', color: '#ffffff' }}>1 (严)</option>
                  <option value="2" style={{ background: '#18181b', color: '#ffffff' }}>2</option>
                  <option value="3" style={{ background: '#18181b', color: '#ffffff' }}>3</option>
                  <option value="4" style={{ background: '#18181b', color: '#ffffff' }}>4</option>
                  <option value="5" style={{ background: '#18181b', color: '#ffffff' }}>5</option>
                  <option value="6" style={{ background: '#18181b', color: '#ffffff' }}>6 (松)</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">ImgMode</label>
                <select
                  value={nbImgMode}
                  onChange={(e) => update({ nbImgMode: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  <option value="image_url" style={{ background: '#18181b', color: '#ffffff' }}>URL</option>
                  <option value="base64" style={{ background: '#18181b', color: '#ffffff' }}>Base64</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">Seed (0=不传)</label>
                <input
                  type="number" min={0}
                  value={nbSeed}
                  onChange={(e) => update({ nbSeed: Math.max(0, parseInt(e.target.value) || 0) })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                />
              </div>
              <label className="flex items-center gap-1.5 text-[10px] text-white/60 mt-4">
                <input
                  type="checkbox"
                  checked={nbWebSearch}
                  onChange={(e) => update({ nbWebSearch: e.target.checked })}
                />
                <span>Web Search</span>
              </label>
            </div>
            <div>
              <label className="text-[10px] text-white/50 block mb-1">System Prompt (可选)</label>
              <input
                type="text"
                value={nbSysPrompt}
                onChange={(e) => update({ nbSysPrompt: e.target.value })}
                placeholder="可选系统指令"
                style={{ background: '#18181b', color: '#ffffff' }}
                className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
              />
            </div>
          </div>
        )}

        {/* ========== MJ 专属参数面板(完全对齐 gpt-image-2-web mj_* 控件 L1552~L1580) ========== */}
        {showAdvancedImageOptions && isMj && (
          <div className="space-y-2 rounded border border-purple-400/30 bg-purple-500/5 p-2">
            <div className="text-[10px] text-purple-300 font-semibold tracking-wide">
              ✨ Midjourney · Comfly 渠道(严格对齐主项目 runMJ)
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">版本</label>
                <select
                  value={mjVersion}
                  onChange={(e) => update({ mjVersion: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  {MJ_VERSIONS.map((m) => (
                    <option key={m.value} value={m.value} style={{ background: '#18181b', color: '#ffffff' }}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">比例</label>
                <select
                  value={mjAr}
                  onChange={(e) => update({ mjAr: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  {MJ_RATIOS.map((r) => (
                    <option key={r} value={r} style={{ background: '#18181b', color: '#ffffff' }}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">速度</label>
                <select
                  value={mjSpeed}
                  onChange={(e) => update({ mjSpeed: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  {MJ_SPEEDS.map((s) => (
                    <option key={s.value} value={s.value} style={{ background: '#18181b', color: '#ffffff' }}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1" title="chaos 0~100">--c</label>
                <input
                  type="number" min={0} max={100}
                  value={mjC}
                  onChange={(e) => update({ mjC: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1" title="stylize 0~1000">--s</label>
                <input
                  type="number" min={0} max={1000}
                  value={mjS}
                  onChange={(e) => update({ mjS: Math.max(0, Math.min(1000, parseInt(e.target.value) || 0)) })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1" title="image weight 0~3">--iw</label>
                <input
                  type="number" min={0} max={3} step={0.25}
                  value={mjIw}
                  onChange={(e) => update({ mjIw: Math.max(0, Math.min(3, parseFloat(e.target.value) || 0)) })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1" title="style ref weight 0~1000">--sw</label>
                <input
                  type="number" min={0} max={1000}
                  value={mjSw}
                  onChange={(e) => update({ mjSw: Math.max(0, Math.min(1000, parseInt(e.target.value) || 0)) })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">--sv</label>
                <select
                  value={mjSv}
                  onChange={(e) => update({ mjSv: e.target.value })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                >
                  {MJ_SVS.map((o) => (
                    <option key={o.value} value={o.value} style={{ background: '#18181b', color: '#ffffff' }}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1" title="seed 0=不传">seed</label>
                <input
                  type="number" min={0}
                  value={mjSeed}
                  onChange={(e) => update({ mjSeed: Math.max(0, parseInt(e.target.value) || 0) })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1" title="排除词">--no</label>
                <input
                  type="text"
                  value={mjNo}
                  onChange={(e) => update({ mjNo: e.target.value })}
                  placeholder="text, blurry"
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1" title="轮询最大次数">maxPoll</label>
                <input
                  type="number" min={10} max={2000}
                  value={mjMaxPoll}
                  onChange={(e) => update({ mjMaxPoll: Math.max(10, Math.min(2000, parseInt(e.target.value) || 300)) })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                />
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1" title="轮询间隔(s)">pollInt(s)</label>
                <input
                  type="number" min={1} max={30}
                  value={mjPollInt}
                  onChange={(e) => update({ mjPollInt: Math.max(1, Math.min(30, parseInt(e.target.value) || 3)) })}
                  style={{ background: '#18181b', color: '#ffffff' }}
                  className="w-full rounded border border-white/10 px-2 py-1 text-xs outline-none focus:border-white/30"
                />
              </div>
            </div>
            {/* sref 风格参考图 */}
            <div>
              <label className="text-[10px] text-white/50 block mb-1">--sref 风格参考 · {mjSrefImages.length}/{MJ_REF_MAX}</label>
              <div className="flex flex-wrap gap-1.5">
                {mjSrefImages.map((url, i) => (
                  <div key={i} className="relative w-12 h-12 rounded overflow-hidden border border-purple-300/30">
                    <img src={url} alt={`sref-${i}`} className="w-full h-full object-cover" />
                    <button
                      onClick={() => removeMjRef('sref', i)}
                      className="absolute top-0 right-0 w-4 h-4 bg-red-500/80 hover:bg-red-500 flex items-center justify-center rounded-bl"
                      title="移除"
                    >
                      <X size={9} className="text-white" />
                    </button>
                  </div>
                ))}
                {mjSrefImages.length < MJ_REF_MAX && (
                  <button
                    onClick={() => handleMjPick('sref')}
                    className="w-12 h-12 rounded border-2 border-dashed border-purple-300/30 hover:border-purple-300/60 flex items-center justify-center text-purple-300/60 hover:text-purple-300 transition-colors"
                    title="上传 sref 风格参考图"
                  >
                    <Plus size={14} />
                  </button>
                )}
              </div>
            </div>
            {/* oref 角色参考图 */}
            <div>
              <label className="text-[10px] text-white/50 block mb-1">--oref 角色参考 · {mjOrefImages.length}/{MJ_REF_MAX}</label>
              <div className="flex flex-wrap gap-1.5">
                {mjOrefImages.map((url, i) => (
                  <div key={i} className="relative w-12 h-12 rounded overflow-hidden border border-purple-300/30">
                    <img src={url} alt={`oref-${i}`} className="w-full h-full object-cover" />
                    <button
                      onClick={() => removeMjRef('oref', i)}
                      className="absolute top-0 right-0 w-4 h-4 bg-red-500/80 hover:bg-red-500 flex items-center justify-center rounded-bl"
                      title="移除"
                    >
                      <X size={9} className="text-white" />
                    </button>
                  </div>
                ))}
                {mjOrefImages.length < MJ_REF_MAX && (
                  <button
                    onClick={() => handleMjPick('oref')}
                    className="w-12 h-12 rounded border-2 border-dashed border-purple-300/30 hover:border-purple-300/60 flex items-center justify-center text-purple-300/60 hover:text-purple-300 transition-colors"
                    title="上传 oref 角色参考图"
                  >
                    <Plus size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 简化参考图区域 */}
        {modelDef.supportsReference && (
          <div className="relative rounded-lg border border-white/10 bg-white/5 p-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-white/50">参考图 {orderedImages.length}/{maxRefs}</span>
              {refImages.length < maxRefs && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setReferenceMenuOpen((v) => !v);
                  }}
                  className="text-[10px] px-2 py-1 rounded border border-white/10 text-white/70 hover:bg-white/10"
                >
                  上传
                </button>
              )}
            </div>
            {referenceMenuOpen && (
              <div className="absolute right-2 top-9 z-[80] w-36 rounded-lg border border-white/10 bg-zinc-950/95 p-1 text-[11px] text-white shadow-xl">
                <button
                  type="button"
                  className="flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-white/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    setReferenceMenuOpen(false);
                    handlePickFile();
                  }}
                >
                  从本地上传图片
                </button>
                <button
                  type="button"
                  className="flex w-full items-center rounded-md px-2 py-1.5 text-left hover:bg-white/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStartCanvasReferencePick();
                  }}
                >
                  从画布选择
                </button>
              </div>
            )}
            {isPickingReference && (
              <div className="mb-2 rounded-md border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-[10px] text-emerald-200">
                请点击画布上的图片作为参考图
              </div>
            )}
            {orderedImages.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {orderedImages.slice(0, maxRefs).map((m) => (
                  <div key={m.id} className="imade-ref-thumb relative w-12 h-12 rounded-md overflow-visible border border-white/10 bg-black/20">
                    <img src={m.url} alt={m.label || '参考图'} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveMaterial(m);
                      }}
                      className="imade-ref-remove absolute -right-1 -top-1 z-[120] flex h-5 w-5 items-center justify-center rounded-full bg-white text-zinc-700 opacity-0 shadow-lg ring-1 ring-black/10 transition hover:bg-red-500 hover:text-white"
                      title={m.origin === 'local' ? '移除参考图' : '断开参考图连线'}
                    >
                      <X size={12} strokeWidth={2.4} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setReferenceMenuOpen((v) => !v);
                }}
                className="w-full h-12 rounded-md border border-dashed border-white/15 text-[11px] text-white/35 hover:text-white/70 hover:border-white/30"
              >
                添加参考图
              </button>
            )}
          </div>
        )}
        {/* 隐藏的主参考图上传 input - 走 mainFileInputRef + handleFiles */}
        <input
          ref={mainFileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFiles}
          className="hidden"
        />
        {/* 隐藏的 MJ sref/oref 上传 input - 走 fileInputRef + handleMjFiles */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleMjFiles}
          className="hidden"
        />

        {/* 本地 prompt(优先取上游) */}
        <div>
          <label className="text-[10px] text-white/50 block mb-1">本地 Prompt(可选,优先取上游 text)</label>
          <textarea
            value={localPrompt}
            onChange={(e) => update({ prompt: e.target.value })}
            placeholder="备用:无上游连接时使用此提示词"
            className="w-full h-14 resize-none rounded bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-white outline-none focus:border-white/30 placeholder:text-white/30"
          />
        </div>

        {/* 生成按钮(包含异步进度) */}
        <button
          onClick={handleGenerate}
          disabled={generateDisabled}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
        >
          {generationLocked ? (
            <>
              <Sparkles size={12} /> {generateButtonLabel}
            </>
          ) : isGenerating ? (
            <>
              <Loader2 size={12} className="animate-spin" /> 生成中
            </>
          ) : (
            <>
              <Sparkles size={12} /> 生成
            </>
          )}
        </button>

        {error && (
          <div className="flex items-start gap-1 text-[10px] text-red-300 bg-red-500/10 border border-red-500/20 rounded px-2 py-1">
            <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}
      </div>
        </div>
      )}

      {false && imageUrl && !hasAutoOutput && (
        <div className="border-t border-white/10 p-2">
          <img
            src={imageUrl}
            alt="生成结果"
            className="w-full rounded object-cover"
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            data-drag-source
            data-drag-kind="image"
            data-drag-url={imageUrl}
            data-drag-preview={imageUrl}
            data-drag-node-id={id}
            onClick={(e) =>
              handleCanvasReferenceSourceClick(e, { kind: 'image', url: imageUrl, sourceNodeId: id, previewUrl: imageUrl })
            }
            onMouseDown={(e) =>
              beginMaterialDrag(e, { kind: 'image', url: imageUrl, sourceNodeId: id, previewUrl: imageUrl })
            }
            title="Ctrl+拖拽可送到其他节点"
          />
        </div>
      )}
    </div>
  );
};

export default memo(ImageNode);
