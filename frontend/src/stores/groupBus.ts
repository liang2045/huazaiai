import { create } from 'zustand';

/**
 * 节点组(GroupBox)操作总线
 * - 由 GroupBoxNode 内部按钮触发请求,Canvas 监听 ts 变化执行对应动作
 * - 不直接持有 nodes/edges 引用,避免双向耦合
 */

export interface GroupExecuteRequest {
  groupId: string;
  memberIds: string[];
  ts: number;
}

export interface GroupDeleteRequest {
  groupId: string;
  ts: number;
}

interface GroupBusState {
  executeReq: GroupExecuteRequest | null;
  deleteReq: GroupDeleteRequest | null;
  requestExecute: (groupId: string, memberIds: string[]) => void;
  requestDelete: (groupId: string) => void;
  clearExecute: () => void;
  clearDelete: () => void;
}

export const useGroupBusStore = create<GroupBusState>((set) => ({
  executeReq: null,
  deleteReq: null,
  requestExecute: (groupId, memberIds) =>
    set({ executeReq: { groupId, memberIds, ts: Date.now() } }),
  requestDelete: (groupId) =>
    set({ deleteReq: { groupId, ts: Date.now() } }),
  clearExecute: () => set({ executeReq: null }),
  clearDelete: () => set({ deleteReq: null }),
}));

// 12 色 GroupBox 调色板(与 PenguinPravite NodeGroupBox.GROUP_COLORS 对齐)
export const GROUP_COLORS = [
  '#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EC4899', '#06B6D4',
  '#EF4444', '#84CC16', '#F97316', '#14B8A6', '#A855F7', '#64748B',
];

export const DEFAULT_GROUP_NAME = 'My favourite girl is Go Younjung';
