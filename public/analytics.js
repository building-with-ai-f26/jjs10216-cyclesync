// PostHog analytics for the app (Plan.md step 8).
//
// - Loads PostHog only if POSTHOG_KEY is set in .env (via /api/config).
//   No key → nothing loads, and track() does nothing.
// - Pageviews, clicks and session replay are automatic. Anything inside an
//   element with the "ph-no-capture" class (all health screens) is a blank box
//   in replays and ignored by click tracking. Typed inputs are masked too.
// - Funnel events go through track(), which only ever sends the properties
//   allowed below. cleanEvent() checks every event once more right before it
//   leaves the browser: it adds source: "app", and removes anything else.
//
// Never sent: health answers, symptoms, cycle day, phase, verdict, card text.
(function () {
  // The only custom events, and the only properties each may carry.
  const FUNNEL = {
    checkin_started: [],
    checkin_completed: ['workout_type'],
    result_shown: ['workout_type'],
    response_tapped: ['workout_type', 'response'],
    science_opened: ['screen'], // not health: which screen the science panel was opened on
  };
  // The only values those properties may have.
  const ALLOWED_VALUES = {
    workout_type: ['run', 'strength', 'class', 'walk_yoga'],
    response: ['do_this', 'original_plan', 'something_else', 'rest'],
    screen: ['setup', 'home'],
  };
  // Added by PostHog itself to every event; needed for it to be accepted.
  const POSTHOG_FIELDS = ['token', 'distinct_id'];

  // Last check on every event before it's sent. Returns the event to send, or
  // null to drop it.
  function cleanEvent(event) {
    if (!event || typeof event.event !== 'string') return null;
    const name = event.event;
    const props = { ...(event.properties || {}) };

    if (FUNNEL[name]) {
      for (const key of Object.keys(props)) {
        if (key.startsWith('$') || POSTHOG_FIELDS.includes(key) || key === 'source') continue;
        const allowed = FUNNEL[name].includes(key) && ALLOWED_VALUES[key].includes(props[key]);
        if (!allowed) delete props[key];
      }
    } else if (!name.startsWith('$')) {
      return null; // A custom event that isn't in the funnel list: never send it.
    }

    props.source = 'app';
    const cleaned = { ...event, properties: removeInviteCodes(props) };
    if (event.$set) cleaned.$set = removeInviteCodes(event.$set);
    if (event.$set_once) cleaned.$set_once = removeInviteCodes(event.$set_once);
    return cleaned;
  }

  // Second layer behind public/invite.js: if a URL with ?code=... ever reaches
  // an event (page URL, referrer, initial URL...), the code is replaced.
  function removeInviteCodes(value) {
    if (typeof value === 'string') return value.replace(/([?&])code=[^&#\s]*/g, '$1code=removed');
    if (Array.isArray(value)) return value.map(removeInviteCodes);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = removeInviteCodes(v);
      return out;
    }
    return value;
  }

  // Builds a funnel event's properties from the allowlist only.
  function pickProperties(name, props) {
    const picked = {};
    for (const key of FUNNEL[name] || []) {
      const value = props?.[key];
      if (ALLOWED_VALUES[key].includes(value)) picked[key] = value;
    }
    return picked;
  }

  let posthog = null; // set once PostHog has loaded
  let enabled = true; // false when there's no key: queued events are thrown away
  const queue = []; // events tracked before PostHog finished loading

  function track(name, props) {
    if (!FUNNEL[name] || !enabled) return;
    const properties = pickProperties(name, props);
    if (posthog) posthog.capture(name, properties);
    else queue.push([name, properties]);
  }

  function postHogConfig(host) {
    return {
      api_host: host,
      defaults: '2026-05-30', // same as the Product Page
      person_profiles: 'identified_only', // no person profiles: we never identify anyone
      autocapture: true, // clicks (ignores anything inside .ph-no-capture)
      capture_pageview: true,
      disable_session_recording: false,
      session_recording: {
        maskAllInputs: true, // typed fields and the date pickers show as ***
        blockClass: 'ph-no-capture', // health screens show as blank boxes
      },
      enable_recording_console_log: false,
      capture_performance: false, // no network request list in replays
      enable_heatmaps: false, // click positions could hint at which answer was tapped
      capture_dead_clicks: false,
      before_send: cleanEvent,
      loaded: (ph) => {
        ph.register({ source: 'app' });
        posthog = ph;
        for (const [name, properties] of queue.splice(0)) ph.capture(name, properties);
      },
    };
  }

  async function init() {
    try {
      const res = await fetch('/api/config');
      const config = await res.json();
      if (!config.posthog) {
        enabled = false;
        queue.length = 0;
        return;
      }
      const { key, host } = config.posthog;
      const script = document.createElement('script');
      script.src = `${host.replace('.i.posthog.com', '-assets.i.posthog.com')}/static/array.js`;
      script.crossOrigin = 'anonymous';
      script.async = true;
      script.onload = () => window.posthog?.init(key, postHogConfig(host));
      document.head.append(script);
    } catch {
      // Analytics failing to load must never break the app.
      enabled = false;
      queue.length = 0;
    }
  }

  globalThis.csAnalytics = { track, cleanEvent, removeInviteCodes, pickProperties, postHogConfig, FUNNEL, ALLOWED_VALUES };
  if (typeof document !== 'undefined' && typeof fetch === 'function' && globalThis.location?.protocol?.startsWith('http')) {
    init();
  }
})();
