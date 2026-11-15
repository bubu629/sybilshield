// tests/analyzer.test.ts
import { describe, it, expect } from 'vitest';
import { analyzeSybilGraph, SAMPLE_WALLET_GRAPH } from '../src/analyzer.js';

describe('SybilShield Local Cluster Engine', () => {
  it('flags shared funder clusters, shared CEX deposit collisions, and generates deterministic jitter plans', () => {
    const res = analyzeSybilGraph(SAMPLE_WALLET_GRAPH);
    expect(res.summary.total_wallets).toBe(4);
    expect(res.summary.critical_sybils).toBeGreaterThanOrEqual(2);
    expect(res.summary.c_deposit_collisions).toBe(2);
    expect(res.isolation_plan.length).toBe(4);
  });
});
