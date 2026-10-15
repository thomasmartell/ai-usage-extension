import assert from 'node:assert/strict';
import { it } from 'node:test';
import { accountFingerprint, codexDiagnostics } from '../src/shared/diagnostics';
import { buildCodexUsage } from '../src/background/services/UsageService';

it('shows the raw quota before clamping without exposing other response values', async () => {
  const raw = {
    account_id: 'private-account-id',
    accessToken: 'private-token',
    email: 'private@example.test',
    rate_limit: {
      primary_window: {
        used_percent: 169,
        limit_window_seconds: 604800,
        reset_at: 1800000000,
        secret: 'nested-secret',
      },
    },
  };
  const usage = buildCodexUsage(raw)!;
  usage.diagnostics = {
    requestAccountFingerprint: await accountFingerprint(raw.account_id),
    responseAccountFingerprint: await accountFingerprint(raw.account_id),
  };
  const report = codexDiagnostics(usage);
  assert.equal(report.primary?.rawPercent, 169);
  assert.equal(report.rendered[0].percent, 100);
  assert.match(report.accounts!.requestAccountFingerprint!, /^[0-9a-f]{12}$/);
  const serialized = JSON.stringify(report);
  for (const secret of [
    'private-account-id',
    'private-token',
    'private@example.test',
    'nested-secret',
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(await accountFingerprint(null), null);
  assert.equal(codexDiagnostics().snapshotAt, null);
});
