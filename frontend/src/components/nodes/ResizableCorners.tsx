import { NodeResizeControl, type ResizeParams } from '@xyflow/react';
import { useThemeStore } from '../../stores/theme';

/**
 * ResizableCorners — 四角同比例缩放控件 (通用)
 *
 * 设计:
 *   1. 仅在节点 4 个角放置 handle (不放边线), 默认低调, 鼠标 hover 时高亮
 *   2. keepAspectRatio 同比例缩放: 角拖动时 width/height 等比变化, 不会变形
 *   3. 主题适配: 科技风 / 像素风 × 深色 / 浅色 共 4 套视觉
 *      - 科技风: 圆角小方块 + 主题色描边 + 发光光晕 (hover)
 *      - 像素风: 黑描边小方块 + 硬阴影 (neo-brutalism)
 *   4. 只有节点 selected 时才出现, 避免节点丛干扰视野
 *
 * 用法 (节点 root 内任意位置, 推荐紧贴 Handle 之后):
 *   <ResizableCorners selected={selected} minWidth={220} minHeight={140} accent="#5eead4" />
 *
 * 视觉样式定义在 src/styles/index.css 末尾 (.imade-resize-handle*)
 */
interface Props {
  selected?: boolean;
  /** 最小宽度 (px). 默认 160 */
  minWidth?: number;
  /** 最小高度 (px). 默认 100 */
  minHeight?: number;
  /** 最大宽度 (px). 默认 不限 */
  maxWidth?: number;
  /** 最大高度 (px). 默认 不限 */
  maxHeight?: number;
  /** 节点主题强调色 (科技风用作描边/发光色), 像素风固定使用主题变量, 不读此值 */
  accent?: string;
  /** 缩放进行中回调 (可选, 一般无需) */
  onResize?: (e: any, params: ResizeParams) => void;
}

const POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

export default function ResizableCorners({
  selected,
  minWidth = 160,
  minHeight = 100,
  maxWidth,
  maxHeight,
  accent = '#5eead4',
  onResize,
}: Props) {
  const { theme, style } = useThemeStore();
  const isDark = theme === 'dark';
  const isPixel = style === 'pixel';

  // 未选中: 完全不渲染 (节点视图保持纯净)
  if (!selected) return null;

  const themeStyle = isPixel ? 'pixel' : 'tech';
  const themeMode = isDark ? 'dark' : 'light';
  // 科技风用 accent 作 CSS 变量; 像素风忽略, 使用 theme-pixel.css 中的固定糖果色
  const styleVars = !isPixel
    ? ({ ['--imade-resize-accent' as any]: accent } as React.CSSProperties)
    : undefined;

  return (
    <>
      {POSITIONS.map((p) => (
        <NodeResizeControl
          key={p}
          position={p}
          keepAspectRatio
          minWidth={minWidth}
          minHeight={minHeight}
          maxWidth={maxWidth}
          maxHeight={maxHeight}
          onResize={onResize}
          className={`imade-resize-handle imade-resize-handle--${themeStyle} imade-resize-handle--${themeStyle}-${themeMode} imade-resize-handle--${p}`}
          style={styleVars}
        />
      ))}
    </>
  );
}
