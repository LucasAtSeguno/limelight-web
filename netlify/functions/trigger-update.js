/**
 * Netlify serverless function — trigger-update
 * Fires a GitHub Actions workflow_dispatch and returns immediately.
 * The dashboard polls limelight-data.json directly to detect when
 * the update is complete — no waiting in the function itself.
 */

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  const token = process.env.GITHUB_TOKEN;
  const repo  = process.env.GITHUB_REPO;

  if (!token || !repo) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Missing environment variables' }),
    };
  }

  try {
    const res = await fetch(
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

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`GitHub dispatch failed: ${res.status} — ${err.message || 'unknown'}`);
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ status: 'dispatched' }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
