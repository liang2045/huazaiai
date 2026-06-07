/**
 * NodeActionBar —— 选中可执行节点时的浮动操作栏
 *
 * 设计目标:
 *   选中任意「带生成/执行功能」的节点 (EXECUTABLE_NODE_TYPES) 时,
 *   在节点右上角外侧出现一条快捷操作栏: 执行 / 中止 / 取消选中
 *
 * 设计要点:
 *   - 0 节点侵入: 在 ReactFlow 内部统一渲染, 不需要改每个节点组件
 *   - 跟随 viewport 缩放/平移: 用 useViewport 拿到 (vx, vy, zoom) 计算屏幕坐标
 *   - 双主题适配: 科技风 (深色玻璃 + 圆角) / 像素风 (硬边 + 硬阴影)
 *   - 状态联动: 当前节点正在运行时, ▶ RUN 自动切换为 ■ STOP
 *   - 智能定位: 锚定节点右上角往上偏移, 让按钮组与节点保持 8px 间距
 */
import { useMemo } from 'react';
import { useNodes, useViewport, useReactFlow, type Node } from '@xyflow/react';
import { Play, Square, X } from 'lucide-react';
import { useThemeStore } from '../stores/theme';
import { useRunBusStore } from '../stores/runBus';

// 与 Canvas.tsx 一致 (需要保持同步; 后续可考虑抽到 config/constants)
const EXECUTABLE_NODE_TYPES = new Set<string>([
  'image', 'edit',
  'multi-angle-3d', 'panorama-720', 'portrait-preset',
  'video', 'seedance', 'audio', 'llm',
  'resize', 'upscale', 'grid-crop', 'remove-bg', 'combine',
  'frame-extractor',
  'upload',
]);

const BAR_GAP_PX = 8; // 与节点顶部的世界坐标系间距

