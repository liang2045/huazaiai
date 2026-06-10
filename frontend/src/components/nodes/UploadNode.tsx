import { memo, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Handle, Position, useReactFlow, useUpdateNodeInternals, useViewport, type Node, type Edge, type NodeProps } from '@xyflow/react';
import {
  AlertCircle,
  Download,
  Edit3,
  FileImage,
  FileVideo,
  Music,
  RotateCcw,
  Upload as UploadIcon,
  X,
} from 'lucide-react';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useThemeStore } from '../../stores/theme';
import { PORT_COLOR } from '../../config/portTypes';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { CANVAS_REFERENCE_PICK_EVENT, useDragMaterialStore, type MaterialPayload } from '../../stores/dragMaterial';
import ImageEditModal, { type ImageEditProduceMeta } from './ImageEditModal';
import ResizableCorners from './ResizableCorners';
import { downloadAsset } from '../../utils/download';
import { apiUrl } from '../../services/apiBase';

const DEFAULT_UPLOAD_WIDTH = 220;

/**
 * UploadNode - 通用上传素材节点
 *
 * 设计(v2 重构: 占除了"先选类型"步骤):
 *   1. 节点创建后默认就是"点击/拖拽上传"状态, accept = image/video/audio 三合一
 *   2. 选中/拖入文件 → 按 MIME 自动识别 kind (图像/视频/音频)
 *   3. 上传完成:保存 url 到对应字段(imageUrl / videoUrl / audioUrl)
 *      同时按类型选择正确的端口颜色
 *   4. Handle 颜色随 uploadType 变化(image=黄/video=粉/audio=紫);
 *      未上传时 Handle 为中性 any 色
 *   5. 已上传后右上角可重置/换文件
 *
 * 与下游联动:
 *   - 上游 nothing(无 target Handle)
 *   - 输出 → 通过 data.imageUrl/videoUrl/audioUrl 暴露给下游
 */
type UploadKind = 'image' | 'video' | 'audio';

const KIND_META: Record<
  UploadKind,
  {
    label: string;
    accept: string;
    icon: typeof FileImage;
    color: string;
    dataField: 'imageUrl' | 'videoUrl' | 'audioUrl';
    port: 'image' | 'video' | 'audio';
  }
> = {
  image: {
    label: '图像',
    accept: 'image/*',
    icon: FileImage,
    color: PORT_COLOR.image,
    dataField: 'imageUrl',
    port: 'image',
  },
  video: {
    label: '视频',
    accept: 'video/*',
    icon: FileVideo,
    color: PORT_COLOR.video,
    dataField: 'videoUrl',
    port: 'video',
  },
  audio: {
    label: '音频',
    accept: 'audio/*',
    icon: Music,
    color: PORT_COLOR.audio,
    dataField: 'audioUrl',
    port: 'audio',
  },
};

/** 通过文件 MIME 推断上传类型(支持拖拽时自动选定类型) */
function inferKindFromFile(file: File): UploadKind | null {
  const m = String(file.type || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();
  if (!m) {
    if (/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(name)) return 'image';
    if (/\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(name)) return 'video';
    if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(name)) return 'audio';
    return null;
  }
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return null;
}

function formatUploadFileName(name: string) {
  if (!name) return '';
  return name.length > 4 ? `${name.slice(0, 4)}…` : name;
}

