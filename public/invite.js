// Runs first, before analytics.js loads PostHog (Plan.md B3-4).
// If the address has ?code=..., save the code in this browser and remove it
// from the address bar right away, so PostHog (and anyone looking over her
// shoulder) never sees it. The app sends it with every API call.
(function () {
  const KEY = 'cyclesync.inviteCode';
  const FORMAT = /^[A-Za-z0-9_-]{22}$/;
  let memory = null; // used when this browser blocks storage (private mode)

  try {
    const url = new URL(location.href);
    const code = url.searchParams.get('code');
    if (url.searchParams.has('code')) {
      url.searchParams.delete('code');
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    }
    if (code && FORMAT.test(code)) {
      memory = code;
      try { localStorage.setItem(KEY, code); } catch {}
    }
  } catch {}

  globalThis.csInvite = {
    get() {
      try { return localStorage.getItem(KEY) || memory; } catch { return memory; }
    },
  };
})();
