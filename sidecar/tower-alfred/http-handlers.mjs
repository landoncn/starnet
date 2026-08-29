function sendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function parseBody(req, res, readBody) {
  try {
    const raw = await readBody(req, 256 * 1024, res);
    const value = JSON.parse(raw || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('body must be an object');
    return value;
  } catch (error) {
    if (!res.headersSent && !res.writableEnded) sendJson(res, 400, { ok: false, error: `bad json: ${error.message}` });
    return null;
  }
}

export function createTowerAlfredHttpHandlers({ service, readBody }) {
  if (!service || typeof readBody !== 'function') throw new Error('Tower Alfred HTTP handlers require service and readBody');

  async function status(_req, res) {
    sendJson(res, 200, service.status());
  }

  async function run(req, res) {
    const body = await parseBody(req, res, readBody);
    if (!body) return;
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    let runId = '';
    let settled = false;
    let cancelIssued = false;
    const cancelDisconnected = () => {
      if (settled || cancelIssued) return;
      cancelIssued = true;
      const target = runId ? { runId } : { streamId: body.streamId, agentId: body.agentId };
      Promise.resolve(service.cancel(target)).catch(error => {
        console.warn('[tower-alfred] disconnect cancellation failed:', error && error.message || error);
      });
    };
    const onAborted = () => cancelDisconnected();
    const onClose = () => { if (!res.writableEnded) cancelDisconnected(); };
    if (req && typeof req.once === 'function') req.once('aborted', onAborted);
    if (res && typeof res.once === 'function') res.once('close', onClose);
    try {
      await service.run(body, event => {
        if (event && event.name === 'agent.run.start' && event.payload && event.payload.runId) runId = String(event.payload.runId);
        if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
      });
    } catch (error) {
      if (!res.destroyed && !res.writableEnded) {
        res.write(`${JSON.stringify({ name: 'agent.run.error', payload: { message: error.message || String(error) } })}\n`);
      }
    } finally {
      settled = true;
      if (req && typeof req.removeListener === 'function') req.removeListener('aborted', onAborted);
      if (res && typeof res.removeListener === 'function') res.removeListener('close', onClose);
    }
    if (!res.destroyed && !res.writableEnded) res.end();
  }

  async function consent(req, res) {
    const body = await parseBody(req, res, readBody);
    if (!body) return;
    const result = service.resolvePermission(body);
    sendJson(res, result.ok ? 200 : 404, result);
  }

  async function cancel(req, res) {
    const body = await parseBody(req, res, readBody);
    if (!body) return;
    sendJson(res, 200, await service.cancel(body));
  }

  return { status, run, consent, cancel };
}
