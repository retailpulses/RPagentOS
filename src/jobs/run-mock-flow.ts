import { supabase } from '../lib/supabase.js';
import { createAgentRun, completeAgentRun, failAgentRun } from '../lib/agent-run.js';
import { generateCandidates } from './generate-promotion-candidates.js';
import { mockDecisions } from './run-agent-decision-mock.js';
import { approveCandidate } from './approve-candidate.js';
import { executeApprovedMock } from './execute-approved-mock.js';

const PLATFORM = process.env['AGENT_OS_TARGET_PLATFORM'] || 'mercari';
const SHOP = process.env['AGENT_OS_TARGET_SHOP'] || 'shop4';

async function main() {
  const run = await createAgentRun({
    runType: 'mock_promotion_flow',
    targetPlatform: PLATFORM,
    targetShopCode: SHOP,
    metadata: { orchestrator: 'run-mock-flow' },
  });

  const runId = run.id;
  console.log(`=== Mock Flow v2 ===`);
  console.log(`run_id: ${runId}`);

  try {
    // Step 1: Generate candidates
    console.log(`\n--- step 1: generate candidates ---`);
    const c = await generateCandidates(supabase, runId, PLATFORM, SHOP);

    // Step 2: Mock decisions
    console.log(`\n--- step 2: mock decisions ---`);
    const d = await mockDecisions(supabase, runId);

    // Step 3: Approve
    console.log(`\n--- step 3: approve ---`);
    const a = await approveCandidate(supabase, runId);

    // Step 4: Execute mock
    console.log(`\n--- step 4: execute mock ---`);
    const e = await executeApprovedMock(supabase, runId);

    // Complete
    await completeAgentRun(runId, {
      orchestrator: 'run-mock-flow',
      candidates_created: c.created,
      candidates_skipped: c.skipped,
      decisions_created: d.created,
      decisions_skipped: d.skipped,
      approval_created: a.approved,
      execution_logs_created: e.created,
      execution_logs_skipped: e.skipped,
    });

    console.log(`\n=== Summary ===`);
    console.log(JSON.stringify({
      run_id: runId,
      final_status: 'completed',
      candidates_created: c.created,
      candidates_skipped: c.skipped,
      decisions_created: d.created,
      decisions_skipped: d.skipped,
      approval_created: a.approved,
      execution_logs_created: e.created,
      execution_logs_skipped: e.skipped,
    }, null, 2));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failAgentRun(runId, msg);
    console.error(`\n=== Flow failed ===`);
    console.error(`run_id: ${runId}`);
    console.error(`error: ${msg}`);
    process.exit(1);
  }
}

main();
