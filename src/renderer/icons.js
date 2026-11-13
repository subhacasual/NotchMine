'use strict';
/* Small icon set (24x24, stroke = currentColor).
   Many glyphs are adapted from Feather Icons (MIT, (c) 2013-2017 Cole Bemis) and
   Lucide (ISC, (c) Lucide Contributors); the sky/weather/party glyphs are original.
   Full license texts: THIRD_PARTY_NOTICES.md */
(function () {
  const S = (body, extra = '') =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;
  const F = body => `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none">${body}</svg>`;

  const ICONS = {
    home: S('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>'),
    timer: S('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 10v3.5l2.5 2"/><path d="M9.5 2.5h5"/><path d="M12 2.5V6"/>'),
    cpu: S('<rect x="5" y="5" width="14" height="14" rx="2.5"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>'),
    memory: S('<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 7v10M11 7v10M15 7v10M5 17v3M19 17v3"/>'),
    tray: S('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'),
    sliders: S('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
    pin: S('<path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3v3H7v-3l3-3z"/>'),
    music: S('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
    play: F('<path d="M7.5 4.2v15.6a1 1 0 0 0 1.52.85l12.4-7.8a1 1 0 0 0 0-1.7L9.02 3.35A1 1 0 0 0 7.5 4.2z"/>'),
    pause: F('<rect x="5.5" y="4" width="4.5" height="16" rx="1.4"/><rect x="14" y="4" width="4.5" height="16" rx="1.4"/>'),
    next: F('<path d="M4 5.3v13.4a1 1 0 0 0 1.55.83l9.6-6.7a1 1 0 0 0 0-1.66l-9.6-6.7A1 1 0 0 0 4 5.3z"/><rect x="16.5" y="4.5" width="3" height="15" rx="1.2"/>'),
    prev: F('<path d="M20 5.3v13.4a1 1 0 0 1-1.55.83l-9.6-6.7a1 1 0 0 1 0-1.66l9.6-6.7A1 1 0 0 1 20 5.3z"/><rect x="4.5" y="4.5" width="3" height="15" rx="1.2"/>'),
    chevL: S('<path d="m15 18-6-6 6-6"/>'),
    chevR: S('<path d="m9 18 6-6-6-6"/>'),
    pin2: S('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>'),
    droplet: S('<path d="M12 2.7 6.3 8.4a8 8 0 1 0 11.4 0z"/>'),
    wind: S('<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2M9.6 4.6A2 2 0 1 1 11 8H2M12.6 19.4A2 2 0 1 0 14 16H2"/>'),
    minus: S('<path d="M5 12h14"/>'),
    plus: S('<path d="M12 5v14M5 12h14"/>'),
    reset: S('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
    pen: S('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    volume: S('<path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
    volumeLow: S('<path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>'),
    mute: S('<path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path d="m16 9 6 6M22 9l-6 6"/>'),
    sun: S('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    bolt: F('<path d="M13.5 2 4.5 13.5h6.5L10 22l9-11.5h-6.5z"/>'),
    screenshot: S('<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3.5"/>'),
    lock: S('<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    calc: S('<rect x="5" y="2" width="14" height="20" rx="2.5"/><path d="M8.5 6.5h7M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h.01M15.5 18h.01"/>'),
    folder: S('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    terminal: S('<rect x="2" y="4" width="20" height="16" rx="2.5"/><path d="m6 9 3 3-3 3M12 15h5"/>'),
    activity: S('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
    wifi: S('<path d="M5 12.55a11 11 0 0 1 14 0M8.5 16.1a6 6 0 0 1 7 0M2 8.82a15 15 0 0 1 20 0"/><path d="M12 20h.01"/>'),
    bluetooth: S('<path d="m7 7 10 10-5 5V2l5 5L7 17"/>'),
    gear: S('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
    trash: S('<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'),
    x: S('<path d="M18 6 6 18M6 6l12 12"/>'),
    clipboard: S('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>'),
    check: S('<path d="M20 6 9 17l-5-5"/>'),
    download: S('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),
    power: S('<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>'),
    bell: S('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
    grid: S('<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>'),
    palette: S('<path d="M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-2.5a1.5 1.5 0 0 0-1.1 2.5c.4.4.6.9.6 1.4 0 1.2-1 2.1-3 2.1z"/><circle cx="7.5" cy="11" r="1.3" fill="currentColor"/><circle cx="10.5" cy="6.8" r="1.3" fill="currentColor"/><circle cx="15.5" cy="7.3" r="1.3" fill="currentColor"/>'),
    arrowDown: S('<path d="M12 4v15M6 13l6 6 6-6"/>'),
    arrowUp: S('<path d="M12 20V5M6 11l6-6 6 6"/>'),
    external: S('<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
    globe: S('<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5a14.5 14.5 0 0 1 0 19 14.5 14.5 0 0 1 0-19z"/>'),
    quote: S('<path d="M3 21c3 0 7-1 7-8V5H3v7h4c0 3-1 5-4 5z"/><path d="M14 21c3 0 7-1 7-8V5h-7v7h4c0 3-1 5-4 5z"/>'),
    mixer: S('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
    mic: S('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8"/>'),
    micOff: S('<path d="M2 2l20 20M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.8"/><path d="M17 16.9A7 7 0 0 1 5 11v-1M19 10v1a7 7 0 0 1-.1 1.3M12 18v4M8 22h8"/>'),
    camera: S('<path d="M23 7l-7 5 7 5z"/><rect x="1" y="5" width="15" height="14" rx="2.5"/>'),
    headphones: S('<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>'),
    usb: S('<circle cx="10" cy="19" r="2.5"/><path d="M10 16.5V3M10 3 7.5 6M10 3l2.5 3M10 13l5-3V7M10 10.5 6 8V6"/><rect x="13.5" y="5" width="3" height="2.5" rx=".5"/><circle cx="6" cy="5.3" r="1.2"/>'),
    phone: S('<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>'),
    clock: S('<circle cx="12" cy="12" r="9.5"/><path d="M12 7v5l3 2"/>'),
    bellOff: S('<path d="M8.7 3A6 6 0 0 1 18 8a21 21 0 0 0 .6 5M17 17H3s3-2 3-9a4.7 4.7 0 0 1 .3-1.7M10.3 21a1.94 1.94 0 0 0 3.4 0M2 2l20 20"/>'),
    sparkle: S('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
    save: S('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>'),
    text: S('<path d="M4 7V4h16v3M9 20h6M12 4v16"/>'),
    keyboard: S('<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M10 13h4M7 16h10"/>'),
    // ---- idle pill: sky + weather (multi-colour, sized by CSS)
    skySun: '<svg viewBox="0 0 24 24"><g class="rays" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 1.6v2.6M12 19.8v2.6M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M1.6 12h2.6M19.8 12h2.6M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/></g><circle cx="12" cy="12" r="4.8" fill="currentColor"/></svg>',
    skyMoon: '<svg viewBox="0 0 24 24"><path d="M20.4 14.6A8.6 8.6 0 1 1 9.4 3.6a6.9 6.9 0 0 0 11 11z" fill="currentColor"/><circle cx="17.5" cy="5" r="1" fill="currentColor" opacity=".8"/><circle cx="21" cy="9" r=".7" fill="currentColor" opacity=".6"/></svg>',
    chip: S('<rect x="6" y="6" width="12" height="12" rx="2.5"/><rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="currentColor" stroke="none"/><path d="M9.5 2.5v3M14.5 2.5v3M9.5 18.5v3M14.5 18.5v3M2.5 9.5h3M2.5 14.5h3M18.5 9.5h3M18.5 14.5h3"/>'),
    ram: S('<rect x="2.5" y="7" width="19" height="9.5" rx="2"/><path d="M6.5 10v3M10.5 10v3M14.5 10v3M18 10v3M5 16.5v2.5M19 16.5v2.5"/>'),
    netDown: S('<circle cx="12" cy="12" r="9.5" opacity=".35"/><path d="M12 6.5v10M7.8 12.6 12 16.8l4.2-4.2"/>'),
    wxClear: '<svg viewBox="0 0 24 24"><g stroke="#ffd60a" stroke-width="2" stroke-linecap="round"><path d="M12 2v2.4M12 19.6V22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2 12h2.4M19.6 12H22M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/></g><circle cx="12" cy="12" r="4.6" fill="#ffd60a"/></svg>',
    wxClearN: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8.2 8.2 0 1 1 9.5 4a6.6 6.6 0 0 0 10.5 10.5z" fill="#e6e9ff"/></svg>',
    wxPartly: '<svg viewBox="0 0 24 24"><circle cx="8.5" cy="8.5" r="3.6" fill="#ffd60a"/><g stroke="#ffd60a" stroke-width="1.7" stroke-linecap="round"><path d="M8.5 1.8v1.6M2 8.5h1.6M3.9 3.9l1.1 1.1M13.1 3.9 12 5"/></g><path d="M8.6 20h9.2a3.6 3.6 0 0 0 .5-7.15 5 5 0 0 0-9.6 1.1A3.05 3.05 0 0 0 8.6 20z" fill="#dfe5f0"/></svg>',
    wxPartlyN: '<svg viewBox="0 0 24 24"><path d="M13 9.6A5.6 5.6 0 1 1 6.2 2.8a4.5 4.5 0 0 0 6.8 6.8z" fill="#e6e9ff"/><path d="M8.6 20h9.2a3.6 3.6 0 0 0 .5-7.15 5 5 0 0 0-9.6 1.1A3.05 3.05 0 0 0 8.6 20z" fill="#c9d1e0"/></svg>',
    wxCloud: '<svg viewBox="0 0 24 24"><path d="M6.8 19h10.6a4.3 4.3 0 0 0 .6-8.55A6 6 0 0 0 6.6 11.6 3.75 3.75 0 0 0 6.8 19z" fill="#d4dbe8"/></svg>',
    wxRain: '<svg viewBox="0 0 24 24"><path d="M6.8 15h10.6a4.3 4.3 0 0 0 .6-8.55A6 6 0 0 0 6.6 7.6 3.75 3.75 0 0 0 6.8 15z" fill="#c4cde0"/><g stroke="#5eb0ff" stroke-width="2" stroke-linecap="round"><path d="M8.5 17.5 7.5 20.5M12.5 17.5l-1 3M16.5 17.5l-1 3"/></g></svg>',
    wxStorm: '<svg viewBox="0 0 24 24"><path d="M6.8 14h10.6a4.3 4.3 0 0 0 .6-8.55A6 6 0 0 0 6.6 6.6 3.75 3.75 0 0 0 6.8 14z" fill="#aab4c8"/><path d="M12.8 13.5 9.6 18.2h2.8l-1.4 4.3 4.4-5.9h-2.9l1.6-3.1z" fill="#ffd60a"/></svg>',
    wxSnow: '<svg viewBox="0 0 24 24"><path d="M6.8 14.5h10.6a4.3 4.3 0 0 0 .6-8.55A6 6 0 0 0 6.6 7.1 3.75 3.75 0 0 0 6.8 14.5z" fill="#dfe8f5"/><g fill="#ffffff"><circle cx="8.5" cy="18" r="1.2"/><circle cx="12.5" cy="20" r="1.2"/><circle cx="16.5" cy="18" r="1.2"/></g></svg>',
    wxFog: '<svg viewBox="0 0 24 24"><g stroke="#c4ccd8" stroke-width="2" stroke-linecap="round"><path d="M4 8h16M2.5 12h19M5 16h14M8 20h8"/></g></svg>',
    ethernet: S('<rect x="7" y="3" width="10" height="7" rx="1.5"/><path d="M9.5 3v2.5M12 3v2.5M14.5 3v2.5M12 10v4M5 21v-4h14v4M12 14v3"/>'),
    wifiOff: S('<path d="M2 2l20 20M8.5 16.4a5 5 0 0 1 7 0M5 12.8a10 10 0 0 1 4.3-2.4M15.7 10.5A10 10 0 0 1 19 12.8M2 9a15 15 0 0 1 4.2-2.6M11 5.1A15 15 0 0 1 22 9"/><path d="M12 20h.01"/>'),
    sideways: S('<rect x="3" y="4" width="18" height="16" rx="3"/><rect x="16" y="8" width="2.5" height="8" rx="1.25" fill="currentColor"/>'),
    plug: S('<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a6 6 0 0 1-12 0V8z"/>'),
  };

  window.ICONS = ICONS;
  window.icon = name => ICONS[name] || '';
  window.hydrateIcons = (root = document) => {
    root.querySelectorAll('i[data-icon]').forEach(el => {
      if (!el.dataset.done) { el.innerHTML = ICONS[el.dataset.icon] || ''; el.dataset.done = '1'; }
    });
  };
})();
