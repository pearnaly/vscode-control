import * as path from 'node:path';
// A namespace import, not `{ z }`: esbuild cannot tree-shake zod 4's `z` re-export, so `{ z }` bundles all 40+
// locales (about +540 kb in each bundle). The namespace import has the same members as the named `z`.
import * as z from 'zod';

export const TOOL_NAMES = ['open_file', 'reveal_in_explorer'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_PATH = /^[\\/]{2}[^\\/]+[\\/][^\\/]+/;

/**
 * On Windows `path.isAbsolute` also accepts `/c/Users/x` (Git Bash style) and `\foo`, which name no
 * file there, so only a drive path or a UNC path counts as absolute.
 */
function isAbsolutePath(p: string): boolean {
  if (process.platform === 'win32') return WINDOWS_DRIVE_PATH.test(p) || WINDOWS_UNC_PATH.test(p);
  return path.isAbsolute(p);
}

const ABSOLUTE_PATH_MESSAGE =
  process.platform === 'win32'
    ? 'must be an absolute Windows path like C:\\dir\\file (not /c/dir/file)'
    : 'must be an absolute path';

const absolutePath = z.string().refine(isAbsolutePath, { error: ABSOLUTE_PATH_MESSAGE });

const GROUP_MESSAGE = 'must be "beside", "active" or an integer 1-9';
// The message sits on the union and on every check of the number branch, so whichever issue zod reports
// for a bad group ('left', 0, 10, 1.5), it reads the same. `abort` on the integer check stops 1e21 and 2**53,
// which fail the safe-integer check and max(9) alike, from reporting the message twice.
const groupNumber = z
  .number({ error: GROUP_MESSAGE })
  .int({ error: GROUP_MESSAGE, abort: true })
  .min(1, { error: GROUP_MESSAGE })
  .max(9, { error: GROUP_MESSAGE });

/** Raw shape for open_file; the MCP SDK turns it into the tool's JSON schema. */
export const openFileShape = {
  path: absolutePath.describe('Absolute path of an existing file (on Windows C:\\… or \\\\server\\share\\…).'),
  line: z
    .number().int().min(1).optional()
    .describe('1-based line for the cursor; the line is scrolled to the middle of the screen.'),
  column: z
    .number().int().min(1).optional()
    .describe('1-based column for the cursor, in UTF-16 code units like VS Code (a tab counts 1, most emoji 2); default 1. Requires line.'),
  endLine: z
    .number().int().min(1).optional()
    .describe('Selects from line/column to this 1-based line (inclusive). Requires line.'),
  endColumn: z
    .number().int().min(1).optional()
    .describe('1-based column of the last selected character, inclusive, in UTF-16 code units (default: end of endLine). Requires endLine (use endLine = line for one line).'),
  group: z
    .union([z.literal('beside'), z.literal('active'), groupNumber], { error: GROUP_MESSAGE })
    .optional()
    .describe('"beside" (default): the editor group next to the Claude chat. "active": the active group. 1-9: that group.'),
  focus: z
    .boolean().optional()
    .describe('false (default): keyboard focus stays in the chat. true: focus moves into the file, e.g. so the user can type a secret.'),
  preview: z
    .boolean().optional()
    .describe('false (default): a normal tab. true: a preview tab that the next preview replaces.'),
};

/**
 * Strict object over `openFileShape`, without the cross-field rules. This is what gets registered
 * with the MCP SDK, so unknown keys are rejected instead of being silently stripped.
 */
export const openFileObject = z.object(openFileShape).strict();

/** `openFileObject` plus the cross-field rules; the bridge and the extension validate with this. */
export const openFileArgs = openFileObject.superRefine((a, ctx) => {
  const fail = (field: string, message: string): void => ctx.addIssue({ code: 'custom', path: [field], message });

  // Independent of the endLine chain below, so none of these hides another.
  if (a.column !== undefined && a.line === undefined) fail('column', 'column requires line');
  if (a.endColumn !== undefined && a.endLine === undefined) {
    fail('endColumn', 'endColumn requires endLine (use endLine = line for one line)');
  }

  if (a.endLine !== undefined && a.line === undefined) {
    fail('endLine', 'endLine requires line');
  } else if (a.endLine !== undefined && a.line !== undefined && a.endLine < a.line) {
    fail('endLine', 'endLine must be >= line');
  } else if (
    a.endLine !== undefined && a.endLine === a.line && a.endColumn !== undefined && a.endColumn < (a.column ?? 1)
  ) {
    fail('endColumn', 'endColumn must be >= column when line = endLine');
  }
});
export type OpenFileArgs = z.infer<typeof openFileArgs>;

/** Raw shape for reveal_in_explorer. */
export const revealShape = {
  path: absolutePath.describe(
    "Absolute path of an existing file or folder inside the window's workspace (on Windows C:\\… or \\\\server\\share\\…).",
  ),
  focus: z
    .boolean().optional()
    .describe('false (default): keyboard focus goes back to the active editor group (normally the chat tab). true: focus stays in the Explorer.'),
};
export const revealArgs = z.object(revealShape).strict();
export type RevealArgs = z.infer<typeof revealArgs>;

/** Body of POST /call (bridge → extension). Args are validated again by the extension. */
export const callRequestSchema = z.object({
  tool: z.enum(TOOL_NAMES),
  args: z.unknown().optional(), // zod 4 no longer makes a z.unknown() key optional by itself
});
export type CallRequest = z.infer<typeof callRequestSchema>;

/** Answer of POST /call. */
export const callResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), text: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type CallResponse = z.infer<typeof callResponseSchema>;

/** Content of ~/.vscode-control/windows/<pid>.json. zod 4 numbers reject ±Infinity and NaN by default. */
export const windowRecordSchema = z.object({
  pid: z.number().int().positive(),
  port: z.number().int().min(1).max(65535),
  token: z.string().min(32),
  workspaceFolders: z.array(absolutePath),
  windowName: z.string(),
  lastFocusedAt: z.number(),
  /** Epoch ms when the window's extension host started; absent in files written by 0.1.x. */
  startedAt: z.number().int().positive().optional(),
});
export type WindowRecord = z.infer<typeof windowRecordSchema>;

/** "field: message; other: message" — short enough for a tool result. Root-level issues read "arguments: …". */
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.map(String).join('.') : 'arguments'}: ${issue.message}`)
    .join('; ');
}
