import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Crop as CropIcon,
  Grid3x3,
  RotateCcw,
  X,
  Plus,
  Minus,
  Eraser,
  Undo2,
  Check,
  Loader2,
} from 'lucide-react';
import { useThemeStore } from '../../stores/theme';
import { opCrop, opGridCrop } from '../../services/imageOps';

/**
 * ImageEditModal
 *  OutputNode 中图片双击后弹出, 支持:
 *    - 裁剪 (crop): 拖动 crop-box + 4 角缩放
 *    - 宫格切分 (grid):
 *        预设: rows/cols 等分 + gap (像素间隔)
 *        自定义: 拖入横线/纵线, 拖动调整, 撤销/清空
 *
 *  产物不修改原素材, 全部以独立 OutputNode 形式落到右侧 (由 onProduce 回调处理)。
 *  双主题适配: 科技风 (深底+青色 accent) / 像素风 (白底+黑边+8-bit)
 */

export type ImageEditProduceMeta =
  | { type: 'crop'; rect: { x: number; y: number; w: number; h: number } }
  | {
      type: 'grid-split';
      layout: { rows: number; cols: number; gap: number };
      rects: Array<{ x: number; y: number; w: number; h: number; row: number; col: number }>;
    };

interface Props {
  srcUrl: string;
  onClose: () => void;
  /** 产物 urls 注入到外部 (在 OutputNode 中创建 N 个新 OutputNode) */
  onProduce: (urls: string[], meta: ImageEditProduceMeta) => void;
}

