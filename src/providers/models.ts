/**
 * 模型注册表 - 集中定义可扩展模型清单
 * 后续要新增模型只需在对应数组里追加即可。
 */

export type ProviderType = 'zhenzhen' | 'llm-direct' | 'runninghub';

// ========================================================================
// 图像模型
// ========================================================================
export type ImageParamKind = 'gpt-size' | 'banana-ratio' | 'mj';

export interface ImageModelDef {
  id: string;
  apiModel: string;
  label: string;
  tabLabel: string;
  provider: ProviderType;
  paramKind: ImageParamKind;
  capabilities: ('t2i' | 'i2i' | 'edit' | 'text-render')[];
  apiModelOptions: Array<{ value: string; label: string }>;
  aspectRatios: string[];
  defaultAspectRatio: string;
  sizes: string[];
  defaultSize: string;
  supportsReference: boolean;
  maxReferenceImages: number;
  description?: string;
}

const GPT_RATIOS = [
  'Auto',
  '1:1',
  '16:9',
  '4:3',
  '4:5',
  '3:2',
  '2:3',
  '3:4',
  '5:4',
  '9:16',
  '21:9',
  '1:4',
  '4:1',
  '1:8',
  '8:1',
];
const BANANA_FLASH_RATIOS = GPT_RATIOS;
const BANANA_PRO_RATIOS = ['Auto', '1:1', '16:9', '4:3', '4:5', '3:2', '2:3', '3:4', '5:4', '9:16', '21:9'];

export const IMAGE_MODELS: ImageModelDef[] = [
  {
    id: 'gpt-image-2',
    // 默认走标准 GPT2 路径，后端会按 aspect_ratio + 1K/2K/4K 映射像素尺寸并用白图占位。
    // FAL 子模型仍保留为手动选项，但 FAL 的 edit/gen 自动判断需另行修复。
    apiModel: 'gpt-image-2-all',
    label: 'GPT Image 2',
    tabLabel: 'GPT2',
    provider: 'zhenzhen',
    paramKind: 'gpt-size',
    capabilities: ['t2i', 'i2i', 'edit', 'text-render'],
    apiModelOptions: [
      { value: 'gpt-image-2-all', label: 'gpt-image-2-all（标准路径）' },
      { value: 'gpt-image-2', label: 'gpt-image-2（标准路径）' },
      { value: 'gpt-image-2-fal', label: 'gpt-image-2-fal' },
    ],
    aspectRatios: GPT_RATIOS,
    defaultAspectRatio: '1:1',
    sizes: ['1K', '2K', '4K'],
    defaultSize: '2K',
    supportsReference: true,
    maxReferenceImages: 5,
    description: '支持文生图/图生图/编辑/文字渲染',
  },
  {
    id: 'nano-banana-2',
    apiModel: 'nano-banana-2',
    label: 'Nano Banana 2',
    tabLabel: '香蕉2',
    provider: 'zhenzhen',
    paramKind: 'banana-ratio',
    capabilities: ['t2i', 'i2i'],
    apiModelOptions: [
      { value: 'nano-banana-2', label: 'nano-banana-2 (Flash)' },
      { value: 'nano-banana-2-fal', label: 'nano-banana-2-fal' },
    ],
    aspectRatios: BANANA_FLASH_RATIOS,
    defaultAspectRatio: '1:1',
    sizes: ['1K', '2K', '4K'],
    defaultSize: '2K',
    supportsReference: true,
    maxReferenceImages: 5,
    description: '高速生成，适合迭代',
  },
  {
    id: 'nano-banana-pro',
    apiModel: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    tabLabel: '香蕉Pro',
    provider: 'zhenzhen',
    paramKind: 'banana-ratio',
    capabilities: ['t2i', 'i2i', 'edit'],
    apiModelOptions: [
      { value: 'nano-banana-pro', label: 'nano-banana-pro' },
      { value: 'nano-banana-pro-2k', label: 'nano-banana-pro-2k' },
      { value: 'nano-banana-pro-4k', label: 'nano-banana-pro-4k' },
      { value: 'nano-banana-pro-fal', label: 'nano-banana-pro-fal' },
    ],
    aspectRatios: BANANA_PRO_RATIOS,
    defaultAspectRatio: '1:1',
    sizes: ['1K', '2K', '4K'],
    defaultSize: '2K',
    supportsReference: true,
    maxReferenceImages: 5,
    description: '高品质 Pro 版本',
  },
  {
    id: 'midjourney',
    apiModel: 'midjourney',
    label: 'Midjourney',
    tabLabel: 'MJ',
    provider: 'zhenzhen',
    paramKind: 'mj',
    capabilities: ['t2i', 'i2i'],
    apiModelOptions: [{ value: 'midjourney', label: 'Midjourney' }],
    aspectRatios: ['1:1', '4:3', '3:2', '16:9', '3:4', '2:3', '9:16'],
    defaultAspectRatio: '1:1',
    sizes: [],
    defaultSize: '',
    supportsReference: true,
    maxReferenceImages: 4,
    description: 'Midjourney v8.1 / niji 7 等（Comfly 渠道）',
  },
];

