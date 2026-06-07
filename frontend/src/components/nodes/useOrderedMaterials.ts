import { useMemo } from 'react';
import type { Material } from './useUpstreamMaterials';

/**
 * useOrderedMaterials - 把 materials 按 order 排序
 *
 * 规则:
 *   1. order 中存在的 id 按 order 数组顺序排在前
 *   2. 未在 order 中的项 (新连入 / 新本地上传) 追加到末尾
 *   3. 已断开 (order 中存在但 materials 中找不到) 的 id 在结果中自然消失
 *      但 order 数组本身不在此 hook 中清理 (允许后续重连复用排序记忆)
 *
 * 多分组/混类型场景: 调用方可把 [...texts, ...images, ...videos, ...audios]
 * 一次性传入, 让用户跨类型自由排序; 也可以分别调用本 hook 获得每组排序结果。
 */
export function useOrderedMaterials<T extends Material>(
  materials: T[],
  order: string[] | undefined,
): T[] {
  return useMemo(() => {
    const arr = materials || [];
    if (!order || order.length === 0) return arr.slice();
    const map = new Map<string, T>();
    for (const m of arr) map.set(m.id, m);
    const ordered: T[] = [];
    const used = new Set<string>();
    for (const oid of order) {
      const m = map.get(oid);
      if (m && !used.has(m.id)) {
        ordered.push(m);
        used.add(m.id);
      }
    }
    for (const m of arr) {
      if (!used.has(m.id)) ordered.push(m);
    }
    return ordered;
  }, [materials, order]);
}
