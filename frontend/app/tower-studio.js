/* Angler's Hollow Studio command center for server-attested Tower Alfred mode. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TowerStudio = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const STATE_LABELS = Object.freeze({
    working: 'WORKING', review: 'IN REVIEW', blocked: 'BLOCKED', queued: 'QUEUED',
    idle: 'IDLE', unknown: 'STATUS UNKNOWN', unprovisioned: 'UNPROVISIONED'
  });
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function taskHtml(agent) {
    const task = agent && agent.task;
    if (!task) return '<p class="tower-studio-task none">No active Kanban assignment.</p>';
    return '<p class="tower-studio-task"><b>' + esc(task.title || 'Untitled task') + '</b><span>' + esc(task.status || '') + '</span></p>';
  }

  function agentHtml(agent) {
    const state = String(agent && agent.state || 'unknown');
    return '<article class="tower-studio-agent state-' + esc(state) + '">' +
      '<div class="tower-studio-agent-head"><b>' + esc(agent && (agent.name || agent.profile)) + '</b>' +
      '<span>' + esc(STATE_LABELS[state] || state.toUpperCase()) + '</span></div>' +
      '<small>' + esc(agent && agent.role) + ' · ' + esc(agent && agent.profile) + '</small>' + taskHtml(agent) + '</article>';
  }

  function artifactHtml(artifact) {
    const preview = artifact && artifact.preview === 'audio' ? 'audio' : 'image';
    const title = String(artifact && artifact.title || 'Untitled artifact');
    const id = String(artifact && artifact.id || '');
    const label = preview === 'audio' ? 'AUDIO PREVIEW' : 'IMAGE PREVIEW';
    const review = artifact && artifact.review || {};
    const decision = ['approved', 'denied'].includes(String(review.decision)) ? String(review.decision) : 'pending';
    const feedback = String(review.feedback || '');
    return '<article class="tower-studio-artifact review-' + esc(decision) + '"><div><b>' + esc(title) + '</b>' +
      '<span class="tower-studio-artifact-meta">' + esc(artifact && artifact.status) + ' · ' + esc(artifact && artifact.creatorProfile) + ' · OWNER ' + esc(decision.toUpperCase()) + '</span>' +
      '<p>' + esc(artifact && artifact.note) + '</p></div>' +
      '<button type="button" class="tower-studio-preview-btn" data-artifact="' + esc(id) + '" aria-label="Preview ' + esc(title) + ' ' + preview + '">' + label + '</button>' +
      '<div class="tower-studio-preview" data-artifact-preview="' + esc(id) + '" aria-live="polite"></div>' +
      '<div class="tower-studio-review" data-review-artifact="' + esc(id) + '">' +
      '<div class="tower-studio-review-actions"><button type="button" data-review-artifact="' + esc(id) + '" data-review-decision="approved" aria-pressed="' + String(decision === 'approved') + '">APPROVE</button>' +
      '<button type="button" data-review-artifact="' + esc(id) + '" data-review-decision="denied" aria-pressed="' + String(decision === 'denied') + '">DENY</button></div>' +
      '<label>Owner feedback<textarea maxlength="2000" data-review-feedback="' + esc(id) + '" placeholder="What should change, or what works well?">' + esc(feedback) + '</textarea></label>' +
      '<button type="button" class="tower-studio-feedback-save" data-review-artifact="' + esc(id) + '" data-review-save="true">Save feedback</button>' +
      '<p class="tower-studio-review-status" data-review-status="' + esc(id) + '" aria-live="polite"></p></div></article>';
  }

  function render(data) {
    if (!data || data.ok !== true) {
      return '<div class="tower-studio-unavailable"><b>STUDIO TELEMETRY UNAVAILABLE</b><p>' + esc(data && data.error || 'The project manifest or task board could not be read.') + '</p></div>';
    }
    const studio = data.studio || {};
    const agents = Array.isArray(data.agents) ? data.agents : [];
    const artifacts = Array.isArray(data.artifacts) ? data.artifacts : [];
    const taskWarning = data.sources && data.sources.tasks === 'unavailable'
      ? '<p class="tower-studio-warning">KANBAN UNAVAILABLE — agent activity is not being inferred.</p>' : '';
    const artifactWarning = data.sources && data.sources.artifacts === 'unavailable'
      ? '<p class="tower-studio-warning">ASSET REGISTRY UNAVAILABLE.</p>'
      : data.sources && data.sources.artifacts === 'partial'
        ? '<p class="tower-studio-warning">' + esc(data.rejectedArtifacts || 0) + ' REGISTERED FILES WERE REJECTED BY SAFETY CHECKS.</p>' : '';
    return '<header class="tower-studio-title"><div><strong>ANGLER’S HOLLOW STUDIO</strong><span>' + esc(studio.milestone || 'No active milestone') + '</span></div>' +
      '<span class="tower-studio-source">' + esc(data.board || '') + '</span></header>' + taskWarning +
      '<section><h3>STUDIO FLOOR · ' + agents.length + ' PERMANENT AGENTS</h3><div class="tower-studio-agents">' + agents.map(agentHtml).join('') + '</div></section>' +
      '<section><h3>ART & AUDIO REVIEW · ' + artifacts.length + ' FILES</h3>' + artifactWarning +
      (artifacts.length ? '<div class="tower-studio-artifacts">' + artifacts.map(artifactHtml).join('') + '</div>' : '<p class="tower-studio-empty">No registered art or audio deliverables yet.</p>') + '</section>';
  }

  function shouldReplaceSnapshot(current, next) {
    return !current || Boolean(next && next.ok === true);
  }

  function bootBrowser() {
    if (typeof window === 'undefined' || !window.__TOWER_ALFRED__) return;
    const start = () => {
      const game = document.getElementById('screen-game');
      if (!game || document.getElementById('tower-studio-command')) return;
      const panel = document.createElement('aside');
      panel.id = 'tower-studio-command';
      panel.setAttribute('aria-label', "Angler's Hollow Studio command center");
      panel.innerHTML = '<button type="button" class="tower-studio-toggle" aria-expanded="true" aria-controls="tower-studio-body">STUDIO FLOOR ▾</button><div id="tower-studio-body" class="tower-studio-body"><p class="tower-studio-loading">Connecting to the studio ledger…</p></div>';
      game.appendChild(panel);
      const body = panel.querySelector('.tower-studio-body');
      const toggle = panel.querySelector('.tower-studio-toggle');
      let current = null;
      let timer = null;
      let pollController = null;
      let stopped = false;
      const previewControllers = new Set();
      const blobs = new Map();
      const reviewDrafts = new Map();
      const revokeBlob = id => {
        const url = blobs.get(id);
        if (!url) return;
        try { URL.revokeObjectURL(url); } catch (_) {}
        blobs.delete(id);
      };
      const clearBlobs = () => { for (const id of Array.from(blobs.keys())) revokeBlob(id); };
      const preservePreviews = () => {
        const saved = [];
        for (const host of body.querySelectorAll('[data-artifact-preview]')) {
          if (!host.firstChild) continue;
          const id = host.getAttribute('data-artifact-preview');
          const nodes = [];
          const audio = host.querySelector('audio');
          const audioState = audio ? { node: audio, paused: audio.paused, currentTime: audio.currentTime } : null;
          while (host.firstChild) nodes.push(host.removeChild(host.firstChild));
          saved.push({ id, nodes, audioState });
        }
        return () => {
          for (const item of saved) {
            const host = body.querySelector('[data-artifact-preview="' + CSS.escape(item.id) + '"]');
            if (!host) { revokeBlob(item.id); continue; }
            for (const node of item.nodes) host.appendChild(node);
            if (item.audioState) {
              try { item.audioState.node.currentTime = item.audioState.currentTime; } catch (_) {}
              if (!item.audioState.paused) item.audioState.node.play().catch(() => {});
            }
          }
        };
      };
      const updateBody = data => {
        const markup = render(data);
        if (body.innerHTML === markup) return;
        const activeArtifact = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-artifact');
        const activeReview = document.activeElement && document.activeElement.getAttribute
          ? {
              id: document.activeElement.getAttribute('data-review-feedback') || document.activeElement.getAttribute('data-review-artifact'),
              decision: document.activeElement.getAttribute('data-review-decision'),
              save: document.activeElement.getAttribute('data-review-save'),
              textarea: document.activeElement.matches && document.activeElement.matches('textarea[data-review-feedback]'),
              start: typeof document.activeElement.selectionStart === 'number' ? document.activeElement.selectionStart : null,
              end: typeof document.activeElement.selectionEnd === 'number' ? document.activeElement.selectionEnd : null
            }
          : null;
        const restorePreviews = preservePreviews();
        body.innerHTML = markup;
        restorePreviews();
        for (const textarea of body.querySelectorAll('[data-review-feedback]')) {
          const id = textarea.getAttribute('data-review-feedback');
          if (reviewDrafts.has(id)) textarea.value = reviewDrafts.get(id);
        }
        if (activeArtifact) {
          const replacement = body.querySelector('[data-artifact="' + CSS.escape(activeArtifact) + '"]');
          if (replacement) replacement.focus();
        } else if (activeReview && activeReview.id) {
          let selector = activeReview.textarea
            ? 'textarea[data-review-feedback="' + CSS.escape(activeReview.id) + '"]'
            : 'button[data-review-artifact="' + CSS.escape(activeReview.id) + '"]';
          if (!activeReview.textarea && activeReview.decision) selector += '[data-review-decision="' + CSS.escape(activeReview.decision) + '"]';
          if (!activeReview.textarea && activeReview.save) selector += '[data-review-save="true"]';
          const replacement = body.querySelector(selector);
          if (replacement) {
            replacement.focus();
            if (activeReview.textarea && activeReview.start != null) {
              try { replacement.setSelectionRange(activeReview.start, activeReview.end); } catch (_) {}
            }
          }
        }
      };
      const showStaleWarning = () => {
        let warning = body.querySelector('.tower-studio-poll-warning');
        if (!warning) {
          warning = document.createElement('p');
          warning.className = 'tower-studio-warning tower-studio-poll-warning';
          body.prepend(warning);
        }
        warning.textContent = 'LIVE REFRESH FAILED — showing the last verified studio snapshot.';
      };
      const teardown = () => {
        if (stopped) return;
        stopped = true;
        if (timer) clearTimeout(timer);
        if (pollController) pollController.abort();
        for (const controller of previewControllers) controller.abort();
        previewControllers.clear();
        clearBlobs();
        reviewDrafts.clear();
      };
      toggle.addEventListener('click', () => {
        const open = panel.classList.toggle('collapsed') === false;
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = open ? 'STUDIO FLOOR ▾' : 'STUDIO FLOOR ▸';
      });
      panel.addEventListener('input', event => {
        const textarea = event.target.closest && event.target.closest('textarea[data-review-feedback]');
        if (textarea) reviewDrafts.set(String(textarea.dataset.reviewFeedback || ''), textarea.value);
      });
      panel.addEventListener('click', async event => {
        const reviewButton = event.target.closest && event.target.closest('button[data-review-artifact]');
        if (reviewButton && current) {
          const id = String(reviewButton.dataset.reviewArtifact || '');
          const artifact = Array.isArray(current.artifacts) ? current.artifacts.find(item => String(item && item.id || '') === id) : null;
          const textarea = panel.querySelector('textarea[data-review-feedback="' + CSS.escape(id) + '"]');
          const status = panel.querySelector('[data-review-status="' + CSS.escape(id) + '"]');
          if (!artifact || !textarea || !status) return;
          const existing = artifact.review || { decision: 'pending' };
          const decision = reviewButton.dataset.reviewDecision || existing.decision || 'pending';
          const buttons = Array.from(panel.querySelectorAll('button[data-review-artifact="' + CSS.escape(id) + '"]'));
          for (const control of buttons) control.disabled = true;
          status.textContent = 'Saving owner review…';
          const controller = new AbortController();
          previewControllers.add(controller);
          try {
            const response = await fetch('/api/tower/studio/review', {
              method: 'POST', cache: 'no-store', signal: controller.signal,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ artifactId: id, decision, feedback: textarea.value })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.ok || !payload.review) throw new Error(payload.error || ('HTTP ' + response.status));
            reviewDrafts.delete(id);
            current = {
              ...current,
              artifacts: current.artifacts.map(item => String(item && item.id || '') === id ? { ...item, review: payload.review } : item)
            };
            updateBody(current);
            const saved = panel.querySelector('[data-review-status="' + CSS.escape(id) + '"]');
            if (saved) saved.textContent = 'Owner review saved.';
          } catch (error) {
            if (error.name !== 'AbortError') status.textContent = 'Review not saved: ' + error.message;
          } finally {
            previewControllers.delete(controller);
            for (const control of buttons) if (control.isConnected) control.disabled = false;
          }
          return;
        }
        const button = event.target.closest && event.target.closest('button[data-artifact]');
        if (!button || !current) return;
        const id = String(button.dataset.artifact || '');
        const artifact = Array.isArray(current.artifacts) ? current.artifacts.find(item => String(item && item.id || '') === id) : null;
        const host = panel.querySelector('[data-artifact-preview="' + CSS.escape(id) + '"]');
        if (!artifact || !host || !/^\/api\/tower\/studio\/artifact\?path=/.test(String(artifact.previewUrl || ''))) return;
        button.disabled = true;
        host.textContent = 'Loading preview…';
        const controller = new AbortController();
        previewControllers.add(controller);
        try {
          const response = await fetch(artifact.previewUrl, { cache: 'no-store', signal: controller.signal });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          revokeBlob(id);
          const url = URL.createObjectURL(await response.blob());
          blobs.set(id, url);
          if (artifact.preview === 'audio') {
            host.innerHTML = '<audio controls preload="metadata"></audio>';
            const audio = host.querySelector('audio');
            audio.setAttribute('aria-label', artifact.title + ' audio preview');
            audio.src = url;
          } else {
            host.innerHTML = '<img class="tower-studio-image">';
            const image = host.querySelector('img');
            image.alt = artifact.title + ' visual preview';
            image.src = url;
          }
        } catch (error) {
          if (error.name !== 'AbortError') host.textContent = 'Preview unavailable: ' + error.message;
        } finally {
          previewControllers.delete(controller);
          if (button.isConnected) button.disabled = false;
        }
      });
      async function refresh() {
        if (stopped || !panel.isConnected) { teardown(); return; }
        pollController = new AbortController();
        try {
          const response = await fetch('/api/tower/studio', { cache: 'no-store', signal: pollController.signal });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          const data = await response.json();
          if (shouldReplaceSnapshot(current, data)) {
            current = data;
            updateBody(data);
          } else {
            showStaleWarning();
          }
        } catch (error) {
          if (error.name !== 'AbortError') {
            if (!current) updateBody({ ok: false, error: 'Studio telemetry request failed' });
            else showStaleWarning();
          }
        } finally {
          pollController = null;
          if (!stopped && panel.isConnected) timer = setTimeout(refresh, 5000);
        }
      }
      window.addEventListener('pagehide', teardown, { once: true });
      refresh();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }

  bootBrowser();
  return { esc, render, shouldReplaceSnapshot, bootBrowser };
});
