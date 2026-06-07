import { useReactFlow } from '@xyflow/react';
import { useCallback } from 'react';

/**
 * 用于在节点内部更新自身 data 的 hook
 * 通过 reactflow 的 setNodes 接口更新指定 id 的节点
 */
export function useUpdateNodeData(nodeId: string) {
  const { setNodes } = useReactFlow();
  return useCallback(
    (patch: Record<string, any>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...(n.data as any), ...patch } }
            : n
        )
      );
    },
    [nodeId, setNodes]
  );
}
