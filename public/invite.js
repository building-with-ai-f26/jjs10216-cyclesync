// Runs first, before analytics.js loads PostHog (Plan.md B3-4).
// If the address has ?code=..., save the code in this browser and remove it
// from the address bar right away, so PostHog (and anyone looking over her
// shoulder) never sees it. The app sends it with every API call.
//
// A ?code= in the address always wins over a code saved earlier (bug, Nov 19:
// a phone kept using an old, revoked code). A malformed ?code= clears the
// saved code too, so an old one is never used by mistake.
(function () {
  const KEY = 'cyclesync.inviteCode';
  const FORMAT = /^[A-Za-z0-9_-]{22}$/;
  let memory = null; // this visit's code from the address (also covers blocked storage)
  let fromLink = false; // a well-formed ?code= was in the address this visit
  let badLink = false; // a ?code= was there but malformed: treat as a dead link

  try {
    const url = new URL(location.href);
    if (url.searchParams.has('code')) {
      const code = url.searchParams.get('code');
      url.searchParams.delete('code');
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
      if (FORMAT.test(code)) {
        memory = code;
        fromLink = true;
        try { localStorage.setItem(KEY, code); } catch {}
      } else {
        badLink = true;
        try { localStorage.removeItem(KEY); } catch {}
      }
    }
  } catch {}

  globalThis.csInvite = {
    get() {
      if (memory) return memory;
      if (badLink) return null;
      try { return localStorage.getItem(KEY); } catch { return null; }
    },
    fromLink: () => fromLink,
    badLink: () => badLink,
  };
})();