const NodeActionBar = () => {
  const nodes = useNodes();
  const { x: vx, y: vy, zoom } = useViewport();
  const { setNodes } = useReactFlow();
  const { theme, style } = useThemeStore();
  const isDark = theme === 'dark';
  const isPixel = style === 'pixel';

  const currentRunId = useRunBusStore((s) => s.currentRunId);
  const triggerRun = useRunBusStore((s) => s.triggerRun);
  const cancelAll = useRunBusStore((s) => s.cancelAll);

  // 找选中的可执行节点 (只取第一个; 多选时仅最后选中的那个显示)
  const selectedExe = useMemo<Node | null>(() => {
    // 倒序找让"最近一次选中"优先
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n.selected && n.type && EXECUTABLE_NODE_TYPES.has(n.type)) {
        return n;
      }
    }
    return null;
  }, [nodes]);

  if (!selectedExe) return null;

  // 节点宽高 (优先 measured.width, fallback 到 width / 320)
  const nodeW =
    (selectedExe as any).measured?.width ||
    (selectedExe as any).width ||
    320;

  // 节点屏幕坐标
  const nodeScreenX = selectedExe.position.x * zoom + vx;
  const nodeScreenY = selectedExe.position.y * zoom + vy;
  // ActionBar 锚定: 右对齐节点右边, 在节点上方 (BAR_GAP_PX * zoom)
  const rightX = nodeScreenX + nodeW * zoom;
  const topY = nodeScreenY - BAR_GAP_PX * zoom;

  const isRunning = currentRunId === selectedExe.id;

  // === 主题派生样式 ===
  // 科技风: 深色玻璃面板 + 圆角  /  像素风: 硬边 + 硬阴影
  const barBg = isPixel
    ? '#FFFFFF'
    : isDark
      ? 'rgba(28,28,32,0.92)'
      : 'rgba(255,255,255,0.95)';
  const barBorder = isPixel
    ? '2px solid #1A1410'
    : `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`;
  const barRadius = isPixel ? 8 : 10;
  const barShadow = isPixel
    ? '3px 3px 0 #1A1410'
    : isDark
      ? '0 6px 24px rgba(0,0,0,0.4)'
      : '0 6px 24px rgba(0,0,0,0.12)';

  const onRun = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRunning) return;
    triggerRun(selectedExe.id, 'single');
  };
  const onStop = (e: React.MouseEvent) => {
    e.stopPropagation();
    cancelAll();
  };
  const onClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNodes((nds) => nds.map((n) => (n.id === selectedExe.id ? { ...n, selected: false } : n)));
  };

  // 按钮通用样式生成器
  const mkBtn = (kind: 'run' | 'stop' | 'close'): React.CSSProperties => {
    const color =
      kind === 'run'
        ? '#22c55e' // green-500
        : kind === 'stop'
          ? '#f97316' // orange-500
          : '#ef4444'; // red-500
    if (isPixel) {
      return {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: kind === 'run' ? '4px 10px' : '4px 6px',
        height: 28,
        background: kind === 'run' ? color : '#FFFFFF',
        color: kind === 'run' ? '#FFFFFF' : color,
        border: `2px solid ${kind === 'run' ? '#1A1410' : color}`,
        borderRadius: 6,
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 700,
        boxShadow: `2px 2px 0 ${kind === 'run' ? '#1A1410' : color}`,
        userSelect: 'none' as const,
      };
    }
    return {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: kind === 'run' ? '4px 10px' : '4px 6px',
      height: 26,
      background: kind === 'run'
        ? `${color}22`
        : isDark
          ? 'rgba(255,255,255,0.05)'
          : 'rgba(0,0,0,0.04)',
      color,
      border: `1px solid ${color}66`,
      borderRadius: 6,
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: 600,
      transition: 'background 0.12s, border-color 0.12s',
      userSelect: 'none' as const,
    };
  };

  // hover 增强
  const onEnter = (e: React.MouseEvent, kind: 'run' | 'stop' | 'close') => {
    const color =
      kind === 'run' ? '#22c55e' : kind === 'stop' ? '#f97316' : '#ef4444';
    if (isPixel) return;
    (e.currentTarget as HTMLElement).style.background = `${color}33`;
    (e.currentTarget as HTMLElement).style.borderColor = color;
  };
  const onLeave = (e: React.MouseEvent, kind: 'run' | 'stop' | 'close') => {
    const color =
      kind === 'run' ? '#22c55e' : kind === 'stop' ? '#f97316' : '#ef4444';
    if (isPixel) return;
    (e.currentTarget as HTMLElement).style.background =
      kind === 'run'
        ? `${color}22`
        : isDark
          ? 'rgba(255,255,255,0.05)'
          : 'rgba(0,0,0,0.04)';
    (e.currentTarget as HTMLElement).style.borderColor = `${color}66`;
  };

  return (
    <div
      // pointer-events: none 让外层不阻挡画布交互; 子按钮独立 enable
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        pointerEvents: 'none',
        zIndex: 50,
      }}
    >
      <div
        // 真正的浮动条
        className="nodrag nopan"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: rightX,
          top: topY,
          // 整体右对齐 + 向上脱离 (translate 不受 transform-origin 影响)
          transform: 'translate(-100%, -100%)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 6px',
          background: barBg,
          border: barBorder,
          borderRadius: barRadius,
          boxShadow: barShadow,
          backdropFilter: isPixel ? 'none' : 'blur(6px)',
          pointerEvents: 'all',
          whiteSpace: 'nowrap',
        }}
      >
        {/* 执行 / 中止 (互斥) */}
        {isRunning ? (
          <button
            type="button"
            onClick={onStop}
            onMouseEnter={(e) => onEnter(e, 'stop')}
            onMouseLeave={(e) => onLeave(e, 'stop')}
            title="中止当前运行"
            style={mkBtn('stop')}
          >
            <Square size={12} fill="currentColor" />
            <span>STOP</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onRun}
            onMouseEnter={(e) => onEnter(e, 'run')}
            onMouseLeave={(e) => onLeave(e, 'run')}
            title="执行此节点"
            style={mkBtn('run')}
          >
            <Play size={12} fill="currentColor" />
            <span>RUN</span>
          </button>
        )}

        {/* 取消选中 (关闭操作栏) */}
        <button
          type="button"
          onClick={onClose}
          onMouseEnter={(e) => onEnter(e, 'close')}
          onMouseLeave={(e) => onLeave(e, 'close')}
          title="取消选中 (隐藏操作栏)"
          style={mkBtn('close')}
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
};

export default NodeActionBar;
