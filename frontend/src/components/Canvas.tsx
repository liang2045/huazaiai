import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WheelEvent } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlowProvider,
  SelectionMode,
  ViewportPortal,
  Handle,
  Position,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, Play, Copy, CopyPlus, Trash2, FolderPlus, Download } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { useCanvasStore } from '../stores/canvas';
import { useThemeStore } from '../stores/theme';
import { useRunBusStore } from '../stores/runBus';
import { useGroupBusStore, GROUP_COLORS, DEFAULT_GROUP_NAME } from '../stores/groupBus';
import { useDragMaterialStore } from '../stores/dragMaterial';
import { topologicalSort } from '../utils/topologicalSort';
import { installGlobalWheelBlockObserver } from '../utils/wheelBlock';
import * as api from '../services/api';
import TerminalPanel from './TerminalPanel';
import MaterialDragOverlay from './MaterialDragOverlay';
import { useCanvasHistory } from '../hooks/useCanvasHistory';
import type { CanvasTemplate } from '../config/canvasTemplates';
import PlaceholderNode from './nodes/PlaceholderNode';
import TextNode from './nodes/TextNode';
import ImageNode from './nodes/ImageNode';
import LLMNode from './nodes/LLMNode';
import VideoNode from './nodes/VideoNode';
import SeedanceNode from './nodes/SeedanceNode';
import AudioNode from './nodes/AudioNode';
import ResizeNode from './nodes/ResizeNode';
import UpscaleNode from './nodes/UpscaleNode';
import GridCropNode from './nodes/GridCropNode';
import CombineNode from './nodes/CombineNode';
import RemoveBgNode from './nodes/RemoveBgNode';
import ImageCompareNode from './nodes/ImageCompareNode';
import ToolboxParamNode from './nodes/ToolboxParamNode';
import IdeaNode from './nodes/IdeaNode';
import BpNode from './nodes/BpNode';
import RelayNode from './nodes/RelayNode';
import VideoOutputNode from './nodes/VideoOutputNode';
import PortraitMetadataNode from './nodes/PortraitMetadataNode';
import StoryboardGridNode from './nodes/StoryboardGridNode';
import PresetImageNode from './nodes/PresetImageNode';
import DrawingBoardNode from './nodes/DrawingBoardNode';
import BrowserNode from './nodes/BrowserNode';
import FrameExtractorNode from './nodes/FrameExtractorNode';
import UploadNode from './nodes/UploadNode';
import OutputNode from './nodes/OutputNode';
import GroupBoxNode from './nodes/GroupBoxNode';
import DeletableEdge from './edges/DeletableEdge';
import { NODE_REGISTRY } from '../config/nodeRegistry';
import { uploadFile as uploadAssetFile } from '../services/generation';
import { downloadBlob } from '../utils/download';
import type { NodeType, NodeMeta } from '../types/canvas';
import {
  isConnectionValid,
  getNodeOutputs,
  getNodeInputs,
  arePortsCompatible,
  PORT_COLOR,
  PORT_LABEL,
  NODE_PORTS,
  type PortType,
} from '../config/portTypes';

// Phase 4 闃舵:鍏ㄩ儴 24 涓妭鐐瑰潎宸插疄鐜颁笟鍔￠€昏緫
const SPECIFIC_NODES: Record<string, any> = {
  // Core (8)
  text: TextNode,
  image: ImageNode,
  video: VideoNode,
  seedance: SeedanceNode, // 瀹屽叏瀵归綈 gpt-image-2-web Seedance2.0(鐙珛 /seedance/v3 璺緞)
  audio: AudioNode,
  llm: LLMNode,
  // Special (5)
  'multi-angle-3d': PresetImageNode,
  'panorama-720': PresetImageNode,
  'portrait-preset': PresetImageNode,
  'portrait-metadata': PortraitMetadataNode,
  'storyboard-grid': StoryboardGridNode,
  // Utility (9)
  'drawing-board': DrawingBoardNode,
  browser: BrowserNode,
  'image-compare': ImageCompareNode,
  'frame-extractor': FrameExtractorNode,
  resize: ResizeNode,
  combine: CombineNode,
  'remove-bg': RemoveBgNode,
  upscale: UpscaleNode,
  'grid-crop': GridCropNode,
  // Auxiliary (5)
  edit: ImageNode, // 澶嶇敤 ImageNode,榛樿鍋忓悜 edit 鑳藉姏
  idea: IdeaNode,
  bp: BpNode,
  relay: RelayNode,
  'video-output': VideoOutputNode,
  // Toolbox (2)
  cinematic: ToolboxParamNode,
  'video-motion': ToolboxParamNode,
  'custom-tool': ToolboxParamNode,
  // Input (1) - 涓婁紶绱犳潗
  upload: UploadNode,
  // Output (1) - 杈撳嚭绱犳潗(鏂囨湰/鍥惧儚/瑙嗛/闊抽 棰勮 + 鏂囨湰鍙屽嚮缂栬緫)
  output: OutputNode,
};

// 鑺傜偣鍒濆 data(鐢ㄤ簬鍖哄垎鍏变韩缁勪欢鐨?kind/preset/model 绛?
const INITIAL_DATA: Record<string, Record<string, any>> = {
  image: { model: 'gpt-image-2', aspectRatio: '1:1', sizeLevel: '2K', referenceImages: [] },
  edit: { mode: 'edit', model: 'gpt-image-2', aspectRatio: '1:1', sizeLevel: '2K', referenceImages: [] },
  seedance: {
    model: 'doubao-seedance-2-0-fast-260128',
    duration: 5,
    ratio: '16:9',
    resolution: '480p',
    generateAudio: true,
    returnLastFrame: false,
    watermark: false,
    webSearch: false,
    seed: -1,
    maxPoll: 360,
    pollInt: 10,
    frameMode: 'auto',
  },
  cinematic: { kind: 'cinematic' },
  'video-motion': { kind: 'video-motion' },
  'custom-tool': { kind: 'custom-tool', customTools: [{ id: 'custom-1', label: '自定义工具', text: '' }], presetId: 'custom-1', prompt: '', draftLabel: '自定义工具', draftPrompt: '' },
  'drawing-board': { resolutionW: 800, resolutionH: 800, frameW: 800, frameH: 800 },
  'multi-angle-3d': { preset: 'multi-angle-3d' },
  'panorama-720': { preset: 'panorama-720' },
  'portrait-preset': { preset: 'portrait-preset' },
  audio: { mode: 'generate', version: 'v5.5', title: '', tags: '', seed: 0, continueAt: 28 },
  llm: {
    model: 'gemini-3.1-flash-lite-preview',
    system: '',
    prompt: '',
    temperature: 0.7,
    maxTokens: 4096,
    stream: true,
    history: [],
  },
  upload: { uploadType: null },
};

// 鍙鈥滄壒閲忚繍琛屸€濊皟璧风殑鑺傜偣绫诲瀷闆嗗悎
// upload 浜﹁绾冲叆: 鐐瑰嚮 RUN 鍚庝細鏍规嵁宸蹭笂浼犵礌鏉愬垱寤轰笅娓?OutputNode (瑕?UploadNode.handleRun)
const EXECUTABLE_NODE_TYPES = new Set<string>([
  'image', 'edit',
  'multi-angle-3d', 'panorama-720', 'portrait-preset',
  'video', 'seedance', 'audio', 'llm',
  'resize', 'upscale', 'grid-crop', 'remove-bg', 'combine',
  'frame-extractor',
  'upload',
]);

// 缃戞牸鍚搁檮姝ラ暱 / 瀵归綈闃堝€?涓栫晫鍧愭爣)
const SNAP_GRID: [number, number] = [20, 20];
const ALIGN_THRESHOLD = 8;
const ALIGNABLE_NODE_TYPES = new Set<string>(['image', 'edit', 'upload', 'output', 'drawing-board', 'text', 'video', 'seedance']);
const LAYERABLE_NODE_TYPES = new Set<string>(['image', 'edit', 'upload', 'drawing-board', 'text', 'video', 'seedance']);
const FRAME_CHILD_NODE_TYPES = new Set<string>(['image', 'edit', 'upload', 'text', 'video', 'seedance']);
const STALE_RUNTIME_STATUSES = new Set(['generating', 'polling', 'submitting', 'running']);
const stripStaleRuntime = (node: Node): Node => {
  const data: any = node.data || {};
  const status = String(data.status || '').toLowerCase();
  if (!STALE_RUNTIME_STATUSES.has(status)) return node;
  const nextData = { ...data };
  delete nextData.taskId;
  delete nextData.progress;
  delete nextData.error;
  delete nextData.isRunning;
  delete nextData.isPolling;
  delete nextData.pollingTimer;
  nextData.status = 'idle';
  return { ...node, data: nextData };
};
const TEXT_FONT_OPTIONS = [
  { label: '系统默认', value: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { label: '苹方 / 微软雅黑', value: '"PingFang SC", "Microsoft YaHei", sans-serif' },
  { label: '思源黑体', value: '"Source Han Sans SC", "Noto Sans CJK SC", sans-serif' },
  { label: '宋体', value: 'SimSun, "Songti SC", serif' },
  { label: '衬线', value: 'Georgia, "Times New Roman", serif' },
  { label: '等宽', value: '"SFMono-Regular", Consolas, "Liberation Mono", monospace' },
];
const TEXT_WEIGHT_OPTIONS = [300, 400, 500, 600, 700, 800, 900];
const FRAME_PRESETS = [
  { id: 'ecom-800', group: '电商', label: '800×800', w: 800, h: 800 },
  { id: 'ecom-1000', group: '电商', label: '1000×1000', w: 1000, h: 1000 },
  { id: 'ecom-1200', group: '电商', label: '1200×1200', w: 1200, h: 1200 },
  { id: 'ecom-800-1200', group: '电商', label: '800×1200', w: 800, h: 1200 },
  { id: 'ecom-1200-1600', group: '电商', label: '1200×1600', w: 1200, h: 1600 },
  { id: 'social-1-1', group: '社媒', label: '1:1', w: 1080, h: 1080 },
  { id: 'social-3-4', group: '社媒', label: '3:4', w: 1080, h: 1440 },
  { id: 'social-4-5', group: '社媒', label: '4:5', w: 1080, h: 1350 },
  { id: 'social-9-16', group: '社媒', label: '9:16', w: 1080, h: 1920 },
  { id: 'social-16-9', group: '社媒', label: '16:9', w: 1920, h: 1080 },
];
const MIN_FRAME_CREATE_W = 48;
const MIN_FRAME_CREATE_H = 48;
const COLOR_SWATCHES = ['#111111', '#ffffff', '#ef4444', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

const makeLinearGradientCss = (from: string, to: string, angle: number) =>
  `linear-gradient(${Number.isFinite(angle) ? angle : 90}deg, ${from || '#111111'}, ${to || '#ffffff'})`;

const getFrameBackgroundCss = (data: Record<string, any>) => {
  if (data.backgroundMode === 'gradient') {
    return makeLinearGradientCss(
      data.backgroundGradientFrom || '#ffffff',
      data.backgroundGradientTo || '#dbeafe',
      Number(data.backgroundGradientAngle ?? 90),
    );
  }
  return data.backgroundColor || 'rgba(128,128,128,.12)';
};

const loadCanvasImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`无法加载图片: ${src}`));
    image.src = src;
  });

const drawBackgroundPaint = (ctx: CanvasRenderingContext2D, data: Record<string, any>, w: number, h: number) => {
  if (data.backgroundMode === 'gradient') {
    const angle = ((Number(data.backgroundGradientAngle ?? 90) - 90) * Math.PI) / 180;
    const cx = w / 2;
    const cy = h / 2;
    const len = Math.abs(w * Math.cos(angle)) + Math.abs(h * Math.sin(angle));
    const grad = ctx.createLinearGradient(
      cx - Math.cos(angle) * len / 2,
      cy - Math.sin(angle) * len / 2,
      cx + Math.cos(angle) * len / 2,
      cy + Math.sin(angle) * len / 2,
    );
    grad.addColorStop(0, data.backgroundGradientFrom || '#ffffff');
    grad.addColorStop(1, data.backgroundGradientTo || '#dbeafe');
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = data.backgroundColor || 'rgba(128,128,128,.12)';
  }
  ctx.fillRect(0, 0, w, h);
};

const isAlignableNode = (node: Node) => !!node.type && ALIGNABLE_NODE_TYPES.has(node.type);
const isLayerableNode = (node: Node) => !!node.type && LAYERABLE_NODE_TYPES.has(node.type);
const canFrameContainNode = (node: Node) => !!node.type && FRAME_CHILD_NODE_TYPES.has(node.type);

const getNodeSize = (node: Node) => {
  const data = (node.data || {}) as Record<string, any>;
  if (node.type === 'drawing-board') {
    return {
      w: Math.round(Number(data.frameW || data.resolutionW || (node as any).width || (node as any).measured?.width || 800)),
      h: Math.round(Number(data.frameH || data.resolutionH || (node as any).height || (node as any).measured?.height || 800)),
    };
  }
  return {
    w: Math.round(Number((node as any).width || (node as any).measured?.width || data.textW || data.imageWidth || data.width || data.frameW || 200)),
    h: Math.round(Number((node as any).height || (node as any).measured?.height || data.textH || data.imageHeight || data.height || data.frameH || 100)),
  };
};

const getNodeAbsolutePosition = (node: Node, allNodes: Node[]): { x: number; y: number } => {
  let x = node.position.x;
  let y = node.position.y;
  let parentId = (node as any).parentId as string | undefined;
  const seen = new Set<string>([node.id]);
  while (parentId && !seen.has(parentId)) {
    const parent = allNodes.find((n) => n.id === parentId);
    if (!parent) break;
    seen.add(parent.id);
    x += parent.position.x;
    y += parent.position.y;
    parentId = (parent as any).parentId as string | undefined;
  }
  return { x, y };
};

const getNodeRect = (node: Node, allNodes: Node[]) => {
  const pos = getNodeAbsolutePosition(node, allNodes);
  const size = getNodeSize(node);
  return {
    x: pos.x,
    y: pos.y,
    w: size.w,
    h: size.h,
    L: pos.x,
    C: pos.x + size.w / 2,
    R: pos.x + size.w,
    T: pos.y,
    M: pos.y + size.h / 2,
    B: pos.y + size.h,
  };
};

const getIntersectionArea = (
  a: ReturnType<typeof getNodeRect>,
  b: ReturnType<typeof getNodeRect>,
) => {
  const w = Math.max(0, Math.min(a.R, b.R) - Math.max(a.L, b.L));
  const h = Math.max(0, Math.min(a.B, b.B) - Math.max(a.T, b.T));
  return w * h;
};

const getRectArea = (rect: ReturnType<typeof getNodeRect>) => Math.max(1, rect.w * rect.h);

const toNodeLocalPosition = (node: Node, absolute: { x: number; y: number }, allNodes: Node[]) => {
  const parentId = (node as any).parentId as string | undefined;
  if (!parentId) return absolute;
  const parent = allNodes.find((n) => n.id === parentId);
  if (!parent) return absolute;
  const parentPos = getNodeAbsolutePosition(parent, allNodes);
  return { x: absolute.x - parentPos.x, y: absolute.y - parentPos.y };
};

const getLayerZ = (node: Node, index: number) => {
  if (typeof node.zIndex === 'number') return node.zIndex;
  return node.type === 'drawing-board' ? index * 10 : 1000 + index * 10;
};

const getNextLayerZ = (nodes: Node[], type?: string) => {
  const layers = nodes.filter(isLayerableNode);
  if (layers.length === 0) return type === 'drawing-board' ? 0 : 1000;
  const zs = layers.map((n, i) => getLayerZ(n, i));
  return type === 'drawing-board' ? Math.min(...zs) - 10 : Math.max(...zs) + 10;
};

const orderParentFramesFirst = (nodes: Node[]) =>
  [...nodes].sort((a, b) => {
    if (a.id === (b as any).parentId) return -1;
    if (b.id === (a as any).parentId) return 1;
    return 0;
  });

const reorderLayerNodes = (nodes: Node[], ids: string[], action: 'forward' | 'backward' | 'front' | 'back') => {
  const selectedIds = new Set(ids);
  const ordered = nodes
    .filter((n) => selectedIds.has(n.id) && isLayerableNode(n))
    .map((n) => n.id);
  if (ordered.length === 0) return nodes;
  const layerNodes = nodes
    .filter(isLayerableNode)
    .sort((a, b) => getLayerZ(a, nodes.indexOf(a)) - getLayerZ(b, nodes.indexOf(b)));

  if (action === 'front') {
    layerNodes.sort((a, b) => Number(selectedIds.has(a.id)) - Number(selectedIds.has(b.id)));
  } else if (action === 'back') {
    layerNodes.sort((a, b) => Number(selectedIds.has(b.id)) - Number(selectedIds.has(a.id)));
  } else if (action === 'forward') {
    for (let i = layerNodes.length - 2; i >= 0; i -= 1) {
      if (selectedIds.has(layerNodes[i].id) && !selectedIds.has(layerNodes[i + 1].id)) {
        [layerNodes[i], layerNodes[i + 1]] = [layerNodes[i + 1], layerNodes[i]];
      }
    }
  } else {
    for (let i = 1; i < layerNodes.length; i += 1) {
      if (selectedIds.has(layerNodes[i].id) && !selectedIds.has(layerNodes[i - 1].id)) {
        [layerNodes[i - 1], layerNodes[i]] = [layerNodes[i], layerNodes[i - 1]];
      }
    }
  }

  const zById = new Map(layerNodes.map((n, i) => [n.id, i * 10]));
  return nodes.map((n) => (zById.has(n.id) ? { ...n, zIndex: zById.get(n.id) } : n));
};

const attachNodesToFrames = (nodes: Node[], movedIds: string[]) => {
  if (movedIds.length === 0) return nodes;
  const moved = new Set(movedIds);
  const frames = nodes.filter((n) => n.type === 'drawing-board');
  if (frames.length === 0) return nodes;
  const next = nodes.map((node) => {
    if (!moved.has(node.id) || !canFrameContainNode(node)) return node;
    const rect = getNodeRect(node, nodes);
    const center = { x: rect.C, y: rect.M };
    const target = frames
      .filter((frame) => frame.id !== node.id)
      .filter((frame) => {
        const fr = getNodeRect(frame, nodes);
        return center.x >= fr.L && center.x <= fr.R && center.y >= fr.T && center.y <= fr.B;
      })
      .sort((a, b) => getLayerZ(b, nodes.indexOf(b)) - getLayerZ(a, nodes.indexOf(a)))[0];
    if (!target || (node as any).parentId === target.id) return node;
    const framePos = getNodeAbsolutePosition(target, nodes);
    return {
      ...node,
      parentId: target.id,
      extent: undefined,
      position: { x: rect.x - framePos.x, y: rect.y - framePos.y },
      zIndex: getNextLayerZ(nodes, node.type),
    };
  });
  return orderParentFramesFirst(next);
};

const detachNodesOutsideFrames = (nodes: Node[], movedIds: string[]) => {
  if (movedIds.length === 0) return nodes;
  const moved = new Set(movedIds);
  return orderParentFramesFirst(
    nodes.map((node) => {
      const parentId = (node as any).parentId as string | undefined;
      if (!moved.has(node.id) || !parentId || !canFrameContainNode(node)) {
        return (node as any).extent === 'parent' ? { ...node, extent: undefined } : node;
      }
      const parent = nodes.find((n) => n.id === parentId && n.type === 'drawing-board');
      if (!parent) return { ...node, parentId: undefined, extent: undefined };
      const rect = getNodeRect(node, nodes);
      const frameRect = getNodeRect(parent, nodes);
      const insideRatio = getIntersectionArea(rect, frameRect) / getRectArea(rect);
      if (insideRatio >= 0.5) {
        return (node as any).extent === 'parent' ? { ...node, extent: undefined } : node;
      }
      return {
        ...node,
        parentId: undefined,
        extent: undefined,
        position: { x: rect.x, y: rect.y },
      };
    }),
  );
};

const cleanFrameClipStyle = (node: Node): Node => {
  const style = { ...((node as any).style || {}) } as Record<string, any>;
  const hadManagedStyle = style.clipPath !== undefined || style.overflow === 'hidden';
  delete style.clipPath;
  if (style.overflow === 'hidden') delete style.overflow;
  if (!hadManagedStyle) return node;
  return { ...node, style: Object.keys(style).length > 0 ? style : undefined };
};

const applyFrameClipping = (nodes: Node[]): Node[] => {
  let changed = false;
  const next = nodes.map((node) => {
    const parentId = (node as any).parentId as string | undefined;
    const parent = parentId ? nodes.find((n) => n.id === parentId && n.type === 'drawing-board') : null;
    if (!parent || !canFrameContainNode(node)) {
      const cleaned = cleanFrameClipStyle(node);
      if (cleaned !== node) changed = true;
      return cleaned;
    }

    const nodeRect = getNodeRect(node, nodes);
    const frameRect = getNodeRect(parent, nodes);
    const rawLeft = Math.max(0, frameRect.L - nodeRect.L);
    const rawTop = Math.max(0, frameRect.T - nodeRect.T);
    const rawRight = Math.max(0, nodeRect.R - frameRect.R);
    const rawBottom = Math.max(0, nodeRect.B - frameRect.B);
    const fullyHidden = rawLeft + rawRight >= nodeRect.w || rawTop + rawBottom >= nodeRect.h;
    const clipPath = fullyHidden
      ? 'inset(0 100% 100% 0)'
      : `inset(${Math.round(rawTop)}px ${Math.round(rawRight)}px ${Math.round(rawBottom)}px ${Math.round(rawLeft)}px)`;
    const style = { ...((node as any).style || {}), clipPath, overflow: 'hidden' };
    const same = (node as any).style?.clipPath === clipPath && (node as any).style?.overflow === 'hidden';
    if (!same) changed = true;
    return same ? node : { ...node, style };
  });
  return changed ? next : nodes;
};

// 鎶婃墍鏈夎妭鐐圭被鍨嬮兘娉ㄥ唽鍒板搴旂粍浠?宸插疄鐜扮殑鐢ㄤ笟鍔＄粍浠?鍏朵綑鐢?Placeholder)
const nodeTypes = NODE_REGISTRY.reduce<Record<string, any>>((acc, m) => {
  acc[m.type] = SPECIFIC_NODES[m.type] || PlaceholderNode;
  return acc;
}, {});
// 鑺傜偣缁勫鍣?涓嶅湪 NODE_REGISTRY 涓?浣滀负鐙珛鐨勮瑙夊鍣ㄨ妭鐐圭被鍨?
nodeTypes.groupBox = GroupBoxNode;

