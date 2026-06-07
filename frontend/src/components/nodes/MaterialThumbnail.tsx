import { memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Video as VideoIcon,
  Music,
  X,
  Link2,
  Pin,
  FileText,
} from 'lucide-react';
import type { Material } from './useUpstreamMaterials';

/**
 * MaterialThumbnail - 单项素材缩略 (供 MaterialPreviewSection 内部使用)
 *
 * 视觉:
 *   - image  : 直接渲染 <img>, object-cover 填满
 *   - video  : 黑底 + VideoIcon (后续可升级为视频首帧)
 *   - audio  : 黄/teal 底 + Music 图标
 *   - text   : 浅色卡片 + 文本前缀字
 *   - 左上角: 序号 (1/2/3…)
 *   - 右上角: 来源标识 📌 local / 🔗 upstream
 *   - 右下角: 删除按钮 (仅 local 来源)
 *
 * 主题:
 *   - isPixel=true  → 黑色像素描边 + 1px 偏移投影 + 高对比黄/青块
 *   - isPixel=false → 圆角 + 半透明描边 + 白/teal 高亮
 *
 * 交互:
 *   - 整个缩略项是 dnd-kit useSortable 的拖把手
 *   - 加 className="nodrag" 让 xyflow 节点拖动不抢事件
 *   - 删除按钮 onPointerDown stopPropagation 避免触发拖动
 */

interface Props {
  material: Material;
  index: number;
  isPixel: boolean;
  isDark: boolean;
  draggable?: boolean;
  removable?: boolean;
  onRemove?: () => void;
  size?: number;
}

const MaterialThumbnail = ({
  material,
  index,
  isPixel,
  isDark,
  draggable = true,
  removable = false,
  onRemove,
  size = 56,
}: Props) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: material.id, disabled: !draggable });

  const wrapStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    width: size,
    height: size,
    cursor: draggable ? 'grab' : 'default',
    position: 'relative',
    overflow: 'hidden',
    flex: '0 0 auto',
    ...(isPixel
      ? { border: '1.5px solid var(--px-ink, #1a1a1a)', boxShadow: '1px 1px 0 var(--px-ink, #1a1a1a)' }
      : { borderRadius: 6, border: `1px solid ${isDark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.12)'}` }),
  };

  const cornerCommon: React.CSSProperties = {
    position: 'absolute',
    fontSize: 9,
    fontWeight: 700,
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 14,
    height: 14,
    pointerEvents: 'none',
  };

  return (
    <div ref={setNodeRef} style={wrapStyle} className="nodrag" {...attributes} {...listeners}
      title={material.label || material.url}>
      {/* 内容主体 */}
      {material.kind === 'image' ? (
        <img
          src={material.url}
          alt={material.label || ''}
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : material.kind === 'video' ? (
        <div style={{ width: '100%', height: '100%', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <VideoIcon size={20} color="#cbd5e1" />
        </div>
      ) : material.kind === 'audio' ? (
        <div style={{
          width: '100%', height: '100%',
          background: isPixel ? 'var(--px-yellow, #fde047)' : isDark ? 'rgba(20,184,166,.18)' : 'rgba(20,184,166,.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Music size={20} color={isPixel ? '#1a1a1a' : '#5eead4'} />
        </div>
      ) : (
        <div style={{
          width: '100%', height: '100%',
          padding: '4px 4px',
          fontSize: 9, lineHeight: 1.25,
          display: 'flex', alignItems: 'flex-start',
          background: isPixel ? 'var(--px-card, #fefce8)' : isDark ? 'rgba(99,102,241,.14)' : 'rgba(99,102,241,.10)',
          color: isPixel ? '#1a1a1a' : isDark ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.78)',
          overflow: 'hidden',
        }}>
          <FileText size={9} style={{ marginRight: 2, flexShrink: 0, marginTop: 1 }} />
          <span style={{
            display: '-webkit-box',
            WebkitLineClamp: 4,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            wordBreak: 'break-all',
          }}>
            {material.label || material.url}
          </span>
        </div>
      )}

      {/* 序号角标 - 左上 */}
      <div
        style={{
          ...cornerCommon,
          top: 0,
          left: 0,
          padding: '0 3px',
          background: isPixel ? 'var(--px-yellow, #fde047)' : 'rgba(0,0,0,.6)',
          color: isPixel ? '#1a1a1a' : '#fff',
          ...(isPixel ? { borderRight: '1.5px solid #1a1a1a', borderBottom: '1.5px solid #1a1a1a' } : {}),
        }}
      >
        {index + 1}
      </div>

      {/* 来源角标 - 右上 */}
      <div
        style={{
          ...cornerCommon,
          top: 0,
          right: 0,
          width: 14,
          background: material.origin === 'local'
            ? (isPixel ? 'var(--px-card, #fefce8)' : 'rgba(0,0,0,.6)')
            : (isPixel ? 'var(--px-cyan, #67e8f9)' : 'rgba(20,184,166,.85)'),
          color: isPixel ? '#1a1a1a' : '#fff',
          ...(isPixel ? { borderLeft: '1.5px solid #1a1a1a', borderBottom: '1.5px solid #1a1a1a' } : {}),
        }}
      >
        {material.origin === 'local' ? <Pin size={8} /> : <Link2 size={8} />}
      </div>

      {/* 删除按钮 - 右下 (仅 local) */}
      {removable && onRemove && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: 14,
            height: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isPixel ? 'var(--px-red, #ef4444)' : 'rgba(239,68,68,.92)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            ...(isPixel ? { borderLeft: '1.5px solid #1a1a1a', borderTop: '1.5px solid #1a1a1a' } : {}),
          }}
          title="移除本地素材"
        >
          <X size={9} />
        </button>
      )}
    </div>
  );
};

export default memo(MaterialThumbnail);
