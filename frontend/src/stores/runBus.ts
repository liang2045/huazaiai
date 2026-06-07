import { create } from 'zustand';

/**
 * 批量运行总线
 * - currentRunId:当前应执行的节点 id;节点内 useRunTrigger 监听到该值变化时主动触发自身 runFn
 * - lastDone:最后一次完成的节点(成功/失败均会记录),供外部串行流程订阅推进
 * - triggerRun(id):投递运行请求(调用方应保证一次只投递一个,等 lastDone === id 后再下一个)
 * - markDone(id, ok):节点 runFn 完成时回调(成功/失败均调用)
 * - cancelAll():取消当前所有运行(将 currentRunId 置空)
 */

export interface LastDoneInfo {
  id: string;
  ok: boolean;
  ts: number;
  error?: string;
}

interface RunBusState {
  currentRunId: string | null;
  lastDone: LastDoneInfo | null;
  // 0=空闲, 1=单节点运行中, 2=批量运行中
  mode: 'idle' | 'single' | 'batch';
  batchTotal: number;
  batchDoneCount: number;
  triggerRun: (id: string, mode?: 'single' | 'batch') => void;
  markDone: (id: string, ok: boolean, error?: string) => void;
  cancelAll: () => void;
  setBatchProgress: (total: number, done: number) => void;
}

export const useRunBusStore = create<RunBusState>((set) => ({
  currentRunId: null,
  lastDone: null,
  mode: 'idle',
  batchTotal: 0,
  batchDoneCount: 0,
  triggerRun: (id, mode = 'single') =>
    set((s) => ({
      currentRunId: id,
      mode: s.mode === 'batch' ? 'batch' : mode,
    })),
  markDone: (id, ok, error) =>
    set((s) => ({
      lastDone: { id, ok, ts: Date.now(), error },
      currentRunId: null,
      // 单节点模式自动回到 idle;批量模式由 Canvas 控制
      mode: s.mode === 'batch' ? 'batch' : 'idle',
    })),
  cancelAll: () =>
    set({ currentRunId: null, mode: 'idle', batchTotal: 0, batchDoneCount: 0 }),
  setBatchProgress: (total, done) =>
    set({ batchTotal: total, batchDoneCount: done, mode: total > 0 ? 'batch' : 'idle' }),
}));
