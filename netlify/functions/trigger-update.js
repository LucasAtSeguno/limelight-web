/**
 * Netlify serverless function — trigger-update
 * Called by the dashboard Update button.
 * Dispatches a workflow_dispatch event to GitHub Actions,
 * then polls until the run completes and returns the result.
 * The GitHub token is kept server-side and never exposed to the browser.
 */

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  const token = process.env.GITHUB_TOKEN;
  const repo  = process.env.GITHUB_REPO;

  if (!token || !repo) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Server configuration error — missing environment variables' }),
    };
  }

  try {
    // Step 1 — Dispatch the workflow
    const dispatchRes = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/update.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
      }
    );

    if (!dispatchRes.ok) {
      const err = await dispatchRes.json().catch(() => ({}));
      throw new Error(`Dispatch failed: ${dispatchRes.status} — ${err.message || 'unknown error'}`);
    }

    // Step 2 — Poll for the run to appear (GitHub takes a moment to create it)
    let runId = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      await delay(3000);
      const runsRes = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows/update.yml/runs?per_page=1&event=workflow_dispatch`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
          },
        }
      );
      const runs = await runsRes.json();
      if (runs.workflow_runs?.length > 0) {
        runId = runs.workflow_runs[0].id;
        break;
      }
    }

    if (!runId) {
      return {
        statusCode: 202,
        headers: CORS,
        body: JSON.stringify({ status: 'dispatched', message: 'Workflow triggered — check back shortly.' }),
      };
    }

    // Step 3 — Poll until complete (max ~3 minutes)
    for (let attempt = 0; attempt < 36; attempt++) {
      await delay(5000);
      const runRes = await fetch(
        `https://api.github.com/repos/${repo}/actions/runs/${runId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
          },
        }
      );
      const run = await runRes.json();

      if (run.status === 'completed') {
        if (run.conclusion === 'success') {
          return {
            statusCode: 200,
            headers: CORS,
            body: JSON.stringify({ status: 'success', message: 'Update complete — reloading data.' }),
          };
        } else {
          return {
            statusCode: 500,
            headers: CORS,
            body: JSON.stringify({ status: 'failed', message: `Workflow ended with status: ${run.conclusion}` }),
          };
        }
      }
    }

    // Timed out waiting — workflow is still running
    return {
      statusCode: 202,
      headers: CORS,
      body: JSON.stringify({ status: 'timeout', message: 'Update is taking longer than expected — check back in a moment.' }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
