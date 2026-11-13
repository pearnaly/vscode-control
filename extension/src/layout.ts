import type { OpenFileArgs } from '../../shared/protocol';

/** View type of the Claude Code chat editor tab (VS Code may prefix it with "mainThreadWebview-"). */
export const CLAUDE_CHAT_VIEW_TYPE = 'claudeVSCodePanel';

export interface TabInfo {
  isActive: boolean;
  isClaudeChat: boolean;
}

export interface GroupInfo {
  viewColumn: number;
  isActive: boolean;
  tabs: TabInfo[];
}

export type Target = { kind: 'column'; column: number } | { kind: 'active' } | { kind: 'beside' };
export type GroupArg = NonNullable<OpenFileArgs['group']>;

export function isClaudeChatViewType(viewType: string): boolean {
  return viewType === CLAUDE_CHAT_VIEW_TYPE || viewType.endsWith(`-${CLAUDE_CHAT_VIEW_TYPE}`);
}

/** True when the group's visible tab is a Claude chat, i.e. opening a file there would cover it. */
const showsChat = (g: GroupInfo): boolean => g.tabs.some((t) => t.isActive && t.isClaudeChat);

/**
 * View column of the group holding the Claude chat. A group that shows the chat wins (the active
 * one first); otherwise the active group among those with a hidden chat tab, else the first of them.
 */
export function findChatColumn(groups: readonly GroupInfo[]): number | undefined {
  const withChat = groups.filter((g) => g.tabs.some((t) => t.isClaudeChat));
  const visible = withChat.filter(showsChat);
  const pick =
    visible.find((g) => g.isActive) ?? visible[0] ?? withChat.find((g) => g.isActive) ?? withChat[0];
  return pick?.viewColumn;
}

/**
 * Where open_file opens. "beside" = next to the Claude chat, never in a group that is showing a
 * Claude chat: the nearest other group by view-column distance, the later column on a tie (view
 * columns follow VS Code's grid order, which is not necessarily left to right); else a new group
 * after the last one. VS Code's own "beside" when the chat is not an editor tab, or when that
 * new group would be beyond 9.
 */
export function resolveTarget(group: GroupArg, groups: readonly GroupInfo[]): Target {
  if (typeof group === 'number') return { kind: 'column', column: group };
  if (group === 'active') return { kind: 'active' };
  const chat = findChatColumn(groups);
  if (chat === undefined) return { kind: 'beside' };
  const nearest = groups
    .filter((g) => g.viewColumn !== chat && !showsChat(g))
    .map((g) => g.viewColumn)
    .sort((a, b) => Math.abs(a - chat) - Math.abs(b - chat) || b - a)[0];
  if (nearest !== undefined) return { kind: 'column', column: nearest };
  // VS Code creates group max+1 after the last group in grid order, which can be away from the chat.
  const next = Math.max(...groups.map((g) => g.viewColumn)) + 1;
  return next <= 9 ? { kind: 'column', column: next } : { kind: 'beside' };
}
