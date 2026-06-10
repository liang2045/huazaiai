import { useRef, useState } from 'react';
import {
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react';
import { X } from 'lucide-react';

export default function DeletableEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    style,
    markerEnd,
    selected,
    data,
  } = props;
  const { setEdges } = useReactFlow();
  const flowActive = !!(data as any)?.flowActive;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const [hover, setHover] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const show = () => {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setHover(true);
  };
  const scheduleHide = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setHover(false), 80);
  };

  const visible = hover;

  const handleCut = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setEdges((eds) => eds.filter((ed) => ed.id !== id));
  };

  return (
    <>
      <path
        id={id}
        d={edgePath}
        fill="none"
        className="react-flow__edge-path imade-edge-base-path"
        style={style}
        markerEnd={markerEnd}
        pointerEvents="none"
      />
      {flowActive && (
        <path
          d={edgePath}
          fill="none"
          className="imade-edge-flow-path"
          pointerEvents="none"
        />
      )}
      {flowActive && (
        <>
          <circle className="imade-edge-end-pulse" cx={sourceX} cy={sourceY} r={4.5} pointerEvents="none" />
          <circle className="imade-edge-end-pulse imade-edge-end-pulse--target" cx={targetX} cy={targetY} r={4.5} pointerEvents="none" />
        </>
      )}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={34}
        style={{ cursor: 'pointer' }}
        pointerEvents="stroke"
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
        onDoubleClick={handleCut}
        onContextMenu={handleCut}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: visible ? 'all' : 'none',
            opacity: visible ? 1 : 0,
            transition: 'opacity 0.15s, transform 0.15s',
            zIndex: 1000,
          }}
          onMouseEnter={show}
          onMouseLeave={scheduleHide}
        >
          <button
            type="button"
            onClick={handleCut}
            onMouseDown={(e) => e.stopPropagation()}
            title="断开连线"
            aria-label="断开连线"
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: 'rgba(24,24,27,0.92)',
              border: '1px solid rgba(255,255,255,0.18)',
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(0,0,0,0.28)',
              padding: 0,
              transition: 'transform 0.15s, background 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = '#ef4444';
              (e.currentTarget as HTMLButtonElement).style.color = '#fff';
              (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.08)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(24,24,27,0.92)';
              (e.currentTarget as HTMLButtonElement).style.color = '#fff';
              (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
            }}
          >
            <X size={13} strokeWidth={2.2} />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
