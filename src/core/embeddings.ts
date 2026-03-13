/**
 * Embedding Model Management
 *
 * Generates vector embeddings for semantic search. Supports three backends:
 *
 *   1. harper-fabric-embeddings — Minimal native GGUF wrapper (~19 MB).
 *      Preferred on Fabric. Requires a pre-staged model file.
 *
 *   2. harper-fabric-onnx — ONNX Runtime backend.
 *      Alternative on Fabric; may be preferred depending on deployment.
 *
 *   3. node-llama-cpp — Full-featured wrapper (~250 MB+).
 *      Fallback for local dev. Downloads the model on first run.
 *
 * The backend is selected automatically by trying each in order,
 * or a specific backend can be requested via the `embeddingBackend` config option.
 */

import { writeFile, readFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

// ─── Backend abstraction ────────────────────────────────────────────────────

interface EmbeddingBackend {
	generateEmbedding(text: string): Promise<number[]>;
	dispose(): Promise<void>;
}

let backend: EmbeddingBackend | null = null;

// ─── Model configuration ───────────────────────────────────────────────────

const MODEL_CONFIGS: Record<string, { repo: string; file: string }> = {
	'nomic-embed-text': {
		repo: 'nomic-ai/nomic-embed-text-v1.5-GGUF',
		file: 'nomic-embed-text-v1.5.Q4_K_M.gguf',
	},
	'nomic-embed-text-v2-moe': {
		repo: 'nomic-ai/nomic-embed-text-v2-moe-GGUF',
		file: 'nomic-embed-text-v2-moe.Q4_K_M.gguf',
	},
};

// Module-level models directory, set during initEmbeddingModel
let modelsDir: string | null = null;

// ─── Public API ─────────────────────────────────────────────────────────────

type BackendId = 'gguf' | 'onnx' | 'llama-cpp';

interface BackendEntry {
	id: BackendId;
	label: string;
	init: (modelName: string) => Promise<EmbeddingBackend>;
}

const BACKENDS: BackendEntry[] = [
	{ id: 'gguf', label: 'harper-fabric-embeddings', init: initFabricBackend },
	{ id: 'onnx', label: 'harper-fabric-onnx', init: initFabricOnnxBackend },
	{ id: 'llama-cpp', label: 'node-llama-cpp', init: initNodeLlamaCppBackend },
];

/**
 * Initialize the embedding model.
 *
 * When `embeddingBackend` is set, that backend is used directly (no fallback).
 * Otherwise backends are tried in order: gguf → onnx → llama-cpp.
 */
export async function initEmbeddingModel(config: {
	embeddingModel: string;
	componentDir: string;
	embeddingBackend?: BackendId;
}): Promise<void> {
	if (backend) {
		logger?.debug?.('Embedding model already initialized');
		return;
	}

	const modelName = config.embeddingModel || 'nomic-embed-text';
	modelsDir = path.join(config.componentDir, 'models');

	// If a specific backend is requested, use it directly
	if (config.embeddingBackend) {
		const entry = BACKENDS.find((b) => b.id === config.embeddingBackend);
		if (!entry) {
			throw new Error(
				`Unknown embedding backend: "${config.embeddingBackend}". Supported: ${BACKENDS.map((b) => b.id).join(', ')}`
			);
		}
		backend = await entry.init(modelName);
		logger?.info?.(`Embedding model "${modelName}" loaded via ${entry.label}`);
		return;
	}

	// Auto-detect: try each backend in order
	for (const entry of BACKENDS) {
		try {
			backend = await entry.init(modelName);
			logger?.info?.(`Embedding model "${modelName}" loaded via ${entry.label}`);
			return;
		} catch (err) {
			logger?.debug?.(`${entry.label} not available:`, (err as Error).message);
		}
	}

	throw new Error('No embedding backend available. Install harper-fabric-embeddings, harper-fabric-onnx, or node-llama-cpp.');
}

/**
 * Generate an embedding vector for the given text.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
	if (!backend) {
		throw new Error('Embedding model not initialized. Call initEmbeddingModel() first.');
	}
	return backend.generateEmbedding(text);
}

/**
 * Clean up embedding model resources.
 */
export async function dispose(): Promise<void> {
	if (backend) {
		await backend.dispose();
		backend = null;
	}
	logger?.info?.('Embedding model disposed');
}

// ─── harper-fabric-embeddings backend ────────────────────────────────────────

async function initFabricBackend(modelName: string): Promise<EmbeddingBackend> {
	const fabricPkg = 'harper-fabric-embeddings';
	const fabricModule = (await import(fabricPkg)) as unknown as {
		init(options: {
			modelPath?: string;
			modelsDir?: string;
			modelName?: string;
			contextSize?: number;
			batchSize?: number;
			threads?: number;
			gpuLayers?: number;
		}): Promise<void>;
		embed(text: string): Promise<number[]>;
		dispose(): Promise<void>;
	};

	// Pass modelsDir so the fabric backend can find or download the model
	await fabricModule.init({ modelsDir: modelsDir!, modelName });

	return {
		generateEmbedding: (text) => fabricModule.embed(text),
		dispose: () => fabricModule.dispose(),
	};
}

// ─── harper-fabric-onnx backend ──────────────────────────────────────────────

async function initFabricOnnxBackend(modelName: string): Promise<EmbeddingBackend> {
	const onnxPkg = 'harper-fabric-onnx';
	const onnxModule = (await import(onnxPkg)) as unknown as {
		init(options: { modelPath?: string; modelsDir?: string; modelName?: string }): Promise<void>;
		embed(text: string): Promise<number[]>;
		dispose(): Promise<void>;
	};

	await onnxModule.init({ modelsDir: modelsDir!, modelName });

	return {
		generateEmbedding: (text) => onnxModule.embed(text),
		dispose: () => onnxModule.dispose(),
	};
}

// ─── node-llama-cpp backend ─────────────────────────────────────────────────

// Interfaces for node-llama-cpp types (avoid importing at module level —
// node-llama-cpp is heavy and includes native bindings)
interface LlamaInstance {
	loadModel(options: { modelPath: string }): Promise<LlamaModel>;
	dispose(): Promise<void>;
}

interface LlamaModel {
	createEmbeddingContext(options?: { contextSize?: 'auto' | number }): Promise<LlamaEmbeddingContext>;
	dispose(): Promise<void>;
}

interface LlamaEmbeddingContext {
	getEmbeddingFor(input: string): Promise<{ vector: readonly number[] }>;
	dispose(): Promise<void>;
	readonly disposed: boolean;
}

async function initNodeLlamaCppBackend(modelName: string): Promise<EmbeddingBackend> {
	const modelPath = await downloadModelIfNeeded(modelName);

	// @ts-expect-error — node-llama-cpp is an optional manual install, not a declared dependency
	const { getLlama } = (await import('node-llama-cpp')) as unknown as {
		getLlama: (options?: { progressLogs?: boolean; build?: 'never' | 'auto' }) => Promise<LlamaInstance>;
	};

	const llama = await getLlama({ progressLogs: false, build: 'never' });
	const model = await llama.loadModel({ modelPath });
	const ctx = await model.createEmbeddingContext({ contextSize: 'auto' });

	return {
		async generateEmbedding(text: string): Promise<number[]> {
			const result = await ctx.getEmbeddingFor(text);
			return Array.from(result.vector);
		},
		async dispose(): Promise<void> {
			if (ctx && !ctx.disposed) await ctx.dispose();
			await model.dispose();
			await llama.dispose();
		},
	};
}

// ─── Model download (node-llama-cpp only) ───────────────────────────────────

function getModelUri(modelName: string): string {
	const config = MODEL_CONFIGS[modelName];
	if (!config) {
		throw new Error(`Unknown embedding model: ${modelName}. Supported: ${Object.keys(MODEL_CONFIGS).join(', ')}`);
	}
	return `hf:${config.repo}/${config.file}`;
}

function getLockFilePath(modelName: string): string {
	return path.join(modelsDir!, `${modelName}.lock`);
}

async function acquireDownloadLock(modelName: string): Promise<boolean> {
	const lockPath = getLockFilePath(modelName);
	try {
		if (existsSync(lockPath)) {
			const lockContent = await readFile(lockPath, 'utf-8');
			const lockTime = parseInt(lockContent, 10);
			if (!isNaN(lockTime) && Date.now() - lockTime < 10 * 60 * 1000) {
				return false;
			}
		}
		await writeFile(lockPath, String(Date.now()), { flag: 'wx' }).catch(async () => {
			await writeFile(lockPath, String(Date.now()));
		});
		return true;
	} catch {
		return false;
	}
}

async function releaseDownloadLock(modelName: string): Promise<void> {
	const lockPath = getLockFilePath(modelName);
	try {
		await unlink(lockPath);
	} catch {
		// Already removed
	}
}

async function waitForDownload(modelName: string, modelPath: string): Promise<void> {
	const lockPath = getLockFilePath(modelName);
	const maxWait = 10 * 60 * 1000;
	const pollInterval = 2000;
	const start = Date.now();

	while (Date.now() - start < maxWait) {
		if (existsSync(modelPath) && !existsSync(lockPath)) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, pollInterval));
	}
	throw new Error(`Timed out waiting for model download: ${modelName}`);
}

