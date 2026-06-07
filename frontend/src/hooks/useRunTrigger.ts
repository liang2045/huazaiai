import { useEffect, useRef } from 'react';
import { useRunBusStore } from '../stores/runBus';

/**
 * 节点运行总线监听器
 * 节点在内部调用:`useRunTrigger(id, async () => { await handleGenerate(); })`
 * 当外部(批量运行)将 currentRunId 设为本节点 id 时,自动调用 runFn,
 * 完成后(成功 / 失败)回报 markDone(id, ok)。
 *
 * 设计要点:
 * - runFn 通过 ref 保存,避免依赖项导致 effect 反复执行
 * - 用 startedRef 防重入,避免 React StrictMode 二次挂载触发两次
 */
export function useRunTrigger(nodeId: string, runFn: () => Promise<void> | void) {
  const target = useRunBusStore((s) => s.currentRunId);
  const markDone = useRunBusStore((s) => s.markDone);
  const runFnRef = useRef(runFn);
  runFnRef.current = runFn;
  const startedRef = useRef(false);

  useEffect(() => {
    if (target !== nodeId) {
      startedRef.current = false;
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        await runFnRef.current();
        if (!cancelled) markDone(nodeId, true);
      } catch (e: any) {
        if (!cancelled) markDone(nodeId, false, e?.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target, nodeId, markDone]);
}
