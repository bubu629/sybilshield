// src/main.ts
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { stringify } from 'csv-stringify/sync';
import { analyzeSybilGraph, SAMPLE_WALLET_GRAPH, WalletTransferEdge } from './analyzer.js';
import { LicensePayload, saveAndActivateLicense, loadSavedLicense } from './license.js';

const app = Fastify({ logger: false });

const COMMUNITY_DEFAULT: LicensePayload = {
  license_id: 'community-free',
  tier: 'COMMUNITY',
  max_wallets: 3,
  unlock_routing_plan: false,
  issued_at: new Date().toISOString(),
  expires_at: null
};

let activeLicense: LicensePayload = loadSavedLicense() || COMMUNITY_DEFAULT;

function openBrowser(url: string) {
  const cmd =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(cmd);
}

app.get('/api/license/status', async () => ({
  ok: true,
  license: activeLicense,
  sample: JSON.stringify(SAMPLE_WALLET_GRAPH, null, 2)
}));

app.post('/api/license/activate', async (req, reply) => {
  const { license_key } = req.body as { license_key: string };
  const res = saveAndActivateLicense(license_key);
  if (!res.valid || !res.payload) {
    return reply.status(400).send({ ok: false, error: res.reason });
  }
  activeLicense = res.payload;
  return { ok: true, license: activeLicense };
});

app.post('/api/audit', async (req, reply) => {
  const { edges_json } = req.body as { edges_json: string };
  let edges: WalletTransferEdge[];
  try {
    edges = JSON.parse(edges_json);
  } catch {
    return reply.status(400).send({ ok: false, error: 'Invalid JSON input' });
  }

  if (edges.length > activeLicense.max_wallets) {
    return reply.status(403).send({
      ok: false,
      error: `[${activeLicense.tier} Limit] Input has ${edges.length} wallets, but Community mode only audits up to ${activeLicense.max_wallets} wallets. Activate an SS1.xxx license key to unlock up to 10,000 wallets. Get a key at https://t.me/Userstudiobot/Store`
    });
  }

  const result = analyzeSybilGraph(edges);
  const outDir = path.resolve(process.cwd(), 'SybilShield_Output');
  fs.mkdirSync(outDir, { recursive: true });

  const reportCsv = stringify(
    result.reports.map((r) => ({
      wallet: r.wallet,
      risk_score: r.risk_score,
      risk_level: r.risk_level,
      funder_cluster: r.shared_funder_cluster,
      cex_collision: r.shared_cex_deposit_collision,
      reasons: r.reasons.join(' | ')
    })),
    { header: true }
  );
  fs.writeFileSync(path.join(outDir, 'sybil_risk_audit.csv'), reportCsv, 'utf8');

  if (activeLicense.unlock_routing_plan) {
    const planCsv = stringify(result.isolation_plan, { header: true });
    fs.writeFileSync(path.join(outDir, 'anti_sybil_funding_plan.csv'), planCsv, 'utf8');
  }

  return {
    ok: true,
    output_dir: outDir,
    summary: result.summary,
    reports: result.reports,
    isolation_plan: activeLicense.unlock_routing_plan ? result.isolation_plan : 'LOCKED (Requires Personal/Pro License)'
  };
});

app.get('/', async (_req, reply) => {
  reply.type('text/html; charset=utf-8').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>SybilShield Local — 100% Air-Gapped Multi-Wallet Anti-Sybil Auditor</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #090d16; color: #f8fafc; margin: 0; padding: 24px; }
    .container { max-width: 980px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #1e293b; padding-bottom: 16px; }
    .badge { background: #1e293b; border: 1px solid #a855f7; color: #c084fc; padding: 6px 14px; border-radius: 999px; font-size: 13px; font-weight: 600; }
    .grid { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 20px; margin-top: 20px; }
    .card { background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 20px; }
    label { display: block; font-size: 13px; color: #9ca3af; margin-top: 12px; }
    input, textarea { width: 100%; padding: 8px; margin-top: 4px; background: #030712; border: 1px solid #374151; color: #fff; border-radius: 4px; box-sizing: border-box; font-family: monospace; font-size: 12px; }
    button { background: #7c3aed; color: #fff; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer; font-weight: 600; margin-top: 16px; width: 100%; }
    pre { background: #030712; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 12px; color: #c084fc; min-height: 190px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin:0;">SybilShield Local <span style="font-weight:normal;font-size:14px;color:#9ca3af;">AIR-GAPPED WEB3 CLUSTER AUDITOR & JITTER PLANNER</span></h2>
      <div id="tierBadge" class="badge">Loading...</div>
    </div>
    <div class="grid">
      <div class="card">
        <h3 style="margin-top:0;">1. Local Wallet Funding & CEX Sweep Graph (JSON)</h3>
        <label>100% Offline Execution — Zero RPC Leakage, Zero IP Tracking</label>
        <textarea id="edgesJson" rows="14"></textarea>
        <button onclick="runAudit()">Run Local Cluster Detection & Export Isolation Plan</button>
      </div>
      <div class="card">
        <h3 style="margin-top:0;">2. Offline License Key (SS1.xxx)</h3>
        <label>Paste SS1.xxx Key (Community Limit: 3 Wallets | Pro: 10,000 Wallets)</label>
        <input type="text" id="licenseKey" placeholder="SS1.eyJsaWNlbnNlX2lk..." />
        <button style="background:#059669;" onclick="activateKey()">Verify & Save Offline License</button> <a href="https://t.me/Userstudiobot/Store" target="_blank" style="display:inline-block;margin-left:8px;padding:8px 14px;background:#2481cc;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:13px;">Buy License Key ↗</a>
        <h3 style="margin-top:20px;">3. Local Cluster Audit Output</h3>
        <pre id="outputLog">Ready. Default sample has 4 wallets (triggers Community 3-wallet limit until activated).</pre>
      </div>
    </div>
  </div>
  <script>
    async function init() {
      const res = await fetch('/api/license/status');
      const data = await res.json();
      document.getElementById('edgesJson').value = data.sample;
      updateBadge(data.license);
    }
    function updateBadge(lic) {
      document.getElementById('tierBadge').innerText = 'Tier: ' + lic.tier + ' (Max ' + lic.max_wallets + ' Wallets)';
    }
    async function activateKey() {
      const key = document.getElementById('licenseKey').value;
      const res = await fetch('/api/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_key: key })
      });
      const data = await res.json();
      if (!data.ok) return alert(data.error);
      updateBadge(data.license);
      document.getElementById('outputLog').innerText = '✅ License verified offline! Unlocked up to ' + data.license.max_wallets + ' wallets & CEX Sub-Account Jitter Planner.';
    }
    async function runAudit() {
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edges_json: document.getElementById('edgesJson').value })
      });
      const data = await res.json();
      if (!data.ok) {
        document.getElementById('outputLog').innerText = '❌ ' + data.error;
        return;
      }
      document.getElementById('outputLog').innerText =
        '✅ Saved CSVs to: ' + data.output_dir +
        '\nCritical Sybils Flagged: ' + data.summary.critical_sybils +
        '\nCEX Deposit Collisions: ' + data.summary.c_deposit_collisions +
        '\n\n' + JSON.stringify({ reports: data.reports, isolation_plan: data.isolation_plan }, null, 2);
    }
    init();
  </script>
</body>
</html>`);
});

app.listen({ port: 4569, host: '127.0.0.1' }).then(() => {
  const url = 'http://127.0.0.1:4569';
  console.log(`🚀 SybilShield Local running at ${url}`);
  openBrowser(url);
});