// SHIFT 鎵归噺绉荤嚎 phantom 鑺傜偣: 鎷栨嫿鏈熼棿鍏呭綋杈圭殑涓存椂閿愮偣,璺熼殢榧犳爣绉诲姩
function BulkPhantomNode() {
  return (
    <>
      <Handle type="target" position={Position.Left} style={{ opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 'none', background: 'transparent' }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 'none', background: 'transparent' }} />
    </>
  );
}
nodeTypes.bulkPhantom = BulkPhantomNode;
const BULK_PHANTOM_ID = '__bulk_phantom__';
const REMOVED_NODE_TYPES = new Set<string>(['runninghub', 'runninghub-wallet', 'rh-config']);

function withoutRemovedNodes(ns: Node[], es: Edge[]) {
  const nodes = ns.filter((n) => !REMOVED_NODE_TYPES.has(String(n.type || '')));
  const keptIds = new Set(nodes.map((n) => n.id));
  const edges = es.filter((e) => keptIds.has(e.source) && keptIds.has(e.target));
  return { nodes, edges };
}

// 杈圭被鍨? 榛樿杈归噰鐢ㄥ彲鐐瑰嚮鏂紑鐨?DeletableEdge
const edgeTypes = {
  default: DeletableEdge,
  deletable: DeletableEdge,
};

export type CanvasInteractionMode = 'select' | 'move';

const INSPECTOR_W = 240;
const INSPECTOR_MARGIN = 16;

const getInitialInspectorPosition = () => {
  if (typeof window === 'undefined') return { x: 0, y: 96 };
  return {
    x: Math.max(INSPECTOR_MARGIN, window.innerWidth - INSPECTOR_W - INSPECTOR_MARGIN),
    y: Math.max(INSPECTOR_MARGIN, Math.round((window.innerHeight - 560) / 2)),
  };
};

const clampInspectorPosition = (pos: { x: number; y: number }) => {
  if (typeof window === 'undefined') return pos;
  return {
    x: Math.min(Math.max(INSPECTOR_MARGIN, pos.x), Math.max(INSPECTOR_MARGIN, window.innerWidth - INSPECTOR_W - INSPECTOR_MARGIN)),
    y: Math.min(Math.max(INSPECTOR_MARGIN, pos.y), Math.max(INSPECTOR_MARGIN, window.innerHeight - 80)),
  };
};

interface CanvasInnerProps {
  onAddNodeRef?: React.MutableRefObject<((type: NodeType) => void) | null>;
  onSaveRef?: React.MutableRefObject<(() => Promise<void>) | null>;
  interactionMode?: CanvasInteractionMode;
}