type EditMode = 'crop' | 'grid';
type GridSubMode = 'preset' | 'custom';
interface Line {
  type: 'h' | 'v';
  pos: number; // 0..1 fraction of natural size
}
interface CropBox {
  x: number; // 0..1
  y: number;
  w: number;
  h: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// 计算切割矩形 (natural 像素), 兼容 等分 / 自定义 两个模式
function computeRects(
  W: number,
  H: number,
  rows: number,
  cols: number,
  gap: number,
  customLines: Line[] | null,
): Array<{ x: number; y: number; w: number; h: number; row: number; col: number }> {
  const halfGap = gap / 2;
  if (customLines && customLines.length > 0) {
    const rawH = [...new Set(customLines.filter((l) => l.type === 'h').map((l) => l.pos * H))].sort(
      (a, b) => a - b,
    );
    const rawV = [...new Set(customLines.filter((l) => l.type === 'v').map((l) => l.pos * W))].sort(
      (a, b) => a - b,
    );
    const hCuts = [0, ...rawH, H];
    const vCuts = [0, ...rawV, W];
    const rects: Array<{ x: number; y: number; w: number; h: number; row: number; col: number }> = [];
    for (let row = 0; row < hCuts.length - 1; row++) {
      for (let col = 0; col < vCuts.length - 1; col++) {
        const y1 = Math.round(row === 0 ? hCuts[row] : hCuts[row] + halfGap);
        const y2 = Math.round(
          row === hCuts.length - 2 ? hCuts[row + 1] : hCuts[row + 1] - halfGap,
        );
        const x1 = Math.round(col === 0 ? vCuts[col] : vCuts[col] + halfGap);
        const x2 = Math.round(
          col === vCuts.length - 2 ? vCuts[col + 1] : vCuts[col + 1] - halfGap,
        );
        if (x2 > x1 && y2 > y1) {
          rects.push({ row, col, x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
        }
      }
    }
    return rects;
  }
  // 等分
  const rects: Array<{ x: number; y: number; w: number; h: number; row: number; col: number }> = [];
  for (let row = 0; row < rows; row++) {
    const topLine = (row * H) / rows;
    const bottomLine = ((row + 1) * H) / rows;
    const y1 = Math.round(row === 0 ? 0 : topLine + halfGap);
    const y2 = Math.round(row === rows - 1 ? H : bottomLine - halfGap);
    for (let col = 0; col < cols; col++) {
      const leftLine = (col * W) / cols;
      const rightLine = ((col + 1) * W) / cols;
      const x1 = Math.round(col === 0 ? 0 : leftLine + halfGap);
      const x2 = Math.round(col === cols - 1 ? W : rightLine - halfGap);
      if (x2 > x1 && y2 > y1) rects.push({ row, col, x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    }
  }
  return rects;
}

const ImageEditModal = ({ srcUrl, onClose, onProduce }: Props) => {
  const { theme, style } = useThemeStore();
  const isDark = theme === 'dark';
  const isPixel = style === 'pixel';

  const [mode, setMode] = useState<EditMode>('crop');
  const [gridMode, setGridMode] = useState<GridSubMode>('preset');
  const [crop, setCrop] = useState<CropBox>({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(2);
  const [gap, setGap] = useState(0);
  const [orient, setOrient] = useState<'h' | 'v'>('h');
  const [customLines, setCustomLines] = useState<Line[]>([]);
  const [history, setHistory] = useState<Line[][]>([]);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 主题样式 token
  const accent = isPixel ? '#C73B6B' : '#22d3ee';
  const modalBg = isPixel ? '#FFFBF0' : isDark ? 'rgb(20,20,22)' : '#fff';
  const modalBorder = isPixel
    ? '2px solid #1A1410'
    : isDark
    ? '1px solid rgba(255,255,255,.15)'
    : '1px solid rgba(0,0,0,.12)';
  const modalRadius = isPixel ? 0 : 14;
  const modalShadow = isPixel ? '6px 6px 0 #1A1410' : '0 20px 50px rgba(0,0,0,.35)';
  const textColor = isPixel ? '#1A1410' : isDark ? '#fff' : '#111';
  const subText = isPixel ? '#5A4A3F' : isDark ? 'rgba(255,255,255,.5)' : 'rgba(0,0,0,.5)';
  const inputBg = isPixel ? '#fff' : isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.04)';
  const handleRadius = isPixel ? 0 : 999;

  // ---- crop-box 拖拽 ----
  const dragRef = useRef<{
    mode: 'move' | 'tl' | 'tr' | 'bl' | 'br';
    startX: number;
    startY: number;
    startCrop: CropBox;
    rect: DOMRect;
  } | null>(null);

  const startCropDrag = (e: React.PointerEvent, m: 'move' | 'tl' | 'tr' | 'bl' | 'br') => {
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    dragRef.current = {
      mode: m,
      startX: e.clientX,
      startY: e.clientY,
      startCrop: { ...crop },
      rect,
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  };
  const moveCropDrag = (e: React.PointerEvent) => {
    const ctx = dragRef.current;
    if (!ctx) return;
    const dx = (e.clientX - ctx.startX) / ctx.rect.width;
    const dy = (e.clientY - ctx.startY) / ctx.rect.height;
    setCrop((c) => {
      let { x, y, w, h } = ctx.startCrop;
      if (ctx.mode === 'move') {
        x = clamp(x + dx, 0, 1 - w);
        y = clamp(y + dy, 0, 1 - h);
      } else if (ctx.mode === 'br') {
        w = clamp(ctx.startCrop.w + dx, 0.02, 1 - x);
        h = clamp(ctx.startCrop.h + dy, 0.02, 1 - y);
      } else if (ctx.mode === 'tr') {
        w = clamp(ctx.startCrop.w + dx, 0.02, 1 - x);
        const ny = clamp(ctx.startCrop.y + dy, 0, ctx.startCrop.y + ctx.startCrop.h - 0.02);
        h = ctx.startCrop.h - (ny - ctx.startCrop.y);
        y = ny;
      } else if (ctx.mode === 'bl') {
        const nx = clamp(ctx.startCrop.x + dx, 0, ctx.startCrop.x + ctx.startCrop.w - 0.02);
        w = ctx.startCrop.w - (nx - ctx.startCrop.x);
        x = nx;
        h = clamp(ctx.startCrop.h + dy, 0.02, 1 - y);
      } else if (ctx.mode === 'tl') {
        const nx = clamp(ctx.startCrop.x + dx, 0, ctx.startCrop.x + ctx.startCrop.w - 0.02);
        const ny = clamp(ctx.startCrop.y + dy, 0, ctx.startCrop.y + ctx.startCrop.h - 0.02);
        w = ctx.startCrop.w - (nx - ctx.startCrop.x);
        h = ctx.startCrop.h - (ny - ctx.startCrop.y);
        x = nx;
        y = ny;
      }
      return { x, y, w, h };
    });
  };
  const endCropDrag = () => {
    dragRef.current = null;
  };

  // ---- 自定义切线 ----
  const lineDragRef = useRef<{ index: number; pointerId: number } | null>(null);

  const lineHit = (fx: number, fy: number, W: number, H: number): number => {
    if (!customLines.length) return -1;
    // 阈值: max(8, min(W,H)/80) (像素), 转 fraction
    const thresholdPxV = Math.max(8, Math.min(W, H) / 80);
    let best = -1;
    let bestDist = Infinity;
    customLines.forEach((line, idx) => {
      const dist =
        line.type === 'h'
          ? Math.abs(fy - line.pos) * H
          : Math.abs(fx - line.pos) * W;
      if (dist < thresholdPxV && dist < bestDist) {
        best = idx;
        bestDist = dist;
      }
    });
    return best;
  };

  const onStagePointerDown = (e: React.PointerEvent) => {
    if (mode !== 'grid' || gridMode !== 'custom' || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const fx = clamp((e.clientX - rect.left) / rect.width, 0.001, 0.999);
    const fy = clamp((e.clientY - rect.top) / rect.height, 0.001, 0.999);
    if (!naturalSize) return;
    // 命中已有线 → 进入 drag
    const hit = lineHit(fx, fy, naturalSize.w, naturalSize.h);
    setHistory((h) => [...h, customLines.map((l) => ({ ...l }))]);
    if (hit >= 0) {
      lineDragRef.current = { index: hit, pointerId: e.pointerId };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } else {
      const newLine: Line = { type: orient, pos: orient === 'h' ? fy : fx };
      setCustomLines((arr) => {
        const next = [...arr, newLine];
        lineDragRef.current = { index: next.length - 1, pointerId: e.pointerId };
        return next;
      });
      (e.target as Element).setPointerCapture?.(e.pointerId);
    }
    e.preventDefault();
  };
  const onStagePointerMove = (e: React.PointerEvent) => {
    if (!imgRef.current) return;
    const ctx = lineDragRef.current;
    if (!ctx) return;
    const rect = imgRef.current.getBoundingClientRect();
    const fx = clamp((e.clientX - rect.left) / rect.width, 0.001, 0.999);
    const fy = clamp((e.clientY - rect.top) / rect.height, 0.001, 0.999);
    setCustomLines((arr) =>
      arr.map((l, i) =>
        i === ctx.index ? { ...l, pos: l.type === 'h' ? fy : fx } : l,
      ),
    );
  };
  const onStagePointerUp = (e: React.PointerEvent) => {
    if (lineDragRef.current) {
      try {
        (e.target as Element).releasePointerCapture?.(lineDragRef.current.pointerId);
      } catch {}
      lineDragRef.current = null;
    }
  };

  const undoLine = () => {
    setHistory((h) => {
      if (!h.length) return h;
      const last = h[h.length - 1];
      setCustomLines(last);
      return h.slice(0, -1);
    });
  };
  const clearLines = () => {
    setHistory((h) => [...h, customLines.map((l) => ({ ...l }))]);
    setCustomLines([]);
  };

  const enterCustom = () => {
    setGridMode('custom');
    setHistory([]);
    setCustomLines([]);
  };
  const exitCustom = () => {
    setGridMode('preset');
    setCustomLines([]);
    setHistory([]);
  };

  // ---- 应用 ----
  async function applyCrop() {
    if (!naturalSize) return;
    setBusy(true);
    setErrMsg(null);
    try {
      const px = {
        x: Math.round(crop.x * naturalSize.w),
        y: Math.round(crop.y * naturalSize.h),
        w: Math.max(1, Math.round(crop.w * naturalSize.w)),
        h: Math.max(1, Math.round(crop.h * naturalSize.h)),
      };
      const { imageUrl } = await opCrop(srcUrl, px.x, px.y, px.w, px.h);
      onProduce([imageUrl], { type: 'crop', rect: px });
      onClose();
    } catch (e: any) {
      setErrMsg(e?.message || '裁剪失败');
    } finally {
      setBusy(false);
    }
  }
  async function applyGrid() {
    if (!naturalSize) return;
    setBusy(true);
    setErrMsg(null);
    try {
      const useCustom = gridMode === 'custom' && customLines.length > 0;
      const rects = computeRects(
        naturalSize.w,
        naturalSize.h,
        rows,
        cols,
        gap,
        useCustom ? customLines : null,
      );
      if (rects.length === 0) {
        setErrMsg('无有效切割矩形');
        setBusy(false);
        return;
      }
      const { urls, layout } = await opGridCrop(
        srcUrl,
        useCustom ? Math.max(1, ...rects.map((r) => r.row + 1)) : rows,
        useCustom ? Math.max(1, ...rects.map((r) => r.col + 1)) : cols,
        gap,
        rects,
      );
      onProduce(urls, { type: 'grid-split', layout, rects });
      onClose();
    } catch (e: any) {
      setErrMsg(e?.message || '宫格切分失败');
    } finally {
      setBusy(false);
    }
  }

  // ---- 等分预览叠层 (svg) ----
  const previewLines = useMemo(() => {
    if (mode !== 'grid') return null;
    const useCustom = gridMode === 'custom';
    const items: Array<{ type: 'h' | 'v'; pos: number; cut?: boolean }> = [];
    if (useCustom) {
      customLines.forEach((l) => items.push({ type: l.type, pos: l.pos }));
    } else {
      for (let i = 1; i < rows; i++) items.push({ type: 'h', pos: i / rows });
      for (let i = 1; i < cols; i++) items.push({ type: 'v', pos: i / cols });
    }
    return items;
  }, [mode, gridMode, customLines, rows, cols]);

  const cropPxLabel = naturalSize
    ? `${Math.round(crop.w * naturalSize.w)}×${Math.round(crop.h * naturalSize.h)}`
    : '—';

  const btnBase: React.CSSProperties = {
    height: 32,
    padding: '0 10px',
    borderRadius: isPixel ? 0 : 8,
    border: isPixel ? '2px solid #1A1410' : `1px solid ${isDark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.18)'}`,
    background: inputBg,
    color: textColor,
    fontSize: 12,
    fontWeight: 600,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer',
    boxShadow: isPixel ? '2px 2px 0 #1A1410' : 'none',
  };
  const btnPrimary: React.CSSProperties = {
    ...btnBase,
    background: accent,
    color: isPixel ? '#1A1410' : '#001b1f',
    border: isPixel ? '2px solid #1A1410' : 'none',
  };
  const tabBtn = (active: boolean): React.CSSProperties => ({
    ...btnBase,
    background: active ? accent + (isPixel ? '' : '33') : inputBg,
    color: active ? (isPixel ? '#1A1410' : accent) : textColor,
    border: isPixel
      ? `2px solid ${active ? '#1A1410' : '#1A1410'}`
      : `1px solid ${active ? accent : isDark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.18)'}`,
    fontWeight: active ? 700 : 500,
  });

  const inputStyle: React.CSSProperties = {
    width: 56,
    height: 28,
    padding: '0 6px',
    background: inputBg,
    color: textColor,
    border: isPixel ? '2px solid #1A1410' : `1px solid ${isDark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.18)'}`,
    borderRadius: isPixel ? 0 : 6,
    fontSize: 12,
    textAlign: 'center',
  };

  const ui = (
    <div
      className="img-edit-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="img-edit-modal"
        style={{
          background: modalBg,
          border: modalBorder,
          borderRadius: modalRadius,
          boxShadow: modalShadow,
          color: textColor,
        }}
      >
        {/* Header (横向): 标题 + tabs + 关闭 */}
        <div
          className="img-edit-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '14px 20px',
            borderBottom: isPixel
              ? '2px solid #1A1410'
              : `1px solid ${isDark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.1)'}`,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '0 0 auto' }}>
            <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>编辑图片</div>
            <div style={{ fontSize: 11, color: subText, lineHeight: 1.2 }}>
              {mode === 'crop'
                ? '拖动框体选择区域，4 角可缩放'
                : gridMode === 'preset'
                ? '调整横/纵线数量与 gap 进行等分切分'
                : '点击画布添加切线，拖动进行调整'}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={tabBtn(mode === 'crop')} onClick={() => setMode('crop')}>
              <CropIcon size={14} /> 裁剪
            </button>
            <button style={tabBtn(mode === 'grid')} onClick={() => setMode('grid')}>
              <Grid3x3 size={14} /> 宫格切分
            </button>
          </div>
          <button style={btnBase} onClick={onClose} title="关闭 (ESC)">
            <X size={14} />
          </button>
        </div>

        {/* Toolbar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 10,
            padding: '10px 20px',
            background: isPixel ? '#FFF7DD' : isDark ? 'rgba(255,255,255,.03)' : 'rgba(0,0,0,.03)',
            borderBottom: isPixel
              ? '2px solid #1A1410'
              : `1px solid ${isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)'}`,
            fontSize: 12,
          }}
        >
          {mode === 'crop' && (
            <>
              <span style={{ color: subText }}>框尺寸</span>
              <strong>{cropPxLabel}</strong>
              <button
                style={btnBase}
                onClick={() => setCrop({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 })}
              >
                <RotateCcw size={13} /> 重置
              </button>
              <div style={{ flex: 1 }} />
              {naturalSize && (
                <span style={{ color: subText }}>
                  原图 {naturalSize.w}×{naturalSize.h}
                </span>
              )}
            </>
          )}
          {mode === 'grid' && gridMode === 'preset' && (
            <>
              <span style={{ color: subText }}>行</span>
              <input
                type="number"
                min={1}
                max={20}
                value={rows}
                onChange={(e) => setRows(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                style={inputStyle}
              />
              <span style={{ color: subText }}>列</span>
              <input
                type="number"
                min={1}
                max={20}
                value={cols}
                onChange={(e) => setCols(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                style={inputStyle}
              />
              <span style={{ color: subText }}>gap</span>
              <input
                type="number"
                min={0}
                max={240}
                value={gap}
                onChange={(e) => setGap(clamp(Number(e.target.value) || 0, 0, 240))}
                style={inputStyle}
              />
              <span style={{ color: subText }}>px</span>
              <div
                style={{
                  width: 1,
                  height: 18,
                  background: isPixel ? '#1A1410' : 'rgba(127,127,127,.3)',
                  margin: '0 4px',
                }}
              />
              <button style={btnBase} onClick={() => { setRows(2); setCols(2); }}>2×2</button>
              <button style={btnBase} onClick={() => { setRows(3); setCols(3); }}>3×3</button>
              <button style={btnBase} onClick={() => { setRows(2); setCols(3); }}>2×3</button>
              <button style={btnBase} onClick={() => { setRows(4); setCols(4); }}>4×4</button>
              <div style={{ flex: 1 }} />
              <button style={btnBase} onClick={enterCustom}>
                <Plus size={13} /> 自定义切线
              </button>
            </>
          )}
          {mode === 'grid' && gridMode === 'custom' && (
            <>
              <span style={{ color: subText }}>方向</span>
              <button style={tabBtn(orient === 'h')} onClick={() => setOrient('h')} title="放置横线">
                ─ 横
              </button>
              <button style={tabBtn(orient === 'v')} onClick={() => setOrient('v')} title="放置纵线">
                │ 纵
              </button>
              <span style={{ color: subText, marginLeft: 8 }}>gap</span>
              <input
                type="number"
                min={0}
                max={240}
                value={gap}
                onChange={(e) => setGap(clamp(Number(e.target.value) || 0, 0, 240))}
                style={inputStyle}
              />
              <span style={{ color: subText }}>px</span>
              <span style={{ color: subText, marginLeft: 8 }}>共 {customLines.length} 条</span>
              <div style={{ flex: 1 }} />
              <button style={btnBase} onClick={undoLine} disabled={!history.length}>
                <Undo2 size={13} /> 撤销
              </button>
              <button style={btnBase} onClick={clearLines}>
                <Eraser size={13} /> 清空
              </button>
              <button style={btnBase} onClick={exitCustom}>
                <Minus size={13} /> 退出自定义
              </button>
            </>
          )}
        </div>

        {/* Stage */}
        <div
          ref={stageRef}
          className="img-edit-stage"
          style={{
            flex: 1,
            overflow: 'auto',
            padding: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isPixel ? '#FFF1B8' : isDark ? '#020617' : '#f8fafc',
            minHeight: 360,
            cursor:
              mode === 'grid' && gridMode === 'custom'
                ? orient === 'h'
                  ? 'row-resize'
                  : 'col-resize'
                : 'default',
          }}
          onPointerMove={(e) => {
            moveCropDrag(e);
            onStagePointerMove(e);
          }}
          onPointerUp={(e) => {
            endCropDrag();
            onStagePointerUp(e);
          }}
        >
          <div
            style={{
              position: 'relative',
              display: 'inline-block',
              lineHeight: 0,
              userSelect: 'none',
            }}
            onPointerDown={onStagePointerDown}
          >
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <img
              ref={imgRef}
              src={srcUrl}
              draggable={false}
              onLoad={(e) => {
                const t = e.currentTarget;
                setNaturalSize({ w: t.naturalWidth, h: t.naturalHeight });
              }}
              style={{
                display: 'block',
                maxWidth: 'calc(94vw - 80px)',
                maxHeight: 'calc(94vh - 220px)',
                background: isPixel ? '#fff' : '#000',
                borderRadius: isPixel ? 0 : 8,
                imageRendering: isPixel ? 'pixelated' : 'auto',
              }}
            />
            {/* crop-box (仅 crop 模式) */}
            {mode === 'crop' && naturalSize && (
              <div
                className="crop-box"
                onPointerDown={(e) => startCropDrag(e, 'move')}
                style={{
                  position: 'absolute',
                  left: `${crop.x * 100}%`,
                  top: `${crop.y * 100}%`,
                  width: `${crop.w * 100}%`,
                  height: `${crop.h * 100}%`,
                  border: `2px solid ${isPixel ? '#1A1410' : '#fff'}`,
                  boxShadow: `0 0 0 9999px rgba(${isPixel ? '26,20,16' : '15,23,42'},.55)`,
                  borderRadius: isPixel ? 0 : 6,
                  cursor: 'move',
                }}
              >
                {(['tl', 'tr', 'bl', 'br'] as const).map((k) => {
                  const pos: React.CSSProperties = {
                    position: 'absolute',
                    width: 14,
                    height: 14,
                    background: isPixel ? '#FFE066' : '#fff',
                    border: '2px solid #111',
                    borderRadius: handleRadius,
                    cursor: k === 'tl' || k === 'br' ? 'nwse-resize' : 'nesw-resize',
                  };
                  if (k === 'tl') {
                    pos.left = -8;
                    pos.top = -8;
                  } else if (k === 'tr') {
                    pos.right = -8;
                    pos.top = -8;
                  } else if (k === 'bl') {
                    pos.left = -8;
                    pos.bottom = -8;
                  } else {
                    pos.right = -8;
                    pos.bottom = -8;
                  }
                  return (
                    <div
                      key={k}
                      className="crop-handle"
                      onPointerDown={(e) => startCropDrag(e, k)}
                      style={pos}
                    />
                  );
                })}
              </div>
            )}

            {/* grid overlay svg */}
            {mode === 'grid' && previewLines && (
              <svg
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none',
                }}
              >
                {previewLines.map((l, i) => {
                  const stroke = accent;
                  if (l.type === 'h') {
                    const yPct = `${l.pos * 100}%`;
                    return (
                      <g key={i}>
                        <line
                          x1="0"
                          x2="100%"
                          y1={yPct}
                          y2={yPct}
                          stroke={stroke}
                          strokeWidth={isPixel ? 2 : 1.6}
                          shapeRendering={isPixel ? 'crispEdges' : 'auto'}
                        />
                        {gap > 0 && (
                          <>
                            <line
                              x1="0"
                              x2="100%"
                              y1={`calc(${yPct} - ${gap / 2}px)`}
                              y2={`calc(${yPct} - ${gap / 2}px)`}
                              stroke={stroke}
                              strokeDasharray="6 4"
                              strokeWidth="1"
                            />
                            <line
                              x1="0"
                              x2="100%"
                              y1={`calc(${yPct} + ${gap / 2}px)`}
                              y2={`calc(${yPct} + ${gap / 2}px)`}
                              stroke={stroke}
                              strokeDasharray="6 4"
                              strokeWidth="1"
                            />
                          </>
                        )}
                      </g>
                    );
                  }
                  const xPct = `${l.pos * 100}%`;
                  return (
                    <g key={i}>
                      <line
                        x1={xPct}
                        x2={xPct}
                        y1="0"
                        y2="100%"
                        stroke={stroke}
                        strokeWidth={isPixel ? 2 : 1.6}
                        shapeRendering={isPixel ? 'crispEdges' : 'auto'}
                      />
                      {gap > 0 && (
                        <>
                          <line
                            x1={`calc(${xPct} - ${gap / 2}px)`}
                            x2={`calc(${xPct} - ${gap / 2}px)`}
                            y1="0"
                            y2="100%"
                            stroke={stroke}
                            strokeDasharray="6 4"
                            strokeWidth="1"
                          />
                          <line
                            x1={`calc(${xPct} + ${gap / 2}px)`}
                            x2={`calc(${xPct} + ${gap / 2}px)`}
                            y1="0"
                            y2="100%"
                            stroke={stroke}
                            strokeDasharray="6 4"
                            strokeWidth="1"
                          />
                        </>
                      )}
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '14px 20px',
            borderTop: isPixel
              ? '2px solid #1A1410'
              : `1px solid ${isDark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.1)'}`,
          }}
        >
          {errMsg && (
            <div style={{ color: '#EF4444', fontSize: 12, fontWeight: 600 }}>{errMsg}</div>
          )}
          <div style={{ flex: 1 }} />
          <button style={btnBase} onClick={onClose} disabled={busy}>
            取消
          </button>
          {mode === 'crop' ? (
            <button style={btnPrimary} onClick={applyCrop} disabled={busy || !naturalSize}>
              {busy ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> 处理中…
                </>
              ) : (
                <>
                  <Check size={14} /> 应用裁剪
                </>
              )}
            </button>
          ) : (
            <button style={btnPrimary} onClick={applyGrid} disabled={busy || !naturalSize}>
              {busy ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> 处理中…
                </>
              ) : (
                <>
                  <Check size={14} /> 应用宫格切分
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  // 使用 Portal 逃逸 ReactFlow 节点的 transform 父级,
  // 否则 position:fixed 会被变换为相对 transform 父定位, 对备布局逼仄。
  return typeof document !== 'undefined' ? createPortal(ui, document.body) : ui;
};

export default ImageEditModal;
