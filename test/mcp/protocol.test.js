/**
 * Tests for MCP JSON-RPC protocol handler.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { handleJsonRpc } from '../../dist/mcp/protocol.js';

const TEST_KB = 'test-kb';

const mockCaller = {
	userId: 'test-user',
	clientId: 'test-client',
	scopes: ['mcp:read', 'mcp:write'],
	kbId: TEST_KB,
};

describe('handleJsonRpc', () => {
	beforeEach(() => clearAllTables());

	it('handles initialize', async () => {
		const result = await handleJsonRpc(
			{
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2025-03-26',
					capabilities: {},
					clientInfo: { name: 'test', version: '1' },
				},
			},
			mockCaller
		);

		assert.strictEqual(result.jsonrpc, '2.0');
		assert.strictEqual(result.id, 1);
		assert.ok(result.result.protocolVersion);
		assert.ok(result.result.serverInfo);
		assert.strictEqual(result.result.serverInfo.name, 'knowledge-base');
		assert.ok(result.result.capabilities.tools);
	});

	it('handles tools/list', async () => {
		const result = await handleJsonRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, mockCaller);

		assert.strictEqual(result.jsonrpc, '2.0');
		assert.strictEqual(result.id, 2);
		assert.ok(Array.isArray(result.result.tools));
		assert.strictEqual(result.result.tools.length, 10);

		for (const tool of result.result.tools) {
			assert.ok(tool.name, `tool missing name`);
			assert.ok(tool.description, `${tool.name} missing description`);
			assert.ok(tool.inputSchema, `${tool.name} missing inputSchema`);
			assert.strictEqual(tool.inputSchema.type, 'object', `${tool.name} schema type should be object`);
		}
	});

	it('handles tools/call for knowledge_search', async () => {
		await tables.KnowledgeEntry.put({
			id: 'proto-s1',
			kbId: TEST_KB,
			title: 'Protocol test entry',
			content: 'Testing the protocol handler',
			tags: ['protocol'],
			confidence: 'verified',
			deprecated: false,
		});

		const result = await handleJsonRpc(
			{
				jsonrpc: '2.0',
				id: 3,
				method: 'tools/call',
				params: {
					name: 'knowledge_search',
					arguments: { query: 'protocol' },
				},
			},
			mockCaller
		);

		assert.strictEqual(result.jsonrpc, '2.0');
		assert.strictEqual(result.id, 3);
		assert.ok(result.result);
		assert.ok(Array.isArray(result.result.content));
		assert.strictEqual(result.result.content[0].type, 'text');
		const data = JSON.parse(result.result.content[0].text);
		assert.ok(data.resultCount >= 0);
	});

	it('returns METHOD_NOT_FOUND for unknown method', async () => {
		const result = await handleJsonRpc({ jsonrpc: '2.0', id: 3, method: 'foo/bar' }, mockCaller);

		assert.strictEqual(result.jsonrpc, '2.0');
		assert.strictEqual(result.id, 3);
		assert.strictEqual(result.error.code, -32601);
		assert.ok(result.error.message.includes('foo/bar'));
	});

	it('returns INVALID_REQUEST for non-JSON-RPC body', async () => {
		const result = await handleJsonRpc({ not: 'jsonrpc' }, mockCaller);

		assert.strictEqual(result.error.code, -32600);
	});

	it('returns INVALID_REQUEST for null body', async () => {
		const result = await handleJsonRpc(null, mockCaller);

		assert.strictEqual(result.error.code, -32600);
	});

	it('returns null for notifications (no id)', async () => {
		const result = await handleJsonRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, mockCaller);

		assert.strictEqual(result, null);
	});

	it('returns METHOD_NOT_FOUND for unknown tool in tools/call', async () => {
		const result = await handleJsonRpc(
			{
				jsonrpc: '2.0',
				id: 4,
				method: 'tools/call',
				params: { name: 'nonexistent_tool', arguments: {} },
			},
			mockCaller
		);

		assert.strictEqual(result.error.code, -32601);
		assert.ok(result.error.message.includes('nonexistent_tool'));
	});

	it('preserves the request id in responses', async () => {
		const result = await handleJsonRpc(
			{ jsonrpc: '2.0', id: 'string-id-42', method: 'initialize', params: {} },
			mockCaller
		);

		assert.strictEqual(result.id, 'string-id-42');
	});

	it('tools/list includes expected tool names', async () => {
		const result = await handleJsonRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, mockCaller);

		const names = result.result.tools.map((t) => t.name);
		const expected = [
			'knowledge_search',
			'knowledge_add',
			'knowledge_get',
			'knowledge_related',
			'knowledge_list_tags',
			'knowledge_triage',
			'knowledge_update',
			'knowledge_history',
			'knowledge_reindex',
			'knowledge_link',
		];
		for (const name of expected) {
			assert.ok(names.includes(name), `Missing tool: ${name}`);
		}
	});
});