function CanvasInner({ onAddNodeRef, onSaveRef, interactionMode = 'select' }: CanvasInnerProps) {
  const { activeId } = useCanvasStore();
  const { theme, style } = useThemeStore();
  const { screenToFlowPosition, setCenter, getViewport, setViewport } = useReactFlow();
  const endReferencePick = useDragMaterialStore((s) => s.endReferencePick);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const lastSavedRef = useRef<string>('');

  // 閫変腑鑺傜偣 / 鍓创鏉?
  const [selectedCount, setSelectedCount] = useState(0);
  const clipboardRef = useRef<{ nodes: Node[]; edges: Edge[]; incomingEdges?: Edge[]; outgoingEdges?: Edge[] } | null>(null);
  const [clipboardCount, setClipboardCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 鎷栫嚎鍒扮┖鐧藉鐨勫€欓€夎妭鐐硅彍鍗?connection picker)
  const [picker, setPicker] = useState<{
    fromNodeId: string;
    fromHandleType: 'source' | 'target';
    flowPos: { x: number; y: number };
    screenPos: { x: number; y: number };
  } | null>(null);
  const connectingFromRef = useRef<{
    nodeId: string;
    handleType: 'source' | 'target';
  } | null>(null);

  // ===== SHIFT+鎷栨嫿 Handle 鎵归噺绉荤嚎 =====
  // 鎸変綇 SHIFT 浠庤妭鐐瑰叆鍙?target handle)鎷栧嚭锛屽彲涓€娆℃€ф妸鎵€鏈夊叆杈圭Щ鍒板彟涓€涓妭鐐圭殑鍏ュ彛銆?
  // 鍚岀悊涔熸敮鎸佷粠 source handle SHIFT+鎷栨嫿绉诲姩鎵€鏈夊嚭杈广€?
  const bulkReconnectRef = useRef<{
    fromNodeId: string;
    handleType: 'source' | 'target';
    edges: Edge[];
  } | null>(null);

  // 璺熻釜鏈€鏂?nodes/edges 渚涘叏灞€浜嬩欢鍥炶皟浣跨敤
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    setNodes((prev) => applyFrameClipping(prev));
  }, [nodes]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  // 鍚搁檮 + 瀵归綈杈呭姪绾?
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [guides, setGuides] = useState<{ vertical: number[]; horizontal: number[] }>({
    vertical: [],
    horizontal: [],
  });

  // 鎵归噺杩愯鐘舵€?
  const [isRunning, setIsRunning] = useState(false);
  const cancelRunRef = useRef(false);
  const batchTotal = useRunBusStore((s) => s.batchTotal);
  const batchDone = useRunBusStore((s) => s.batchDoneCount);

  // 閫夊尯鍙抽敭鑿滃崟(妗嗛€夊悗鍙抽敭 鎴?鑺傜偣涓婂彸閿?
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    ids: string[];
  } | null>(null);

  // 鐢诲竷绌虹櫧鍖哄彸閿彍鍗?蹇€熸坊鍔犺妭鐐?
  const [paneMenu, setPaneMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [frameCreateMode, setFrameCreateMode] = useState(false);
  const [frameDraft, setFrameDraft] = useState<{
    start: { x: number; y: number };
    end: { x: number; y: number };
  } | null>(null);
  const [customFrameSize, setCustomFrameSize] = useState({ w: 800, h: 800 });
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true);
  const [inspectorPosition, setInspectorPosition] = useState(getInitialInspectorPosition);
  const inspectorDragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const inspectorDragMovedRef = useRef(false);

  useEffect(() => {
    const onResize = () => setInspectorPosition((pos) => clampInspectorPosition(pos));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const beginInspectorDrag = useCallback((event: React.MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    inspectorDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: inspectorPosition.x,
      originY: inspectorPosition.y,
    };
    inspectorDragMovedRef.current = false;
    const onMove = (moveEvent: MouseEvent) => {
      const drag = inspectorDragRef.current;
      if (!drag) return;
      if (Math.hypot(moveEvent.clientX - drag.startX, moveEvent.clientY - drag.startY) > 3) {
        inspectorDragMovedRef.current = true;
      }
      setInspectorPosition(clampInspectorPosition({
        x: drag.originX + moveEvent.clientX - drag.startX,
        y: drag.originY + moveEvent.clientY - drag.startY,
      }));
    };
    const onUp = () => {
      inspectorDragRef.current = null;
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
    };
    document.body.style.cursor = 'move';
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
  }, [inspectorPosition.x, inspectorPosition.y]);

  // 鍘嗗彶鏍?
  const applySnapshot = useCallback((snap: { nodes: Node[]; edges: Edge[] }) => {
    const clean = withoutRemovedNodes(snap.nodes, snap.edges);
    setNodes(clean.nodes);
    setEdges(clean.edges);
  }, []);
  const { capture: histCapture, undo: histUndo, redo: histRedo, reset: histReset, canUndo, canRedo } =
    useCanvasHistory(applySnapshot);
  const captureTimer = useRef<number | null>(null);
  const isDraggingRef = useRef(false);

  // 鑺傜偣/杩炵嚎鍙樻洿鍚?鍦ㄦ嫋鎷界粨鏉?+ 鐭殏闃叉姈绐楀彛鍐呭帇鏍堜竴娆?
  const scheduleCapture = useCallback(
    (snap: { nodes: Node[]; edges: Edge[] }) => {
      if (isDraggingRef.current) return;
      if (captureTimer.current) window.clearTimeout(captureTimer.current);
      captureTimer.current = window.setTimeout(() => {
        histCapture(snap);
      }, 250);
    },
    [histCapture]
  );

  // 鍔犺浇鐢诲竷鏁版嵁
  useEffect(() => {
    if (!activeId) {
      setNodes([]);
      setEdges([]);
      setLoaded(false);
      histReset();
      return;
    }
    setLoaded(false);
    api
      .getCanvasData(activeId)
      .then((data) => {
        const ns = data.nodes || [];
        const es = data.edges || [];
        // 鈿?鍏戝簳琛ヤ竵: 鍘嗗彶鐢诲竷涓彲鑳藉瓨鍦?connectable=false 鐨勬棫 groupBox 鑺傜偣
        // (5656721 浜嬫晠鏈熼棿鍒涘缓鐨?group), 鍔犺浇鏃跺己鍒舵墦寮€鍙繛鎺ヤ互鎭㈠鍙充晶鑱氬悎杈撳嚭鍙?
        const fixedNs = ns.map((n: any) =>
          n.type === 'groupBox' && n.connectable === false
            ? { ...n, connectable: true }
            : n,
        );
        const visibleNs = fixedNs
          .filter((n: any) => n.type !== 'output')
          .map((n: any) => (n.extent === 'parent' ? { ...n, extent: undefined } : n));
        const visibleIds = new Set(visibleNs.map((n: any) => n.id));
        const visibleEs = es.filter((ed: any) => visibleIds.has(ed.source) && visibleIds.has(ed.target));
        const clean = withoutRemovedNodes(visibleNs, visibleEs);
        const orderedNodes = orderParentFramesFirst(clean.nodes).map(stripStaleRuntime);
        setNodes(orderedNodes);
        setEdges(clean.edges);
        lastSavedRef.current = JSON.stringify({ nodes: fixedNs, edges: es });
        histReset({ nodes: orderedNodes, edges: clean.edges });
        setLoaded(true);
      })
      .catch((e) => {
        console.error('鍔犺浇鐢诲竷澶辫触', e);
        setNodes([]);
        setEdges([]);
        histReset();
        setLoaded(true);
      });
  }, [activeId, histReset]);

  // nodes/edges 鍙樺寲鍚庡帇鏍?鑺傛祦闃叉鎷栨嫿涓捣閲忓叆鏍?
  useEffect(() => {
    if (!loaded) return;
    scheduleCapture({ nodes, edges });
  }, [nodes, edges, loaded, scheduleCapture]);

  const saveCurrentCanvas = useCallback(async () => {
    if (!activeId || !loaded) return;
    const persistNodes = nodesRef.current.filter((n) => n.id !== BULK_PHANTOM_ID && n.type !== 'output');
    const persistNodeIds = new Set(persistNodes.map((n) => n.id));
    const persistEdges = edgesRef.current.filter(
      (ed) => ed.source !== BULK_PHANTOM_ID && ed.target !== BULK_PHANTOM_ID && persistNodeIds.has(ed.source) && persistNodeIds.has(ed.target)
    );
    const snapshot = JSON.stringify({ nodes: persistNodes, edges: persistEdges });
    if (persistNodes.length === 0 && lastSavedRef.current !== '') {
      try {
        const previous = JSON.parse(lastSavedRef.current);
        if (Array.isArray(previous.nodes) && previous.nodes.length > 0) return;
      } catch {
        return;
      }
    }
    await api.saveCanvasData(activeId, { nodes: persistNodes, edges: persistEdges, viewport: { x: 0, y: 0, zoom: 1 } });
    lastSavedRef.current = snapshot;
  }, [activeId, loaded]);

  useEffect(() => {
    if (!onSaveRef) return;
    onSaveRef.current = saveCurrentCanvas;
    return () => {
      if (onSaveRef.current === saveCurrentCanvas) onSaveRef.current = null;
    };
  }, [onSaveRef, saveCurrentCanvas]);

  useEffect(() => {
    const handleForceSave = () => {
      void saveCurrentCanvas().catch((e) => console.error('保存画布失败', e));
    };
    window.addEventListener('imade:force-save', handleForceSave);
    return () => window.removeEventListener('imade:force-save', handleForceSave);
  }, [saveCurrentCanvas]);

  // 鑷姩淇濆瓨(闃叉姈 800ms,闃茬┖鏁版嵁瑕嗙洊)
  useEffect(() => {
    if (!activeId || !loaded) return;
    // 杩囨护 SHIFT 鎵归噺绉荤嚎鎷栨嫿杩囩▼涓殑 phantom 鑺傜偣涓庨噸瀹氬悜杈?涓嶄綔涓烘寔涔呭寲蹇収)
    const persistNodes = nodes.filter((n) => n.id !== BULK_PHANTOM_ID && n.type !== 'output');
    const persistNodeIds = new Set(persistNodes.map((n) => n.id));
    const persistEdges = edges.filter(
      (ed) => ed.source !== BULK_PHANTOM_ID && ed.target !== BULK_PHANTOM_ID && persistNodeIds.has(ed.source) && persistNodeIds.has(ed.target)
    );
    const snapshot = JSON.stringify({ nodes: persistNodes, edges: persistEdges });
    if (snapshot === lastSavedRef.current) return;
    if (persistNodes.length === 0 && lastSavedRef.current !== '' && JSON.parse(lastSavedRef.current).nodes?.length > 0) {
      // 闃叉绌烘暟鎹鐩?
      return;
    }
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        await saveCurrentCanvas();
      } catch (e) {
        console.error('淇濆瓨鐢诲竷澶辫触', e);
      }
    }, 800);
  }, [nodes, edges, activeId, loaded, saveCurrentCanvas]);

  const getViewportCenterFlowPosition = useCallback(() => {
    const flowEl = document.querySelector('.react-flow') as HTMLElement | null;
    const rect = flowEl?.getBoundingClientRect();
    return screenToFlowPosition({
      x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
      y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
    });
  }, [screenToFlowPosition]);

  const createDrawingBoardFrame = useCallback(
    (size: { w: number; h: number; label?: string }, topLeft?: { x: number; y: number }) => {
      const w = Math.max(MIN_FRAME_CREATE_W, Math.round(size.w));
      const h = Math.max(MIN_FRAME_CREATE_H, Math.round(size.h));
      const center = topLeft ? null : getViewportCenterFlowPosition();
      const id = `drawing-board-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newNode: Node = {
        id,
        type: 'drawing-board',
        zIndex: getNextLayerZ(nodesRef.current, 'drawing-board'),
        position: topLeft
          ? { x: Math.round(topLeft.x), y: Math.round(topLeft.y) }
          : { x: Math.round((center?.x || 0) - w / 2), y: Math.round((center?.y || 0) - h / 2) },
        selected: true,
        data: {
          ...(INITIAL_DATA['drawing-board'] || {}),
          name: size.label || '画框',
          frameW: w,
          frameH: h,
          resolutionW: w,
          resolutionH: h,
        },
      };
      setNodes((prev) => orderParentFramesFirst([...prev.map((n) => ({ ...n, selected: false })), newNode]));
      setFrameCreateMode(false);
      setFrameDraft(null);
      setPaneMenu(null);
      return newNode;
    },
    [getViewportCenterFlowPosition],
  );

  const updateSelectedFrameSize = useCallback((size: { w: number; h: number; label?: string }) => {
    const w = Math.max(MIN_FRAME_CREATE_W, Math.round(size.w));
    const h = Math.max(MIN_FRAME_CREATE_H, Math.round(size.h));
    setNodes((prev) =>
      applyFrameClipping(
        prev.map((n) => {
          if (!n.selected || n.type !== 'drawing-board') return n;
          return {
            ...n,
            data: {
              ...((n.data as any) || {}),
              frameW: w,
              frameH: h,
              resolutionW: w,
              resolutionH: h,
              ...(size.label ? { framePresetLabel: size.label } : {}),
            },
          };
        }),
      ),
    );
  }, []);

  const applyFrameSizeChoice = useCallback(
    (size: { w: number; h: number; label?: string }) => {
      const hasSelectedFrame = nodesRef.current.some((n) => n.selected && n.type === 'drawing-board');
      if (hasSelectedFrame) {
        updateSelectedFrameSize(size);
      } else {
        createDrawingBoardFrame(size);
      }
    },
    [createDrawingBoardFrame, updateSelectedFrameSize],
  );

  const cancelFrameCreateMode = useCallback(() => {
    setFrameCreateMode(false);
    setFrameDraft(null);
  }, []);

  // 娣诲姞鑺傜偣(渚?Sidebar 璋冪敤) 鈥斺€?榛樿钀藉湪褰撳墠瑙嗗彛涓績
  // 鍙€?atScreen 浼犲叆灞忓箷鍧愭爣锛岃妭鐐逛細钀藉湪璇ョ偣(鐢ㄤ簬鍙抽敭鐢诲竷绌虹櫧鍖烘坊鍔?
  const addNode = useCallback(
    (type: NodeType, atScreen?: { x: number; y: number }) => {
      if (type === 'drawing-board' && !atScreen) {
        setFrameCreateMode(true);
        setFrameDraft(null);
        setPaneMenu(null);
        return;
      }
      if (type === 'drawing-board' && atScreen) {
        createDrawingBoardFrame({ w: customFrameSize.w, h: customFrameSize.h, label: `${customFrameSize.w}×${customFrameSize.h}` }, screenToFlowPosition(atScreen));
        return;
      }
      const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      let cx: number;
      let cy: number;
      if (atScreen) {
        cx = atScreen.x;
        cy = atScreen.y;
      } else {
        // 浠?ReactFlow 鐢诲竷瀹瑰櫒涓績涓洪粯璁ゆ彃鍏ョ偣锛涙嬁涓嶅埌鍒?fallback 鍒?window 涓績
        const flowEl =
          document.querySelector('.react-flow') as HTMLElement | null;
        const rect = flowEl?.getBoundingClientRect();
        cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
        cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
      }
      const center = screenToFlowPosition({ x: cx, y: cy });
      // 浠呴粯璁ゆ彃鍏?鏃?atScreen)鏃跺姞闅忔満鎷栧姩锛屽彸閿彃鍏ラ渶绮惧噯鍦ㄧ偣鍑讳綅缃?
      const jitter = atScreen ? 0 : (Math.random() - 0.5) * 80;
      const newNode: Node = {
        id,
        type,
        zIndex: getNextLayerZ(nodesRef.current, type),
        position: atScreen
          ? {
              // 鍙抽敭娣诲姞锛氳妭鐐瑰乏涓婅瀵瑰噯榧犳爣鐐瑰嚮浣嶇疆锛屼娇榧犳爣钀藉湪鑺傜偣 header 涓?
              x: center.x,
              y: center.y,
            }
          : {
              // Sidebar 娣诲姞锛氳妭鐐硅瑙変腑蹇冨鍑嗚鍙ｄ腑蹇?+ 灏忚寖鍥存姈鍔ㄩ伩鍏嶉噸鍙?
              x: center.x - 160 + jitter,
              y: center.y - 100 + (Math.random() - 0.5) * 80,
            },
        data: { ...(INITIAL_DATA[type] || {}) },
      };
      setNodes((prev) => [...prev, newNode]);
    },
    [createDrawingBoardFrame, customFrameSize.h, customFrameSize.w, screenToFlowPosition]
  );

  // ===== 澶嶅埗 / 绮樿创 / 鍒犻櫎 =====
  const getDroppedImageFiles = (e: React.DragEvent): File[] =>
    Array.from(e.dataTransfer?.files || []).filter((file) => file.type.startsWith('image/'));

  const handlePaneDragOver = useCallback((e: React.DragEvent) => {
    const hasImage = Array.from(e.dataTransfer?.items || []).some(
      (item) => item.kind === 'file' && item.type.startsWith('image/')
    );
    if (!hasImage) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handlePaneDrop = useCallback(
    async (e: React.DragEvent) => {
      const files = getDroppedImageFiles(e);
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();

      const base = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        try {
          const uploaded = await uploadAssetFile(file);
          const newNode: Node = {
            id: `upload-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'upload',
            position: { x: base.x + i * 34, y: base.y + i * 34 },
            data: {
              uploadType: 'image',
              imageUrl: uploaded.url,
              fileName: file.name,
              fileSize: file.size,
              mime: file.type,
            },
          };
          setNodes((prev) => [...prev, { ...newNode, zIndex: getNextLayerZ(prev, 'upload') }]);
        } catch (err) {
          console.error('鍥剧墖鎷栧叆涓婁紶澶辫触', err);
        }
      }
    },
    [screenToFlowPosition]
  );

  const handleClipboardImagePaste = useCallback(
    async (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      const items = Array.from(event.clipboardData?.items || []);
      const imageFiles = items
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter(Boolean) as File[];
      if (imageFiles.length === 0) return;
      event.preventDefault();
      const base = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      for (let i = 0; i < imageFiles.length; i += 1) {
        const file = imageFiles[i];
        const namedFile = new File([file], file.name || `clipboard-${Date.now()}-${i}.png`, {
          type: file.type || 'image/png',
        });
        try {
          const uploaded = await uploadAssetFile(namedFile);
          setNodes((prev) => [
            ...prev,
            {
              id: `upload-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
              type: 'upload',
              zIndex: getNextLayerZ(prev, 'upload'),
              position: { x: base.x + i * 34, y: base.y + i * 34 },
              data: {
                uploadType: 'image',
                imageUrl: uploaded.url,
                fileName: namedFile.name,
                fileSize: namedFile.size,
                mime: namedFile.type,
              },
            } as Node,
          ]);
        } catch (err) {
          console.error('粘贴截图失败', err);
        }
      }
    },
    [screenToFlowPosition]
  );

  useEffect(() => {
    window.addEventListener('paste', handleClipboardImagePaste);
    return () => window.removeEventListener('paste', handleClipboardImagePaste);
  }, [handleClipboardImagePaste]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 1) return;
      const target = event.target as HTMLElement | null;
      if (!target?.closest('.react-flow')) return;
      if (
        target.closest('.react-flow__node') ||
        target.closest('.react-flow__handle') ||
        target.closest('button') ||
        target.closest('input') ||
        target.closest('textarea') ||
        target.closest('select') ||
        target.closest('[contenteditable="true"]')
      ) {
        return;
      }
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const startViewport = getViewport();
      const onMove = (moveEvent: MouseEvent) => {
        setViewport({
          x: startViewport.x + moveEvent.clientX - startX,
          y: startViewport.y + moveEvent.clientY - startY,
          zoom: startViewport.zoom,
        });
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };
    window.addEventListener('mousedown', onMouseDown, { capture: true });
    return () => window.removeEventListener('mousedown', onMouseDown, true);
  }, [getViewport, setViewport]);

  const handleCopy = useCallback(() => {
    const sel = nodes.filter((n) => n.selected);
    if (sel.length === 0) return;
    const ids = new Set(sel.map((n) => n.id));
    // 鍐呴儴杈? source/target 閮藉湪閫変腑闆嗗悎 鈥斺€?鏅€氱矘璐?蹇€熷鍒朵細浣跨敤
    const selEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    // 澶栭儴鍏ヨ竟: target 鍦ㄩ€変腑闆嗗悎,source 涓嶅湪 鈥斺€?Ctrl+Shift+V 杩炶竟绮樿创浣跨敤
    const incomingEdges = edges.filter((e) => !ids.has(e.source) && ids.has(e.target));
    // 澶栭儴鍑鸿竟: source 鍦ㄩ€変腑闆嗗悎,target 涓嶅湪
    const outgoingEdges = edges.filter((e) => ids.has(e.source) && !ids.has(e.target));
    clipboardRef.current = {
      nodes: JSON.parse(JSON.stringify(sel.map((n) => {
        const parentId = (n as any).parentId as string | undefined;
        if (!parentId || ids.has(parentId)) return n;
        return {
          ...n,
          parentId: undefined,
          extent: undefined,
          position: getNodeAbsolutePosition(n, nodes),
        };
      }))),
      edges: JSON.parse(JSON.stringify(selEdges)),
      incomingEdges: JSON.parse(JSON.stringify(incomingEdges)),
      outgoingEdges: JSON.parse(JSON.stringify(outgoingEdges)),
    };
    setClipboardCount(sel.length);
  }, [nodes, edges]);

  // 鏅€氱矘璐? 浠呭鍒堕€変腑鑺傜偣 + 鍏跺唴閮ㄨ竟(涓庡師閫昏緫涓€鑷?
  // withLinks=true: Ctrl+Shift+V 棰濆澶嶅埗鍘熻妭鐐圭殑澶栭儴鍏ヨ竟/鍑鸿竟 鈥斺€?灏嗘柊鑺傜偣涓庡師鐢诲竷涓婅繕瀛樺湪鐨勯偦灞呰繛鎺?
  const handlePaste = useCallback((withLinks = false) => {
    const cb = clipboardRef.current as (typeof clipboardRef.current & {
      incomingEdges?: Edge[];
      outgoingEdges?: Edge[];
    }) | null;
    if (!cb || cb.nodes.length === 0) return;
    // 杩愯鏃跺瓧娈甸粦鍚嶅崟(澶嶅埗/绮樿创鏃跺繀椤婚噸缃?閬垮厤鏂拌妭鐐规樉绀轰负杩涜涓?鎼哄甫鏃?taskId)
    const RUNTIME_KEYS = [
      'status', 'taskId', 'progress', 'error',
      'isRunning', 'isPolling', 'pollingTimer',
    ];
    const sanitize = (data: any) => {
      const next: any = { ...(data || {}) };
      for (const k of RUNTIME_KEYS) delete next[k];
      next.status = 'idle';
      return next;
    };
    const idMap = new Map<string, string>();
    const stamp = Date.now();
    cb.nodes.forEach((n, idx) => {
      const newId = `${n.type}-${stamp}-${idx}-${Math.random().toString(36).slice(2, 5)}`;
      idMap.set(n.id, newId);
    });
    const newNodes = cb.nodes.map((n, idx) => {
      const newId = idMap.get(n.id)!;
      const parentId = (n as any).parentId as string | undefined;
      const nextParentId = parentId ? idMap.get(parentId) : undefined;
      return {
        ...n,
        id: newId,
        selected: true,
        parentId: nextParentId,
        extent: undefined,
        zIndex: isLayerableNode(n) ? getNextLayerZ(nodesRef.current, n.type) + idx * 10 : n.zIndex,
        position: {
          x: (n.position?.x ?? 0) + 40,
          y: (n.position?.y ?? 0) + 40,
        },
        data: sanitize(n.data),
      } as Node;
    });
    // 鍐呴儴杈? source/target 閮芥槧灏勫埌鏂拌妭鐐?
    const newInternalEdges = cb.edges
      .map((e, idx) => {
        const s = idMap.get(e.source);
        const t = idMap.get(e.target);
        if (!s || !t) return null;
        return {
          ...e,
          id: `e-${stamp}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
          source: s,
          target: t,
        } as Edge;
      })
      .filter(Boolean) as Edge[];
    let extraEdges: Edge[] = [];
    if (withLinks) {
      // 澶栭儴鍏ヨ竟: source 淇濈暀(鍘熻妭鐐归』浠嶅湪鐢诲竷), target 鏄犲皠涓烘柊鑺傜偣
      const incoming = (cb.incomingEdges || [])
        .map((e, idx) => {
          const sourceStillExists = nodes.some((n) => n.id === e.source);
          const t = idMap.get(e.target);
          if (!sourceStillExists || !t) return null;
          return {
            ...e,
            id: `e-in-${stamp}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
            source: e.source,
            target: t,
          } as Edge;
        })
        .filter(Boolean) as Edge[];
      // 澶栭儴鍑鸿竟: source 鏄犲皠涓烘柊鑺傜偣, target 淇濈暀
      const outgoing = (cb.outgoingEdges || [])
        .map((e, idx) => {
          const targetStillExists = nodes.some((n) => n.id === e.target);
          const s = idMap.get(e.source);
          if (!targetStillExists || !s) return null;
          return {
            ...e,
            id: `e-out-${stamp}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
            source: s,
            target: e.target,
          } as Edge;
        })
        .filter(Boolean) as Edge[];
      extraEdges = [...incoming, ...outgoing];
    }
    // 鍙栨秷鍏朵粬鑺傜偣鐨勯€変腑,鏂扮矘璐磋妭鐐硅涓洪€変腑
    setNodes((prev) => [...prev.map((n) => ({ ...n, selected: false })), ...newNodes]);
    setEdges((prev) => [...prev, ...newInternalEdges, ...extraEdges]);
  }, [nodes]);

  const handleDuplicate = useCallback(() => {
    handleCopy();
    // 鍦?copy 瀹屾垚鍚庝笅涓€甯ф墽琛?paste(鐢变簬涓婇潰鐨?setClipboardCount 鏄紓姝?
    setTimeout(() => handlePaste(false), 0);
  }, [handleCopy, handlePaste]);

  const handleDeleteSelected = useCallback(() => {
    setNodes((prev) => {
      const removeIds = new Set(prev.filter((n) => n.selected).map((n) => n.id));
      if (removeIds.size === 0) return prev;
      setEdges((eds) =>
        eds.filter((e) => !removeIds.has(e.source) && !removeIds.has(e.target) && !e.selected)
      );
      return prev.filter((n) => !removeIds.has(n.id));
    });
    setEdges((prev) => prev.filter((e) => !e.selected));
  }, []);

  // ===== 瀵煎叆 / 瀵煎嚭 =====
  const handleExport = useCallback(() => {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      nodes,
      edges,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `canvas-${activeId || 'export'}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [nodes, edges, activeId]);

  const handleDownloadFrame = useCallback(async (frame: Node) => {
    const frameData = (frame.data || {}) as Record<string, any>;
    const frameRect = getNodeRect(frame, nodesRef.current);
    const width = Math.max(1, Math.round(Number(frameData.frameW || frameRect.w || 800)));
    const height = Math.max(1, Math.round(Number(frameData.frameH || frameRect.h || 800)));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    drawBackgroundPaint(ctx, frameData, width, height);
    const members = nodesRef.current
      .filter((node) => (node as any).parentId === frame.id && canFrameContainNode(node))
      .sort((a, b) => getLayerZ(a, nodesRef.current.indexOf(a)) - getLayerZ(b, nodesRef.current.indexOf(b)));
    let skippedVideo = 0;

    for (const node of members) {
      const data = (node.data || {}) as Record<string, any>;
      const rect = getNodeRect(node, nodesRef.current);
      const x = rect.x - frameRect.x;
      const y = rect.y - frameRect.y;
      const w = rect.w;
      const h = rect.h;

      if (node.type === 'text') {
        const text = String(data.prompt || '');
        if (!text.trim()) continue;
        const fontSize = Math.max(8, Number(data.fontSize || 48));
        const lineHeight = Math.max(0.7, Number(data.lineHeight || 1.12));
        const fontWeight = Number(data.fontWeight || 600);
        const fontFamily = data.fontFamily || TEXT_FONT_OPTIONS[0].value;
        const lines = text.split(/\r?\n/);
        const linePx = Math.max(fontSize, fontSize * lineHeight);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, width, height);
        ctx.clip();
        ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
        ctx.textBaseline = 'top';
        ctx.textAlign = data.textAlign === 'center' ? 'center' : data.textAlign === 'right' ? 'right' : 'left';
        if (data.colorMode === 'gradient') {
          const angle = ((Number(data.gradientAngle ?? 90) - 90) * Math.PI) / 180;
          const len = Math.max(w, h);
          const grad = ctx.createLinearGradient(
            x + w / 2 - Math.cos(angle) * len / 2,
            y + h / 2 - Math.sin(angle) * len / 2,
            x + w / 2 + Math.cos(angle) * len / 2,
            y + h / 2 + Math.sin(angle) * len / 2,
          );
          grad.addColorStop(0, data.gradientFrom || data.color || '#111111');
          grad.addColorStop(1, data.gradientTo || '#ffffff');
          ctx.fillStyle = grad;
        } else {
          ctx.fillStyle = data.color || '#111111';
        }
        const baseX = ctx.textAlign === 'center' ? x + w / 2 : ctx.textAlign === 'right' ? x + w : x;
        lines.forEach((line, index) => ctx.fillText(line || ' ', baseX, y + index * linePx));
        ctx.restore();
        continue;
      }

      const imageUrl = data.imageUrl || (data.uploadType === 'image' ? data.imageUrl : '');
      if (imageUrl) {
        try {
          const image = await loadCanvasImage(String(imageUrl));
          const scale = Math.min(w / image.naturalWidth, h / image.naturalHeight);
          const dw = image.naturalWidth * scale;
          const dh = image.naturalHeight * scale;
          ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
        } catch (err) {
          console.warn('frame export image skipped', node.id, err);
        }
        continue;
      }

      if (node.type === 'video' || node.type === 'seedance') {
        skippedVideo += 1;
      }
    }

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;
    await downloadBlob(blob, `frame-${width}x${height}-${Date.now()}.png`);
    if (skippedVideo > 0) {
      alert(`画框已导出。${skippedVideo} 个视频节点无法读取当前帧，已跳过。`);
    }
  }, []);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';

      const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
      if (isPng) {
        try {
          const uploaded = await uploadAssetFile(file);
          const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
          const newNode: Node = {
            id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'upload',
            zIndex: getNextLayerZ(nodesRef.current, 'upload'),
            selected: true,
            position: { x: center.x - 160, y: center.y - 120 },
            data: {
              uploadType: 'image',
              imageUrl: uploaded.url,
              fileName: file.name || uploaded.filename,
              fileSize: file.size,
              mime: file.type || 'image/png',
            },
          };
          setNodes((prev) => [...prev.map((n) => ({ ...n, selected: false })), newNode]);
        } catch (err) {
          alert(`导入 PNG 失败：${err instanceof Error ? err.message : String(err)}`);
          console.error(err);
        }
        return;
      }

      if (file.type && file.type !== 'application/json' && !/\.json$/i.test(file.name)) {
        alert('请选择 JSON 画布文件或 PNG 透明底图');
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const txt = String(reader.result || '');
          const json = JSON.parse(txt);
          const importedNodes = Array.isArray(json.nodes) ? json.nodes : [];
          const importedEdges = Array.isArray(json.edges) ? json.edges : [];
          if (!confirm(`瀵煎叆灏嗘浛鎹㈠綋鍓嶇敾甯?${importedNodes.length} 涓妭鐐?/ ${importedEdges.length} 鏉¤繛绾?,鏄惁缁х画?`)) {
            return;
          }
          const clean = withoutRemovedNodes(importedNodes, importedEdges);
          setNodes(clean.nodes);
          setEdges(clean.edges);
        } catch (err) {
          alert('瀵煎叆澶辫触:JSON 瑙ｆ瀽閿欒');
          console.error(err);
        }
      };
      reader.readAsText(file);
    },
    [screenToFlowPosition]
  );

  // ===== 搴旂敤妯℃澘 =====
  const handleApplyTemplate = useCallback((tpl: CanvasTemplate) => {
    const built = tpl.build();
    // 鍋忕Щ鐜版湁 nodes 鏁伴噺,閬垮厤閲嶅彔
    setNodes((prev) => [...prev.map((n) => ({ ...n, selected: false })), ...built.nodes.map((n) => ({ ...n, selected: true }))]);
    setEdges((prev) => [...prev, ...built.edges]);
  }, []);

  // ===== 鎵归噺杩愯 =====
  // 閫氱敤: 鍦ㄦ寚瀹氳妭鐐瑰瓙闆嗕笂鎷撴墤鎺掑簭 + 涓茶璋?runBus
  const runNodesByOrder = useCallback(
    async (subNodes: Node[], subEdges: Edge[]) => {
      const order = topologicalSort(subNodes, subEdges, EXECUTABLE_NODE_TYPES);
      if (order.length === 0) return 0;
      cancelRunRef.current = false;
      setIsRunning(true);
      const { triggerRun, setBatchProgress, cancelAll } = useRunBusStore.getState();
      setBatchProgress(order.length, 0);
      try {
        for (let i = 0; i < order.length; i++) {
          if (cancelRunRef.current) break;
          const id = order[i];
          await new Promise<void>((resolve) => {
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              unsub();
              window.clearTimeout(timer);
              resolve();
            };
            const unsub = useRunBusStore.subscribe((state) => {
              if (state.lastDone && state.lastDone.id === id) finish();
              if (cancelRunRef.current) finish();
            });
            // 瀹夊叏瓒呮椂 5 鍒嗛挓(杞浠诲姟鍙兘杈冮暱)
            const timer = window.setTimeout(finish, 5 * 60 * 1000);
            triggerRun(id, 'batch');
          });
          setBatchProgress(order.length, i + 1);
        }
      } finally {
        cancelAll();
        setIsRunning(false);
        cancelRunRef.current = false;
      }
      return order.length;
    },
    []
  );

  const handleRunAll = useCallback(async () => {
    if (isRunning) return;
    const order = topologicalSort(nodes, edges, EXECUTABLE_NODE_TYPES);
    if (order.length === 0) {
      alert('鐢诲竷涓婃病鏈夊彲鎵ц鑺傜偣');
      return;
    }
    await runNodesByOrder(nodes, edges);
  }, [isRunning, nodes, edges, runNodesByOrder]);

  // 缁勬墽琛? 浠呭湪閫変腑鐨勮妭鐐瑰瓙闆嗕笂杩愯(浠呬繚鐣欏瓙闆嗗唴閮ㄨ竟浣滀负渚濊禆)
  const handleRunGroup = useCallback(
    async (ids: string[]) => {
      if (isRunning) return;
      const idSet = new Set(ids);
      const subNodes = nodes.filter((n) => idSet.has(n.id));
      const subEdges = edges.filter((e) => idSet.has(e.source) && idSet.has(e.target));
      const executable = subNodes.filter((n) => n.type && EXECUTABLE_NODE_TYPES.has(n.type));
      if (executable.length === 0) {
        alert('所选节点中没有可执行节点');
        return;
      }
      await runNodesByOrder(subNodes, subEdges);
    },
    [isRunning, nodes, edges, runNodesByOrder]
  );

  // ===== ALT+鎷栧姩澶嶅埗鑺傜偣 =====
  // 鎬濊矾: dragStart 鏃跺湪鍘熶綅鎻掑叆鍗犱綅鍏嬮殕(涓存椂ID),鐢ㄦ埛鎷栧姩杩囩▼涓師浣嶇湅璧锋潵鏈夎妭鐐逛笉鍔?
  // dragStop 鏃跺仛 ID 浜掓崲: 鍗犱綅鍏嬮殕 鈫?鎭㈠鍘熷ID(淇濈暀杩炵嚎), 琚嫋璧扮殑鍘熻妭鐐?鈫?鍒嗛厤鏂癐D(sanitize)
  // 鏈€缁堟晥鏋? 鍘熻妭鐐圭暀鍦ㄥ師浣?淇濈暀杩炵嚎鍜屾暟鎹?, 鏂板鍒惰妭鐐瑰湪鎷栨斁浣嶇疆
  const altDragCloneRef = useRef<{
    placeholderIds: Map<string, string>; // origId -> placeholderId
  } | null>(null);

  const onNodeDragStart = useCallback(
    (e: React.MouseEvent | MouseEvent, node: Node) => {
      altDragCloneRef.current = null;
      frameDragRef.current = null;
      if (node.type === 'drawing-board') {
        const allNodes = nodes.map((n) => (n.id === node.id ? node : n));
        const frameRect = getNodeRect(node, allNodes);
        const memberIds = allNodes
          .filter((n) => n.id !== node.id && canFrameContainNode(n) && (n as any).parentId !== node.id)
          .filter((n) => {
            const r = getNodeRect(n, allNodes);
            return r.C >= frameRect.L && r.C <= frameRect.R && r.M >= frameRect.T && r.M <= frameRect.B;
          })
          .map((n) => n.id);
        frameDragRef.current = {
          frameId: node.id,
          lastX: node.position.x,
          lastY: node.position.y,
          memberIds,
        };
      }
      if (!e.altKey) return;
      // ALT 鎸変笅: 纭畾琚嫋鍔ㄧ殑鑺傜偣闆嗗悎
      const selected = nodes.filter((n) => n.selected);
      const targets = selected.length > 0 && selected.some((n) => n.id === node.id)
        ? selected
        : [node];
      // 鍦ㄥ師浣嶅垱寤哄崰浣嶅厠闅?涓存椂 ID, 鍚屾牱澶栬 / 鏁版嵁, 浣嗕笉閫変腑)
      const stamp = Date.now();
      const placeholderIds = new Map<string, string>();
      const placeholders: Node[] = [];
      targets.forEach((n, idx) => {
        const phId = `_alt-ph-${stamp}-${idx}-${Math.random().toString(36).slice(2, 5)}`;
        placeholderIds.set(n.id, phId);
        placeholders.push({
          ...n,
          id: phId,
          selected: false,
          position: { ...n.position },
          data: JSON.parse(JSON.stringify(n.data || {})),
        } as Node);
      });
      setNodes((prev) => [...prev, ...placeholders]);
      // 绔嬪嵆灏嗚繛鎺ュ師鑺傜偣鐨勮竟杞Щ鍒板崰浣嶅厠闅嗕笂,杩欐牱鎷栧姩杩囩▼涓繛绾跨暀鍦ㄥ師浣嶄笉鍔?
      setEdges((prev) => prev.map((e2) => {
        let s = e2.source;
        let t = e2.target;
        const phS = placeholderIds.get(s);
        const phT = placeholderIds.get(t);
        if (!phS && !phT) return e2;
        return { ...e2, source: phS || s, target: phT || t };
      }));
      altDragCloneRef.current = { placeholderIds };
    },
    [nodes]
  );

  // ===== 鑺傜偣缁?GroupBox) =====
  // 鎷栧姩缁勮妭鐐规椂浣跨敤,璁板綍涓婁竴甯т綅缃互璁＄畻 delta 鍚屾鍋忕Щ鎴愬憳鑺傜偣
  // memberIds 鍦ㄦ嫋鍔ㄥ紑濮嬫椂鏍规嵁褰撳墠鍑犱綍鍏崇郴鍔ㄦ€佽绠?涓嶄緷璧栧垱缁勬椂蹇収)
  const groupDragRef = useRef<{
    groupId: string;
    lastX: number;
    lastY: number;
    memberIds: string[];
  } | null>(null);
  const frameDragRef = useRef<{
    frameId: string;
    lastX: number;
    lastY: number;
    memberIds: string[];
  } | null>(null);

  // 鍒涘缓鑺傜偣缁? 璁＄畻 bounding box, 鐢熸垚 type='groupBox' 鑺傜偣瑁呰繘 nodes
  const handleCreateGroup = useCallback(
    (ids: string[]) => {
      // 鎺掗櫎 groupBox 鑷韩(涓嶅厑璁稿祵濂楃粍)
      const targets = nodes.filter((n) => ids.includes(n.id) && n.type !== 'groupBox');
      if (targets.length < 1) {
        alert('璇峰厛閫変腑瑕佹墦缁勭殑鑺傜偣');
        return;
      }
      const PAD = 30;
      const HEADER = 40;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of targets) {
        const w = (n as any).width || (n as any).measured?.width || 200;
        const h = (n as any).height || (n as any).measured?.height || 100;
        const x = n.position.x;
        const y = n.position.y;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x + w > maxX) maxX = x + w;
        if (y + h > maxY) maxY = y + h;
      }
      const groupX = minX - PAD;
      const groupY = minY - PAD - HEADER;
      const groupW = (maxX - minX) + PAD * 2;
      const groupH = (maxY - minY) + PAD * 2 + HEADER;
      const newId = `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      // 闅忔満閫変竴涓鑹?
      const color = GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)];
      const groupNode: Node = {
        id: newId,
        type: 'groupBox',
        position: { x: groupX, y: groupY },
        data: {
          name: DEFAULT_GROUP_NAME,
          color,
          memberIds: targets.map((n) => n.id),
          width: groupW,
          height: groupH,
        },
        // 缃簬鏅€氳妭鐐逛箣涓?璐?1000 閬垮厤閫変腑鏃?zIndex 琚嫭鍙疯皟楂?
        zIndex: -1000,
        draggable: true,
        selectable: true,
        deletable: true,
        // 鍙繛鎺? 鍙充晶 source handle 鑳芥妸銆岀粍鍐呮墍鏈夎妭鐐圭殑鑱氬悎杈撳嚭銆嶄紶缁欑粍澶?
        connectable: true,
      } as Node;
      // 鎻掑叆鍒版渶鍓嶉潰,纭繚娓叉煋椤哄簭鍦ㄥ簳(閰嶅悎 zIndex 璐熷€?
      setNodes((prev) => [groupNode, ...prev.map((n) => ({ ...n, selected: false }))]);
    },
    [nodes]
  );

  // 鐩戝惉 GroupBox 鐨勬墽琛岃姹?/ 鍒犻櫎璇锋眰
  const executeReq = useGroupBusStore((s) => s.executeReq);
  const deleteReq = useGroupBusStore((s) => s.deleteReq);
  const clearExecuteReq = useGroupBusStore((s) => s.clearExecute);
  const clearDeleteReq = useGroupBusStore((s) => s.clearDelete);

  useEffect(() => {
    if (!executeReq) return;
    handleRunGroup(executeReq.memberIds);
    clearExecuteReq();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executeReq?.ts]);

  useEffect(() => {
    if (!deleteReq) return;
    setNodes((prev) => prev.filter((n) => n.id !== deleteReq.groupId));
    clearDeleteReq();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteReq?.ts]);

  const handleCancelRun = useCallback(() => {
    cancelRunRef.current = true;
    useRunBusStore.getState().cancelAll();
  }, []);

  // ===== 鏅鸿兘瀵归綈杈呭姪绾?=====
  const onNodeDrag = useCallback(
    (_e: any, node: Node) => {
      if (node.type === 'drawing-board' && frameDragRef.current?.frameId === node.id) {
        const ref = frameDragRef.current;
        const dx = node.position.x - ref.lastX;
        const dy = node.position.y - ref.lastY;
        if (dx !== 0 || dy !== 0) {
          ref.lastX = node.position.x;
          ref.lastY = node.position.y;
          if (ref.memberIds.length > 0) {
            const idSet = new Set(ref.memberIds);
            setNodes((prev) =>
              applyFrameClipping(
                prev.map((n) =>
                  idSet.has(n.id) && !(n as any).parentId
                    ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
                    : n
                )
              )
            );
          }
        }
      }
      // 鎷栧姩 GroupBox 鑺傜偣: 鑱斿姩鎵€鏈夋垚鍛樿妭鐐瑰悓姝ュ亸绉?
      if (node.type === 'groupBox') {
        const ref = groupDragRef.current;
        if (!ref || ref.groupId !== node.id) {
          // 棣栧抚: 鏍规嵁褰撳墠鍑犱綍浣嶇疆閲嶆柊璁＄畻鍝簺鑺傜偣鍦ㄧ粍鐭╁舰鍐?
          // (鑺傜偣涓績鐐瑰湪缁?bbox 鍐呭垯瑙嗕负鎴愬憳,涓嶅啀渚濊禆鍒涚粍鏃剁殑闈欐€?memberIds)
          const gx = node.position.x;
          const gy = node.position.y;
          const gw =
            (node.data as any)?.width ||
            (node as any).width ||
            (node as any).measured?.width ||
            0;
          const gh =
            (node.data as any)?.height ||
            (node as any).height ||
            (node as any).measured?.height ||
            0;
          const liveMembers: string[] = [];
          for (const n of nodes) {
            if (n.id === node.id) continue;
            if (n.type === 'groupBox') continue; // 涓嶅祵濂楃粍
            const nw =
              (n as any).width || (n as any).measured?.width || 200;
            const nh =
              (n as any).height || (n as any).measured?.height || 100;
            const cx = n.position.x + nw / 2;
            const cy = n.position.y + nh / 2;
            if (cx >= gx && cx <= gx + gw && cy >= gy && cy <= gy + gh) {
              liveMembers.push(n.id);
            }
          }
          groupDragRef.current = {
            groupId: node.id,
            lastX: node.position.x,
            lastY: node.position.y,
            memberIds: liveMembers,
          };
          return;
        }
        const dx = node.position.x - ref.lastX;
        const dy = node.position.y - ref.lastY;
        if (dx === 0 && dy === 0) return;
        ref.lastX = node.position.x;
        ref.lastY = node.position.y;
        if (ref.memberIds.length === 0) return;
        const idSet = new Set(ref.memberIds);
        setNodes((prev) =>
          prev.map((n) =>
            idSet.has(n.id)
              ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
              : n
          )
        );
        return;
      }
      if (!snapEnabled || !isAlignableNode(node)) return;
      const allNodes = nodes.map((n) => (n.id === node.id ? node : n));
      const rect = getNodeRect(node, allNodes);
      const tx = Math.round(rect.x);
      const ty = Math.round(rect.y);
      const targets = { L: rect.L, C: rect.C, R: rect.R, T: rect.T, M: rect.M, B: rect.B };
      const vGuides = new Set<number>();
      const hGuides = new Set<number>();
      let snapDX: number | null = null;
      let snapDY: number | null = null;
      let bestVDiff = ALIGN_THRESHOLD + 1;
      let bestHDiff = ALIGN_THRESHOLD + 1;
      for (const other of allNodes) {
        if (other.id === node.id) continue;
        if (!isAlignableNode(other)) continue;
        const oVals = getNodeRect(other, allNodes);
        // 鍨傜洿杈呭姪绾?鍒楀榻?: L/C/R 瀵?L/C/R
        for (const tk of ['L', 'C', 'R'] as const) {
          for (const ok of ['L', 'C', 'R'] as const) {
            const diff = Math.abs(targets[tk] - oVals[ok]);
            if (diff <= ALIGN_THRESHOLD) {
              vGuides.add(oVals[ok]);
              if (diff < bestVDiff) {
                bestVDiff = diff;
                snapDX = oVals[ok] - targets[tk];
              }
            }
          }
        }
        // 姘村钩杈呭姪绾?琛屽榻?: T/M/B 瀵?T/M/B
        for (const tk of ['T', 'M', 'B'] as const) {
          for (const ok of ['T', 'M', 'B'] as const) {
            const diff = Math.abs(targets[tk] - oVals[ok]);
            if (diff <= ALIGN_THRESHOLD) {
              hGuides.add(oVals[ok]);
              if (diff < bestHDiff) {
                bestHDiff = diff;
                snapDY = oVals[ok] - targets[tk];
              }
            }
          }
        }
        const verticalTouchTargets = [
          { diff: Math.abs(targets.B - oVals.T), dy: oVals.T - targets.B, guide: oVals.T },
          { diff: Math.abs(targets.T - oVals.B), dy: oVals.B - targets.T, guide: oVals.B },
        ];
        for (const item of verticalTouchTargets) {
          if (item.diff <= ALIGN_THRESHOLD) {
            hGuides.add(item.guide);
            if (item.diff < bestHDiff) {
              bestHDiff = item.diff;
              snapDY = item.dy;
            }
          }
        }
        const horizontalTouchTargets = [
          { diff: Math.abs(targets.R - oVals.L), dx: oVals.L - targets.R, guide: oVals.L },
          { diff: Math.abs(targets.L - oVals.R), dx: oVals.R - targets.L, guide: oVals.R },
        ];
        for (const item of horizontalTouchTargets) {
          if (item.diff <= ALIGN_THRESHOLD) {
            vGuides.add(item.guide);
            if (item.diff < bestVDiff) {
              bestVDiff = item.diff;
              snapDX = item.dx;
            }
          }
        }
      }
      setGuides({ vertical: Array.from(vGuides), horizontal: Array.from(hGuides) });
      // 寮卞惛闄?璋冩暣褰撳墠鎷栨嫿鑺傜偣浣嶇疆
      if (snapDX !== null || snapDY !== null) {
        setNodes((prev) => {
          const targetNode = prev.find((n) => n.id === node.id) || node;
          const nextAbs = { x: Math.round(tx + (snapDX ?? 0)), y: Math.round(ty + (snapDY ?? 0)) };
          const nextLocal = toNodeLocalPosition(targetNode, nextAbs, prev);
          return prev.map((n) => (n.id === node.id ? { ...n, position: nextLocal } : n));
        });
      }
    },
    [nodes, snapEnabled]
  );

  const onNodeDragStop = useCallback((_e: any, node: Node) => {
    setGuides({ vertical: [], horizontal: [] });

    // ===== ALT+鎷栧姩缁撴潫: ID 浜掓崲 =====
    // 鍗犱綅鍏嬮殕(涓存椂ID,鍦ㄥ師浣? 鈫?鎭㈠涓哄師濮婭D(杈硅嚜鍔ㄧ暀鍦ㄥ師浣?
    // 鍘熻妭鐐?鍘熷ID,宸叉嫋鍒版柊浣嶇疆) 鈫?鍒嗛厤鏂癐D + sanitize(鍙樻垚骞插噣鍓湰)
    if (altDragCloneRef.current) {
      const { placeholderIds } = altDragCloneRef.current;
      altDragCloneRef.current = null;
      const origIds = new Set(placeholderIds.keys());
      // phId 鈫?origId 鍙嶆煡琛?
      const phToOrig = new Map<string, string>();
      placeholderIds.forEach((phId, origId) => phToOrig.set(phId, origId));
      // 杩愯鏃跺瓧娈甸粦鍚嶅崟
      const RUNTIME_KEYS = ['status', 'taskId', 'progress', 'error', 'isRunning', 'isPolling', 'pollingTimer'];
      const sanitize = (data: any) => {
        const next: any = { ...(data || {}) };
        for (const k of RUNTIME_KEYS) delete next[k];
        next.status = 'idle';
        return next;
      };
      const stamp = Date.now();
      const newIdMap = new Map<string, string>(); // origId -> newCopyId

      setNodes((prev) => {
        return prev.map((n) => {
          // 鍗犱綅鍏嬮殕 鈫?鎭㈠鍘熷ID
          const restoreId = phToOrig.get(n.id);
          if (restoreId) {
            return { ...n, id: restoreId };
          }
          // 琚嫋璧扮殑鍘熻妭鐐?鈫?鏂癐D + sanitize
          if (origIds.has(n.id)) {
            const newId = `${n.type}-${stamp}-${newIdMap.size}-${Math.random().toString(36).slice(2, 5)}`;
            newIdMap.set(n.id, newId);
            return { ...n, id: newId, selected: true, data: sanitize(n.data) };
          }
          return n;
        });
      });

      // 杈瑰鐞? dragStart 鏃惰竟宸蹭粠 origId 杞Щ鍒?phId,鐜板湪闇€鎭㈠涓?origId + 澶嶅埗鍐呴儴杈圭粰鏂拌妭鐐?
      setEdges((prev) => {
        // 1. phId 鈫?origId 鎭㈠
        const restored = prev.map((e2) => {
          const origS = phToOrig.get(e2.source);
          const origT = phToOrig.get(e2.target);
          if (!origS && !origT) return e2;
          return { ...e2, source: origS || e2.source, target: origT || e2.target };
        });
        // 2. 澶嶅埗鍐呴儴杈?鍘熻妭鐐逛箣闂寸殑杈?鈫?鏂拌妭鐐逛箣闂?
        const cloneEdges = restored
          .filter((e2) => origIds.has(e2.source) && origIds.has(e2.target))
          .map((e2, idx) => {
            const s = newIdMap.get(e2.source);
            const t = newIdMap.get(e2.target);
            if (!s || !t) return null;
            return { ...e2, id: `e-alt-${stamp}-${idx}-${Math.random().toString(36).slice(2, 5)}`, source: s, target: t } as Edge;
          })
          .filter(Boolean) as Edge[];
        return cloneEdges.length > 0 ? [...restored, ...cloneEdges] : restored;
      });
      groupDragRef.current = null;
      frameDragRef.current = null;
      return;
    }

    // 鎷栧姩缁勭粨鏉? 灏嗘渶鏂扮殑鍑犱綍鎴愬憳鍚屾鍒?data.memberIds(渚汫roupBoxNode鏄剧ず鑺傜偣鏁?鎵ц浣跨敤)
    if (node?.type === 'groupBox' && groupDragRef.current?.groupId === node.id) {
      const latestIds = groupDragRef.current.memberIds;
      setNodes((prev) =>
        prev.map((n) =>
          n.id === node.id
            ? { ...n, data: { ...((n.data as any) || {}), memberIds: latestIds } }
            : n
        )
      );
    }

    const frameMemberIds = frameDragRef.current?.frameId === node.id ? frameDragRef.current.memberIds : [];
    const attachIds = node.type === 'drawing-board' ? frameMemberIds : [node.id];
    if (attachIds.length > 0) {
      setNodes((prev) => {
        const hadParent = new Set(
          prev
            .filter((n) => attachIds.includes(n.id) && !!(n as any).parentId)
            .map((n) => n.id),
        );
        const detached = detachNodesOutsideFrames(prev, attachIds);
        const justDetached = detached.some((n) => hadParent.has(n.id) && !(n as any).parentId);
        return applyFrameClipping(justDetached ? detached : attachNodesToFrames(detached, attachIds));
      });
    }
  
    // 鏍囪琚敤鎴锋墜鍔ㄦ嫋鍔ㄨ繃鐨勮嚜鍔ㄥ鎸?OutputNode (id 浠?'output-auto-' 寮€澶?,
    // 鍚庣画銆岀綉鏍奸噸鎺掋€島seEffect 浼氭娴?data.userMoved 璺宠繃杩欎簺鑺傜偣, 淇濈暀鐢ㄦ埛浣嶇疆銆?
    // 澶氶€夋嫋鍔ㄥ満鏅? xyflow 鍙紶涓绘嫋 node, 鏈嚱鏁拌繛鍚屾墍鏈?selected 涓斿甫璇ュ墠缂€鐨勮妭鐐归兘鎵撲笂鏍囪銆?
    setNodes((prev) => {
      const selectedAutoOutputIds = new Set<string>();
      for (const n of prev) {
        if (n.selected && typeof n.id === 'string' && n.id.startsWith('output-auto-')) {
          selectedAutoOutputIds.add(n.id);
        }
      }
      if (typeof node?.id === 'string' && node.id.startsWith('output-auto-')) {
        selectedAutoOutputIds.add(node.id);
      }
      if (selectedAutoOutputIds.size === 0) return prev;
      return prev.map((n) =>
        selectedAutoOutputIds.has(n.id)
          ? { ...n, data: { ...((n.data as any) || {}), userMoved: true } }
          : n
      );
    });
  
    groupDragRef.current = null;
    frameDragRef.current = null;
  }, []);

  // ===== 鍙抽敭鑿滃崟 =====
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const closePaneMenu = useCallback(() => setPaneMenu(null), []);
  const handleLayerOrder = useCallback((ids: string[], action: 'forward' | 'backward' | 'front' | 'back') => {
    setNodes((prev) => {
      const first = prev.find((n) => ids.includes(n.id));
      const parentId = first ? (first as any).parentId as string | undefined : undefined;
      if (!parentId) return reorderLayerNodes(prev, ids, action);
      const selectedIds = new Set(ids);
      const scoped = prev
        .filter((n) => (n as any).parentId === parentId && isLayerableNode(n))
        .sort((a, b) => getLayerZ(a, prev.indexOf(a)) - getLayerZ(b, prev.indexOf(b)));
      if (action === 'front') {
        scoped.sort((a, b) => Number(selectedIds.has(a.id)) - Number(selectedIds.has(b.id)));
      } else if (action === 'back') {
        scoped.sort((a, b) => Number(selectedIds.has(b.id)) - Number(selectedIds.has(a.id)));
      } else if (action === 'forward') {
        for (let i = scoped.length - 2; i >= 0; i -= 1) {
          if (selectedIds.has(scoped[i].id) && !selectedIds.has(scoped[i + 1].id)) {
            [scoped[i], scoped[i + 1]] = [scoped[i + 1], scoped[i]];
          }
        }
      } else {
        for (let i = 1; i < scoped.length; i += 1) {
          if (selectedIds.has(scoped[i].id) && !selectedIds.has(scoped[i - 1].id)) {
            [scoped[i - 1], scoped[i]] = [scoped[i], scoped[i - 1]];
          }
        }
      }
      const zById = new Map(scoped.map((n, i) => [n.id, 1000 + i * 10]));
      return prev.map((n) => (zById.has(n.id) ? { ...n, zIndex: zById.get(n.id) } : n));
    });
  }, []);

  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes]);
  const selectedNodeIds = useMemo(() => new Set(selectedNodes.map((n) => n.id)), [selectedNodes]);
  const selectedTextNodes = useMemo(() => selectedNodes.filter((n) => n.type === 'text'), [selectedNodes]);
  const selectedFrameNode = useMemo(() => selectedNodes.find((n) => n.type === 'drawing-board') || null, [selectedNodes]);
  const selectedFrameData = (selectedFrameNode?.data || {}) as Record<string, any>;
  const framePanelVisible = frameCreateMode || !!selectedFrameNode;
  const activeFrameW = Math.round(Number(selectedFrameData.frameW || selectedFrameData.resolutionW || customFrameSize.w || 800));
  const activeFrameH = Math.round(Number(selectedFrameData.frameH || selectedFrameData.resolutionH || customFrameSize.h || 800));
  const selectedTextIdsRef = useRef<string[]>([]);
  useEffect(() => {
    if (selectedTextNodes.length > 0) {
      selectedTextIdsRef.current = selectedTextNodes.map((n) => n.id);
    }
  }, [selectedTextNodes]);
  const primaryTextNode = selectedTextNodes[0] || null;
  const primaryTextData = (primaryTextNode?.data || {}) as Record<string, any>;
  const InspectorIcon = ((LucideIcons as any).PanelRightOpen || (LucideIcons as any).SlidersHorizontal || (LucideIcons as any).Settings) as any;
  const textControlsDisabled = !primaryTextNode;
  const selectedFontValue = TEXT_FONT_OPTIONS.some((f) => f.value === primaryTextData.fontFamily) ? primaryTextData.fontFamily : '';
  const customFontValue = selectedFontValue ? '' : (primaryTextData.fontFamily || '');
  const currentTextColor = primaryTextData.color || (theme === 'dark' ? '#ffffff' : '#111111');
  const colorTarget = primaryTextNode ? 'text' : selectedFrameNode ? 'frame' : null;
  const colorTargetData = primaryTextNode ? primaryTextData : selectedFrameData;
  const colorPanelDisabled = !colorTarget;
  const currentColorMode = colorTarget === 'frame'
    ? (colorTargetData.backgroundMode === 'gradient' ? 'gradient' : 'solid')
    : (colorTargetData.colorMode === 'gradient' ? 'gradient' : 'solid');
  const currentSolidColor = colorTarget === 'frame'
    ? (colorTargetData.backgroundColor || '#ffffff')
    : currentTextColor;
  const currentGradientFrom = colorTarget === 'frame'
    ? (colorTargetData.backgroundGradientFrom || currentSolidColor)
    : (colorTargetData.gradientFrom || currentSolidColor);
  const currentGradientTo = colorTarget === 'frame'
    ? (colorTargetData.backgroundGradientTo || '#dbeafe')
    : (colorTargetData.gradientTo || '#ffffff');
  const currentGradientAngle = Number(colorTarget === 'frame'
    ? (colorTargetData.backgroundGradientAngle ?? 90)
    : (colorTargetData.gradientAngle ?? 90));
  const inspectorInputClass = `mt-1 w-full rounded-md border px-2 py-1.5 text-xs outline-none disabled:cursor-not-allowed disabled:opacity-40 ${
    theme === 'dark'
      ? 'border-white/14 bg-zinc-950/80 text-white placeholder:text-white/30 focus:border-white/30 focus:bg-zinc-900/90'
      : 'border-black/10 bg-white text-zinc-900 placeholder:text-zinc-400 focus:border-black/25'
  }`;
  const alignIconButtons = [
    ['left', 'AlignHorizontalJustifyStart', '左对齐'],
    ['hcenter', 'AlignHorizontalJustifyCenter', '水平居中'],
    ['right', 'AlignHorizontalJustifyEnd', '右对齐'],
    ['top', 'AlignVerticalJustifyStart', '顶部对齐'],
    ['vcenter', 'AlignVerticalJustifyCenter', '垂直居中'],
    ['bottom', 'AlignVerticalJustifyEnd', '底部对齐'],
  ] as const;
  const textAlignIconButtons = [
    ['left', 'AlignLeft', '左对齐'],
    ['center', 'AlignCenter', '居中'],
    ['right', 'AlignRight', '右对齐'],
  ] as const;
  const nodeLabelByType = useMemo(
    () => new Map(NODE_REGISTRY.map((meta) => [meta.type, meta.label])),
    []
  );
  const layerItems = useMemo(() => {
    const summarizeNode = (node: Node) => {
      const data = (node.data || {}) as Record<string, any>;
      const raw =
        data.name ||
        data.label ||
        data.fileName ||
        data.prompt ||
        data.lastPrompt ||
        data.imageUrl ||
        data.videoUrl ||
        data.audioUrl ||
        '';
      const text = String(raw).replace(/\s+/g, ' ').trim();
      return text ? text.slice(0, 28) : node.id.slice(0, 12);
    };
    const visibleNodes = nodes
      .filter((node) => {
        const type = String(node.type || '');
        return node.id !== BULK_PHANTOM_ID && type !== 'output' && !REMOVED_NODE_TYPES.has(type);
      });
    const toItem = (node: Node, level: number) => ({
        node,
        typeLabel: nodeLabelByType.get(node.type as NodeType) || String(node.type || '节点'),
        summary: summarizeNode(node),
        sortable: isLayerableNode(node),
        level,
      });
    const childrenByFrame = new Map<string, Node[]>();
    visibleNodes.forEach((node) => {
      const parentId = (node as any).parentId as string | undefined;
      if (!parentId) return;
      const parent = visibleNodes.find((n) => n.id === parentId && n.type === 'drawing-board');
      if (!parent) return;
      const list = childrenByFrame.get(parentId) || [];
      list.push(node);
      childrenByFrame.set(parentId, list);
    });
    const topLevel = visibleNodes
      .filter((node) => !(node as any).parentId || !visibleNodes.some((n) => n.id === (node as any).parentId && n.type === 'drawing-board'))
      .sort((a, b) => getLayerZ(b, nodes.indexOf(b)) - getLayerZ(a, nodes.indexOf(a)));
    const items: Array<{ node: Node; typeLabel: string; summary: string; sortable: boolean; level: number }> = [];
    topLevel.forEach((node) => {
      items.push(toItem(node, 0));
      if (node.type === 'drawing-board') {
        (childrenByFrame.get(node.id) || [])
          .sort((a, b) => getLayerZ(b, nodes.indexOf(b)) - getLayerZ(a, nodes.indexOf(a)))
          .forEach((child) => items.push(toItem(child, 1)));
      }
    });
    return items;
  }, [nodes, nodeLabelByType]);

  const updateSelectedText = useCallback((patch: Record<string, any>) => {
    const ids = selectedTextNodes.length > 0
      ? selectedTextNodes.map((n) => n.id)
      : selectedTextIdsRef.current;
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setNodes((prev) =>
      prev.map((n) =>
        idSet.has(n.id) && n.type === 'text'
          ? { ...n, data: { ...((n.data as any) || {}), ...patch } }
          : n
      )
    );
  }, [selectedTextNodes]);

  const updateSelectedFrameBackground = useCallback((patch: Record<string, any>) => {
    const id = selectedFrameNode?.id;
    if (!id) return;
    setNodes((prev) =>
      prev.map((n) =>
        n.id === id && n.type === 'drawing-board'
          ? { ...n, data: { ...((n.data as any) || {}), ...patch } }
          : n
      )
    );
  }, [selectedFrameNode?.id]);

  const updateCurrentColorTarget = useCallback((patch: Record<string, any>) => {
    if (colorTarget === 'text') updateSelectedText(patch);
    if (colorTarget === 'frame') updateSelectedFrameBackground(patch);
  }, [colorTarget, updateSelectedFrameBackground, updateSelectedText]);

  const alignSelectedNodes = useCallback((mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => {
    setNodes((prev) => {
      const targets = prev.filter((n) => n.selected && isLayerableNode(n));
      if (targets.length === 0) return prev;
      const frameTarget =
        targets.length === 1 && (targets[0] as any).parentId
          ? prev.find((n) => n.id === (targets[0] as any).parentId)
          : null;
      const targetRects = targets.map((n) => getNodeRect(n, prev));
      const base = frameTarget
        ? getNodeRect(frameTarget, prev)
        : {
            L: Math.min(...targetRects.map((r) => r.L)),
            R: Math.max(...targetRects.map((r) => r.R)),
            T: Math.min(...targetRects.map((r) => r.T)),
            B: Math.max(...targetRects.map((r) => r.B)),
          };
      const selectedIds = new Set(targets.map((n) => n.id));
      return prev.map((n) => {
        if (!selectedIds.has(n.id)) return n;
        const rect = getNodeRect(n, prev);
        let x = rect.x;
        let y = rect.y;
        if (mode === 'left') x = base.L;
        if (mode === 'hcenter') x = (base.L + base.R) / 2 - rect.w / 2;
        if (mode === 'right') x = base.R - rect.w;
        if (mode === 'top') y = base.T;
        if (mode === 'vcenter') y = (base.T + base.B) / 2 - rect.h / 2;
        if (mode === 'bottom') y = base.B - rect.h;
        return { ...n, position: toNodeLocalPosition(n, { x: Math.round(x), y: Math.round(y) }, prev) };
      });
    });
  }, []);

  const selectLayerNode = useCallback((id: string) => {
    setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === id })));
    const target = nodesRef.current.find((n) => n.id === id);
    if (!target) return;
    const rect = getNodeRect(target, nodesRef.current);
    const { zoom } = getViewport();
    setCenter(rect.C, rect.M, { zoom, duration: 320 });
  }, [getViewport, setCenter]);

  // 閫夊尯鍙抽敭(妗嗛€?鈮?1 涓妭鐐瑰悗鍙抽敭)
  const onSelectionContextMenu = useCallback(
    (e: React.MouseEvent, sels: Node[]) => {
      e.preventDefault();
      const ids = sels.map((n) => n.id);
      if (ids.length === 0) return;
      setContextMenu({ x: e.clientX, y: e.clientY, ids });
    },
    []
  );

  // 鑺傜偣涓婂彸閿? 鑻ユ湭閫変腑鍒欎粎閫変腑姝よ妭鐐?
  const onNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: Node) => {
      e.preventDefault();
      let ids: string[];
      const currentSelected = nodes.filter((n) => n.selected).map((n) => n.id);
      if (currentSelected.includes(node.id) && currentSelected.length > 1) {
        ids = currentSelected;
      } else {
        setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === node.id })));
        ids = [node.id];
      }
      setContextMenu({ x: e.clientX, y: e.clientY, ids });
    },
    [nodes]
  );

  // 绌虹櫧澶勫彸閿? 寮瑰嚭蹇€熸坊鍔犺妭鐐硅彍鍗?鍚屾椂鍏抽棴閫夊尯鑿滃崟)
  const onPaneContextMenu = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      e.preventDefault();
      if (frameCreateMode) {
        cancelFrameCreateMode();
        setPaneMenu(null);
        return;
      }
      setContextMenu(null);
      const x = (e as MouseEvent).clientX;
      const y = (e as MouseEvent).clientY;
      setPaneMenu({ x, y });
    },
    [cancelFrameCreateMode, frameCreateMode]
  );

  const onFrameCreatePaneMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.button === 0 && target?.closest('.react-flow__pane')) {
        endReferencePick();
      }
      if (!frameCreateMode || e.button !== 0) return;
      if (!target?.closest('.react-flow__pane')) return;
      e.preventDefault();
      e.stopPropagation();
      const start = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setFrameDraft({ start, end: start });

      const onMove = (moveEvent: MouseEvent) => {
        const end = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
        setFrameDraft({ start, end });
      };
      const onUp = (upEvent: MouseEvent) => {
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('mouseup', onUp, true);
        const end = screenToFlowPosition({ x: upEvent.clientX, y: upEvent.clientY });
        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const w = Math.abs(end.x - start.x);
        const h = Math.abs(end.y - start.y);
        if (w >= MIN_FRAME_CREATE_W && h >= MIN_FRAME_CREATE_H) {
          createDrawingBoardFrame({ w, h, label: `${Math.round(w)}×${Math.round(h)}` }, { x, y });
        } else {
          setFrameDraft(null);
        }
      };
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('mouseup', onUp, true);
    },
    [createDrawingBoardFrame, endReferencePick, frameCreateMode, screenToFlowPosition],
  );

  // 璁板綍鏈€鏂伴€変腑鐨勮妭鐐?id 鍒楄〃(浠ヤ究 onSelectionEnd 璇诲彇)
  const lastSelectedIdsRef = useRef<string[]>([]);
  const onSelectionChange = useCallback(
    ({ nodes: ns }: { nodes: Node[]; edges: Edge[] }) => {
      lastSelectedIdsRef.current = ns.map((n) => n.id);
    },
    []
  );

  // 框选结束只保留选中状态；菜单仅由右键触发。
  const onSelectionEnd = useCallback(() => {}, []);

  // 鏆撮湶 addNode 缁欑埗缁勪欢
  useEffect(() => {
    if (onAddNodeRef) {
      onAddNodeRef.current = addNode;
    }
    return () => {
      if (onAddNodeRef) onAddNodeRef.current = null;
    };
  }, [onAddNodeRef, addNode]);

  // xyflow 浜嬩欢
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // 妫€娴嬫嫋鎷界姸鎬?閬垮厤鎷栨嫿涓绻佸帇鏍?
      for (const c of changes) {
        if (c.type === 'position') {
          if ((c as any).dragging === true) {
            isDraggingRef.current = true;
          } else if ((c as any).dragging === false) {
            isDraggingRef.current = false;
          }
        }
      }
      setNodes((nds) => {
        const next = applyFrameClipping(applyNodeChanges(changes, nds));
        // 鍚屾閫変腑鏁?鐢?next 璁＄畻鏇村噯纭?
        const selCount = next.reduce((acc, n) => acc + (n.selected ? 1 : 0), 0);
        setSelectedCount(selCount);
        return next;
      });
    },
    []
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onConnect = useCallback(
    (params: Connection) => {
      // 鎵归噺绉荤嚎杩囩▼涓姝㈡櫘閫氳繛鎺ラ€昏緫(涓嶇劧浼氬涓€鏉￠噸澶嶈竟)
      if (bulkReconnectRef.current) return;
      const curNodes = nodesRef.current;
      const curEdges = edgesRef.current;
      // 杩炴帴鏈夋晥鎬ф牎楠?闃叉缁曡繃 isValidConnection 鐨勫簳灞傝皟鐢?
      const src = curNodes.find((n) => n.id === params.source);
      let tgt = curNodes.find((n) => n.id === params.target);
      if (!isConnectionValid(src, tgt)) return;

      // 鈿?缁勫鍣ㄨ繛鍑哄幓閲? 濡傛灉 source 鏄?groupBox, 骞朵笖缁勫唴鎴愬憳宸茬粡鐙珛杩炲埌鍚屼竴涓笅娓?target,
      // 鍒欒嚜鍔ㄦ柇寮€閭ｄ簺銆屾垚鍛樷啋target銆嶇殑閲嶅杈? 鍙繚鐣?group鈫抰arget
      // (閬垮厤鍚屼竴婧愬ご閲嶅浼犺緭 + 闃叉娼滃湪寰幆渚濊禆)
      if (src && src.type === 'groupBox' && tgt && params.target) {
        const memberIds: string[] = Array.isArray((src.data as any)?.memberIds)
          ? ((src.data as any).memberIds as string[])
          : [];
        if (memberIds.length > 0) {
          const memberSet = new Set(memberIds);
          const dupEdges = curEdges.filter(
            (e) => memberSet.has(e.source) && e.target === params.target,
          );
          if (dupEdges.length > 0) {
            const dupIds = new Set(dupEdges.map((e) => e.id));
            setEdges((eds) => eds.filter((e) => !dupIds.has(e.id)));
          }
        }
      }

      // 鈿?杈撳嚭绱犳潗鑺傜偣鍗曡緭鍏ョ害鏉?鑻ョ洰鏍囨槸 output 涓斿凡鏈夎繛鍏?
      // 鑷姩娲剧敓涓€涓柊鐨?output 鑺傜偣骞舵妸鏈杩炴帴杞悜瀹冦€?
      if (tgt && tgt.type === 'output') {
        const targetHasConn = curEdges.some((e) => e.target === tgt!.id);
        if (targetHasConn) {
          const newId = `output-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          // 鏂?output 鑺傜偣鏀惧湪鍘熻妭鐐瑰彸渚?360瀹?+ 40搴?
          const newNode: Node = {
            id: newId,
            type: 'output',
            position: {
              x: (tgt.position?.x ?? 0) + 360,
              y: tgt.position?.y ?? 0,
            },
            data: { ...(INITIAL_DATA['output'] || {}) },
          };
          setNodes((prev) => [...prev, newNode]);
          // 鍚庣画杈硅繛鍒版柊鑺傜偣
          tgt = newNode;
          params = { ...params, target: newId };
        }
      }

      // 鏍规嵁涓婃父杈撳嚭绫诲瀷鏌撹壊杩炵嚎
      const outs = src ? getNodeOutputs(src) : [];
      const ins = tgt ? getNodeInputs(tgt) : [];
      const matched = outs.find((o) => ins.includes(o) || o === 'any' || ins.includes('any'));
      const color = matched && matched !== 'any' ? PORT_COLOR[matched] : undefined;
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            ...(color ? { style: { stroke: color, strokeWidth: 2 } } : {}),
            data: { portType: matched ?? 'any' },
          },
          eds
        )
      );
    },
    []
  );

  // ReactFlow 鎷栫嚎杩炴帴鏃剁殑瀹炴椂鏍￠獙(鍦ㄨ繛绾垮浜庘€滈瑙堚€濋樁娈靛氨鎷︽埅涓嶅吋瀹硅繛鎺?
  const onIsValidConnection = useCallback(
    (params: Connection | Edge) => {
      const curNodes = nodesRef.current;
      const src = curNodes.find((n) => n.id === (params as Connection).source);
      const tgt = curNodes.find((n) => n.id === (params as Connection).target);
      return isConnectionValid(src, tgt);
    },
    []
  );

  // ===== 鎷栫嚎鍒扮┖鐧藉 鈫?寮瑰嚭鍊欓€夎妭鐐硅彍鍗?=====
  const onConnectStart = useCallback(
    (_e: any, params: { nodeId: string | null; handleType: 'source' | 'target' | null }) => {
      if (!params.nodeId || !params.handleType) return;
      connectingFromRef.current = { nodeId: params.nodeId, handleType: params.handleType };

      // SHIFT + target handle 鈫?鎵归噺绉诲姩鎵€鏈夊叆杈?
      const evt = _e as MouseEvent;
      if (evt.shiftKey) {
        if (params.handleType === 'target') {
          const incoming = edges.filter((e) => e.target === params.nodeId);
          if (incoming.length > 0) {
            bulkReconnectRef.current = {
              fromNodeId: params.nodeId,
              handleType: 'target',
              edges: JSON.parse(JSON.stringify(incoming)),
            };
          }
        } else if (params.handleType === 'source') {
          const outgoing = edges.filter((e) => e.source === params.nodeId);
          if (outgoing.length > 0) {
            bulkReconnectRef.current = {
              fromNodeId: params.nodeId,
              handleType: 'source',
              edges: JSON.parse(JSON.stringify(outgoing)),
            };
          }
        }
      }
    },
    [edges]
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const from = connectingFromRef.current;
      connectingFromRef.current = null;

      // ===== SHIFT+鎵归噺绉荤嚎澶勭悊 =====
      if (bulkReconnectRef.current) {
        const bulk = bulkReconnectRef.current;
        bulkReconnectRef.current = null;

        const targetEl = event.target as HTMLElement | null;
        if (!targetEl) return;
        // 妫€娴嬫槸鍚﹂噴鏀惧湪涓€涓?Handle 涓?
        const handleEl = targetEl.closest('.react-flow__handle') as HTMLElement | null;
        if (handleEl) {
          const newNodeId =
            handleEl.getAttribute('data-nodeid') ||
            handleEl.closest('.react-flow__node')?.getAttribute('data-id') ||
            '';
          const dropHandleType = handleEl.getAttribute('data-handletype'); // 'source' | 'target'

          if (newNodeId && newNodeId !== bulk.fromNodeId) {
            // 鍏ュ彛鈫掑叆鍙? 鎵€鏈夊叆杈圭殑 target 鏀逛负鏂拌妭鐐?
            if (bulk.handleType === 'target' && dropHandleType === 'target') {
              const bulkIds = new Set(bulk.edges.map((e) => e.id));
              setEdges((eds) => {
                const filtered = eds.filter((e) => !bulkIds.has(e.id));
                const newTarget = nodes.find((n) => n.id === newNodeId);
                const newEdges = bulk.edges.map((old) => {
                  const srcNode = nodes.find((n) => n.id === old.source);
                  const outs = srcNode ? getNodeOutputs(srcNode) : [];
                  const ins = newTarget ? getNodeInputs(newTarget) : [];
                  const matched = outs.find((o) => ins.includes(o) || o === 'any' || ins.includes('any'));
                  const color = matched && matched !== 'any' ? PORT_COLOR[matched] : undefined;
                  return {
                    ...old,
                    id: `e-${old.source}-${newNodeId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    target: newNodeId,
                    targetHandle: null,
                    ...(color ? { style: { stroke: color, strokeWidth: 2 } } : {}),
                    data: { ...((old.data as any) || {}), portType: matched ?? 'any' },
                  };
                });
                return [...filtered, ...newEdges];
              });
              return;
            }
            // 鍑哄彛鈫掑嚭鍙? 鎵€鏈夊嚭杈圭殑 source 鏀逛负鏂拌妭鐐?
            if (bulk.handleType === 'source' && dropHandleType === 'source') {
              const bulkIds = new Set(bulk.edges.map((e) => e.id));
              setEdges((eds) => {
                const filtered = eds.filter((e) => !bulkIds.has(e.id));
                const newSource = nodes.find((n) => n.id === newNodeId);
                const newEdges = bulk.edges.map((old) => {
                  const tgtNode = nodes.find((n) => n.id === old.target);
                  const outs = newSource ? getNodeOutputs(newSource) : [];
                  const ins = tgtNode ? getNodeInputs(tgtNode) : [];
                  const matched = outs.find((o) => ins.includes(o) || o === 'any' || ins.includes('any'));
                  const color = matched && matched !== 'any' ? PORT_COLOR[matched] : undefined;
                  return {
                    ...old,
                    id: `e-${newNodeId}-${old.target}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    source: newNodeId,
                    sourceHandle: null,
                    ...(color ? { style: { stroke: color, strokeWidth: 2 } } : {}),
                    data: { ...((old.data as any) || {}), portType: matched ?? 'any' },
                  };
                });
                return [...filtered, ...newEdges];
              });
              return;
            }
          }
        }
        // 閲婃斁鍦ㄥ叾浠栦綅缃?鈫?鍙栨秷锛岃竟涓嶅彉
        return;
      }

      // ===== 鏅€氭嫋绾块€昏緫 =====
      if (!from) return;
      // 缁堢偣鏄惁钀藉湪 Handle / 鑺傜偣 / 杩炵嚎涓?浠讳綍涓€椤瑰懡涓兘浜ょ粰 ReactFlow 榛樿杩炴帴閫昏緫澶勭悊,涓嶅脊鍑哄€欓€夎彍鍗?
      // 浠呭綋榧犳爣閲婃斁鍦ㄢ€滅┖鐧界敾甯冣€?pane / background 鏈綋鎴栧叾闅斿眰瀛?鏃舵墠寮硅彍鍗?
      // 渚嬪: 鎷栧埌 GroupBox(鑺傜偣缁?鐨勫唴閮ㄧ┖鐧藉尯鍩熶篃搴旇琚浣溾€滅┖鐧解€?鈫?寮硅彍鍗?
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const onHandle = !!target.closest('.react-flow__handle');
      const nodeEl = target.closest('.react-flow__node') as HTMLElement | null;
      const onEdge = !!target.closest('.react-flow__edge');
      // 鍒ゆ柇鏄惁钀藉湪鐪熷疄鑺傜偣涓?(鎺掗櫎 groupBox 绫诲瀷: groupBox 鏈韩搴旇褰撲綔鈥滃尯鍩熷鍣ㄢ€?鑰岄潪鍙繛鎺ヨ妭鐐?
      let onNode = false;
      if (nodeEl) {
        const hitId = nodeEl.getAttribute('data-id');
        const hitNode = hitId ? nodes.find((n) => n.id === hitId) : null;
        // groupBox 鑺傜偣 涓嶄綔涓衡€滆妭鐐光€濆鐞?鈫?鍏佽寮瑰嚭鍊欓€夎彍鍗?
        if (hitNode && hitNode.type !== 'groupBox') onNode = true;
      }
      // 濡傛灉钀藉湪 Handle/鐪熷疄鑺傜偣/杩炵嚎 涓?璁?ReactFlow 鑷繁澶勭悊(宸茶繛 / 涓嶈繛),鍒欎笉寮硅彍鍗?
      if (onHandle || onNode || onEdge) return;
      // 鑾峰彇鍧愭爣
      const clientX =
        (event as MouseEvent).clientX ?? (event as TouchEvent).changedTouches?.[0]?.clientX ?? 0;
      const clientY =
        (event as MouseEvent).clientY ?? (event as TouchEvent).changedTouches?.[0]?.clientY ?? 0;
      const flowPos = screenToFlowPosition({ x: clientX, y: clientY });
      setPicker({
        fromNodeId: from.nodeId,
        fromHandleType: from.handleType,
        flowPos,
        screenPos: { x: clientX, y: clientY },
      });
    },
    [screenToFlowPosition, nodes]
  );

  // ===== 鍏ㄥ眬 SHIFT+Handle 鎵归噺绉荤嚎鎷︽埅鍣?=====
  // 鍘熷洜: ReactFlow 鐨?multiSelectionKeyCode 鍖呭惈 'Shift'锛屽鑷存寜浣?SHIFT 鍦?handle 涓?mousedown
  // 浼氳 ReactFlow 鎷︽埅涓哄閫変簨浠讹紝onConnectStart 鍙兘涓嶄細瑙﹀彂銆?
  // 杩欓噷浣跨敤 capture 闃舵鍏ㄥ眬鎷︽埅 + stopImmediatePropagation 瀹屽叏鎺ョ璇ヤ氦浜掋€?
  // 浜や簰鍗囩骇: 鎷栨嫿鏈熼棿浣跨敤 phantom 鑺傜偣浣滀负杈圭殑涓存椂閿愮偣,璁╂墍鏈夎繛绾胯窡闅忛紶鏍囩Щ鍔ㄣ€?
  useEffect(() => {
    // SHIFT 閿姸鎬?鈫?body.shift-mode (鍏夋爣鎻愮ず)
    const onShiftDown = (kev: KeyboardEvent) => {
      if (kev.key === 'Shift' && !document.body.classList.contains('shift-mode')) {
        document.body.classList.add('shift-mode');
      }
    };
    const onShiftUp = (kev: KeyboardEvent) => {
      if (kev.key === 'Shift') {
        document.body.classList.remove('shift-mode');
      }
    };
    window.addEventListener('keydown', onShiftDown);
    window.addEventListener('keyup', onShiftUp);
    // 澶辩劍鏃朵篃娓呴櫎
    const onBlur = () => document.body.classList.remove('shift-mode');
    window.addEventListener('blur', onBlur);

    // ===== 鍓╁垁鍒掔嚎鏂繛妯″紡 =====
    // 瑙﹀彂鏉′欢: SHIFT + 绌虹櫧鍖哄煙(.react-flow__pane 鎴?GroupBoxNode 鍐呴儴绌虹櫧) 宸﹂敭鎸変笅
    // 浜や簰: mousemove 瀹炴椂鎺㈡祴榧犳爣涓嬬殑 .react-flow__edge 骞舵爣璁颁负寰呭垏, mouseup 鎵归噺鍒犻櫎
    // 瑙嗚: body.cut-mode (鍓╁垁鍏夋爣) + 涓存椂 SVG overlay 鐢诲嚭榧犳爣杞ㄨ抗 + 寰呭垏 edge 楂樹寒
    let cutSvg: SVGSVGElement | null = null;
    let cutPath: SVGPolylineElement | null = null;
    let cutPoints: number[][] = [];
    let cutSet: Set<string> = new Set();
    let cutting = false;

    const finishCut = () => {
      if (!cutting) return;
      cutting = false;
      // 鎻愪氦鍒犻櫎
      if (cutSet.size > 0) {
        const idsToCut = new Set(cutSet);
        setEdges((prev) => prev.filter((ed) => !idsToCut.has(ed.id)));
      }
      // 娓呯悊 DOM
      document.body.classList.remove('cut-mode');
      if (cutSvg && cutSvg.parentNode) cutSvg.parentNode.removeChild(cutSvg);
      cutSvg = null;
      cutPath = null;
      cutPoints = [];
      // 娓呴櫎楂樹寒 class
      document
        .querySelectorAll('.react-flow__edge.cut-marked')
        .forEach((el) => el.classList.remove('cut-marked'));
      cutSet = new Set();
      window.removeEventListener('mousemove', onCutMove, true);
      window.removeEventListener('mouseup', onCutUp, true);
    };

    const onCutMove = (mv: MouseEvent) => {
      if (!cutting) return;
      // 涓婁竴涓紶鏍囩偣 鈫?褰撳墠鐐?涔嬮棿鎻掑€奸噰鏍凤紝閬垮厤蹇€熸嫋鍔ㄦ椂璺宠繃缁?stroke 绾?鍍忕礌涓婚榛戣壊 edge 浠?2.5px,
      // 榧犳爣蹇€熸嫋鍔ㄦ椂 mousemove 闁撹窛鍙揪 鈮?0px,鍙湅褰撳墠鐐逛細瀹屽叏璺宠繃璇?edge)銆?
      const lastPt = cutPoints.length > 0 ? cutPoints[cutPoints.length - 1] : [mv.clientX, mv.clientY];
      cutPoints.push([mv.clientX, mv.clientY]);
      // 鏈€澶氫繚鐣欒繎 200 涓偣, 閬垮厤 polyline 杩囬暱
      if (cutPoints.length > 200) cutPoints = cutPoints.slice(-200);
      if (cutPath) {
        cutPath.setAttribute('points', cutPoints.map((p) => p.join(',')).join(' '));
      }
      // 鎻掑€奸噰鏍? 姣?4px 涓€涓噰鏍风偣, 涓婇檺 60 鐐?閬垮厤鍗曟 mousemove 閲忚繃澶?
      const dx = mv.clientX - lastPt[0];
      const dy = mv.clientY - lastPt[1];
      const dist = Math.hypot(dx, dy);
      const steps = Math.min(60, Math.max(1, Math.ceil(dist / 4)));
      for (let s = 0; s <= steps; s++) {
        const t = steps === 0 ? 1 : s / steps;
        const px = lastPt[0] + dx * t;
        const py = lastPt[1] + dy * t;
        // 鍛戒腑妫€娴? 閲囨牱鐐逛笅鎵€鏈夊厓绱?
        const els = document.elementsFromPoint(px, py);
        for (const el of els) {
          const edgeEl = (el as Element).closest?.('.react-flow__edge') as Element | null;
          if (!edgeEl) continue;
          const id = edgeEl.getAttribute('data-id') || '';
          if (!id) continue;
          if (!cutSet.has(id)) {
            cutSet.add(id);
            edgeEl.classList.add('cut-marked');
          }
        }
      }
    };

    const onCutUp = () => finishCut();

    const onCutMouseDownCapture = (e: MouseEvent) => {
      if (!e.shiftKey) return;
      if (e.button !== 0) return;
      const targetEl = e.target as HTMLElement | null;
      if (!targetEl) return;
      // 鎺掗櫎: handle / button / input / textarea / [contenteditable] / edge 鏈綋
      if (
        targetEl.closest('.react-flow__handle') ||
        targetEl.closest('button') ||
        targetEl.closest('input') ||
        targetEl.closest('textarea') ||
        targetEl.closest('[contenteditable="true"]') ||
        targetEl.closest('.react-flow__edge')
      ) {
        return;
      }
      // 鍙湪: react-flow pane(鐢诲竷绌虹櫧) 鎴?GroupBoxNode 鍐呴儴绌虹櫧 瑙﹀彂
      const onPane = !!targetEl.closest('.react-flow__pane');
      const groupNode = targetEl.closest('.react-flow__node-groupBox') as HTMLElement | null;
      // 濡傛灉鍦ㄦ櫘閫氳妭鐐瑰唴閮?闈?GroupBox) 涓嶈Е鍙? 閬垮厤涓庤妭鐐规嫋鍔ㄥ啿绐?
      const inOtherNode =
        !!targetEl.closest('.react-flow__node') && !groupNode;
      if (!onPane && !groupNode) return;
      if (inOtherNode) return;

      // 鎷︽埅 ReactFlow 榛樿 panning
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      cutting = true;
      cutSet = new Set();
      cutPoints = [[e.clientX, e.clientY]];
      document.body.classList.add('cut-mode');

      // 鍒涘缓涓存椂 SVG overlay (fixed, pointer-events:none)
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.style.position = 'fixed';
      svg.style.left = '0';
      svg.style.top = '0';
      svg.style.right = '0';
      svg.style.bottom = '0';
      svg.style.width = '100vw';
      svg.style.height = '100vh';
      svg.style.pointerEvents = 'none';
      svg.style.zIndex = '99999';
      svg.setAttribute('class', 'cut-overlay-svg');
      const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      polyline.setAttribute('fill', 'none');
      polyline.setAttribute('points', `${e.clientX},${e.clientY}`);
      polyline.setAttribute('class', 'cut-overlay-path');
      svg.appendChild(polyline);
      document.body.appendChild(svg);
      cutSvg = svg;
      cutPath = polyline;

      window.addEventListener('mousemove', onCutMove, true);
      window.addEventListener('mouseup', onCutUp, true);
    };

    // SHIFT 閲婃斁鏈熼棿涓€斾腑鏂? 涔熸敹灏?
    const onCutKeyUp = (kev: KeyboardEvent) => {
      if (kev.key === 'Shift' && cutting) finishCut();
    };
    window.addEventListener('keyup', onCutKeyUp);
    window.addEventListener('mousedown', onCutMouseDownCapture, true);

    const onMouseDownCapture = (e: MouseEvent) => {
      if (!e.shiftKey) return;
      if (e.button !== 0) return; // 浠呭乏閿?
      const targetEl = e.target as HTMLElement | null;
      if (!targetEl) return;
      const handleEl = targetEl.closest('.react-flow__handle') as HTMLElement | null;
      if (!handleEl) return;

      // 鑾峰彇鑺傜偣 ID
      const nodeEl = handleEl.closest('.react-flow__node') as HTMLElement | null;
      const nodeId =
        handleEl.getAttribute('data-nodeid') || nodeEl?.getAttribute('data-id') || '';
      if (!nodeId) return;

      // 鍒ゆ柇 handle 绫诲瀷锛歞ata-handlepos / class / data-handletype 澶氶噸鍏戝簳
      const detectHandleType = (el: HTMLElement): 'source' | 'target' | null => {
        const dt = el.getAttribute('data-handletype');
        if (dt === 'target' || dt === 'source') return dt;
        if (el.classList.contains('react-flow__handle-left')) return 'target';
        if (el.classList.contains('react-flow__handle-right')) return 'source';
        const pos = el.getAttribute('data-handlepos');
        if (pos === 'left' || pos === 'top') return 'target';
        if (pos === 'right' || pos === 'bottom') return 'source';
        return null;
      };
      const handleType = detectHandleType(handleEl);
      if (!handleType) return;

      // 鏀堕泦鐩稿叧杈?
      const relatedEdges =
        handleType === 'target'
          ? edgesRef.current.filter((ed) => ed.target === nodeId)
          : edgesRef.current.filter((ed) => ed.source === nodeId);
      if (relatedEdges.length === 0) return;

      // 鎷︽埅 ReactFlow 榛樿澶勭悊(澶氶€?杩炴帴鍚姩)
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();

      const startNodeId = nodeId;
      const startHandleType = handleType;
      const stashed: Edge[] = JSON.parse(JSON.stringify(relatedEdges));
      const stashedIds = new Set(stashed.map((ed) => ed.id));

      // 鍒濆 phantom 浣嶇疆 (flow 鍧愭爣)
      const initFlowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });

      // 1) 鍒涘缓 phantom 鑺傜偣
      setNodes((ns) => {
        // 閬垮厤閲嶅鍒涘缓
        if (ns.some((n) => n.id === BULK_PHANTOM_ID)) return ns;
        return [
          ...ns,
          {
            id: BULK_PHANTOM_ID,
            type: 'bulkPhantom',
            position: initFlowPos,
            data: {},
            draggable: false,
            selectable: false,
            deletable: false,
            zIndex: 9999,
            // 鈿狅笍 鍏抽敭锛歱hantom wrapper 蹇呴』 pointerEvents:none锛屽惁鍒欏畠浼氱洊鍦ㄧ洰鏍?handle 涔嬩笂鎷︽埅 mouseup.target锛?
            //         瀵艰嚧 SHIFT 澶氱嚎骞崇Щ鍒扮洰鏍囪妭鐐规椂 target.closest('.react-flow__handle') = null锛屽钩绉荤洿鎺ュけ鏁堛€?
            //         璇﹁ skill.md 搂43銆?
            style: { pointerEvents: 'none' },
          } as Node,
        ];
      });

      // 2) 閲嶅畾鍚?stashed 杈圭殑 target/source 鍒?phantom锛岃杈瑰疄鏃惰窡闅?phantom 绉诲姩
      setEdges((eds) =>
        eds.map((ed) => {
          if (!stashedIds.has(ed.id)) return ed;
          if (startHandleType === 'target') {
            return { ...ed, target: BULK_PHANTOM_ID, targetHandle: null };
          } else {
            return { ...ed, source: BULK_PHANTOM_ID, sourceHandle: null };
          }
        })
      );

      // 鍏夋爣鍙嶉
      document.body.classList.add('bulk-reconnecting');

      // 楂樹寒 hover 鍒扮殑鍚岀被鍨嬪彲鎺ユ敹 handle
      let lastHoverEl: HTMLElement | null = null;
      const setHoverHL = (el: HTMLElement | null) => {
        if (lastHoverEl && lastHoverEl !== el) {
          lastHoverEl.style.boxShadow = '';
          lastHoverEl.style.transform = '';
        }
        if (el && el !== lastHoverEl) {
          el.style.boxShadow = '0 0 0 4px rgba(34, 197, 94, 0.6)';
          el.style.transform = 'scale(1.4)';
        }
        lastHoverEl = el;
      };

      const cleanup = () => {
        window.removeEventListener('mouseup', onMouseUp, true);
        window.removeEventListener('mousemove', onMouseMove, true);
        window.removeEventListener('keydown', onKeyDown, true);
        document.body.classList.remove('bulk-reconnecting');
        setHoverHL(null);
        // 绉婚櫎 phantom 鑺傜偣
        setNodes((ns) => ns.filter((n) => n.id !== BULK_PHANTOM_ID));
      };

      const restoreOriginal = () => {
        // 鍙栨秷: 杈?target/source 杩樺師涓?stashed 閲岀殑鍘熷鍊?
        const origMap = new Map(stashed.map((s) => [s.id, s]));
        setEdges((eds) =>
          eds.map((ed) => {
            const orig = origMap.get(ed.id);
            if (!orig) return ed;
            return {
              ...ed,
              source: orig.source,
              target: orig.target,
              sourceHandle: orig.sourceHandle,
              targetHandle: orig.targetHandle,
            };
          })
        );
      };

      const onKeyDown = (kev: KeyboardEvent) => {
        if (kev.key === 'Escape') {
          cleanup();
          restoreOriginal();
        }
      };

      // 鈿狅笍 鍙屽眰鍏滃簳锛氳烦杩?phantom 鑺傜偣鑷韩锛屼粠鍧愭爣涓嬪懡涓墍鏈夊厓绱犱腑鎵惧嚭鐪熸鐨?handle
      //         璇﹁ skill.md 搂43
      const findHandleAt = (cx: number, cy: number): HTMLElement | null => {
        const els = document.elementsFromPoint(cx, cy);
        for (const el of els) {
          const h = (el as Element).closest?.('.react-flow__handle') as HTMLElement | null;
          if (!h) continue;
          const wrap = h.closest('.react-flow__node') as HTMLElement | null;
          const nid = h.getAttribute('data-nodeid') || wrap?.getAttribute('data-id') || '';
          if (nid === BULK_PHANTOM_ID) continue;
          return h;
        }
        return null;
      };

      const onMouseMove = (mv: MouseEvent) => {
        // 鏇存柊 phantom 鑺傜偣浣嶇疆 鈫?杈硅窡闅忛紶鏍囩Щ鍔?
        const fp = screenToFlowPosition({ x: mv.clientX, y: mv.clientY });
        setNodes((ns) =>
          ns.map((n) =>
            n.id === BULK_PHANTOM_ID ? { ...n, position: fp } : n
          )
        );
        // 楂樹寒 hover 鍒扮殑鍚岀被鍨?handle锛堢敤 elementsFromPoint 澶嶆暟閬嶅巻锛岃烦杩?phantom 鑷韩锛?
        const hoverHandle = findHandleAt(mv.clientX, mv.clientY);
        if (hoverHandle) {
          // 鎺掗櫎鑷韩璧风偣鑺傜偣鐨?handle 浠ュ強 phantom 鑷韩
          const hoverNodeEl = hoverHandle.closest('.react-flow__node') as HTMLElement | null;
          const hoverNodeId =
            hoverHandle.getAttribute('data-nodeid') ||
            hoverNodeEl?.getAttribute('data-id') ||
            '';
          const hoverType = detectHandleType(hoverHandle);
          if (
            hoverNodeId &&
            hoverNodeId !== startNodeId &&
            hoverNodeId !== BULK_PHANTOM_ID &&
            hoverType === startHandleType
          ) {
            setHoverHL(hoverHandle);
            return;
          }
        }
        setHoverHL(null);
      };

      const onMouseUp = (upEv: MouseEvent) => {
        // 鍙屽眰璺緞锛氬厛灏濊瘯 event.target 蹇矾寰勶紝鍛戒腑 phantom 鏃剁敤 elementsFromPoint 鍏滃簳锛堣瑙?skill.md 搂43锛?
        const upTargetEl = upEv.target as HTMLElement | null;
        let upHandleEl = upTargetEl?.closest('.react-flow__handle') as HTMLElement | null;
        if (upHandleEl) {
          const wrap = upHandleEl.closest('.react-flow__node') as HTMLElement | null;
          const nid =
            upHandleEl.getAttribute('data-nodeid') ||
            wrap?.getAttribute('data-id') ||
            '';
          if (nid === BULK_PHANTOM_ID) upHandleEl = null;
        }
        if (!upHandleEl) upHandleEl = findHandleAt(upEv.clientX, upEv.clientY);
        cleanup();

        if (!upHandleEl) {
          restoreOriginal();
          return;
        }
        const upNodeEl = upHandleEl.closest('.react-flow__node') as HTMLElement | null;
        const upNodeId =
          upHandleEl.getAttribute('data-nodeid') ||
          upNodeEl?.getAttribute('data-id') ||
          '';
        if (!upNodeId || upNodeId === startNodeId || upNodeId === BULK_PHANTOM_ID) {
          restoreOriginal();
          return;
        }
        const upHandleType = detectHandleType(upHandleEl);
        if (upHandleType !== startHandleType) {
          restoreOriginal();
          return;
        }

        // 鎵ц鎵归噺閲嶈繛: 鐢熸垚鏂拌竟鏇挎崲 stashed 涓閲嶅畾鍚戝埌 phantom 鐨勮竟
        setEdges((eds) => {
          const filtered = eds.filter((ed) => !stashedIds.has(ed.id));
          const ts = Date.now();
          const newEdges: Edge[] = stashed.map((old) => {
            const sourceId =
              startHandleType === 'target' ? old.source : upNodeId;
            const targetId =
              startHandleType === 'target' ? upNodeId : old.target;
            const srcN = nodesRef.current.find((n) => n.id === sourceId);
            const tgtN = nodesRef.current.find((n) => n.id === targetId);
            const outs = srcN ? getNodeOutputs(srcN) : [];
            const ins = tgtN ? getNodeInputs(tgtN) : [];
            const matched = outs.find(
              (o) => ins.includes(o) || o === 'any' || ins.includes('any')
            );
            const color =
              matched && matched !== 'any' ? PORT_COLOR[matched] : undefined;
            return {
              ...old,
              id: `e-${sourceId}-${targetId}-${ts}-${Math.random()
                .toString(36)
                .slice(2, 6)}`,
              source: sourceId,
              target: targetId,
              sourceHandle: startHandleType === 'target' ? old.sourceHandle : null,
              targetHandle: startHandleType === 'source' ? old.targetHandle : null,
              ...(color ? { style: { stroke: color, strokeWidth: 2 } } : {}),
              data: {
                ...((old.data as any) || {}),
                portType: matched ?? 'any',
              },
            };
          });
          return [...filtered, ...newEdges];
        });
      };

      window.addEventListener('mouseup', onMouseUp, true);
      window.addEventListener('mousemove', onMouseMove, true);
      window.addEventListener('keydown', onKeyDown, true);
    };

    window.addEventListener('mousedown', onMouseDownCapture, true);
    return () => {
      window.removeEventListener('mousedown', onMouseDownCapture, true);
      window.removeEventListener('mousedown', onCutMouseDownCapture, true);
      window.removeEventListener('keyup', onCutKeyUp);
      window.removeEventListener('mousemove', onCutMove, true);
      window.removeEventListener('mouseup', onCutUp, true);
      window.removeEventListener('keydown', onShiftDown);
      window.removeEventListener('keyup', onShiftUp);
      window.removeEventListener('blur', onBlur);
      document.body.classList.remove('shift-mode');
      document.body.classList.remove('bulk-reconnecting');
      document.body.classList.remove('cut-mode');
      if (cutSvg && cutSvg.parentNode) cutSvg.parentNode.removeChild(cutSvg);
      document
        .querySelectorAll('.react-flow__edge.cut-marked')
        .forEach((el) => el.classList.remove('cut-marked'));
    };
  }, [screenToFlowPosition]);

  // 璁＄畻鍊欓€夎妭鐐瑰垪琛?鏍规嵁璧峰鑺傜偣杈撳嚭/杈撳叆绫诲瀷杩囨护)
  const pickerCandidates = useMemo<Array<NodeMeta & { matchedTypes: PortType[] }>>(() => {
    if (!picker) return [];
    const fromNode = nodes.find((n) => n.id === picker.fromNodeId);
    if (!fromNode) return [];
    // 浠?source handle 鎷夊嚭: 婧愯妭鐐硅緭鍑?鈫?鍊欓€夎妭鐐归渶瑕佹湁鑳芥敹杩欎簺杈撳嚭鐨勮緭鍏?
    // 浠?target handle 鎷夊嚭: 婧愯妭鐐硅緭鍏?鈫?鍊欓€夎妭鐐归渶瑕佹湁鑳借鍏舵帴鍙楃殑杈撳嚭
    const isFromSource = picker.fromHandleType === 'source';
    const fromOuts = isFromSource ? getNodeOutputs(fromNode) : [];
    const fromIns = !isFromSource ? getNodeInputs(fromNode) : [];

    return NODE_REGISTRY.flatMap((meta) => {
      // 闅愯棌鑺傜偣涓嶄綔涓哄€欓€夐」鍑虹幇(浠呬粠涓诲姩娣诲姞鍏ュ彛涓Щ闄?涓嶅奖鍝嶅凡瀛樺湪鑺傜偣杩炶竟)
      if (meta.hidden) return [];
      // 涓嶆帹鑽愬甫鍔ㄦ€佽緭鍑虹殑 upload 浣滀负鍊欓€?source鈿′絾鍏佽瀹冧綔涓?target(upload 鏈韩涓嶅彈杈撳叆,瀹為檯鏈€鍚庝細琚繃婊?
      const ports = NODE_PORTS[meta.type];
      if (!ports) return [];
      let matched: PortType[] = [];
      if (isFromSource) {
        // 闇€瑕?meta.inputs 涓?fromOuts 鏈変氦闆?
        if (!arePortsCompatible(fromOuts, ports.inputs)) return [];
        matched = fromOuts.filter((t) => ports.inputs.includes(t) || ports.inputs.includes('any') || t === 'any');
      } else {
        // 鎷栧嚭 target handle鈿￠渶瑕?meta.outputs 涓?fromIns 鏈変氦闆?
        // upload 鑺傜偣 outputs 鍔ㄦ€佷负 [],鍦ㄦ鑰冭檻 image/video/audio 鍧囧彲浣滀负娼滃湪杈撳嚭婧?
        const candidateOuts = meta.type === 'upload' ? (['image', 'video', 'audio'] as PortType[]) : ports.outputs;
        if (!arePortsCompatible(candidateOuts, fromIns)) return [];
        matched = candidateOuts.filter((t) => fromIns.includes(t) || fromIns.includes('any') || t === 'any');
      }
      return [{ ...meta, matchedTypes: matched }];
    }).sort((a, b) => {
      // 涓户鑺傜偣(relay)姘歌繙缃《,浣滀负鏈€甯哥敤鐨勯€忎紶/鍒嗗彂鑺傜偣鍏ュ彛
      if (a.type === 'relay' && b.type !== 'relay') return -1;
      if (b.type === 'relay' && a.type !== 'relay') return 1;
      return 0;
    });
  }, [picker, nodes]);

  // 鐐瑰嚮鍊欓€夐」鈫?鍦ㄦ嫋钀戒綅缃垱寤鸿妭鐐瑰苟鑷姩杩炵嚎
  const handlePickCandidate = useCallback(
    (meta: NodeMeta) => {
      if (!picker) return;
      const id = `${meta.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newNode: Node = {
        id,
        type: meta.type,
        position: picker.flowPos,
        data: { ...(INITIAL_DATA[meta.type] || {}) },
      };
      setNodes((prev) => [...prev, newNode]);

      // 鍒涘缓杩炵嚎:鏍规嵁 source/target 鏂瑰悜
      const isFromSource = picker.fromHandleType === 'source';
      const params: Connection = isFromSource
        ? { source: picker.fromNodeId, target: id, sourceHandle: null, targetHandle: null }
        : { source: id, target: picker.fromNodeId, sourceHandle: null, targetHandle: null };

      // 鏌撹壊(浣跨敤 nodes + 鏂拌妭鐐硅绠?
      const fromNode = nodes.find((n) => n.id === picker.fromNodeId);
      const tempNewNode = newNode;
      const src = isFromSource ? fromNode : tempNewNode;
      const tgt = isFromSource ? tempNewNode : fromNode;
      const outs = src ? getNodeOutputs(src) : [];
      const ins = tgt ? getNodeInputs(tgt) : [];
      const matched = outs.find((o) => ins.includes(o) || o === 'any' || ins.includes('any'));
      const color = matched && matched !== 'any' ? PORT_COLOR[matched] : undefined;

      setEdges((eds) =>
        addEdge(
          {
            ...params,
            ...(color ? { style: { stroke: color, strokeWidth: 2 } } : {}),
            data: { portType: matched ?? 'any' },
          },
          eds
        )
      );
      setPicker(null);
    },
    [picker, nodes]
  );

  // ===== 鑷姩鍒涘缓杈撳嚭绱犳潗鑺傜偣 =====
  // 鐢熸垚绫昏妭鐐?(image/video/audio/seedance/llm/runninghub 绛? 杈撳嚭瀛楁鏈夊€煎悗,
  // 鑷姩鍒涘缓瀵瑰簲鏁伴噺鐨?OutputNode 骞惰繛绾裤€?
  // 闃插惊鐜? 浠?nodeId -> sig(杈撳嚭椤瑰垪琛ㄥ搱甯? 璁板繂宸插鐞嗙姸鎬?
  // 鍚?sig 涓嶉噸澶嶅垱寤? 涓旇烦杩囨湰韬氨鏄?OutputNode 鐨勮妭鐐归伩鍏嶉摼寮忕垎鐐?
  const autoOutputProcessedRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (!loaded) return;
    autoOutputProcessedRef.current.clear();
  }, [loaded]);

  const REORDER_GAP = 30;
  const REORDER_COLS = 3;
  useEffect(() => {
    if (!loaded) return;
    // 鎸?source 鍒嗙粍鏀堕泦鑷姩澶栨寕鐨?OutputNode
    const groups = new Map<string, Node[]>();
    for (const e of edges) {
      if (!e.id.startsWith('e-auto-')) continue;
      const target = nodes.find((n) => n.id === e.target);
      if (!target || target.type !== 'output') continue;
      if (!target.id.startsWith('output-auto-')) continue;
      let g = groups.get(e.source);
      if (!g) {
        g = [];
        groups.set(e.source, g);
      }
      g.push(target);
    }
    if (groups.size === 0) return;

    const updates = new Map<string, { x: number; y: number }>();
    for (const [srcId, list] of groups) {
      const src = nodes.find((n) => n.id === srcId);
      if (!src) continue;
      // 鎸?pickIndex 鎺掑簭, 淇濊瘉椤哄簭涓庝笂娓歌緭鍑轰竴鑷?
      list.sort((a, b) => {
        const ai = (a.data as any)?.pickIndex ?? 0;
        const bi = (b.data as any)?.pickIndex ?? 0;
        return ai - bi;
      });
      // measured 浼樺厛, 鏈覆鏌撳嚭鏉ュ墠鍥為€€鍒板崰浣嶅昂瀵?
      const dims = list.map((n) => ({
        w: (n as any).measured?.width || (n as any).width || 320,
        h: (n as any).measured?.height || (n as any).height || 360,
      }));
      const rowsCount = Math.ceil(list.length / REORDER_COLS);
      const colMaxW = new Array(REORDER_COLS).fill(0);
      const rowMaxH = new Array(rowsCount).fill(0);
      list.forEach((_, i) => {
        const c = i % REORDER_COLS;
        const r = Math.floor(i / REORDER_COLS);
        if (dims[i].w > colMaxW[c]) colMaxW[c] = dims[i].w;
        if (dims[i].h > rowMaxH[r]) rowMaxH[r] = dims[i].h;
      });
      // 绱姞鍑哄悇鍒?/ 鍚勮 鐨勮捣鐐瑰亸绉?
      const colX = new Array(REORDER_COLS).fill(0);
      for (let c = 1; c < REORDER_COLS; c++) {
        colX[c] = colX[c - 1] + colMaxW[c - 1] + REORDER_GAP;
      }
      const rowY = new Array(rowsCount).fill(0);
      for (let r = 1; r < rowsCount; r++) {
        rowY[r] = rowY[r - 1] + rowMaxH[r - 1] + REORDER_GAP;
      }
      const srcW = (src as any).measured?.width || (src as any).width || 320;
      const baseX = (src.position?.x ?? 0) + srcW + 80;
      const baseY = src.position?.y ?? 0;
      list.forEach((n, i) => {
        const c = i % REORDER_COLS;
        const r = Math.floor(i / REORDER_COLS);
        const newX = baseX + colX[c];
        const newY = baseY + rowY[r];
        const cx = n.position?.x ?? 0;
        const cy = n.position?.y ?? 0;
        // 鐢ㄦ埛鎵嬪姩鎷栧姩杩囩殑鑺傜偣 (data.userMoved=true) 璺宠繃, 淇濈暀浣嶇疆
        if ((n.data as any)?.userMoved === true) return;
        // 璇樊澶т簬 1px 鎵嶄慨姝? 閬垮厤寰噺鎶栧姩瑙﹀彂鏃犻檺閲嶆覆鏌?
        if (Math.abs(cx - newX) > 1 || Math.abs(cy - newY) > 1) {
          updates.set(n.id, { x: newX, y: newY });
        }
      });
    }
    if (updates.size > 0) {
      setNodes((prev) =>
        prev.map((n) => {
          const p = updates.get(n.id);
          return p ? { ...n, position: p } : n;
        })
      );
    }
  }, [nodes, edges, loaded]);

  // ===== 鍏ㄥ眬蹇嵎閿?=====
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 褰撶劍鐐瑰湪琛ㄥ崟鍏冪礌涓椂涓嶆嫤鎴?
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const isEditing =
        tag === 'input' ||
        tag === 'textarea' ||
        (e.target as HTMLElement | null)?.isContentEditable;
      const ctrl = e.ctrlKey || e.metaKey;
      // Undo / Redo 鍏ㄥ眬鎷︽埅(鍗充娇鍦ㄨ緭鍏ユ,Ctrl+Z 涔熷睘浜庣敾甯?浣嗘洿鍙嬪ソ鐨勬槸杈撳叆妗嗗唴涓嶆姠鍗?
      if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'z') {
        if (isEditing) return;
        e.preventDefault();
        histUndo();
        return;
      }
      if (ctrl && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        if (isEditing) return;
        e.preventDefault();
        histRedo();
        return;
      }
      if (isEditing) return;
      if (ctrl && e.key.toLowerCase() === 'c') {
        handleCopy();
      } else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'v') {
        // Ctrl+Shift+V: 杩炶竟绮樿创 鈥?鏂拌妭鐐逛笌鍘熺敾甯冮偦灞呬繚鎸佽繛鎺?
        e.preventDefault();
        handlePaste(true);
      } else if (ctrl && e.key.toLowerCase() === 'v') {
        handlePaste(false);
      } else if (ctrl && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handleDuplicate();
      } else if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'g') {
        // Ctrl+G: 蹇嵎鎵撶粍 (榛樿娴忚鍣ㄤ細鎷︽埅涓恒€屾煡鎵句笅涓€涓€嶏紝蹇呴』 preventDefault)
        e.preventDefault();
        const selIds = nodes
          .filter((n) => n.selected && n.type !== 'groupBox')
          .map((n) => n.id);
        if (selIds.length >= 1) handleCreateGroup(selIds);
      } else if (ctrl && (e.key === ']' || e.code === 'BracketRight')) {
        e.preventDefault();
        const selIds = nodes.filter((n) => n.selected).map((n) => n.id);
        handleLayerOrder(selIds, e.shiftKey ? 'front' : 'forward');
      } else if (ctrl && (e.key === '[' || e.code === 'BracketLeft')) {
        e.preventDefault();
        const selIds = nodes.filter((n) => n.selected).map((n) => n.id);
        handleLayerOrder(selIds, e.shiftKey ? 'back' : 'backward');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // xyflow 鍐呯疆 Backspace 鍒犻櫎,浣嗗湪鑺傜偣鏈€変腑鏃朵粛鍙兘鍒犻櫎杩炵嚎;
        // 鎴戜滑鎵嬪姩澶勭悊浠呭垹闄ら€変腑,閬垮厤杈撳叆杈圭紭鎯呭喌
        if (selectedCount > 0) {
          e.preventDefault();
          handleDeleteSelected();
        }
      } else if (ctrl && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setNodes((prev) => prev.map((n) => ({ ...n, selected: true })));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [histUndo, histRedo, handleCopy, handlePaste, handleDuplicate, handleDeleteSelected, handleCreateGroup, handleLayerOrder, nodes, selectedCount]);

  // 鍏ㄥ眬婊氳疆鎷︽埅 鈥斺€?鑷姩缁欐墍鏈夎妭鐐瑰唴鐨?input / textarea / select / contenteditable
  // 鎸備笂 wheel.stopPropagation()锛岃鐢ㄦ埛鍦ㄦ枃鏈鍐呭彲鐢ㄩ紶鏍囨粴杞粴鍔ㄦ枃瀛楄€屼笉瑙﹀彂鐢诲竷缂╂斁銆?
  // 閫氳繃 MutationObserver 鑷姩瑕嗙洊鏈潵鍔ㄦ€佹柊澧炵殑鑺傜偣锛堝鍙抽敭娣诲姞 / 妯℃澘鎻掑叆绛夛級銆?
  useEffect(() => {
    const root = (document.querySelector('.react-flow') as HTMLElement | null) || document.body;
    const dispose = installGlobalWheelBlockObserver(root);
    return dispose;
  }, []);

  const isDark = theme === 'dark';
    const isPixel = style === 'pixel';
    const guideColor = isPixel ? '#FF89A7' : isDark ? '#f3efe3' : '#111111';
    const edgeStroke = isPixel ? '#1A1410' : isDark ? '#676767' : '#8b8981';
    const dotColor = isPixel
      ? isDark ? '#5C4D3E' : '#C8B89A'
      : isDark ? '#D6D6D6' : '#c7c7c7';
  const bgColor = isPixel
    ? isDark ? '#1F1A14' : '#FAF3E7'
    : isDark ? '#2B2B2B' : '#e6e6e6';

  const memoNodeTypes = useMemo(() => nodeTypes, []);
  const memoEdgeTypes = useMemo(() => edgeTypes, []);

  // 鈿狅笍 浠ヤ笅鍑犱釜鍦?ReactFlow 鐨?fieldsToTrack 鍒楄〃涓? 蹇呴』绋冲畾寮曠敤,
  // 鍚﹀垯姣忔鐖剁粍浠?render 閮戒細璁?StoreUpdater 閲嶅 store.setState 鍙嶅瑙﹀彂璁㈤槄鑰?
  // 鍦ㄦ煇浜涜妭鐐规嫇鎵戜笅浼氶€€鍖栦负 Maximum update depth exceeded銆?
  const memoSelectionKeyCode = useMemo(() => ['Control', 'Meta'] as string[], []);
  const memoMultiSelectionKeyCode = useMemo(
    () => ['Control', 'Meta', 'Shift'] as string[],
    []
  );
  const memoDefaultViewport = useMemo(() => ({ x: 0, y: 0, zoom: 1 }), []);
  const memoProOptions = useMemo(() => ({ hideAttribution: true }), []);
  const memoDefaultEdgeOptions = useMemo(
    () => ({
      style: { stroke: edgeStroke, strokeWidth: isPixel ? 2.5 : 2 },
      animated: false,
    }),
    [edgeStroke, isPixel]
  );
  const memoFlowEdges = useMemo(
    () =>
      edges.map((edge) => {
        const flowActive = selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target);
        return {
          ...edge,
          data: {
            ...((edge.data as Record<string, any> | undefined) || {}),
            flowActive,
          },
        };
      }),
    [edges, selectedNodeIds]
  );
  const handleCanvasWheel = useCallback((event: WheelEvent) => {
    const target = event.target as HTMLElement | null;
    if (
      target?.closest('.nowheel') ||
      target?.closest('input') ||
      target?.closest('textarea') ||
      target?.closest('select') ||
      target?.closest('[contenteditable="true"]')
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const flowPoint = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const { zoom } = getViewport();
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
    const nextZoom = Math.min(3, Math.max(0.15, zoom * factor));
    const localX = event.clientX - bounds.left;
    const localY = event.clientY - bounds.top;

    setViewport({
      x: localX - flowPoint.x * nextZoom,
      y: localY - flowPoint.y * nextZoom,
      zoom: nextZoom,
    });
  }, [getViewport, screenToFlowPosition, setViewport]);

  if (!activeId) {
    return (
      <div
        className="flex-1 flex items-center justify-center"
        style={{ background: bgColor, color: isDark ? '#71717a' : '#52525b' }}
      >
        <div className="text-center">
          <div className="text-2xl mb-2 font-bold tracking-wide">iMade</div>
          <p>请新建项目后进入画布</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative" style={{ background: bgColor, cursor: frameCreateMode ? 'crosshair' : undefined }}>
      <TerminalPanel />
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json,image/png,.png"
        className="hidden"
        onChange={handleImportFile}
      />
      <ReactFlow
        nodes={nodes}
        edges={memoFlowEdges}
        nodeTypes={memoNodeTypes}
        edgeTypes={memoEdgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        isValidConnection={onIsValidConnection}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onSelectionContextMenu={onSelectionContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onMouseDown={onFrameCreatePaneMouseDown}
        onDragOver={handlePaneDragOver}
        onDrop={handlePaneDrop}
        onSelectionChange={onSelectionChange}
        onSelectionEnd={onSelectionEnd}
        selectionKeyCode={memoSelectionKeyCode}
        multiSelectionKeyCode={memoMultiSelectionKeyCode}
        defaultViewport={memoDefaultViewport}
        minZoom={0.15}
        maxZoom={3}
        zoomOnScroll={false}
        onWheelCapture={handleCanvasWheel}
        selectionMode={SelectionMode.Partial}
        panOnDrag={!frameCreateMode && interactionMode === 'move'}
        selectionOnDrag={!frameCreateMode && interactionMode === 'select'}
        nodesDraggable={!frameCreateMode}
        snapToGrid={snapEnabled}
        snapGrid={SNAP_GRID}
        elevateNodesOnSelect={false}
        proOptions={memoProOptions}
        defaultEdgeOptions={memoDefaultEdgeOptions}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={isPixel ? 1.6 : 1.2}
          color={dotColor}
        />
        {frameDraft && (
          <ViewportPortal>
            <div
              className="pointer-events-none absolute rounded-none"
              style={{
                left: Math.min(frameDraft.start.x, frameDraft.end.x),
                top: Math.min(frameDraft.start.y, frameDraft.end.y),
                width: Math.abs(frameDraft.end.x - frameDraft.start.x),
                height: Math.abs(frameDraft.end.y - frameDraft.start.y),
                border: `1px solid ${isDark ? '#d7ccb3' : '#8b7a52'}`,
                background: isDark ? 'rgba(215,204,179,.08)' : 'rgba(139,122,82,.08)',
                boxShadow: isDark ? '0 0 0 99999px rgba(0,0,0,.04)' : '0 0 0 99999px rgba(255,255,255,.02)',
              }}
            />
          </ViewportPortal>
        )}
        {frameCreateMode && !frameDraft && (
          <ViewportPortal>
            <div
              className={`pointer-events-none absolute rounded-md px-2 py-1 text-[11px] shadow ${
                isDark ? 'bg-zinc-950/90 text-white/75' : 'bg-white/90 text-zinc-700'
              }`}
              style={(() => {
                const pos = getViewportCenterFlowPosition();
                return { left: pos.x - 72, top: pos.y - 18 };
              })()}
            >
              拖动生成画框
            </div>
          </ViewportPortal>
        )}
        {/* 瀵归綈杈呭姪绾?鍦ㄤ笘鐣屽潗鏍囩郴涓殢瑙嗗彛鍙樻崲 */}
        {(guides.vertical.length > 0 || guides.horizontal.length > 0) && (
          <ViewportPortal>
            <svg
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: 0,
                height: 0,
                overflow: 'visible',
                pointerEvents: 'none',
                zIndex: 5,
              }}
            >
              {guides.vertical.map((x, i) => (
                <line
                  key={`v-${i}-${x}`}
                  x1={x}
                  y1={-100000}
                  x2={x}
                  y2={100000}
                  stroke={guideColor}
                  strokeWidth={isPixel ? 1.5 : 1}
                  strokeDasharray={isPixel ? '8 4' : '6 4'}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {guides.horizontal.map((y, i) => (
                <line
                  key={`h-${i}-${y}`}
                  x1={-100000}
                  y1={y}
                  x2={100000}
                  y2={y}
                  stroke={guideColor}
                  strokeWidth={isPixel ? 1.5 : 1}
                  strokeDasharray={isPixel ? '8 4' : '6 4'}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          </ViewportPortal>
        )}
        <Controls
          style={{
            background: isDark ? 'rgba(20,20,22,.9)' : 'rgba(255,255,255,.9)',
            border: `1px solid ${isDark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.08)'}`,
            borderRadius: 8,
          }}
        />
        <MiniMap
          pannable
          zoomable
          onClick={(_e, position) => {
            // 鐐瑰嚮灏忓湴鍥句换鎰忎綅缃?鈫?骞虫粦灞呬腑鍒拌 flow 鍧愭爣,淇濇寔褰撳墠缂╂斁绾у埆
            const { zoom } = getViewport();
            setCenter(position.x, position.y, { zoom, duration: 400 });
          }}
          style={{
            background: isDark ? 'rgba(20,20,22,.9)' : 'rgba(255,255,255,.9)',
            border: `1px solid ${isDark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.08)'}`,
            borderRadius: 8,
            cursor: 'pointer',
          }}
          maskColor={isDark ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.6)'}
          nodeColor={() => (isDark ? '#a1a1aa' : '#52525b')}
        />
        {/* 閫変腑鍙墽琛岃妭鐐规椂鐨勬诞鍔ㄦ搷浣滄爮 (鎵ц / 涓 / 鍏抽棴) */}
      </ReactFlow>

      {/* 璺ㄨ妭鐐圭礌鏉愭嫋鎷芥诞灞?(Ctrl + 榧犳爣宸﹂敭 浠庣礌鏉愮缉鐣ュ浘鎷栧嚭) */}
      <MaterialDragOverlay />

      {inspectorCollapsed ? (
        <div className="fixed right-3 top-3 z-40 select-none">
          <button
            type="button"
            className={`relative flex h-9 w-9 items-center justify-center rounded-md border shadow-lg transition ${
              isDark ? 'border-white/10 bg-zinc-900 text-zinc-200 hover:bg-white/10' : 'border-black/10 bg-white text-zinc-700 hover:bg-black/5'
            }`}
            title="展开属性面板"
            onClick={() => setInspectorCollapsed(false)}
          >
            <InspectorIcon size={16} />
            {selectedNodes.length > 0 && (
              <span className={`absolute -right-1 -top-1 min-w-4 rounded px-1 text-[9px] leading-4 ${
                isDark ? 'bg-amber-500 text-black' : 'bg-zinc-900 text-white'
              }`}>
                {selectedNodes.length}
              </span>
            )}
          </button>
        </div>
      ) : (
        <div
          className="fixed z-40"
          style={{ left: inspectorPosition.x, top: inspectorPosition.y, width: INSPECTOR_W, pointerEvents: 'none' }}
        >
          <div
            className={`pointer-events-auto max-h-[calc(100vh-32px)] w-[240px] overflow-y-auto rounded-xl border p-2 shadow-2xl backdrop-blur ${
              isDark ? 'border-white/16 bg-zinc-950/94 text-white shadow-black/35' : 'border-black/10 bg-white/96 text-zinc-900'
            }`}
          >
            <div className="mb-2 flex cursor-move items-center gap-2 rounded-lg px-1 py-1" onMouseDown={beginInspectorDrag} title="拖动属性面板">
              <InspectorIcon size={15} className={isDark ? 'text-white/70' : 'text-zinc-600'} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold">属性</div>
                <div className={isDark ? 'text-[10px] text-white/40' : 'text-[10px] text-zinc-500'}>
                  已选 {selectedNodes.length} 个节点
                </div>
              </div>
              <button
                type="button"
                className={`flex h-7 w-7 items-center justify-center rounded-full ${isDark ? 'hover:bg-white/10 text-white/65' : 'hover:bg-black/5 text-zinc-600'}`}
                title="最小化"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => setInspectorCollapsed(true)}
              >
                <ChevronsDown size={14} />
              </button>
            </div>

            <div className="mb-2">
              <div className={isDark ? 'mb-1.5 text-[10px] text-white/45' : 'mb-1.5 text-[10px] text-zinc-500'}>对齐</div>
              <div className="grid grid-cols-3 gap-1.5">
                {alignIconButtons.map(([mode, iconName, title]) => {
                  const Icon = ((LucideIcons as any)[iconName] || (LucideIcons as any).Minus) as any;
                  return (
                    <button
                      key={mode}
                      type="button"
                      disabled={selectedNodes.length === 0}
                      title={title}
                      onClick={() => alignSelectedNodes(mode as any)}
                      className={`flex h-8 items-center justify-center rounded-md transition disabled:opacity-35 ${
                        isDark ? 'border border-white/10 bg-white/7 text-white/78 hover:border-white/18 hover:bg-white/14' : 'bg-black/[0.04] text-zinc-700 hover:bg-black/[0.08]'
                      }`}
                    >
                      <Icon size={15} />
                    </button>
                  );
                })}
              </div>
            </div>

            {framePanelVisible && (
              <div className={`mb-2 rounded-lg border p-1.5 ${isDark ? 'border-white/10 bg-white/[0.035]' : 'border-black/8 bg-black/[0.025]'}`}>
                <div className="mb-1 flex items-center justify-between">
                  <span className={isDark ? 'text-[10px] text-white/55' : 'text-[10px] text-zinc-600'}>画框尺寸</span>
                  {frameCreateMode && (
                    <button
                      type="button"
                      className={isDark ? 'text-[10px] text-white/45 hover:text-white' : 'text-[10px] text-zinc-500 hover:text-zinc-900'}
                      onClick={cancelFrameCreateMode}
                    >
                      取消
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {FRAME_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`rounded-md border px-1.5 py-1 text-left text-[10px] leading-tight transition ${
                        isDark ? 'border-white/10 bg-white/6 text-white/72 hover:border-lime-300/45 hover:bg-lime-300/10' : 'border-black/10 bg-white text-zinc-700 hover:border-lime-600/35 hover:bg-lime-50'
                      }`}
                      title={`${preset.group} ${preset.w}×${preset.h}`}
                      onClick={() => applyFrameSizeChoice({ w: preset.w, h: preset.h, label: preset.label })}
                    >
                      <span className="block truncate font-medium">{preset.label}</span>
                      <span className={`block truncate ${isDark ? 'text-white/35' : 'text-zinc-400'}`}>{preset.group}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-1.5 grid grid-cols-[1fr_1fr_auto] gap-1">
                  <input
                    type="number"
                    min={MIN_FRAME_CREATE_W}
                    value={activeFrameW}
                    onChange={(e) => {
                      const w = Math.max(MIN_FRAME_CREATE_W, Number(e.target.value) || MIN_FRAME_CREATE_W);
                      if (selectedFrameNode) updateSelectedFrameSize({ w, h: activeFrameH });
                      else setCustomFrameSize((prev) => ({ ...prev, w }));
                    }}
                    className={`${inspectorInputClass} h-7 py-0.5`}
                    title="画框宽度"
                  />
                  <input
                    type="number"
                    min={MIN_FRAME_CREATE_H}
                    value={activeFrameH}
                    onChange={(e) => {
                      const h = Math.max(MIN_FRAME_CREATE_H, Number(e.target.value) || MIN_FRAME_CREATE_H);
                      if (selectedFrameNode) updateSelectedFrameSize({ w: activeFrameW, h });
                      else setCustomFrameSize((prev) => ({ ...prev, h }));
                    }}
                    className={`${inspectorInputClass} h-7 py-0.5`}
                    title="画框高度"
                  />
                  <button
                    type="button"
                    className={`rounded-md px-2 text-[10px] transition ${
                      isDark ? 'bg-lime-300/16 text-lime-200 hover:bg-lime-300/24' : 'bg-lime-600 text-white hover:bg-lime-700'
                    }`}
                    onClick={() => applyFrameSizeChoice({ w: activeFrameW, h: activeFrameH, label: `${activeFrameW}×${activeFrameH}` })}
                  >
                    应用
                  </button>
                </div>
                <div className={isDark ? 'mt-1 text-[10px] leading-tight text-white/35' : 'mt-1 text-[10px] leading-tight text-zinc-400'}>
                  {selectedFrameNode ? '当前画框将按新尺寸调整' : '未选中画框时会在视口中心生成'}
                </div>
                {selectedFrameNode && (
                  <button
                    type="button"
                    className={`mt-1.5 flex h-7 w-full items-center justify-center gap-1 rounded-md text-[10px] transition ${
                      isDark ? 'bg-white/10 text-white/78 hover:bg-white/16' : 'bg-zinc-900 text-white hover:bg-zinc-800'
                    }`}
                    onClick={() => void handleDownloadFrame(selectedFrameNode)}
                  >
                    <Download size={12} />
                    下载画框 PNG
                  </button>
                )}
              </div>
            )}

            {colorTarget && (
              <div className={`mb-3 rounded-lg border p-2 ${isDark ? 'border-white/10 bg-white/[0.035]' : 'border-black/8 bg-black/[0.025]'}`}>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className={isDark ? 'text-[10px] text-white/55' : 'text-[10px] text-zinc-600'}>
                    {colorTarget === 'frame' ? '画框背景' : '文字颜色'}
                  </span>
                  <div className={`grid grid-cols-2 gap-0.5 rounded-md border p-0.5 ${isDark ? 'border-white/10 bg-black/20' : 'border-black/10 bg-white'}`}>
                    {(['solid', 'gradient'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        disabled={colorPanelDisabled}
                        className={`rounded px-1.5 py-0.5 text-[10px] transition ${
                          currentColorMode === mode
                            ? isDark ? 'bg-white/18 text-white' : 'bg-zinc-900 text-white'
                            : isDark ? 'text-white/45 hover:bg-white/8' : 'text-zinc-500 hover:bg-black/5'
                        }`}
                        onClick={() => updateCurrentColorTarget(colorTarget === 'frame'
                          ? { backgroundMode: mode }
                          : { colorMode: mode })}
                      >
                        {mode === 'solid' ? '纯色' : '渐变'}
                      </button>
                    ))}
                  </div>
                </div>
                {currentColorMode === 'solid' ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={currentSolidColor}
                      onChange={(e) => updateCurrentColorTarget(colorTarget === 'frame'
                        ? { backgroundMode: 'solid', backgroundColor: e.target.value }
                        : { colorMode: 'solid', color: e.target.value })}
                      className="h-8 w-9 rounded border-0 bg-transparent p-0"
                    />
                    <div className="grid flex-1 grid-cols-5 gap-1">
                      {COLOR_SWATCHES.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className="h-6 rounded border"
                          style={{ background: color, borderColor: isDark ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.16)' }}
                          title={color}
                          onClick={() => updateCurrentColorTarget(colorTarget === 'frame'
                            ? { backgroundMode: 'solid', backgroundColor: color }
                            : { colorMode: 'solid', color })}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div
                      className="h-7 rounded-md border"
                      style={{
                        background: makeLinearGradientCss(currentGradientFrom, currentGradientTo, currentGradientAngle),
                        borderColor: isDark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.12)',
                      }}
                    />
                    <div className="grid grid-cols-[auto_auto_1fr] gap-1.5">
                      <input
                        type="color"
                        value={currentGradientFrom}
                        onChange={(e) => updateCurrentColorTarget(colorTarget === 'frame'
                          ? { backgroundMode: 'gradient', backgroundGradientFrom: e.target.value }
                          : { colorMode: 'gradient', gradientFrom: e.target.value })}
                        className="h-8 w-9 rounded border-0 bg-transparent p-0"
                        title="起始色"
                      />
                      <input
                        type="color"
                        value={currentGradientTo}
                        onChange={(e) => updateCurrentColorTarget(colorTarget === 'frame'
                          ? { backgroundMode: 'gradient', backgroundGradientTo: e.target.value }
                          : { colorMode: 'gradient', gradientTo: e.target.value })}
                        className="h-8 w-9 rounded border-0 bg-transparent p-0"
                        title="结束色"
                      />
                      <input
                        type="number"
                        min={0}
                        max={360}
                        value={currentGradientAngle}
                        onChange={(e) => updateCurrentColorTarget(colorTarget === 'frame'
                          ? { backgroundMode: 'gradient', backgroundGradientAngle: Number(e.target.value) || 0 }
                          : { colorMode: 'gradient', gradientAngle: Number(e.target.value) || 0 })}
                        className={inspectorInputClass}
                        title="渐变角度"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className={isDark ? 'mb-1.5 text-[10px] text-white/45' : 'mb-1.5 text-[10px] text-zinc-500'}>文字设置</div>
            <div className="space-y-2">
              <label className={isDark ? 'block text-[10px] text-white/55' : 'block text-[10px] text-zinc-600'}>
                字体
                <select
                  disabled={textControlsDisabled}
                  value={selectedFontValue}
                  onChange={(e) => {
                    if (e.target.value) updateSelectedText({ fontFamily: e.target.value });
                  }}
                  className={inspectorInputClass}
                >
                  <option value="">自定义</option>
                  {TEXT_FONT_OPTIONS.map((font) => (
                    <option key={font.value} value={font.value}>
                      {font.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className={isDark ? 'block text-[10px] text-white/55' : 'block text-[10px] text-zinc-600'}>
                字体名称
                <input
                  disabled={textControlsDisabled}
                  value={customFontValue}
                  placeholder="输入字体"
                  onChange={(e) => updateSelectedText({ fontFamily: e.target.value || TEXT_FONT_OPTIONS[0].value })}
                  className={inspectorInputClass}
                />
              </label>

              <div className="grid grid-cols-2 gap-1.5">
                <label className={isDark ? 'block text-[10px] text-white/55' : 'block text-[10px] text-zinc-600'}>
                  字重
                  <select
                    disabled={textControlsDisabled}
                    value={Number(primaryTextData.fontWeight || 600)}
                    onChange={(e) => updateSelectedText({ fontWeight: Number(e.target.value) })}
                    className={inspectorInputClass}
                  >
                    {TEXT_WEIGHT_OPTIONS.map((weight) => (
                      <option key={weight} value={weight}>{weight}</option>
                    ))}
                  </select>
                </label>
                <label className={isDark ? 'block text-[10px] text-white/55' : 'block text-[10px] text-zinc-600'}>
                  字号
                  <input
                    disabled={textControlsDisabled}
                    type="number"
                    min={8}
                    max={320}
                    value={Number(primaryTextData.fontSize || 48)}
                    onChange={(e) => updateSelectedText({ fontSize: Math.max(8, Number(e.target.value) || 8) })}
                    className={inspectorInputClass}
                  />
                </label>
                <label className={isDark ? 'block text-[10px] text-white/55' : 'block text-[10px] text-zinc-600'}>
                  行高
                  <input
                    disabled={textControlsDisabled}
                    type="number"
                    min={0.7}
                    max={3}
                    step={0.05}
                    value={Number(primaryTextData.lineHeight || 1.12)}
                    onChange={(e) => updateSelectedText({ lineHeight: Math.max(0.7, Number(e.target.value) || 1) })}
                    className={inspectorInputClass}
                  />
                </label>
                <label className={isDark ? 'block text-[10px] text-white/55' : 'block text-[10px] text-zinc-600'}>
                  字距
                  <input
                    disabled={textControlsDisabled}
                    type="number"
                    min={-20}
                    max={80}
                    step={0.5}
                    value={Number(primaryTextData.letterSpacing || 0)}
                    onChange={(e) => updateSelectedText({ letterSpacing: Number(e.target.value) || 0 })}
                    className={inspectorInputClass}
                  />
                </label>
              </div>

              <div className={`grid grid-cols-3 gap-1 rounded-md border p-1 ${isDark ? 'border-white/10 bg-white/5' : 'border-black/10 bg-black/[0.03]'}`}>
                  {textAlignIconButtons.map(([value, iconName, title]) => {
                    const Icon = ((LucideIcons as any)[iconName] || (LucideIcons as any).Minus) as any;
                    const active = (primaryTextData.textAlign || 'left') === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={textControlsDisabled}
                        title={title}
                        onClick={() => updateSelectedText({ textAlign: value })}
                        className={`flex h-7 items-center justify-center rounded transition disabled:opacity-35 ${
                          active ? 'bg-sky-500/25 text-sky-300' : isDark ? 'text-white/55 hover:bg-white/10' : 'text-zinc-600 hover:bg-black/10'
                        }`}
                      >
                        <Icon size={14} />
                      </button>
                    );
                  })}
              </div>
            </div>

            <div className={`mt-2 border-t pt-1.5 ${isDark ? 'border-white/10' : 'border-black/10'}`}>
              <div className="mb-1 flex items-center justify-between">
                <span className={isDark ? 'text-[10px] text-white/45' : 'text-[10px] text-zinc-500'}>窗口顺序</span>
                <span className={isDark ? 'text-[10px] text-white/35' : 'text-[10px] text-zinc-400'}>{layerItems.length}</span>
              </div>
              <div className="max-h-48 space-y-0.5 overflow-y-auto pr-0.5">
                {layerItems.length === 0 && (
                  <div className={isDark ? 'rounded-md bg-white/5 px-2 py-1.5 text-[10px] text-white/35' : 'rounded-md bg-black/[0.03] px-2 py-1.5 text-[10px] text-zinc-400'}>
                    当前画布没有窗口
                  </div>
                )}
                {layerItems.map(({ node, typeLabel, summary, sortable, level }) => {
                  const active = !!node.selected;
                  const orderButtonClass = `flex h-5 w-5 items-center justify-center rounded transition disabled:cursor-not-allowed disabled:opacity-25 ${
                    isDark ? 'text-white/60 hover:bg-white/10 hover:text-white' : 'text-zinc-500 hover:bg-black/5 hover:text-zinc-900'
                  }`;
                  return (
                    <div
                      key={node.id}
                      className={`rounded-md border px-1.5 py-1 transition ${
                        active
                          ? isDark ? 'border-sky-300/40 bg-sky-400/10' : 'border-sky-500/30 bg-sky-500/10'
                          : isDark ? 'border-white/8 bg-white/[0.035]' : 'border-black/8 bg-black/[0.025]'
                      }`}
                      style={{ marginLeft: level ? 10 : 0 }}
                    >
                      <button
                        type="button"
                        className="flex w-full items-center gap-1.5 text-left"
                        onClick={() => selectLayerNode(node.id)}
                        title={`${typeLabel} · ${node.id}`}
                      >
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-semibold ${
                          isDark ? 'bg-white/8 text-white/70' : 'bg-black/[0.04] text-zinc-600'
                        }`}>
                          {level ? '└' : typeLabel.slice(0, 1)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-[10px] font-medium leading-tight ${isDark ? 'text-white/78' : 'text-zinc-800'}`}>{typeLabel}</span>
                          <span className={`block truncate text-[9px] leading-tight ${isDark ? 'text-white/38' : 'text-zinc-500'}`}>{summary}</span>
                        </span>
                        <span className={`shrink-0 text-[9px] ${isDark ? 'text-white/28' : 'text-zinc-400'}`}>{node.id.slice(-4)}</span>
                      </button>
                      <div className="mt-0.5 flex justify-end gap-0.5">
                        <button type="button" className={orderButtonClass} disabled={!sortable} title="置顶" onClick={() => handleLayerOrder([node.id], 'front')}>
                          <ChevronsUp size={11} />
                        </button>
                        <button type="button" className={orderButtonClass} disabled={!sortable} title="上移" onClick={() => handleLayerOrder([node.id], 'forward')}>
                          <ArrowUp size={11} />
                        </button>
                        <button type="button" className={orderButtonClass} disabled={!sortable} title="下移" onClick={() => handleLayerOrder([node.id], 'backward')}>
                          <ArrowDown size={11} />
                        </button>
                        <button type="button" className={orderButtonClass} disabled={!sortable} title="置底" onClick={() => handleLayerOrder([node.id], 'back')}>
                          <ChevronsDown size={11} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 鎷栫嚎鍒扮┖鐧藉寮瑰嚭鐨勫€欓€夎妭鐐硅彍鍗?*/}
      {picker && (
        <>
          {/* 閬僵灞?鐐瑰嚮绌虹櫧鍏抽棴 (fixed 瑕嗙洊鏁翠釜瑙嗗彛,纭繚鐐瑰嚮绌虹櫧鍖哄煙鍙叧闂? */}
          <div
            className="fixed inset-0 z-30"
            onClick={() => setPicker(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setPicker(null);
            }}
          />
          <div
            className="fixed z-40 rounded-xl overflow-hidden"
            style={{
              // 浣跨敤 fixed + clientX/clientY (瑙嗗彛鍧愭爣) 璁╄彍鍗曠簿纭窡闅忛紶鏍囬噴鏀句綅缃?
              left: Math.min(picker.screenPos.x, window.innerWidth - 280),
              top: Math.min(picker.screenPos.y, window.innerHeight - 360),
              width: 260,
              maxHeight: 360,
              background: isPixel
                ? '#FFFFFF'
                : isDark
                  ? '#18181b'
                  : '#ffffff',
              border: isPixel
                ? '2px solid #1A1410'
                : `1px solid ${isDark ? 'rgba(255,255,255,.2)' : 'rgba(0,0,0,.16)'}`,
              boxShadow: isPixel
                ? '4px 4px 0 #1A1410'
                : isDark ? '0 12px 40px rgba(0,0,0,.45)' : '0 12px 32px rgba(0,0,0,.16)',
              backdropFilter: 'blur(10px)',
            }}
          >
            <div
              className="px-3 py-2 text-[11px] font-semibold flex items-center justify-between"
              style={{
                color: isPixel ? '#1A1410' : isDark ? '#fff' : '#18181b',
                borderBottom: isPixel
                  ? '2px solid #1A1410'
                  : `1px solid ${isDark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.12)'}`,
                background: isPixel ? '#A8E6C9' : 'transparent',
              }}
            >
              <span>
                {picker.fromHandleType === 'source' ? '连接到...' : '从...输入'}
              </span>
              <span
                className="text-[10px] font-normal opacity-60"
                style={{ color: isPixel ? '#1A1410' : undefined }}
              >
                {pickerCandidates.length} 个候选
              </span>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 320 }}>
              {pickerCandidates.length === 0 && (
                <div
                  className="px-3 py-4 text-[11px] text-center"
                  style={{ color: isDark ? 'rgba(255,255,255,.4)' : 'rgba(0,0,0,.4)' }}
                >
                  没有可连接的节点
                </div>
              )}
              {pickerCandidates.map((cand) => {
                const primary = cand.matchedTypes[0] ?? 'any';
                const dotColor = PORT_COLOR[primary];
                return (
                  <button
                    key={cand.type}
                    onClick={() => handlePickCandidate(cand)}
                    className="w-full text-left px-3 py-2 flex items-center gap-2 transition-colors"
                    style={{
                      background: 'transparent',
                      color: isPixel ? '#1A1410' : isDark ? '#e4e4e7' : '#27272a',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = isPixel
                        ? '#FFE08A'
                        : isDark
                          ? 'rgba(255,255,255,.06)'
                          : 'rgba(0,0,0,.04)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = 'transparent';
                    }}
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{
                        background: dotColor,
                        boxShadow: isPixel ? '0 0 0 1.5px #1A1410' : `0 0 0 2px ${dotColor}33`,
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium truncate">{cand.label}</div>
                      <div
                        className="text-[10px] truncate"
                        style={{
                      color: isPixel ? '#5f5547' : isDark ? 'rgba(255,255,255,.62)' : 'rgba(0,0,0,.62)',
                        }}
                      >
                        {cand.description}
                      </div>
                    </div>
                    <div
                      className="flex gap-1 flex-shrink-0"
                      title={cand.matchedTypes.map((t) => PORT_LABEL[t]).join(' / ')}
                    >
                      {cand.matchedTypes.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="text-[9px] px-1.5 py-0.5 rounded"
                          style={{
                            background: isPixel ? '#FFE08A' : isDark ? PORT_COLOR[t] + '2e' : PORT_COLOR[t] + '1f',
                            color: isPixel ? '#1A1410' : isDark ? PORT_COLOR[t] : '#6b4e00',
                            border: isPixel ? `1.5px solid #1A1410` : `1px solid ${PORT_COLOR[t]}88`,
                          }}
                        >
                          {PORT_LABEL[t]}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* 鍙抽敭鑿滃崟(妗嗛€?鍙抽敭 鎴?鑺傜偣鍙抽敭) */}
      {contextMenu && (() => {
        const ids = contextMenu.ids;
        const selNodes = nodes.filter((n) => ids.includes(n.id));
        const exeCount = selNodes.filter((n) => n.type && EXECUTABLE_NODE_TYPES.has(n.type)).length;
        const layerableCount = selNodes.filter(isLayerableNode).length;
        const menuItemCls = isPixel
          ? 'w-full text-left px-3 py-2 text-[12px] flex items-center gap-2 hover:bg-[var(--px-yellow)] disabled:opacity-40 disabled:hover:bg-transparent'
          : `w-full text-left px-3 py-2 text-[12px] flex items-center gap-2 disabled:opacity-40 ${
              isDark
                ? 'text-zinc-100 hover:bg-white/10 disabled:hover:bg-transparent'
                : 'text-zinc-800 hover:bg-black/5 disabled:hover:bg-transparent'
            }`;
        return (
          <>
            {/* 閬僵灞?*/}
            <div
              className="fixed inset-0 z-30"
              onClick={closeContextMenu}
              onContextMenu={(e) => {
                e.preventDefault();
                closeContextMenu();
              }}
            />
            <div
              className="fixed z-40 overflow-hidden"
              style={{
                left: Math.min(contextMenu.x, window.innerWidth - 260),
                top: Math.min(contextMenu.y, window.innerHeight - 220),
                width: 240,
                background: isPixel
                  ? '#FFFFFF'
                  : isDark
                    ? 'rgba(20,20,22,.96)'
                    : 'rgba(255,255,255,.98)',
                border: isPixel
                  ? '2px solid #1A1410'
                  : `1px solid ${isDark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.1)'}`,
                borderRadius: isPixel ? 12 : 8,
                boxShadow: isPixel
                  ? '4px 4px 0 #1A1410'
                  : '0 12px 40px rgba(0,0,0,.35)',
                backdropFilter: 'blur(10px)',
              }}
            >
              <div
                className="px-3 py-2 text-[11px] font-semibold flex items-center justify-between"
                style={{
                  color: isPixel ? '#1A1410' : isDark ? '#fff' : '#18181b',
                  borderBottom: isPixel
                    ? '2px solid #1A1410'
                    : `1px solid ${isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)'}`,
                  background: isPixel ? '#A8E6C9' : 'transparent',
                }}
              >
                <span>已选 {ids.length} 个节点</span>
                <span className="text-[10px] font-normal opacity-60">
                  可执行 {exeCount}
                </span>
              </div>
              <button
                className={menuItemCls}
                disabled={isRunning || exeCount === 0}
                onClick={() => {
                  closeContextMenu();
                  handleRunGroup(ids);
                }}
              >
                <Play size={13} fill="currentColor" />
                <span>组执行 ({exeCount})</span>
              </button>
              <button
                className={menuItemCls}
                disabled={ids.filter((i) => {
                  const n = nodes.find((x) => x.id === i);
                  return n && n.type !== 'groupBox';
                }).length === 0}
                onClick={() => {
                  closeContextMenu();
                  handleCreateGroup(ids);
                }}
              >
                <FolderPlus size={13} />
                <span>打组 (Ctrl+G)</span>
              </button>
              <button
                className={menuItemCls}
                onClick={() => {
                  closeContextMenu();
                  handleCopy();
                }}
              >
                <Copy size={13} />
                <span>复制 (Ctrl+C)</span>
              </button>
              <button
                className={menuItemCls}
                onClick={() => {
                  closeContextMenu();
                  handleDuplicate();
                }}
              >
                <CopyPlus size={13} />
                <span>快速复制 (Ctrl+D)</span>
              </button>
              <button
                className={menuItemCls}
                disabled={layerableCount === 0}
                onClick={() => {
                  closeContextMenu();
                  handleLayerOrder(ids, 'forward');
                }}
              >
                <ArrowUp size={13} />
                <span>上移一层 (Ctrl+])</span>
              </button>
              <button
                className={menuItemCls}
                disabled={layerableCount === 0}
                onClick={() => {
                  closeContextMenu();
                  handleLayerOrder(ids, 'backward');
                }}
              >
                <ArrowDown size={13} />
                <span>下移一层 (Ctrl+[)</span>
              </button>
              <button
                className={menuItemCls}
                disabled={layerableCount === 0}
                onClick={() => {
                  closeContextMenu();
                  handleLayerOrder(ids, 'front');
                }}
              >
                <ChevronsUp size={13} />
                <span>移至顶层</span>
              </button>
              <button
                className={menuItemCls}
                disabled={layerableCount === 0}
                onClick={() => {
                  closeContextMenu();
                  handleLayerOrder(ids, 'back');
                }}
              >
                <ChevronsDown size={13} />
                <span>移至底层</span>
              </button>
              <button
                className={menuItemCls}
                onClick={() => {
                  closeContextMenu();
                  handleDeleteSelected();
                }}
                style={{ color: isPixel ? '#B91C1C' : '#f87171' }}
              >
                <Trash2 size={13} />
                <span>删除 (Delete)</span>
              </button>
            </div>
          </>
        );
      })()}

      {/* 鐢诲竷绌虹櫧鍖哄彸閿彍鍗? 蹇€熸坊鍔犺妭鐐?*/}
      {paneMenu && (() => {
        const QUICK_NODES = NODE_REGISTRY.filter(
          (n) => !n.hidden && (n.category === 'input' || n.category === 'core')
        );
        const COLOR_HEX: Record<string, string> = {
          sky: '#7dd3fc', amber: '#fcd34d', rose: '#fda4af', fuchsia: '#f0abfc',
          violet: '#c4b5fd', emerald: '#6ee7b7', cyan: '#67e8f9', indigo: '#a5b4fc',
          orange: '#fdba74', pink: '#f9a8d4', slate: '#cbd5e1', teal: '#5eead4',
        };
        const itemCls = isPixel
          ? 'w-full text-left px-3 py-2 text-[12px] flex items-center gap-2 hover:bg-[var(--px-yellow)]'
          : `w-full text-left px-3 py-2 text-[12px] flex items-center gap-2 ${
              isDark ? 'text-zinc-100 hover:bg-white/10' : 'text-zinc-800 hover:bg-black/5'
            }`;
        return (
          <>
            {/* 閬僵灞?*/}
            <div
              className="fixed inset-0 z-30"
              onClick={closePaneMenu}
              onContextMenu={(e) => {
                e.preventDefault();
                closePaneMenu();
              }}
            />
            <div
              className="fixed z-40 overflow-hidden"
              style={{
                left: Math.min(paneMenu.x, window.innerWidth - 220),
                top: Math.min(paneMenu.y, window.innerHeight - 360),
                width: 200,
                background: isPixel
                  ? '#FFFFFF'
                  : isDark ? 'rgba(20,20,22,.96)' : 'rgba(255,255,255,.98)',
                border: isPixel
                  ? '2px solid #1A1410'
                  : `1px solid ${isDark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.1)'}`,
                borderRadius: isPixel ? 12 : 8,
                boxShadow: isPixel ? '4px 4px 0 #1A1410' : '0 12px 40px rgba(0,0,0,.35)',
                backdropFilter: 'blur(10px)',
              }}
            >
              <div
                className="px-3 py-2 text-[11px] font-semibold"
                style={{
                  color: isPixel ? '#1A1410' : isDark ? '#fff' : '#18181b',
                  borderBottom: isPixel
                    ? '2px solid #1A1410'
                    : `1px solid ${isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)'}`,
                  background: isPixel ? '#A8E6C9' : 'transparent',
                }}
              >
                快速添加节点
              </div>
              {QUICK_NODES.map((meta) => {
                const Icon = (LucideIcons as any)[meta.icon] || LucideIcons.Box;
                const color = COLOR_HEX[meta.color] || COLOR_HEX.slate;
                return (
                  <button
                    key={meta.type}
                    className={itemCls}
                    onClick={() => {
                      const at = { x: paneMenu.x, y: paneMenu.y };
                      closePaneMenu();
                      addNode(meta.type as NodeType, at);
                    }}
                  >
                    <span
                      className="flex items-center justify-center"
                      style={{
                        width: 22, height: 22,
                        borderRadius: isPixel ? 5 : 6,
                        background: isPixel ? color : `${color}33`,
                        color: isPixel ? '#1A1410' : color,
                        border: isPixel ? '2px solid #1A1410' : 'none',
                        flexShrink: 0,
                      }}
                    >
                      <Icon size={13} />
                    </span>
                    <span className="flex-1 truncate">{meta.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        );
      })()}
    </div>
  );
}

interface CanvasProps {
  onAddNodeRef?: React.MutableRefObject<((type: NodeType) => void) | null>;
  onSaveRef?: React.MutableRefObject<(() => Promise<void>) | null>;
  interactionMode?: CanvasInteractionMode;
}

export default function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

