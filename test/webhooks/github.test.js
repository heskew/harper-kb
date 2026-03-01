/**
 * Tests for webhooks/github — signature validation and payload parsing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';

import { validateSignature, parsePayload } from '../../dist/webhooks/github.js';

/**
 * Create a valid HMAC-SHA256 signature for testing.
 */
function sign(body, secret) {
	return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

// ==========================================================================
// Signature Validation
// ==========================================================================

describe('validateSignature', () => {
	const secret = 'test-webhook-secret';
	const body = '{"action":"opened"}';

	it('returns true for a valid signature', () => {
		const sig = sign(body, secret);
		assert.strictEqual(validateSignature(body, sig, secret), true);
	});

	it('returns false for an invalid signature', () => {
		assert.strictEqual(validateSignature(body, 'sha256=badhex', secret), false);
	});

	it('returns false for a wrong secret', () => {
		const sig = sign(body, 'wrong-secret');
		assert.strictEqual(validateSignature(body, sig, secret), false);
	});

	it('returns false when signature is empty', () => {
		assert.strictEqual(validateSignature(body, '', secret), false);
	});

	it('returns false when secret is empty', () => {
		assert.strictEqual(validateSignature(body, sign(body, secret), ''), false);
	});

	it('returns false for mismatched length signatures', () => {
		assert.strictEqual(validateSignature(body, 'sha256=short', secret), false);
	});
});

// ==========================================================================
// Issue Events
// ==========================================================================

describe('parsePayload — issues', () => {
	const basePayload = {
		repository: { full_name: 'owner/repo' },
		issue: {
			number: 42,
			title: 'Bug in config',
			body: 'Steps to reproduce...',
			user: { login: 'testuser' },
			labels: [{ name: 'bug' }, { name: 'config' }],
		},
	};

	it('handles issues opened', () => {
		const result = parsePayload('issues', { ...basePayload, action: 'opened' });

		assert.ok(result);
		assert.strictEqual(result.source, 'github-webhook');
		assert.strictEqual(result.sourceId, 'github:issues:opened:owner/repo#42');
		assert.ok(result.summary.includes('[GitHub Issue]'));
		assert.ok(result.summary.includes('owner/repo#42'));
		assert.ok(result.summary.includes('Bug in config'));
		assert.ok(result.summary.includes('opened by testuser'));
		assert.ok(result.summary.includes('Labels: bug, config'));
		assert.ok(result.summary.includes('Steps to reproduce...'));
	});

	it('handles issues closed', () => {
		const result = parsePayload('issues', { ...basePayload, action: 'closed' });

		assert.ok(result);
		assert.strictEqual(result.sourceId, 'github:issues:closed:owner/repo#42');
		assert.ok(result.summary.includes('closed by testuser'));
	});

	it('handles issues reopened', () => {
		const result = parsePayload('issues', {
			...basePayload,
			action: 'reopened',
		});

		assert.ok(result);
		assert.strictEqual(result.sourceId, 'github:issues:reopened:owner/repo#42');
	});

	it('handles labeled with kb-candidate label', () => {
		const result = parsePayload('issues', {
			...basePayload,
			action: 'labeled',
			label: { name: 'kb-candidate' },
		});

		assert.ok(result);
		assert.strictEqual(result.sourceId, 'github:issues:labeled:owner/repo#42');
	});

	it('ignores labeled with other labels', () => {
		const result = parsePayload('issues', {
			...basePayload,
			action: 'labeled',
			label: { name: 'enhancement' },
		});

		assert.strictEqual(result, null);
	});

	it('ignores unsupported issue actions', () => {
		const result = parsePayload('issues', { ...basePayload, action: 'edited' });
		assert.strictEqual(result, null);
	});

	it('truncates long bodies', () => {
		const longBody = 'A'.repeat(1000);
		const payload = {
			...basePayload,
			issue: { ...basePayload.issue, body: longBody },
			action: 'opened',
		};

		const result = parsePayload('issues', payload);
		assert.ok(result);
		assert.ok(result.summary.length < longBody.length + 200);
		assert.ok(result.summary.includes('...'));
	});
});

// ==========================================================================
// Issue Comment Events
// ==========================================================================

describe('parsePayload — issue_comment', () => {
	it('handles comment created', () => {
		const result = parsePayload('issue_comment', {
			action: 'created',
			repository: { full_name: 'owner/repo' },
			issue: { number: 10, title: 'Feature request' },
			comment: {
				id: 12345,
				body: 'I agree with this.',
				user: { login: 'commenter' },
			},
		});

		assert.ok(result);
		assert.strictEqual(result.source, 'github-webhook');
		assert.strictEqual(result.sourceId, 'github:issue_comment:12345');
		assert.ok(result.summary.includes('[GitHub Comment]'));
		assert.ok(result.summary.includes('comment by commenter'));
	});

	it('ignores non-created actions', () => {
		const result = parsePayload('issue_comment', {
			action: 'edited',
			repository: { full_name: 'owner/repo' },
			issue: { number: 10, title: 'Feature request' },
			comment: { id: 12345, body: 'Edited.', user: { login: 'commenter' } },
		});

		assert.strictEqual(result, null);
	});
});

// ==========================================================================
// Discussion Events
// ==========================================================================

describe('parsePayload — discussion', () => {
	it('handles discussion created', () => {
		const result = parsePayload('discussion', {
			action: 'created',
			repository: { full_name: 'owner/repo' },
			discussion: {
				number: 5,
				title: 'How to deploy?',
				body: 'I need help deploying.',
				user: { login: 'asker' },
				category: { name: 'Q&A' },
			},
		});

		assert.ok(result);
		assert.strictEqual(result.sourceId, 'github:discussion:created:owner/repo#5');
		assert.ok(result.summary.includes('[GitHub Discussion]'));
		assert.ok(result.summary.includes('Category: Q&A'));
	});

	it('handles discussion answered', () => {
		const result = parsePayload('discussion', {
			action: 'answered',
			repository: { full_name: 'owner/repo' },
			discussion: {
				number: 5,
				title: 'How to deploy?',
				body: 'Answered content.',
				user: { login: 'asker' },
				category: { name: 'Q&A' },
			},
		});

		assert.ok(result);
		assert.strictEqual(result.sourceId, 'github:discussion:answered:owner/repo#5');
	});

	it('ignores other discussion actions', () => {
		const result = parsePayload('discussion', {
			action: 'edited',
			repository: { full_name: 'owner/repo' },
			discussion: { number: 5, title: 'T', body: 'B', user: { login: 'u' } },
		});

		assert.strictEqual(result, null);
	});
});

// ==========================================================================
// Discussion Comment Events
// ==========================================================================

describe('parsePayload — discussion_comment', () => {
	it('handles discussion comment created', () => {
		const result = parsePayload('discussion_comment', {
			action: 'created',
			repository: { full_name: 'owner/repo' },
			discussion: { number: 5, title: 'How to deploy?' },
			comment: {
				id: 99999,
				body: 'Try this approach.',
				user: { login: 'helper' },
			},
		});

		assert.ok(result);
		assert.strictEqual(result.sourceId, 'github:discussion_comment:99999');
		assert.ok(result.summary.includes('[GitHub Discussion Comment]'));
		assert.ok(result.summary.includes('comment by helper'));
	});

	it('ignores non-created discussion comment actions', () => {
		const result = parsePayload('discussion_comment', {
			action: 'deleted',
			repository: { full_name: 'owner/repo' },
			discussion: { number: 5, title: 'How to deploy?' },
			comment: { id: 99999, body: 'Deleted.', user: { login: 'helper' } },
		});

		assert.strictEqual(result, null);
	});
});

// ==========================================================================
// Unsupported Events
// ==========================================================================

describe('parsePayload — unsupported events', () => {
	it('returns null for push events', () => {
		assert.strictEqual(parsePayload('push', { ref: 'refs/heads/main' }), null);
	});

	it('returns null for pull_request events', () => {
		assert.strictEqual(parsePayload('pull_request', { action: 'opened' }), null);
	});

	it('returns null for unknown events', () => {
		assert.strictEqual(parsePayload('ping', {}), null);
	});
});
