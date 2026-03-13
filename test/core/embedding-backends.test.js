/**
 * Tests for embedding backend fallback chain and explicit backend selection.
 *
 * Uses --experimental-test-module-mocks to intercept dynamic imports
 * and verify the init order: gguf → onnx → llama-cpp.
 */
import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert';

// Set up globals before importing the module under test
globalThis.logger = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
};

describe('initEmbeddingModel — backend fallback', () => {
	afterEach(async () => {
		const { dispose } = await import('../../dist/core/embeddings.js');
		await dispose();
		mock.restoreAll();
	});

	it('uses harper-fabric-embeddings when available', async () => {
		let fabricInitCalled = false;

		mock.module('harper-fabric-embeddings', {
			namedExports: {
				init: async () => {
					fabricInitCalled = true;
				},
				embed: async () => [1, 2, 3],
				dispose: async () => {},
			},
		});

		mock.module('harper-fabric-onnx', {
			namedExports: {
				init: async () => {
					throw new Error('should not be called');
				},
			},
		});

		const { initEmbeddingModel, generateEmbedding } = await import('../../dist/core/embeddings.js');
		await initEmbeddingModel({ embeddingModel: 'nomic-embed-text', componentDir: '/tmp/test' });

		assert.ok(fabricInitCalled, 'Should have called fabric-embeddings init');

		const result = await generateEmbedding('test');
		assert.deepStrictEqual(result, [1, 2, 3]);
	});

	it('falls back to harper-fabric-onnx when fabric-embeddings is unavailable', async () => {
		let onnxInitCalled = false;

		mock.module('harper-fabric-embeddings', {
			namedExports: {
				init: async () => {
					throw new Error('not available');
				},
				embed: async () => [],
				dispose: async () => {},
			},
		});

		mock.module('harper-fabric-onnx', {
			namedExports: {
				init: async () => {
					onnxInitCalled = true;
				},
				embed: async () => [4, 5, 6],
				dispose: async () => {},
			},
		});

		const { initEmbeddingModel, generateEmbedding } = await import('../../dist/core/embeddings.js');
		await initEmbeddingModel({ embeddingModel: 'nomic-embed-text', componentDir: '/tmp/test' });

		assert.ok(onnxInitCalled, 'Should have called fabric-onnx init');

		const result = await generateEmbedding('test');
		assert.deepStrictEqual(result, [4, 5, 6]);
	});

	it('throws when no backends are available', async () => {
		mock.module('harper-fabric-embeddings', {
			namedExports: {
				init: async () => {
					throw new Error('not available');
				},
				embed: async () => [],
				dispose: async () => {},
			},
		});

		mock.module('harper-fabric-onnx', {
			namedExports: {
				init: async () => {
					throw new Error('not available');
				},
				embed: async () => [],
				dispose: async () => {},
			},
		});

		const { initEmbeddingModel } = await import('../../dist/core/embeddings.js');

		await assert.rejects(
			() => initEmbeddingModel({ embeddingModel: 'nomic-embed-text', componentDir: '/tmp/test' }),
			{ message: /No embedding backend available/ }
		);
	});
});

describe('initEmbeddingModel — explicit backend selection', () => {
	afterEach(async () => {
		const { dispose } = await import('../../dist/core/embeddings.js');
		await dispose();
		mock.restoreAll();
	});

	it('selects onnx backend directly when embeddingBackend is "onnx"', async () => {
		let fabricInitCalled = false;
		let onnxInitCalled = false;

		mock.module('harper-fabric-embeddings', {
			namedExports: {
				init: async () => {
					fabricInitCalled = true;
				},
				embed: async () => [1, 2, 3],
				dispose: async () => {},
			},
		});

		mock.module('harper-fabric-onnx', {
			namedExports: {
				init: async () => {
					onnxInitCalled = true;
				},
				embed: async () => [7, 8, 9],
				dispose: async () => {},
			},
		});

		const { initEmbeddingModel, generateEmbedding } = await import('../../dist/core/embeddings.js');
		await initEmbeddingModel({
			embeddingModel: 'nomic-embed-text',
			componentDir: '/tmp/test',
			embeddingBackend: 'onnx',
		});

		assert.ok(!fabricInitCalled, 'Should NOT have called fabric-embeddings init');
		assert.ok(onnxInitCalled, 'Should have called fabric-onnx init');

		const result = await generateEmbedding('test');
		assert.deepStrictEqual(result, [7, 8, 9]);
	});

	it('selects gguf backend directly when embeddingBackend is "gguf"', async () => {
		let fabricInitCalled = false;

		mock.module('harper-fabric-embeddings', {
			namedExports: {
				init: async () => {
					fabricInitCalled = true;
				},
				embed: async () => [1, 2, 3],
				dispose: async () => {},
			},
		});

		mock.module('harper-fabric-onnx', {
			namedExports: {
				init: async () => {
					throw new Error('should not be called');
				},
			},
		});

		const { initEmbeddingModel } = await import('../../dist/core/embeddings.js');
		await initEmbeddingModel({
			embeddingModel: 'nomic-embed-text',
			componentDir: '/tmp/test',
			embeddingBackend: 'gguf',
		});

		assert.ok(fabricInitCalled, 'Should have called fabric-embeddings init');
	});

	it('throws for unknown backend name', async () => {
		const { initEmbeddingModel } = await import('../../dist/core/embeddings.js');

		await assert.rejects(
			() =>
				initEmbeddingModel({
					embeddingModel: 'nomic-embed-text',
					componentDir: '/tmp/test',
					embeddingBackend: 'invalid',
				}),
			{ message: /Unknown embedding backend/ }
		);
	});

	it('does not fall back when explicit backend fails', async () => {
		let fabricInitCalled = false;

		mock.module('harper-fabric-embeddings', {
			namedExports: {
				init: async () => {
					fabricInitCalled = true;
				},
				embed: async () => [1, 2, 3],
				dispose: async () => {},
			},
		});

		mock.module('harper-fabric-onnx', {
			namedExports: {
				init: async () => {
					throw new Error('onnx init failed');
				},
				embed: async () => [],
				dispose: async () => {},
			},
		});

		const { initEmbeddingModel } = await import('../../dist/core/embeddings.js');

		await assert.rejects(
			() =>
				initEmbeddingModel({
					embeddingModel: 'nomic-embed-text',
					componentDir: '/tmp/test',
					embeddingBackend: 'onnx',
				}),
			{ message: /onnx init failed/ }
		);

		assert.ok(!fabricInitCalled, 'Should NOT fall back to fabric-embeddings');
	});
});
