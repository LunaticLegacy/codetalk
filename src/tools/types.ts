export type ToolArg = { name: string; type: string; description: string; required?: boolean };
export type ToolDef = { name: string; description: string; args: ToolArg[] };
export type ToolResult = { success: boolean; data: string };
