import { describe, expect, it } from 'vitest';
import { findChatColumn, isClaudeChatViewType, resolveTarget, type GroupInfo } from '../../extension/src/layout';

const chat = { isActive: true, isClaudeChat: true };
const hiddenChat = { isActive: false, isClaudeChat: true };
const file = { isActive: true, isClaudeChat: false };
const g = (viewColumn: number, tabs: GroupInfo['tabs'], isActive = false): GroupInfo => ({ viewColumn, isActive, tabs });

describe('isClaudeChatViewType', () => {
  it('matches the Claude chat panel with or without the webview prefix', () => {
    expect(isClaudeChatViewType('claudeVSCodePanel')).toBe(true);
    expect(isClaudeChatViewType('mainThreadWebview-claudeVSCodePanel')).toBe(true);
  });

  it('ignores other webviews', () => {
    expect(isClaudeChatViewType('claudePlanPreview')).toBe(false);
    expect(isClaudeChatViewType('markdown.preview')).toBe(false);
  });
});

describe('findChatColumn', () => {
  it('is undefined without a chat tab', () => {
    expect(findChatColumn([g(1, [file], true)])).toBeUndefined();
  });

  it('prefers the active group', () => {
    expect(findChatColumn([g(1, [chat]), g(3, [chat], true)])).toBe(3);
  });

  it('then a group where the chat is the visible tab', () => {
    expect(findChatColumn([g(1, [hiddenChat, file]), g(2, [chat]), g(3, [file], true)])).toBe(2);
  });

  it('then the first group with a chat tab', () => {
    expect(findChatColumn([g(1, [file]), g(2, [hiddenChat, file])])).toBe(2);
  });

  it('prefers a visible chat over the active group that only holds a hidden chat', () => {
    expect(findChatColumn([g(1, [hiddenChat, file], true), g(2, [chat])])).toBe(2);
  });

  it('falls back to the active group among hidden chats', () => {
    expect(findChatColumn([g(1, [hiddenChat, file]), g(2, [hiddenChat, file], true)])).toBe(2);
  });
});

describe('resolveTarget', () => {
  it('passes a group number through', () => {
    expect(resolveTarget(4, [])).toEqual({ kind: 'column', column: 4 });
  });

  it('maps "active"', () => {
    expect(resolveTarget('active', [g(1, [chat], true)])).toEqual({ kind: 'active' });
  });

  it("falls back to VS Code's beside when the chat is not an editor tab", () => {
    expect(resolveTarget('beside', [g(1, [file], true)])).toEqual({ kind: 'beside' });
  });

  it('uses the existing group right of the chat', () => {
    expect(resolveTarget('beside', [g(1, [chat], true), g(2, [file])])).toEqual({ kind: 'column', column: 2 });
  });

  it('uses the existing group left of the chat when there is none to the right', () => {
    expect(resolveTarget('beside', [g(1, [file]), g(2, [chat], true)])).toEqual({ kind: 'column', column: 1 });
  });

  it('creates a group right of the chat when the chat is alone', () => {
    expect(resolveTarget('beside', [g(1, [chat], true)])).toEqual({ kind: 'column', column: 2 });
  });

  it("falls back to VS Code's beside when the chat is alone in group 9", () => {
    expect(resolveTarget('beside', [g(9, [chat], true)])).toEqual({ kind: 'beside' });
  });

  it('prefers the group after the chat over the one before it', () => {
    expect(resolveTarget('beside', [g(1, [file]), g(2, [chat], true), g(3, [file])]))
      .toEqual({ kind: 'column', column: 3 });
  });

  it('prefers the nearer group over a later one', () => {
    expect(resolveTarget('beside', [g(1, [file]), g(2, [chat], true), g(4, [file])]))
      .toEqual({ kind: 'column', column: 1 });
  });

  it('skips a neighbour that shows another chat', () => {
    expect(resolveTarget('beside', [g(1, [chat], true), g(2, [chat]), g(3, [file])]))
      .toEqual({ kind: 'column', column: 3 });
  });

  it('creates a new group after the last one when only chats are showing', () => {
    expect(resolveTarget('beside', [g(1, [chat], true), g(2, [chat])])).toEqual({ kind: 'column', column: 3 });
  });

  it('does not create a group beyond 9 when only chats are showing', () => {
    expect(resolveTarget('beside', [g(8, [chat], true), g(9, [chat])])).toEqual({ kind: 'beside' });
  });

  it('opens beside a visible chat, not in the active group that holds a hidden chat', () => {
    const groups = [g(1, [hiddenChat, file], true), g(2, [chat])];
    expect(findChatColumn(groups)).toBe(2);
    expect(resolveTarget('beside', groups)).toEqual({ kind: 'column', column: 1 });
  });
});
