/**
 * Tests for embedding model management.
 *
 * The actual model initialization requires native binaries and model files,
 * so these tests focus on the public API contract and error paths.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import '../helpers/setup.js';

import { generateEmbedding, dispose } from '../../dist/core/embeddings.js';

describe('generateEmbedding', () => {
	it('throws when model is not initialized', async () => {
		// dispose first to ensure clean state (in case another test initialized it)
		await dispose();
		await assert.rejects(() => generateEmbedding('test text'), { message: /not initialized/ });
	});
});

describe('dispose', () => {
	it('runs without error when no model is loaded', async () => {
		// Should not throw even if called multiple times
		await dispose();
		await dispose();
	});
});
