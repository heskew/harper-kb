/**
 * Minimal MCP JSON-RPC 2.0 Protocol Handler
 *
 * Routes initialize, tools/list, and tools/call methods.
 * No SDK, no transport layer — just a function from parsed body to response body.
 */

import type { ValidatedCaller } from '../oauth/validate.ts';
import { tools, type ToolDefinition } from './tools.ts';

const SERVER_INFO = {
	name: 'knowledge-base',
	version: '0.1.0',
};

const PROTOCOL_VERSION = '2025-03-26';

const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

interface JsonRpcResponse {
	jsonrpc: '2.0';
	id: string | number | null;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

/** Pre-built name→tool index (built once at module load). */
const toolsByName = new Map<string, ToolDefinition>(tools.map((t) => [t.name, t]));

/** Format a tool definition for the tools/list response. */
function toToolListEntry(tool: ToolDefinition) {
	return {
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema,
	};
}

/**
 * Handle a single JSON-RPC request.
 *
 * Returns a JSON-RPC response object, or null for notifications (no id).
 */
export async function handleJsonRpc(body: unknown, caller: ValidatedCaller): Promise<JsonRpcResponse | null> {
	if (!body || typeof body !== 'object' || (body as any).jsonrpc !== '2.0') {
		return {
			jsonrpc: '2.0',
			id: (body as any)?.id ?? null,
			error: { code: INVALID_REQUEST, message: 'Invalid JSON-RPC request' },
		};
	}

	const req = body as {
		jsonrpc: '2.0';
		id?: string | number | null;
		method: string;
		params?: Record<string, unknown>;
	};

	// Notifications have no id — acknowledge silently
	if (req.id === undefined || req.id === null) {
		return null;
	}

	const { id } = req;

	try {
		switch (req.method) {
			case 'initialize':
				return {
					jsonrpc: '2.0',
					id,
					result: {
						protocolVersion: PROTOCOL_VERSION,
						capabilities: { tools: {} },
						serverInfo: SERVER_INFO,
					},
				};

			case 'tools/list':
				return {
					jsonrpc: '2.0',
					id,
					result: {
						tools: tools.map(toToolListEntry),
					},
				};

			case 'tools/call': {
				const toolName = (req.params as any)?.name;
				const toolArgs = (req.params as any)?.arguments ?? {};
				const tool = toolsByName.get(toolName);

				if (!tool) {
					return {
						jsonrpc: '2.0',
						id,
						error: {
							code: METHOD_NOT_FOUND,
							message: `Unknown tool: ${toolName}`,
						},
					};
				}

				const result = await tool.handler(toolArgs, caller);
				return { jsonrpc: '2.0', id, result };
			}

			default:
				return {
					jsonrpc: '2.0',
					id,
					error: {
						code: METHOD_NOT_FOUND,
						message: `Unknown method: ${req.method}`,
					},
				};
		}
	} catch (error) {
		logger?.error?.('MCP JSON-RPC handler failed:', (error as Error).message);
		return {
			jsonrpc: '2.0',
			id,
			error: {
				code: INTERNAL_ERROR,
				message: 'Internal server error',
			},
		};
	}
}
