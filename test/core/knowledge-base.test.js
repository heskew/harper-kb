/**
 * Tests for core/knowledge-base — CRUD operations for KB registry.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';
import { clearAllTables } from '../helpers/setup.js';

import {
	createKnowledgeBase,
	getKnowledgeBase,
	updateKnowledgeBase,
	deleteKnowledgeBase,
	listKnowledgeBases,
} from '../../dist/core/knowledge-base.js';

describe('createKnowledgeBase', () => {
	beforeEach(() => clearAllTables());

	it('creates a KB with id and name', async () => {
		const kb = await createKnowledgeBase({ id: 'acme', name: 'Acme KB' });

		assert.strictEqual(kb.id, 'acme');
		assert.strictEqual(kb.name, 'Acme KB');
	});

	it('stores the KB in the table', async () => {
		await createKnowledgeBase({ id: 'stored-kb', name: 'Stored' });

		const stored = await tables.KnowledgeBase.get('stored-kb');
		assert.ok(stored);
		assert.strictEqual(stored.name, 'Stored');
	});

	it('stores optional fields', async () => {
		const kb = await createKnowledgeBase({
			id: 'full-kb',
			name: 'Full KB',
			description: 'A complete KB',
			settings: { embeddingModel: 'custom-model' },
			createdBy: 'admin',
		});

		assert.strictEqual(kb.description, 'A complete KB');
		assert.deepStrictEqual(kb.settings, { embeddingModel: 'custom-model' });
		assert.strictEqual(kb.createdBy, 'admin');
	});

	it('throws if KB already exists', async () => {
		await createKnowledgeBase({ id: 'dupe', name: 'First' });

		await assert.rejects(() => createKnowledgeBase({ id: 'dupe', name: 'Second' }), {
			message: 'Knowledge base already exists: dupe',
		});
	});
});

describe('getKnowledgeBase', () => {
	beforeEach(() => clearAllTables());

	it('returns a KB by id', async () => {
		await createKnowledgeBase({ id: 'get-test', name: 'Get Test' });

		const kb = await getKnowledgeBase('get-test');

		assert.ok(kb);
		assert.strictEqual(kb.id, 'get-test');
		assert.strictEqual(kb.name, 'Get Test');
	});

	it('returns null for non-existent KB', async () => {
		const kb = await getKnowledgeBase('missing');

		assert.strictEqual(kb, null);
	});
});

describe('updateKnowledgeBase', () => {
	beforeEach(() => clearAllTables());

	it('updates name', async () => {
		await createKnowledgeBase({ id: 'upd', name: 'Old Name' });

		const updated = await updateKnowledgeBase('upd', { name: 'New Name' });

		assert.strictEqual(updated.name, 'New Name');
	});

	it('updates description and settings', async () => {
		await createKnowledgeBase({ id: 'upd2', name: 'KB' });

		const updated = await updateKnowledgeBase('upd2', {
			description: 'Updated desc',
			settings: { searchDefault: 'hybrid' },
		});

		assert.strictEqual(updated.description, 'Updated desc');
		assert.deepStrictEqual(updated.settings, { searchDefault: 'hybrid' });
	});

	it('throws for non-existent KB', async () => {
		await assert.rejects(() => updateKnowledgeBase('missing', { name: 'Nope' }), {
			message: 'Knowledge base not found: missing',
		});
	});

	it('preserves fields not in the update', async () => {
		await createKnowledgeBase({
			id: 'partial',
			name: 'Original',
			description: 'Keep this',
		});

		const updated = await updateKnowledgeBase('partial', { name: 'Changed' });

		assert.strictEqual(updated.name, 'Changed');
		assert.strictEqual(updated.description, 'Keep this');
	});
});

describe('deleteKnowledgeBase', () => {
	beforeEach(() => clearAllTables());

	it('deletes an existing KB', async () => {
		await createKnowledgeBase({ id: 'del-kb', name: 'To Delete' });

		await deleteKnowledgeBase('del-kb');

		const stored = await tables.KnowledgeBase.get('del-kb');
		assert.strictEqual(stored, null);
	});

	it('throws for non-existent KB', async () => {
		await assert.rejects(() => deleteKnowledgeBase('missing'), {
			message: 'Knowledge base not found: missing',
		});
	});
});

describe('listKnowledgeBases', () => {
	beforeEach(() => clearAllTables());

	it('returns all KBs', async () => {
		await createKnowledgeBase({ id: 'kb-a', name: 'KB A' });
		await createKnowledgeBase({ id: 'kb-b', name: 'KB B' });

		const kbs = await listKnowledgeBases();

		assert.strictEqual(kbs.length, 2);
		const ids = kbs.map((kb) => kb.id).sort();
		assert.deepStrictEqual(ids, ['kb-a', 'kb-b']);
	});

	it('returns empty array when no KBs exist', async () => {
		const kbs = await listKnowledgeBases();

		assert.deepStrictEqual(kbs, []);
	});
});
