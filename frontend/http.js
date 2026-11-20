async function readJson(response, fallback = 'Request failed') {
  const type = response.headers.get('content-type') || '';
  let data = null;
  if (type.includes('application/json')) {
    try { data = await response.json(); } catch { data = null; }
  }
  if (!response.ok) {
    const error = new Error(data?.error || `${fallback} (${response.status}). Your unsaved work is retained.`);
    error.status = response.status;
    throw error;
  }
  if (data === null) throw new Error(`${fallback}: the server returned an unexpected response.`);
  return data;
}

module.exports = { readJson };