const UploadNode = ({ id, data, selected }: NodeProps) => {
  const update = useUpdateNodeData(id);
  const { theme, style } = useThemeStore();
  const isDark = theme === 'dark';
  const isPixel = style === 'pixel';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rf = useReactFlow();
  const { zoom: viewportZoom } = useViewport();
  const updateNodeInternals = useUpdateNodeInternals();

  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [imageNaturalSize, setImageNaturalSize] = useState<{ w: number; h: number } | null>(null);
  // 图像编辑弹窗 src URL（与 OutputNode 双击逻辑保持一致）
  const [editingUrl, setEditingUrl] = useState<string | null>(null);

  const d = data as any;
  const uploadType: UploadKind | null = d?.uploadType ?? null;
  const fileName: string = d?.fileName || '';
  const fileSize: number = d?.fileSize || 0;
  const meta = uploadType ? KIND_META[uploadType] : null;
  const url: string | undefined = meta ? d?.[meta.dataField] : undefined;
  const stableMenuZoom = Math.max(viewportZoom || 1, 0.01);
  const stableMenuScale = 1 / stableMenuZoom;

  // 节点本地尺寸 state: 默认 (260, 高度由内容撑开 — 上传后图/视频会撑高 root)
  // 拖角后由 ResizableCorners onResize 同步具体 px (保证 measured 准确 + keepAspectRatio 生效 + handleBounds 准确)
  const [size, setSize] = useState<{ w: number; h?: number }>(() => ({
    w: Math.max(1, Number(d?.width || d?.imageWidth || d?.videoWidth || DEFAULT_UPLOAD_WIDTH)),
    h: Number(d?.height || d?.imageHeight || d?.videoHeight || 0) || undefined,
  }));
  const refreshNodeInternals = () => {
    window.requestAnimationFrame(() => updateNodeInternals(id));
  };

  const syncSizeFromMedia = (w: number, h: number, kind: UploadKind) => {
    if (w <= 0 || h <= 0) return;
    const next = { w: Math.round(w), h: Math.round(h) };
    const patch: Record<string, any> = { width: next.w, height: next.h };
    if (kind === 'image') {
      patch.imageWidth = next.w;
      patch.imageHeight = next.h;
    }
    if (kind === 'video') {
      patch.videoWidth = next.w;
      patch.videoHeight = next.h;
    }
    setSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
    update(patch);
    refreshNodeInternals();
  };

  useEffect(() => {
    refreshNodeInternals();
  }, [id, url, uploadType, size.w, size.h]);

  // === 运行总线: 点击 RUN 后根据已上传素材生成下游 OutputNode ===
  // 设计要点:
  //   1. 只有 url 已就绪才会创建, 未上传会报错
  //   2. 防重复: 检查是否已存在 source=id, target.type='output' 且 data.directXxxUrl=当前 url 的下游
  //      若已存在则仅提示不重复创建
  //   3. 创建后节点 id 以 'output-auto-up-' 开头, 避开 'output-auto-' 网格重排接管
  const handleRun = async () => {
    setError(null);
    if (!uploadType || !meta || !url) {
      const msg = '请先上传素材';
      setError(msg);
      throw new Error(msg);
    }
    return;
    // 防重复检测
    const edges = rf.getEdges();
    const nodes = rf.getNodes();
    const dupExisted = edges.some((e) => {
      if (e.source !== id) return false;
      const t = nodes.find((n) => n.id === e.target);
      if (!t || t.type !== 'output') return false;
      const td = (t.data as any) || {};
      return td.directImageUrl === url || td.directVideoUrl === url || td.directAudioUrl === url;
    });
    if (dupExisted) {
      // 已有指向同一 url 的下游 OutputNode, 不重复创建
      return;
    }
    const me = rf.getNode(id);
    const myW = (me as any)?.measured?.width || (me as any)?.width || 320;
    const baseX = (me?.position?.x ?? 0) + myW + 80;
    const baseY = me?.position?.y ?? 0;
    const ts = Date.now();
    const newId = `output-auto-up-${id}-${ts}-${Math.random().toString(36).slice(2, 6)}`;
    // 按 uploadType 写入不同的 direct* 字段, 让 OutputNode 能独立展示
    const dataPatch: Record<string, any> = {};
    if (uploadType === 'image') {
      dataPatch.directImageUrl = url;
      dataPatch.imageUrl = url;
    } else if (uploadType === 'video') {
      dataPatch.directVideoUrl = url;
      dataPatch.videoUrl = url;
    } else if (uploadType === 'audio') {
      dataPatch.directAudioUrl = url;
      dataPatch.audioUrl = url;
    }
    const newNode: Node = {
      id: newId,
      type: 'output',
      position: { x: baseX, y: baseY },
      data: dataPatch,
      selected: false,
    } as Node;
    const newEdge: Edge = {
      id: `e-auto-up-${newId}`,
      source: id,
      target: newId,
      type: 'deletable',
    } as Edge;
    rf.addNodes(newNode);
    rf.setEdges((eds) => [...eds, newEdge]);
  };

  // 接入运行总线, 供 NodeActionBar / 批量运行 调起
  useRunTrigger(id, handleRun);

  // === 跨节点拖拽: source (从已上传缩略图 Ctrl+拖出) ===
  const startDrag = useDragMaterialStore((s) => s.start);
  const referencePickTargetId = useDragMaterialStore((s) => s.referencePickTargetId);
  const beginMaterialDrag = (e: React.MouseEvent, payload: MaterialPayload) => {
    if (e.button !== 0) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();
    startDrag(payload, e.clientX, e.clientY);
  };
  const handleCanvasReferenceSourceClick = (e: React.MouseEvent, payload: MaterialPayload) => {
    if (!referencePickTargetId || payload.kind !== 'image' || !payload.url) return false;
    e.preventDefault();
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent(CANVAS_REFERENCE_PICK_EVENT, {
      detail: { targetNodeId: referencePickTargetId, payload },
    }));
    return true;
  };

  /** 重置:清空所有字段,回到默认拖拽上传状态 */
  const handleReset = () => {
    update({
      uploadType: null,
      imageUrl: undefined,
      videoUrl: undefined,
      audioUrl: undefined,
      fileName: '',
      fileSize: 0,
      mime: '',
      width: undefined,
      height: undefined,
      imageWidth: undefined,
      imageHeight: undefined,
      videoWidth: undefined,
      videoHeight: undefined,
    });
    setSize({ w: DEFAULT_UPLOAD_WIDTH });
    setError(null);
  };

  /** 真正执行上传(在已确定 kind 后) */
  const uploadFile = async (file: File, kind: UploadKind) => {
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(apiUrl('/api/files/upload'), { method: 'POST', body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `上传失败 HTTP ${res.status}`);
      }
      const json = await res.json();
      if (!json.success || !json.data?.url) {
        throw new Error(json.error || '上传失败:未返回 URL');
      }
      const km = KIND_META[kind];
      update({
        uploadType: kind,
        [km.dataField]: json.data.url,
        fileName: file.name,
        fileSize: file.size,
        mime: file.type,
        width: undefined,
        height: undefined,
        imageWidth: undefined,
        imageHeight: undefined,
        videoWidth: undefined,
        videoHeight: undefined,
      });
      setSize({ w: DEFAULT_UPLOAD_WIDTH });
    } catch (e: any) {
      setError(e?.message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  /** 文件选择:自动按 MIME 推断 kind 后上传 */
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选同一文件
    if (!file) return;
    const inferred = uploadType ?? inferKindFromFile(file);
    if (!inferred) {
      setError('无法识别文件类型,请选择图像/视频/音频');
      return;
    }
    // 若已选定类型且不匹配, 提示错误
    if (uploadType && uploadType !== inferred) {
      const km = KIND_META[uploadType];
      setError(`文件类型不匹配:期望 ${km.label},得到 ${file.type || '未知'}`);
      return;
    }
    void uploadFile(file, inferred);
  };

  /** 拖拽上传:若 kind 未选则按文件 MIME 自动推断 */
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const inferred = uploadType ?? inferKindFromFile(file);
    if (!inferred) {
      setError('无法识别文件类型,请选择图像/视频/音频');
      return;
    }
    void uploadFile(file, inferred);
  };

  const triggerPick = () => fileInputRef.current?.click();

  // === 双击 / 上方「Edit」 → 启动图像编辑弹窗（仅 image 类型生效） ===
  // 逻辑对齐 OutputNode：编辑产物以独立 OutputNode 外挂到右侧，
  // 不修改当前上传节点本身的 imageUrl。
  const canEditImage = !!url && uploadType === 'image';
  const openEdit = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (canEditImage && url) setEditingUrl(url);
  };
  const handleProduce = (urls: string[], _meta: ImageEditProduceMeta) => {
    if (!urls || urls.length === 0) return;
    const me = rf.getNode(id);
    const myW = (me as any)?.measured?.width || (me as any)?.width || 260;
    const myH = (me as any)?.measured?.height || (me as any)?.height || 360;
    const baseX = (me?.position?.x ?? 0) + myW + 80;
    const baseY = me?.position?.y ?? 0;
    const COLS = 3;
    const COL_W = 350;
    const ROW_H = Math.max(360, myH);
    const ts = Date.now();
    const newNodes: Node[] = urls.map((u, i) => {
      const newId = `output-auto-edit-${id}-${ts}-${i}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      return {
        id: newId,
        type: 'output',
        position: {
          x: baseX + (i % COLS) * COL_W,
          y: baseY + Math.floor(i / COLS) * ROW_H,
        },
        data: {
          directImageUrl: u,
          imageUrl: u,
        },
      } as Node;
    });
    rf.addNodes(newNodes);
  };
  // ==================== 渲染 ====================
  const handleColor = meta?.color || PORT_COLOR.any;
  const headerLabel = meta ? `上传${meta.label}` : '上传素材';
  const layerOnly = !!url && !selected;
  const mediaInfo = fileName || (uploadType ? KIND_META[uploadType].label : 'Upload');
  const displayMediaInfo = fileName ? formatUploadFileName(fileName) : mediaInfo;
  const mediaActionClass = `flex h-7 w-7 items-center justify-center rounded-full border shadow-lg backdrop-blur transition ${
    isDark
      ? 'border-white/10 bg-zinc-950/88 text-white/80 hover:bg-zinc-900 hover:text-white'
      : 'border-black/10 bg-white/92 text-zinc-700 hover:bg-white hover:text-zinc-950'
  }`;
  const dangerActionClass = `flex h-7 w-7 items-center justify-center rounded-full border shadow-lg backdrop-blur transition ${
    isDark
      ? 'border-red-400/25 bg-zinc-950/88 text-red-200 hover:bg-red-500/15'
      : 'border-red-500/20 bg-white/92 text-red-600 hover:bg-red-50'
  }`;
  const imageToolIconButtonClass = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-zinc-700 transition hover:bg-zinc-100 active:bg-zinc-200';
  const imageToolDividerClass = 'imade-image-toolbar-divider mx-0.5 h-6 w-px shrink-0 bg-zinc-200';
  const uploadedImageResolution = imageNaturalSize ? `${imageNaturalSize.w}×${imageNaturalSize.h}` : '尺寸读取中';
  const uploadImageMeta = `${fileName || '上传图片'} · ${uploadedImageResolution}`;
  const renderUploadImageToolbar = () => {
    if (!selected || !url || uploadType !== 'image') return null;
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
          <button type="button" className={imageToolIconButtonClass} onClick={openEdit}>
            <Edit3 size={14} />
          </button>
          <button type="button" className={imageToolIconButtonClass} onClick={() => void downloadAsset(url, fileName || 'image.png')}>
            <Download size={15} />
          </button>
          <div className={imageToolDividerClass} />
          <button type="button" className={imageToolIconButtonClass} onClick={triggerPick}>
            <UploadIcon size={14} />
          </button>
          <button type="button" className={imageToolIconButtonClass} onClick={handleReset}>
            <X size={14} />
          </button>
        </div>
        <div
          className="imade-image-meta nodrag nopan pointer-events-none absolute left-1/2 z-[185] max-w-[420px] truncate rounded-full px-3 py-1 text-[13px] leading-[18px]"
          style={{
            top: `${-15 / stableMenuZoom}px`,
            transform: `translateX(-50%) scale(${stableMenuScale})`,
            transformOrigin: 'top center',
          }}
        >
          {uploadImageMeta}
        </div>
      </>
    );
  };

  if (url && uploadType && meta) {
    return (
      <div
        className="imade-image-layer imade-upload-layer group relative mt-8 overflow-visible rounded-none bg-transparent"
        data-theme={isDark ? 'dark' : 'light'}
        style={{ width: size.w, height: size.h }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={meta.accept}
          className="hidden"
          onChange={handleFileChange}
        />
        <Handle
          type="source"
          position={Position.Right}
          className="!border-0"
          style={{
            background: handleColor,
            width: 10,
            height: 10,
            top: '50%',
            opacity: selected ? 1 : 0,
            pointerEvents: selected ? 'all' : 'none',
          }}
          title={`Output ${meta.label}`}
        />
        {renderUploadImageToolbar()}
        {uploadType !== 'image' && (
          <div className={`pointer-events-none absolute -top-8 left-0 right-0 z-30 flex items-center justify-between gap-2 transition-opacity ${
            selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}>
            <div className={`min-w-0 flex-1 truncate rounded-full border px-2 py-1 text-[10px] shadow-lg backdrop-blur ${
              isDark ? 'border-white/10 bg-zinc-950/88 text-white/70' : 'border-black/10 bg-white/92 text-zinc-600'
            }`} title={fileName || mediaInfo}>
              {fileSize > 0 ? `${displayMediaInfo} / ${(fileSize / 1024).toFixed(1)} KB` : displayMediaInfo}
            </div>
            <div className="pointer-events-auto flex shrink-0 items-center gap-1">
              <button type="button" className={mediaActionClass} title="Download" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); void downloadAsset(url, fileName || (uploadType === 'video' ? 'video.mp4' : uploadType === 'audio' ? 'audio.mp3' : 'image.png')); }}>
                <Download size={13} />
              </button>
              <button type="button" className={mediaActionClass} title="Replace" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); triggerPick(); }}>
                <UploadIcon size={13} />
              </button>
              <button type="button" className={dangerActionClass} title="Clear" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); handleReset(); }}>
                <X size={13} />
              </button>
            </div>
          </div>
        )}
        {selected && uploadType === 'image' && (
          <ResizableCorners
            selected={selected}
            minWidth={80}
            minHeight={80}
            accent={handleColor}
            onResize={(_e, p) => {
              setSize({ w: p.width, h: p.height });
              update({ width: Math.round(p.width), height: Math.round(p.height) });
              refreshNodeInternals();
            }}
          />
        )}
        {uploadType === 'image' && (
          <img
            src={url}
            alt={fileName}
            className={`block w-full select-none object-contain ${size.h ? 'h-full' : 'h-auto'}`}
            style={{ background: 'transparent' }}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            data-drag-source
            data-drag-kind="image"
            data-drag-url={url}
            data-drag-preview={url}
            data-drag-node-id={id}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                setImageNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
                syncSizeFromMedia(img.naturalWidth, img.naturalHeight, 'image');
              }
              refreshNodeInternals();
            }}
            onClick={(e) =>
              handleCanvasReferenceSourceClick(e, { kind: 'image', url, sourceNodeId: id, previewUrl: url })
            }
            onMouseDown={(e) =>
              beginMaterialDrag(e, { kind: 'image', url, sourceNodeId: id, previewUrl: url })
            }
            onDoubleClick={(e) => {
              e.stopPropagation();
              openEdit();
            }}
          />
        )}
        {uploadType === 'video' && (
          <video
            src={url}
            controls
            className={`block w-full select-none object-contain ${size.h ? 'h-full' : 'h-auto'}`}
            style={{ background: 'transparent' }}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            data-drag-source
            data-drag-kind="video"
            data-drag-url={url}
            data-drag-preview={url}
            data-drag-node-id={id}
            onLoadedMetadata={(e) => {
              const video = e.currentTarget;
              syncSizeFromMedia(video.videoWidth, video.videoHeight, 'video');
              refreshNodeInternals();
            }}
            onMouseDown={(e) =>
              beginMaterialDrag(e, { kind: 'video', url, sourceNodeId: id, previewUrl: url })
            }
          />
        )}
        {uploadType === 'audio' && (
          <audio
            src={url}
            controls
            className="w-full"
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            data-drag-source
            data-drag-kind="audio"
            data-drag-url={url}
            data-drag-node-id={id}
            onMouseDown={(e) =>
              beginMaterialDrag(e, { kind: 'audio', url, sourceNodeId: id })
            }
          />
        )}
        {editingUrl && (
          <ImageEditModal
            srcUrl={editingUrl}
            onClose={() => setEditingUrl(null)}
            onProduce={handleProduce}
          />
        )}
      </div>
    );
  }

  if (layerOnly && uploadType && meta) {
    return (
      <div
        className="imade-image-layer imade-upload-layer relative bg-transparent"
        data-theme={isDark ? 'dark' : 'light'}
        style={{ width: size.w, height: size.h }}
      >
        <Handle
          type="source"
          position={Position.Right}
          className="!border-0 !opacity-0 !pointer-events-none"
          style={{ background: handleColor, width: 10, height: 10, top: '50%' }}
          title={meta ? `输出 ${meta.label}` : '请先选择类型'}
        />
        {uploadType === 'image' && (
          <img
            src={url}
            alt={fileName}
            className={`block w-full select-none object-contain ${size.h ? 'h-full' : 'h-auto'}`}
            style={{ background: 'transparent' }}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            data-drag-source
            data-drag-kind="image"
            data-drag-url={url}
            data-drag-preview={url}
            data-drag-node-id={id}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                setImageNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
                syncSizeFromMedia(img.naturalWidth, img.naturalHeight, 'image');
              }
              refreshNodeInternals();
            }}
            onClick={(e) =>
              handleCanvasReferenceSourceClick(e, { kind: 'image', url, sourceNodeId: id, previewUrl: url })
            }
            onMouseDown={(e) =>
              beginMaterialDrag(e, { kind: 'image', url, sourceNodeId: id, previewUrl: url })
            }
            onDoubleClick={(e) => {
              e.stopPropagation();
              openEdit();
            }}
          />
        )}
        {uploadType === 'video' && (
          <video
            src={url}
            className={`block w-full select-none object-contain ${size.h ? 'h-full' : 'h-auto'}`}
            style={{ background: 'transparent' }}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            data-drag-source
            data-drag-kind="video"
            data-drag-url={url}
            data-drag-preview={url}
            data-drag-node-id={id}
            onLoadedMetadata={(e) => {
              const video = e.currentTarget;
              syncSizeFromMedia(video.videoWidth, video.videoHeight, 'video');
              refreshNodeInternals();
            }}
            onMouseDown={(e) =>
              beginMaterialDrag(e, { kind: 'video', url, sourceNodeId: id, previewUrl: url })
            }
          />
        )}
        {uploadType === 'audio' && (
          <audio
            src={url}
            controls
            className="w-full"
            data-drag-source
            data-drag-kind="audio"
            data-drag-url={url}
            data-drag-node-id={id}
            onMouseDown={(e) =>
              beginMaterialDrag(e, { kind: 'audio', url, sourceNodeId: id })
            }
          />
        )}
      </div>
    );
  }

  return (
    <div
      className="imade-node-ui group relative mt-8 rounded-none border-2 transition-colors flex flex-col"
      data-theme={isDark ? 'dark' : 'light'}
      style={{
        background: 'var(--hz-node-bg)',
        backdropFilter: 'blur(8px)',
        borderColor: selected ? handleColor : 'var(--hz-node-border)',
        boxShadow: selected ? `0 0 0 1px ${handleColor}33, var(--hz-node-shadow)` : 'var(--hz-node-shadow)',
        width: size.w,
        height: size.h, // undefined → auto, 上传后被图/视频自然撑高; 拖角后具体 px
        minWidth: 220,
        // 不设 overflow 避免裁掉 ResizableCorners 的 4 角 handle (中心点在节点边缘上)
      }}
    >
      {/* 四角同比例缩放 (仅选中时出现) — 主题色跟随上传类型的端口色 */}
      {selected && url && uploadType && meta && (
        <div className="pointer-events-none absolute -top-8 left-0 right-0 z-30 flex items-center justify-between gap-2">
          <div className={`min-w-0 flex-1 truncate rounded-full border px-2.5 py-1 text-[13px] leading-[18px] shadow-lg backdrop-blur ${
            isDark ? 'border-white/10 bg-zinc-950/88 text-white/70' : 'border-black/10 bg-white/92 text-zinc-600'
          }`}>
            {fileSize > 0 ? `${mediaInfo} · ${(fileSize / 1024).toFixed(1)} KB` : mediaInfo}
          </div>
          <div className="pointer-events-auto flex shrink-0 items-center gap-1">
            {uploadType === 'image' && (
              <button type="button" className={`flex h-7 w-7 items-center justify-center rounded-full border shadow-lg backdrop-blur transition ${isDark ? 'border-white/10 bg-zinc-950/88 text-white/80 hover:bg-zinc-900' : 'border-black/10 bg-white/92 text-zinc-700 hover:bg-white'}`} title="编辑" onMouseDown={(e) => e.stopPropagation()} onClick={openEdit}>
                <Edit3 size={13} />
              </button>
            )}
            <button type="button" className={`flex h-7 w-7 items-center justify-center rounded-full border shadow-lg backdrop-blur transition ${isDark ? 'border-white/10 bg-zinc-950/88 text-white/80 hover:bg-zinc-900' : 'border-black/10 bg-white/92 text-zinc-700 hover:bg-white'}`} title="下载" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); void downloadAsset(url, uploadType === 'video' ? 'video.mp4' : uploadType === 'audio' ? 'audio.mp3' : 'image.png'); }}>
              <Download size={13} />
            </button>
            <button type="button" className={`flex h-7 w-7 items-center justify-center rounded-full border shadow-lg backdrop-blur transition ${isDark ? 'border-white/10 bg-zinc-950/88 text-white/80 hover:bg-zinc-900' : 'border-black/10 bg-white/92 text-zinc-700 hover:bg-white'}`} title="替换" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); triggerPick(); }}>
              <UploadIcon size={13} />
            </button>
            <button type="button" className={`flex h-7 w-7 items-center justify-center rounded-full border shadow-lg backdrop-blur transition ${isDark ? 'border-red-400/25 bg-zinc-950/88 text-red-200 hover:bg-red-500/15' : 'border-red-500/20 bg-white/92 text-red-600 hover:bg-red-50'}`} title="清空" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); handleReset(); }}>
              <X size={13} />
            </button>
          </div>
        </div>
      )}
      <ResizableCorners
        selected={selected && !!url}
        minWidth={220}
        minHeight={180}
        accent={handleColor}
        onResize={(_e, p) => {
          setSize({ w: p.width, h: p.height });
          update({ width: Math.round(p.width), height: Math.round(p.height) });
          refreshNodeInternals();
        }}
      />
      {/* 选中时浮动「Edit」按钮 — 仅图像类型可用，与双击预览图等价 */}
      {selected && canEditImage && (
        <button
          type="button"
          className="nodrag nopan"
          onClick={openEdit}
          onMouseDown={(e) => e.stopPropagation()}
          title="编辑图像（裁剪 / 宫格切分），等同双击预览图"
          style={{
            position: 'absolute',
            top: -34,
            left: 0,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            height: 26,
            background: isDark ? 'rgba(28,28,32,0.92)' : 'rgba(255,255,255,0.95)',
            color: handleColor,
            border: `1px solid ${handleColor}66`,
            borderRadius: isPixel ? 0 : 6,
            boxShadow: isPixel
              ? `2px 2px 0 ${handleColor}`
              : isDark
                ? '0 6px 24px rgba(0,0,0,0.4)'
                : '0 6px 24px rgba(0,0,0,0.12)',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            zIndex: 30,
          }}
        >
          <Edit3 size={12} />
          <span>Edit</span>
        </button>
      )}
      {/* 仅有 source handle(上传节点不接收输入) */}
      <Handle
        type="source"
        position={Position.Right}
        className="!border-0"
        style={{
          background: handleColor,
          width: 10,
          height: 10,
          top: '50%',
          opacity: selected ? 1 : 0,
          pointerEvents: selected ? 'all' : 'none',
        }}
        title={meta ? `输出 ${meta.label}` : '请先选择类型'}
      />

      {/* 头部 */}
      <div
        className={`flex items-center gap-2 px-3 py-2 border-b ${
          isDark ? 'border-white/10' : 'border-black/10'
        }`}
      >
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{
            background: handleColor + '33',
            color: handleColor,
            boxShadow: `inset 0 0 0 1px ${handleColor}66`,
          }}
        >
          {meta ? <meta.icon size={13} /> : <UploadIcon size={13} />}
        </div>
        <div className={`flex-1 text-sm font-semibold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
          {headerLabel}
        </div>
        {meta && (
          <button
            onClick={handleReset}
            title="重置类型"
            className={`p-1 rounded ${
              isDark ? 'hover:bg-white/10 text-white/60' : 'hover:bg-black/10 text-zinc-600'
            }`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <RotateCcw size={11} />
          </button>
        )}
      </div>

      {/* body 高度逻辑: root 默认 height=auto 时 body 也 auto 跟随内容 (图/视频) 自然高;
          root 拖角后有具体 px 时, body flex-1 撑满剩余 + min-h-0 允许内容 overflow */}
      <div className={`p-2.5 space-y-2 ${size.h ? 'flex-1 min-h-0 overflow-auto' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        {/* 隐藏的文件输入: accept 三合一, 上传后自动按 MIME 识别 kind */}
        <input
          ref={fileInputRef}
          type="file"
          accept={meta ? meta.accept : 'image/*,video/*,audio/*'}
          className="hidden"
          onChange={handleFileChange}
        />

        {/* 未上传状态: 一个大点击/拖拽区域, 自动识别类型 */}
        {!url && (
          <div
            onClick={triggerPick}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={`cursor-pointer rounded border-2 border-dashed flex flex-col items-center justify-center text-[11px] transition-colors py-6 px-3 ${
              dragActive
                ? 'bg-white/10'
                : isDark
                  ? 'border-white/15 hover:border-white/30 text-white/60'
                  : 'border-black/15 hover:border-black/30 text-zinc-500'
            }`}
            style={dragActive ? { borderColor: handleColor } : undefined}
          >
            <UploadIcon size={22} className="mb-1.5" style={{ color: handleColor }} />
            <span className="font-medium">
              {uploading ? '上传中...' : dragActive ? '松开以上传' : '点击或拖拽文件'}
            </span>
            <span
              className={`text-[10px] mt-0.5 ${
                isDark ? 'text-white/30' : 'text-zinc-400'
              }`}
            >
              自动识别 图像 / 视频 / 音频
            </span>
          </div>
        )}

        {/* 已上传:展示预览 + 文件信息 */}
        {url && uploadType && meta && (
          <div className="space-y-1.5">
            {uploadType === 'image' && (
              <img
                src={url}
                alt={fileName}
                className="w-full h-auto block cursor-zoom-in"
                style={{ background: '#0008', objectFit: 'contain', maxHeight: 480 }}
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                data-drag-source
                data-drag-kind="image"
                data-drag-url={url}
                data-drag-preview={url}
                data-drag-node-id={id}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                    setImageNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
                    syncSizeFromMedia(img.naturalWidth, img.naturalHeight, 'image');
                  }
                  refreshNodeInternals();
                }}
                onClick={(e) =>
                  handleCanvasReferenceSourceClick(e, { kind: 'image', url, sourceNodeId: id, previewUrl: url })
                }
                onMouseDown={(e) =>
                  beginMaterialDrag(e, { kind: 'image', url, sourceNodeId: id, previewUrl: url })
                }
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  openEdit();
                }}
                title="双击编辑（裁剪 / 宫格切分） · Ctrl+拖拽可送到其他节点"
              />
            )}
            {uploadType === 'video' && (
              <video
                src={url}
                controls
                className="w-full h-auto block"
                style={{ background: '#000', objectFit: 'contain', maxHeight: 480 }}
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                data-drag-source
                data-drag-kind="video"
                data-drag-url={url}
                data-drag-preview={url}
                data-drag-node-id={id}
                onLoadedMetadata={(e) => {
                  const video = e.currentTarget;
                  syncSizeFromMedia(video.videoWidth, video.videoHeight, 'video');
                  refreshNodeInternals();
                }}
                onMouseDown={(e) =>
                  beginMaterialDrag(e, { kind: 'video', url, sourceNodeId: id, previewUrl: url })
                }
              />
            )}
            {uploadType === 'audio' && (
              <audio
                src={url}
                controls
                className="w-full"
                data-drag-source
                data-drag-kind="audio"
                data-drag-url={url}
                data-drag-node-id={id}
                onMouseDown={(e) =>
                  beginMaterialDrag(e, { kind: 'audio', url, sourceNodeId: id })
                }
              />
            )}
            <div
              className={`flex items-center gap-1 text-[10px] ${
                isDark ? 'text-white/50' : 'text-zinc-500'
              }`}
            >
              <span className="truncate flex-1" title={fileName}>
                {fileName || '未命名'}
              </span>
              {fileSize > 0 && (
                <span className="opacity-70">
                  {(fileSize / 1024).toFixed(1)} KB
                </span>
              )}
              <button
                onClick={triggerPick}
                title="替换文件"
                className={`p-0.5 rounded ${
                  isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'
                }`}
              >
                <UploadIcon size={11} />
              </button>
              <button
                onClick={handleReset}
                title="清空文件"
                className={`p-0.5 rounded ${
                  isDark ? 'hover:bg-red-500/20 text-red-400' : 'hover:bg-red-100 text-red-600'
                }`}
              >
                <X size={11} />
              </button>
            </div>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="flex items-start gap-1 text-[10px] text-red-300 bg-red-500/10 border border-red-500/20 rounded px-2 py-1">
            <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}

        {/* 输出说明 */}
        {meta && (
          <div
            className={`text-[10px] text-right ${
              isDark ? 'text-white/30' : 'text-zinc-400'
            }`}
          >
            → 输出 {meta.label} (端口色 <span style={{ color: handleColor }}>●</span>)
          </div>
        )}
      </div>
      {/* 图像编辑弹窗：产物以独立 OutputNode 外挂到右侧 */}
      {editingUrl && (
        <ImageEditModal
          srcUrl={editingUrl}
          onClose={() => setEditingUrl(null)}
          onProduce={handleProduce}
        />
      )}
    </div>
  );
};

export default memo(UploadNode);
