import { useMemo } from 'react';
import { useNodeConnections, useNodesData } from '@xyflow/react';

/**
 * 检测当前节点是否已经连接了下游 OutputNode (type==='output').
 *
 * 用途:
 *   生成类节点 (image/video/audio/seedance/llm/runninghub/storyboard 等) 在生成完成后,
 *   Canvas 全局逻辑会自动外挂 OutputNode 显示结果, 此时节点内部的图像/视频/音频预览
 *   就成了冗余信息并占用大量垂直空间. 用本 hook 判断是否已外挂, 若是则节点内预览
 *   可以选择不渲染, 仅保留参数配置区域, 让结果由下游 OutputNode 集中展示.
 *
 * 实现:
 *   - useNodeConnections: 订阅本节点 source handle 的连接, 任何连/断连均触发重渲染
 *   - useNodesData: 订阅这些下游节点的 type/data, 任何下游 type 变化均能感知
 *   - useMemo 派生布尔, deps 仅依赖 connections + downstream, 不会循环
 */
export function useHasAutoOutput(nodeId: string): boolean {
  const conns = useNodeConnections({ id: nodeId, handleType: 'source' });
  const targetIds = useMemo(
    () => Array.from(new Set(conns.map((c) => c.target))),
    [conns]
  );
  const targets = useNodesData(targetIds);
  return useMemo(() => {
    const list = Array.isArray(targets) ? targets : [];
    return list.some((n) => n?.type === 'output');
  }, [targets]);
}