// ========================================================================
// Midjourney 常量
// ========================================================================
export const MJ_VERSIONS: Array<{ value: string; label: string }> = [
  { value: 'v 8.1', label: 'v 8.1 (默认)' },
  { value: 'v 8', label: 'v 8' },
  { value: 'v 7', label: 'v 7' },
  { value: 'v 6.1', label: 'v 6.1' },
  { value: 'v 6.0', label: 'v 6.0' },
  { value: 'v 5.2', label: 'v 5.2' },
  { value: 'v 5.1', label: 'v 5.1' },
  { value: 'niji 7', label: 'niji 7' },
  { value: 'niji 6', label: 'niji 6' },
  { value: 'niji 5', label: 'niji 5' },
  { value: 'niji 4', label: 'niji 4' },
];
export const DEFAULT_MJ_VERSION = 'v 8.1';
export const MJ_RATIOS = ['1:1', '4:3', '3:2', '16:9', '3:4', '2:3', '9:16'];
export const DEFAULT_MJ_RATIO = '1:1';
export const MJ_SPEEDS: Array<{ value: 'fast' | 'turbo' | 'relax'; label: string }> = [
  { value: 'fast', label: 'Fast (默认)' },
  { value: 'turbo', label: 'Turbo' },
  { value: 'relax', label: 'Relax' },
];
export const DEFAULT_MJ_SPEED = 'fast';
export const MJ_SVS: Array<{ value: string; label: string }> = [
  { value: '1', label: 'sv 1 (默认)' },
  { value: '2', label: 'sv 2' },
  { value: '3', label: 'sv 3' },
  { value: '4', label: 'sv 4' },
];

export function isMjModel(apiModel: string | undefined | null): boolean {
  if (!apiModel) return false;
  const def = IMAGE_MODELS.find((m) => m.id === apiModel || m.apiModel === apiModel);
  return def?.paramKind === 'mj';
}

// ========================================================================
// FAL 图像渠道
// ========================================================================
export type FalParamKind = 'gpt-fal' | 'nbpro-fal';

export interface FalEndpointDef {
  endpoint: string;
  editEndpoint?: string;
  paramKind: FalParamKind;
  maxRefs: number;
}

export const FAL_REGISTRY: Record<string, FalEndpointDef> = {
  'gpt-image-2-fal': {
    endpoint: 'openai/gpt-image-2',
    editEndpoint: 'openai/gpt-image-2/edit',
    paramKind: 'gpt-fal',
    maxRefs: 5,
  },
  'nano-banana-pro-fal': {
    endpoint: 'fal-ai/nano-banana-pro/edit',
    editEndpoint: 'fal-ai/nano-banana-pro/edit',
    paramKind: 'nbpro-fal',
    maxRefs: 8,
  },
  'nano-banana-2-fal': {
    endpoint: 'fal-ai/nano-banana-pro/edit',
    editEndpoint: 'fal-ai/nano-banana-pro/edit',
    paramKind: 'nbpro-fal',
    maxRefs: 8,
  },
};

export function isFalModel(apiModel: string | undefined | null): boolean {
  if (!apiModel) return false;
  return !!FAL_REGISTRY[String(apiModel)];
}

export const GPT_FAL_SIZES = [
  { value: 'auto', label: 'Auto' },
  { value: 'square_hd', label: 'Square HD' },
  { value: 'square', label: 'Square' },
  { value: 'portrait_4_3', label: 'Portrait 4:3' },
  { value: 'portrait_16_9', label: 'Portrait 16:9' },
  { value: 'landscape_4_3', label: 'Landscape 4:3' },
  { value: 'landscape_16_9', label: 'Landscape 16:9' },
  { value: 'custom', label: 'Custom' },
];

export const NBPRO_FAL_RATIOS = ['auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'];
export const NBPRO_FAL_RESOLUTIONS = ['1K', '2K', '4K'];