async function downloadModelIfNeeded(modelName: string): Promise<string> {
	const modelUri = getModelUri(modelName);
	const dir = modelsDir!;

	await mkdir(dir, { recursive: true });

	const { createModelDownloader } =
		// @ts-expect-error — node-llama-cpp is an optional manual install, not a declared dependency
		(await import('node-llama-cpp')) as unknown as {
			createModelDownloader: (options: { modelUri: string; dirPath: string; skipExisting?: boolean }) => Promise<{
				entrypointFilePath: string;
				download: () => Promise<string>;
			}>;
		};

	const downloader = await createModelDownloader({
		modelUri,
		dirPath: dir,
		skipExisting: true,
	});

	const modelPath = downloader.entrypointFilePath;

	if (existsSync(modelPath)) {
		return modelPath;
	}

	const acquired = await acquireDownloadLock(modelName);

	if (!acquired) {
		logger?.info?.(`Another thread is downloading ${modelName}, waiting...`);
		await waitForDownload(modelName, modelPath);
		return modelPath;
	}

	try {
		logger?.info?.(`Downloading embedding model: ${modelName} from ${modelUri}`);
		const resultPath = await downloader.download();
		logger?.info?.(`Model ${modelName} downloaded successfully to ${resultPath}`);
		return resultPath;
	} finally {
		await releaseDownloadLock(modelName);
	}
}
