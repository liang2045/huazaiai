import { create } from 'zustand';

/**
 * 日志总线 - 对齐 gpt-image-2-web 的 log() 实现
 * 任意业务节点都可以调用 logBus.log('级别', '内容', '来源') 写入
 * TerminalPanel 订阅显示
 */
export type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  id: string;
  ts: number; // unix ms
  level: LogLevel;
  source?: string; // 节点 id 或模块名,如 image:nodeXXX / video / system
  message: string;
}

interface LogState {
  entries: LogEntry[];
  open: boolean;
  unread: number; // 未读消息数(面板关闭时累计)
  log: (level: LogLevel, message: string, source?: string) => void;
  clear: () => void;
  setOpen: (v: boolean) => void;
  toggleOpen: () => void;
}

const MAX_LOGS = 500;

export const useLogStore = create<LogState>((set, get) => ({
  entries: [],
  open: false,
  unread: 0,
  log: (level, message, source) => {
    const entry: LogEntry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ts: Date.now(),
      level,
      source,
      message,
    };
    set((s) => {
      const arr = [...s.entries, entry];
      if (arr.length > MAX_LOGS) arr.splice(0, arr.length - MAX_LOGS);
      return { entries: arr, unread: s.open ? 0 : Math.min(99, s.unread + 1) };
    });
  },
  clear: () => set({ entries: [], unread: 0 }),
  setOpen: (v) => set({ open: v, unread: v ? 0 : get().unread }),
  toggleOpen: () => set((s) => ({ open: !s.open, unread: !s.open ? 0 : s.unread })),
}));

// 便捷 API
export const logBus = {
  info: (msg: string, source?: string) => useLogStore.getState().log('info', msg, source),
  success: (msg: string, source?: string) => useLogStore.getState().log('success', msg, source),
  warn: (msg: string, source?: string) => useLogStore.getState().log('warn', msg, source),
  error: (msg: string, source?: string) => useLogStore.getState().log('error', msg, source),
  debug: (msg: string, source?: string) => useLogStore.getState().log('debug', msg, source),
};
