// src/analyzer.ts
import crypto from 'node:crypto';

export interface WalletTransferEdge {
  from_wallet: string;
  to_wallet: string;
  funder_source: string;
  cex_deposit_address: string;
  tx_timestamp_sec: number;
  amount_eth: number;
  gas_gwei: number;
}

export interface WalletRiskReport {
  wallet: string;
  risk_score: number; // 0 to 100
  risk_level: 'SAFE' | 'WARNING' | 'CRITICAL_SYBIL';
  shared_funder_cluster: string;
  shared_cex_deposit_collision: boolean;
  temporal_burst_flag: boolean;
  identical_amount_flag: boolean;
  reasons: string[];
}

export interface IsolationRoutingStep {
  step_order: number;
  target_wallet: string;
  recommended_cex_subaccount: string;
  jittered_amount_eth: string;
  delay_minutes_after_prev: number;
  recommended_window_utc: string;
}

export const SAMPLE_WALLET_GRAPH: WalletTransferEdge[] = [
  { from_wallet: '0xFunderA', to_wallet: '0xWallet001', funder_source: '0xFunderA', cex_deposit_address: '0xBinanceDep_Shared99', tx_timestamp_sec: 1760000100, amount_eth: 0.0500, gas_gwei: 12 },
  { from_wallet: '0xFunderA', to_wallet: '0xWallet002', funder_source: '0xFunderA', cex_deposit_address: '0xBinanceDep_Shared99', tx_timestamp_sec: 1760000140, amount_eth: 0.0500, gas_gwei: 12 },
  { from_wallet: '0xFunderB', to_wallet: '0xWallet003', funder_source: '0xFunderB', cex_deposit_address: '0xOKXDep_Unique03', tx_timestamp_sec: 1760089000, amount_eth: 0.0734, gas_gwei: 15 },
  { from_wallet: '0xFunderA', to_wallet: '0xWallet004', funder_source: '0xFunderA', cex_deposit_address: '0xOKXDep_Unique04', tx_timestamp_sec: 1760000190, amount_eth: 0.0500, gas_gwei: 12 }
];

export function analyzeSybilGraph(edges: WalletTransferEdge[]): {
  summary: { total_wallets: number; critical_sybils: number; c_deposit_collisions: number };
  reports: WalletRiskReport[];
  isolation_plan: IsolationRoutingStep[];
} {
  const funderCounts = new Map<string, string[]>();
  const cexCounts = new Map<string, string[]>();
  const amountCounts = new Map<string, number>();

  for (const e of edges) {
    const fList = funderCounts.get(e.funder_source) || [];
    fList.push(e.to_wallet);
    funderCounts.set(e.funder_source, fList);

    const cList = cexCounts.get(e.cex_deposit_address) || [];
    cList.push(e.to_wallet);
    cexCounts.set(e.cex_deposit_address, cList);

    const amtKey = e.amount_eth.toFixed(4);
    amountCounts.set(amtKey, (amountCounts.get(amtKey) || 0) + 1);
  }

  const sortedByTime = [...edges].sort((a, b) => a.tx_timestamp_sec - b.tx_timestamp_sec);
  const burstWallets = new Set<string>();
  for (let i = 1; i < sortedByTime.length; i++) {
    if (sortedByTime[i].tx_timestamp_sec - sortedByTime[i - 1].tx_timestamp_sec <= 120) {
      burstWallets.add(sortedByTime[i].to_wallet);
      burstWallets.add(sortedByTime[i - 1].to_wallet);
    }
  }

  const reports: WalletRiskReport[] = [];
  const isolationPlan: IsolationRoutingStep[] = [];

  edges.forEach((e, idx) => {
    let score = 0;
    const reasons: string[] = [];

    const sameFunderPeers = funderCounts.get(e.funder_source) || [];
    if (sameFunderPeers.length > 1) {
      score += 40;
      reasons.push(`Shares direct funder (${e.funder_source}) with ${sameFunderPeers.length - 1} other wallets`);
    }

    const sameCexPeers = cexCounts.get(e.cex_deposit_address) || [];
    const hasCexCollision = sameCexPeers.length > 1;
    if (hasCexCollision) {
      score += 45;
      reasons.push(`FATAL: Sweeps funds into shared CEX deposit address (${e.cex_deposit_address})`);
    }

    const isBurst = burstWallets.has(e.to_wallet);
    if (isBurst) {
      score += 20;
      reasons.push('Temporal script burst (<120s between sibling wallet actions)');
    }

    const amtKey = e.amount_eth.toFixed(4);
    const isIdenticalAmt = (amountCounts.get(amtKey) || 0) > 1;
    if (isIdenticalAmt) {
      score += 15;
      reasons.push(`Identical round funding amount (${amtKey} ETH)`);
    }

    const cappedScore = Math.min(100, score);
    const level: WalletRiskReport['risk_level'] =
      cappedScore >= 60 ? 'CRITICAL_SYBIL' : cappedScore >= 30 ? 'WARNING' : 'SAFE';

    reports.push({
      wallet: e.to_wallet,
      risk_score: cappedScore,
      risk_level: level,
      shared_funder_cluster: e.funder_source,
      shared_cex_deposit_collision: hasCexCollision,
      temporal_burst_flag: isBurst,
      identical_amount_flag: isIdenticalAmt,
      reasons: reasons.length ? reasons : ['Isolated funding & non-overlapping timing']
    });

    // Deterministic anti-correlation funding & CEX sub-account isolation plan
    const hash = crypto.createHash('sha256').update(e.to_wallet).digest();
    const jitter = ((hash[0] % 45) + 12) / 10000; // +0.0012 to +0.0056 ETH
    const delayMin = (hash[1] % 180) + 25; // 25 to 204 minutes gap

    isolationPlan.push({
      step_order: idx + 1,
      target_wallet: e.to_wallet,
      recommended_cex_subaccount: `OKX_SubAccount_Isolated_${String(idx + 1).padStart(2, '0')}`,
      jittered_amount_eth: (0.05 + jitter).toFixed(5),
      delay_minutes_after_prev: delayMin,
      recommended_window_utc: `T+${delayMin * (idx + 1)} mins`
    });
  });

  return {
    summary: {
      total_wallets: reports.length,
      critical_sybils: reports.filter((r) => r.risk_level === 'CRITICAL_SYBIL').length,
      c_deposit_collisions: reports.filter((r) => r.shared_cex_deposit_collision).length
    },
    reports,
    isolation_plan: isolationPlan
  };
}
