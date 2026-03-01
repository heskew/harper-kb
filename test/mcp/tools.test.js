/**
 * Tests for MCP tool definitions.
 *
 * Verifies the static tool array structure and that handlers
 * produce correct output shapes when called directly.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import { tools } from '../../dist/mcp/tools.js';

const TEST_KB = 'test-kb';

const writeCaller = {
	userId: 'test-user',
	clientId: 'test-client',
	scopes: ['mcp:read', 'mcp:write'],
	kbId: TEST_KB,
};

const readOnlyCaller = {
	userId: 'test-user',
	clientId: 'test-client',
	scopes: ['mcp:read'],
	kbId: TEST_KB,
};

function findTool(name) {
	return tools.find((t) => t.name === name);
}

describe('MCP tool definitions', () => {
	it('exports exactly 10 tools', () => {
		assert.strictEqual(tools.length, 10);
	});

	it('each tool has name, description, inputSchema, handler', () => {
		for (const tool of tools) {
			assert.ok(tool.name, 'tool missing name');
			assert.ok(tool.description, `${tool.name} missing description`);
			assert.ok(tool.inputSchema, `${tool.name} missing inputSchema`);
			assert.strictEqual(typeof tool.handler, 'function', `${tool.name} handler is not a function`);
		}
	});

	it("all inputSchema objects have type: 'object'", () => {
		for (const tool of tools) {
			assert.strictEqual(tool.inputSchema.type, 'object', `${tool.name} schema is not type object`);
		}
	});

	it('tools have expected names', () => {
		const names = tools.map((t) => t.name);
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

	it('tools with required fields have valid required arrays', () => {
		for (const tool of tools) {
			if (tool.inputSchema.required) {
				assert.ok(Array.isArray(tool.inputSchema.required), `${tool.name} required should be an array`);
				for (const field of tool.inputSchema.required) {
					assert.ok(tool.inputSchema.properties[field], `${tool.name} required field '${field}' not in properties`);
				}
			}
		}
	});
});

describe('MCP tool handlers', () => {
	beforeEach(() => clearAllTables());

	it('knowledge_search returns results', async () => {
		await tables.KnowledgeEntry.put({
			id: 'mcp-s1',
			kbId: TEST_KB,
			title: 'MCP search test',
			content: 'Content for search',
			tags: ['mcp'],
			confidence: 'verified',
			deprecated: false,
		});

		const tool = findTool('knowledge_search');
		const result = await tool.handler({ query: 'MCP' }, writeCaller);

		assert.ok(result.content);
		assert.strictEqual(result.content[0].type, 'text');
		const data = JSON.parse(result.content[0].text);
		assert.ok(data.resultCount >= 0);
		assert.ok(Array.isArray(data.results));
	});

	it('knowledge_add requires write scope', async () => {
		const tool = findTool('knowledge_add');
		const result = await tool.handler({ title: 'Test', content: 'Test content', tags: ['test'] }, readOnlyCaller);

		assert.strictEqual(result.isError, true);
		assert.ok(result.content[0].text.includes('Write access required'));
	});

	it('knowledge_add creates entry with write scope', async () => {
		const tool = findTool('knowledge_add');
		const result = await tool.handler(
			{ title: 'MCP added entry', content: 'Added via MCP', tags: ['mcp'] },
			writeCaller
		);

		assert.ok(!result.isError);
		const data = JSON.parse(result.content[0].text);
		assert.ok(data.entry.id);
		assert.strictEqual(data.entry.title, 'MCP added entry');
		assert.strictEqual(data.entry.confidence, 'ai-generated');
	});

	it('knowledge_get returns entry by ID', async () => {
		await tables.KnowledgeEntry.put({
			id: 'mcp-g1',
			kbId: TEST_KB,
			title: 'Get test',
			content: 'Content',
			tags: ['test'],
		});

		const tool = findTool('knowledge_get');
		const result = await tool.handler({ id: 'mcp-g1' }, writeCaller);

		assert.ok(!result.isError);
		const data = JSON.parse(result.content[0].text);
		assert.strictEqual(data.entry.id, 'mcp-g1');
		assert.strictEqual(data.entry.title, 'Get test');
	});

	it('knowledge_get returns error for missing entry', async () => {
		const tool = findTool('knowledge_get');
		const result = await tool.handler({ id: 'nonexistent' }, writeCaller);

		assert.strictEqual(result.isError, true);
		assert.ok(result.content[0].text.includes('not found'));
	});

	it('knowledge_get returns error for wrong kbId', async () => {
		await tables.KnowledgeEntry.put({
			id: 'mcp-g2',
			kbId: 'other-kb',
			title: 'Other KB entry',
			content: 'Content',
			tags: [],
		});

		const tool = findTool('knowledge_get');
		const result = await tool.handler({ id: 'mcp-g2' }, writeCaller);

		assert.strictEqual(result.isError, true);
		assert.ok(result.content[0].text.includes('not found'));
	});

	it('knowledge_list_tags returns tags', async () => {
		await tables.KnowledgeTag.put({
			id: `${TEST_KB}:mcp-tag`,
			kbId: TEST_KB,
			entryCount: 1,
		});

		const tool = findTool('knowledge_list_tags');
		const result = await tool.handler({}, writeCaller);

		assert.ok(!result.isError);
		const data = JSON.parse(result.content[0].text);
		assert.ok(data.tagCount >= 1);
		assert.ok(Array.isArray(data.tags));
	});

	it('knowledge_triage requires write scope', async () => {
		const tool = findTool('knowledge_triage');
		const result = await tool.handler({ source: 'test', summary: 'Test triage' }, readOnlyCaller);

		assert.strictEqual(result.isError, true);
		assert.ok(result.content[0].text.includes('Write access required'));
	});

	it('knowledge_triage submits item with write scope', async () => {
		const tool = findTool('knowledge_triage');
		const result = await tool.handler({ source: 'claude-code', summary: 'Test triage' }, writeCaller);

		assert.ok(!result.isError);
		const data = JSON.parse(result.content[0].text);
		assert.ok(data.item.id);
		assert.strictEqual(data.item.source, 'claude-code');
	});

	it('knowledge_update requires write scope', async () => {
		const tool = findTool('knowledge_update');
		const result = await tool.handler({ id: 'test-id', title: 'Updated' }, readOnlyCaller);

		assert.strictEqual(result.isError, true);
	});

	it('knowledge_update updates existing entry', async () => {
		await tables.KnowledgeEntry.put({
			id: 'mcp-u1',
			kbId: TEST_KB,
			title: 'Original',
			content: 'Content',
			tags: ['test'],
		});

		const tool = findTool('knowledge_update');
		const result = await tool.handler({ id: 'mcp-u1', title: 'Updated title' }, writeCaller);

		assert.ok(!result.isError);
		const data = JSON.parse(result.content[0].text);
		assert.strictEqual(data.entry.title, 'Updated title');
	});

	it('knowledge_reindex requires write scope', async () => {
		const tool = findTool('knowledge_reindex');
		const result = await tool.handler({}, readOnlyCaller);

		assert.strictEqual(result.isError, true);
	});

	it('knowledge_link requires write scope', async () => {
		const tool = findTool('knowledge_link');
		const result = await tool.handler({ type: 'sibling', ids: ['a', 'b'] }, readOnlyCaller);

		assert.strictEqual(result.isError, true);
	});

	it('knowledge_link validates entry existence', async () => {
		const tool = findTool('knowledge_link');
		const result = await tool.handler({ type: 'sibling', ids: ['nonexistent1', 'nonexistent2'] }, writeCaller);

		assert.strictEqual(result.isError, true);
		assert.ok(result.content[0].text.includes('not found'));
	});

	it('knowledge_history returns edit history', async () => {
		await tables.KnowledgeEntry.put({
			id: 'mcp-h1',
			kbId: TEST_KB,
			title: 'History test',
			content: 'Content',
			tags: [],
		});

		const tool = findTool('knowledge_history');
		const result = await tool.handler({ id: 'mcp-h1' }, writeCaller);

		assert.ok(!result.isError);
		const data = JSON.parse(result.content[0].text);
		assert.strictEqual(data.entryId, 'mcp-h1');
		assert.ok(Array.isArray(data.edits));
	});
});
