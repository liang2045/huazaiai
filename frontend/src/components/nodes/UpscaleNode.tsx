import { memo } from 'react';
import { ZoomIn } from 'lucide-react';
import type { NodeProps } from '@xyflow/react';
import { ImageOpFrame } from './ImageOpFrame';
import { useUpdateNodeData } from './useUpdateNodeData';
import { opUpscale } from '../../services/imageOps';

const UpscaleNode = (p: NodeProps) => {
  const update = useUpdateNodeData(p.id);
  const d = p.data as any;
  const scale = d?.scale || 2;
  return (
    <ImageOpFrame
      id={p.id}
      data={p.data}
      selected={p.selected}
      title="放大"
      subtitle={`${scale}×`}
      icon={<ZoomIn size={13} />}
      colorHex="#fb923c"
      bgRgba="rgba(251,146,60,.2)"
      shadowRgba="rgba(251,146,60,.2)"
      textHex="#fed7aa"
      buttonClasses="bg-orange-500/20 hover:bg-orange-500/30 text-orange-200"
      renderSettings={() => (
        <div>
          <label className="text-[10px] text-white/50 block mb-1">倍数</label>
          <select
            value={scale}
            onChange={(e) => update({ scale: parseFloat(e.target.value) })}
            className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
          >
            {[1.5, 2, 3, 4].map((x) => (
              <option key={x} value={x} className="bg-zinc-900">
                {x}×
              </option>
            ))}
          </select>
        </div>
      )}
      runOp={async (img) => opUpscale(img as string, scale)}
    />
  );
};

export default memo(UpscaleNode);
