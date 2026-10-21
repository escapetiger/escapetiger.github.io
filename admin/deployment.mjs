// Copyright (C) 2026, Yi Cai. All rights reserved. See LICENSE for details.
// Public Actions reads do not require expanding the phone token's permissions.
export async function deploymentStatus(api, pending, receipt) {
  if (receipt && /^[0-9a-f]{40}$/.test(receipt.revision) && Array.isArray(receipt.paths)) {
    let included = receipt.revision === pending.commit;
    if (!included) {
      const comparison = await api.publicRequest(api.repo, `compare/${pending.commit}...${receipt.revision}`);
      if (comparison.status === 'ahead') {
        const tree = await api.request(`git/trees/${receipt.revision}?recursive=1`);
        if (tree.truncated) throw new Error('Incomplete deployment verification.');
        included = (pending.files || [pending]).every(expected => tree.tree.some(file => file.path === expected.path && file.sha === expected.sha));
        if (!included) return { stage: 'superseded' };
      }
    }
    if (included) {
      if (pending.action === 'draft') return { stage: 'draftLive' };
      const url = pending.url && receipt.paths.includes(pending.url) ? pending.url : null;
      return { stage: url ? 'live' : 'excluded', url };
    }
  }
  const data = await api.publicRequest(api.repo,
    `actions/workflows/mobile-publish.yml/runs?head_sha=${pending.commit}&per_page=5`);
  const run = data.workflow_runs?.find(run => run.head_sha === pending.commit);
  if (!run) return { stage: 'queued' };
  if (run.status !== 'completed') return { stage: run.status === 'in_progress' ? 'building' : 'queued', logs: run.html_url };
  if (run.conclusion === 'success') {
    const repo = 'escapetiger/escapetiger.github.io';
    const commits = await api.publicRequest(repo, 'commits?per_page=10');
    const output = commits.find(commit => commit.commit.message.startsWith(`Publish hugo-yicai ${pending.commit.slice(0, 7)}`));
    if (output) {
      const pages = await api.publicRequest(repo, `actions/runs?head_sha=${output.sha}&per_page=5`);
      const deployment = pages.workflow_runs?.find(item => item.name === 'pages build and deployment');
      if (deployment?.status === 'completed' && deployment.conclusion !== 'success') {
        return { stage: 'failed', logs: deployment.html_url };
      }
    }
    return { stage: 'deploying', logs: run.html_url };
  }
  return { stage: run.conclusion === 'skipped' ? 'disabled' : 'failed', logs: run.html_url };
}

export function viewportGeometry(viewport, fallbackHeight) {
  return { top: Math.max(0, viewport?.offsetTop || 0), height: Math.max(1, viewport?.height || fallbackHeight) };
}