// ========================================================================
// 视频模型
// ========================================================================
export type VideoKind = 'veo' | 'grok' | 'seedance';
export type VideoFalParamKind = 'veo-fal' | 'grok-fal';

export interface VideoModelDef {
  id: string;
  kind: VideoKind;
  label: string;
  tabLabel: string;
  apiModelOptions: Array<{ value: string; label: string }>;
  ratios: string[];
  defaultRatio: string;
  durations?: number[];
  defaultDuration?: number;
  resolutions?: string[];
  defaultResolution?: string;
  maxReferenceImages: number;
  maxRefImages?: number;
  supportImages?: boolean;
  description?: string;
}

export const VIDEO_MODELS: VideoModelDef[] = [
  {
    id: 'veo',
    kind: 'veo',
    label: 'Veo 3.1',
    tabLabel: 'Veo',
    apiModelOptions: [
      { value: 'veo3.1', label: 'Veo 3.1' },
      { value: 'veo3.1-fast', label: 'Veo 3.1 Fast' },
      { value: 'veo3.1-fal', label: 'Veo 3.1 FAL' },
    ],
    ratios: ['16:9', '9:16'],
    defaultRatio: '16:9',
    durations: [5, 8],
    defaultDuration: 5,
    resolutions: ['720P', '1080P'],
    defaultResolution: '720P',
    maxReferenceImages: 3,
    description: 'Veo 视频生成',
  },
  {
    id: 'grok',
    kind: 'grok',
    label: 'Grok Video',
    tabLabel: 'Grok',
    apiModelOptions: [
      { value: 'grok-video-3', label: 'Grok Video 3' },
      { value: 'grok-video-fal', label: 'Grok Video FAL' },
    ],
    ratios: ['16:9', '9:16'],
    defaultRatio: '16:9',
    durations: [6, 10],
    defaultDuration: 6,
    resolutions: ['480P', '720P'],
    defaultResolution: '720P',
    maxReferenceImages: 7,
    description: 'Grok 视频生成',
  },
  {
    id: 'seedance',
    kind: 'seedance',
    label: 'Seedance',
    tabLabel: 'Seedance',
    apiModelOptions: [
      { value: 'doubao-seedance-2-0-fast-260128', label: 'Seedance 2.0 Fast' },
    ],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    defaultRatio: '16:9',
    durations: [5, 10],
    defaultDuration: 5,
    resolutions: ['480P', '720P'],
    defaultResolution: '480P',
    maxReferenceImages: 4,
    description: 'Seedance 分镜视频',
  },
];

export interface VideoFalEndpointDef {
  endpoint: string;
  paramKind: VideoFalParamKind;
  maxRefImages: number;
}

export const VIDEO_FAL_REGISTRY: Record<string, VideoFalEndpointDef> = {
  'veo3.1-fal': {
    endpoint: 'fal-ai/veo3.1',
    paramKind: 'veo-fal',
    maxRefImages: 3,
  },
  'grok-video-fal': {
    endpoint: 'fal-ai/grok-video',
    paramKind: 'grok-fal',
    maxRefImages: 7,
  },
};

export function isFalVideoModel(apiModel: string | undefined | null): boolean {
  if (!apiModel) return false;
  return !!VIDEO_FAL_REGISTRY[String(apiModel)] || /-fal$/.test(String(apiModel));
}

export const VEO_FAL_RATIOS = ['16:9', '9:16'];
export const VEO_FAL_DURATIONS = ['5s', '8s'];
export const VEO_FAL_RESOLUTIONS = ['720p', '1080p'];
export const GROK_FAL_RATIOS = ['16:9', '9:16'];
export const GROK_FAL_RESOLUTIONS = ['480p', '720p'];

// ========================================================================
// 音频模型
// ========================================================================
export const SUNO_VERSIONS: Array<{ value: string; label: string }> = [
  { value: 'v5.5', label: 'Suno V5.5' },
  { value: 'v5', label: 'Suno V5' },
  { value: 'v4.5', label: 'Suno V4.5' },
];
export const DEFAULT_SUNO_VERSION = 'v5.5';

// ========================================================================
// LLM / Vision 模型
// ========================================================================
export const LLM_MODELS: Array<{ value: string; label: string; description?: string }> = [
  { value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
  { value: 'gpt-5', label: 'GPT-5' },
  { value: 'gpt-image-2-all', label: 'GPT Image 2' },
];
export const DEFAULT_LLM_MODEL = 'gemini-3.1-flash-lite-preview';

export function isImageOutputLlm(model: string | undefined | null): boolean {
  if (!model) return false;
  return String(model).includes('gpt-image-2');
}
