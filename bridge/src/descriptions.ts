/**
 * Sent with the MCP handshake. Claude Code may load tool schemas lazily, so this is the text Claude sees
 * when it decides whether these tools are of use at all.
 */
export const SERVER_INSTRUCTIONS = [
  "Tools to show things in the user's VS Code window: open_file (beside the chat, optional selection) and reveal_in_explorer.",
  'Use them when the user asks to see code, for a walkthrough of an implementation (focus false, block selected), or to let the user type a secret into a file that is neither committed nor synced (focus true, placeholder selected; wait for "done"; never reopen it with a selection).',
  'On your own initiative only sparingly: at most the main file of a finished task.',
].join('\n');

export const OPEN_FILE_DESCRIPTION = [
  "Open a file in the user's VS Code window (the window this Claude session runs in), optionally at a line with a range selected.",
  'Use it when the user asks to see code, or to present an implementation as a walkthrough: open each relevant file in turn with the relevant block selected (line/endLine), leaving focus in the chat.',
  'For a secret or another value the user must type: first create the file with a placeholder, then call this with focus: true and the placeholder selected (line, column, endLine, endColumn), and wait for the user to say they are done. Do not read the value back unless asked, and never reopen that file with a selection afterwards: VS Code shares the selected text with Claude.',
  'Create that file where it is neither committed nor synced (outside any cloud-synced folder (OneDrive, Dropbox, iCloud…), and gitignored or outside any repository), and tell the user not to select the value after typing it.',
  'On your own initiative use it sparingly, at most for the main file of a finished task; do not open a file for every file you mention.',
  'Opens beside the Claude chat by default. The file must exist.',
].join(' ');

export const REVEAL_DESCRIPTION = [
  "Reveal a file or folder in the Explorer side panel of the user's VS Code window: the tree expands to it and selects it.",
  'Use it when the user asks where something is, or sparingly after a task to point at the main new file or folder.',
  "The path must exist and lie inside the window's workspace folders. Items hidden by files.exclude are not shown even though the call succeeds. Unless focus: true, keyboard focus goes back to the active editor group (normally the chat tab).",
].join(' ');
