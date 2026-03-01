/**
 * Tests for http-utils — shared HTTP utilities.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import './helpers/setup.js';

import { readBody, buildHeaders, getBaseUrl, parseFormBody, getHeader } from '../dist/http-utils.js';

describe('readBody', () => {
	it('returns empty string when body is null', async () => {
		const result = await readBody({ body: null });
		assert.strictEqual(result, '');
	});

	it('returns empty string when body is undefined', async () => {
		const result = await readBody({});
		assert.strictEqual(result, '');
	});

	it('returns the string when body is already a string', async () => {
		const result = await readBody({ body: 'hello world' });
		assert.strictEqual(result, 'hello world');
	});

	it('reads a stream body with .on()', async () => {
		const stream = new EventEmitter();
		const promise = readBody({ body: stream });

		// Emit data in next tick to simulate async stream
		process.nextTick(() => {
			stream.emit('data', Buffer.from('hello '));
			stream.emit('data', Buffer.from('world'));
			stream.emit('end');
		});

		const result = await promise;
		assert.strictEqual(result, 'hello world');
	});

	it('rejects when stream body exceeds max size', async () => {
		const stream = new EventEmitter();
		stream.destroy = () => {};
		const promise = readBody({ body: stream });

		// Emit a chunk larger than 1MB
		process.nextTick(() => {
			stream.emit('data', Buffer.alloc(1_048_577));
		});

		await assert.rejects(promise, { message: 'Request body too large' });
	});

	it('rejects on stream error', async () => {
		const stream = new EventEmitter();
		const promise = readBody({ body: stream });

		process.nextTick(() => {
			stream.emit('error', new Error('stream broke'));
		});

		await assert.rejects(promise, { message: 'stream broke' });
	});

	it('stringifies an object body', async () => {
		const result = await readBody({ body: { key: 'value' } });
		assert.strictEqual(result, '{"key":"value"}');
	});

	it('converts other types to string', async () => {
		const result = await readBody({ body: 42 });
		assert.strictEqual(result, '42');
	});
});

describe('buildHeaders', () => {
	it('builds from iterable headers (Harper Headers class)', () => {
		const src = {
			[Symbol.iterator]: function* () {
				yield ['content-type', 'application/json'];
				yield ['authorization', 'Bearer abc'];
			},
		};
		const headers = buildHeaders({ headers: src });
		assert.strictEqual(headers.get('content-type'), 'application/json');
		assert.strictEqual(headers.get('authorization'), 'Bearer abc');
	});

	it('builds from plain object headers', () => {
		const headers = buildHeaders({
			headers: { 'content-type': 'text/html', 'x-custom': 'yes' },
		});
		assert.strictEqual(headers.get('content-type'), 'text/html');
		assert.strictEqual(headers.get('x-custom'), 'yes');
	});

	it('joins array header values', () => {
		const headers = buildHeaders({
			headers: { accept: ['text/html', 'application/json'] },
		});
		assert.strictEqual(headers.get('accept'), 'text/html, application/json');
	});

	it('returns empty Headers when no headers provided', () => {
		const headers = buildHeaders({});
		assert.strictEqual([...headers].length, 0);
	});

	it('skips undefined values', () => {
		const headers = buildHeaders({
			headers: { 'x-present': 'yes', 'x-missing': undefined },
		});
		assert.strictEqual(headers.get('x-present'), 'yes');
		assert.strictEqual(headers.get('x-missing'), null);
	});
});

describe('getBaseUrl', () => {
	it('constructs URL from protocol and host', () => {
		const result = getBaseUrl({ protocol: 'https', host: 'kb.harper.fast' });
		assert.strictEqual(result, 'https://kb.harper.fast');
	});

	it('defaults to http://localhost:9926', () => {
		const result = getBaseUrl({});
		assert.strictEqual(result, 'http://localhost:9926');
	});
});

describe('parseFormBody', () => {
	it('parses key=value pairs', () => {
		const result = parseFormBody('name=test&value=42');
		assert.deepStrictEqual(result, { name: 'test', value: '42' });
	});

	it('handles URL-encoded values', () => {
		const result = parseFormBody('redirect_uri=http%3A%2F%2Flocalhost%3A3000');
		assert.strictEqual(result.redirect_uri, 'http://localhost:3000');
	});

	it('returns empty object for empty string', () => {
		const result = parseFormBody('');
		assert.deepStrictEqual(result, {});
	});
});

describe('getHeader', () => {
	it('reads via .get() method', () => {
		const request = {
			headers: {
				get: (name) => (name === 'authorization' ? 'Bearer xyz' : null),
			},
		};
		assert.strictEqual(getHeader(request, 'authorization'), 'Bearer xyz');
	});

	it('reads via direct property access', () => {
		const request = { headers: { authorization: 'Bearer abc' } };
		assert.strictEqual(getHeader(request, 'authorization'), 'Bearer abc');
	});

	it('reads via case-insensitive iterator', () => {
		const request = {
			headers: {
				get: () => null,
				[Symbol.iterator]: function* () {
					yield ['Authorization', 'Bearer iter'];
				},
			},
		};
		assert.strictEqual(getHeader(request, 'authorization'), 'Bearer iter');
	});

	it('returns empty string when header is missing', () => {
		const request = { headers: { get: () => null } };
		assert.strictEqual(getHeader(request, 'x-missing'), '');
	});

	it('returns empty string when headers is null', () => {
		assert.strictEqual(getHeader({}, 'anything'), '');
	});

	it('returns first element of array header value', () => {
		const request = {
			headers: { 'x-multi': ['first', 'second'] },
		};
		assert.strictEqual(getHeader(request, 'x-multi'), 'first');
	});
});
