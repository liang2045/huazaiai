import { memo } from 'react';
import { Grid3x3 } from 'lucide-react';
import type { NodeProps } from '@xyflow/react';
import { ImageOpFrame } from './ImageOpFrame';
import { useUpdateNodeData } from './useUpdateNodeData';
import { opGridCrop } from '../../services/imageOps';

const GridCropNode = (p: NodeProps) => {
  const update = useUpdateNodeData(p.id);
  const d = p.data as any;
  const rows = d?.rows || 3;
  const cols = d?.cols || 3;
  return (
    <ImageOpFrame
      id={p.id}
      data={p.data}
      selected={p.selected}
      title="九宫格"
      subtitle={`${rows}×${cols}`}
      icon={<Grid3x3 size={13} />}
      colorHex="#fb923c"
      bgRgba="rgba(251,146,60,.2)"
      shadowRgba="rgba(251,146,60,.2)"
      textHex="#fed7aa"
      buttonClasses="bg-orange-500/20 hover:bg-orange-500/30 text-orange-200"
      renderSettings={() => (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-white/50 block mb-1">行</label>
            <input
              type="number"
              min={1}
              max={8}
              value={rows}
              onChange={(e) => update({ rows: parseInt(e.target.value) || 3 })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            />
          </div>
          <div>
            <label className="text-[10px] text-white/50 block mb-1">列</label>
            <input
              type="number"
              min={1}
              max={8}
              value={cols}
              onChange={(e) => update({ cols: parseInt(e.target.value) || 3 })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            />
          </div>
        </div>
      )}
      runOp={async (img) => opGridCrop(img as string, rows, cols)}
    />
  );
};

export default memo(GridCropNode);
