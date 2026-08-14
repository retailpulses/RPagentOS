import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deterministicallyRepairGenericProposal,
  repairIssuesFromErrors,
} from './generic-repair.js';

test('extracts only deterministic hard-safety issues', () => {
  assert.deepEqual(repairIssuesFromErrors([
    'Generated copy includes unsourced numeric fact: 17.5kg',
    'Generated copy includes hard fact without trusted-fact evidence: 工具不要',
    'Generated copy includes prohibited claim: 完全防水',
    'unsupported hard claim: 生産国：中国',
    'confidence must be a number between 0 and 1',
  ]).map((issue) => [issue.kind, issue.needle]), [
    ['numeric', '17.5kg'], ['hard_fact', '工具不要'],
    ['prohibited', '完全防水'], ['unsupported_audit', '生産国：中国'],
  ]);
});

test('removes unsafe title tokens and smallest description clauses while preserving benefits', () => {
  const issues = repairIssuesFromErrors([
    'Generated copy includes unsourced numeric fact: 17.5kg',
    'Generated copy includes hard fact without trusted-fact evidence: 工具不要',
    'unsupported hard claim: 生産国：中国',
  ]);
  const result = deterministicallyRepairGenericProposal({
    title: '電動ベッド 17.5kg 工具不要 安心 快適',
    description: '操作がスムーズで便利です。重量17.5kg、工具不要で設置できます。素材はスチール、生産国：中国です。',
    confidence: 0.9,
    rationale: 'Commercial rewrite',
  }, issues);
  assert.equal(result.proposal.title, '電動ベッド 安心 快適');
  assert.match(result.proposal.description!, /スムーズで便利/);
  assert.match(result.proposal.description!, /素材はスチール/);
  assert.doesNotMatch(result.proposal.description!, /17\.5kg|工具不要|生産国/);
  assert.deepEqual(result.unresolvedIssues, []);
});

test('does not remove generic soft benefits when no hard issue targets them', () => {
  const result = deterministicallyRepairGenericProposal({
    title: '軽量 大容量 便利な収納',
    description: '軽量で持ち運びがスムーズ。大容量で整理しやすく便利です。',
    confidence: 0.9,
    rationale: 'Benefits',
  }, []);
  assert.equal(result.changed, false);
  assert.match(result.proposal.description!, /軽量.*スムーズ/);
});
