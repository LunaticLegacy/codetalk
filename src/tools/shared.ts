export const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".venv", "__pycache__"]);

export function countLines(content: string): number {
  return content.split(/\r?\n/).length;
}
