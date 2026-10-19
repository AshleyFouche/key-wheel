// Small line-icon set used across ASH//FLOW (24×24, drawn with currentColor).
(function () {
  const s = (body, fill) => `<svg class="ico${fill ? " fill" : ""}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  window.IC = {
    likeAdd: s('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'),
    liked: s('<circle cx="12" cy="12" r="10" fill="#1ed760"/><path d="M7.5 12.3l3 3 6-6.4" fill="none" stroke="#000" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
    shuffle: s('<path d="M4 7h3.5c1.6 0 3 .8 3.9 2.1l2.2 3.3c.9 1.3 2.3 2.1 3.9 2.1H20"/><path d="M4 17h3.5c1.2 0 2.3-.5 3.1-1.3M13.4 8.3c.8-.8 1.9-1.3 3.1-1.3H20"/><path d="M17.5 4.5 20 7l-2.5 2.5M17.5 12 20 14.5 17.5 17"/>'),
    play: s('<path d="M8 5.6v12.8c0 .8.9 1.3 1.6.9l10-6.4c.6-.4.6-1.4 0-1.8l-10-6.4C8.9 4.3 8 4.8 8 5.6z"/>', 1),
    pause: s('<rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/>', 1),
    prev: s('<rect x="4.5" y="5" width="2.6" height="14" rx="1.1"/><path d="M19 6.3v11.4c0 .8-.9 1.3-1.6.8L9.6 13c-.7-.4-.7-1.5 0-2l7.8-5.5c.7-.5 1.6 0 1.6.8z"/>', 1),
    next: s('<rect x="16.9" y="5" width="2.6" height="14" rx="1.1"/><path d="M5 6.3v11.4c0 .8.9 1.3 1.6.8l7.8-5.5c.7-.4.7-1.5 0-2L6.6 5.5C5.9 5 5 5.5 5 6.3z"/>', 1),
    reconnect: s('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>'),
    queue: s('<path d="M4 6h12M4 11h12M4 16h7"/><path d="M18 13v6M15 16h6"/>'),
    crate: s('<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M8 8V5h8v3M9 13h6"/>'),
    mix: s('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/>'),
    artist: s('<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6"/>'),
    album: s('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.2"/>'),
    open: s('<path d="M14 5h5v5M19 5l-8 8"/><path d="M17 14v4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 18V8.5A1.5 1.5 0 0 1 6.5 7H10"/>'),
    close: s('<path d="M6 6l12 12M18 6L6 18"/>'),
    refresh: s('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>'),
    phone: s('<rect x="7" y="3" width="10" height="18" rx="2.2"/><path d="M11 17.5h2"/>'),
    laptop: s('<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M3 19h18"/>'),
    speaker: s('<rect x="6" y="3" width="12" height="18" rx="2.5"/><circle cx="12" cy="14" r="3.2"/><circle cx="12" cy="7.3" r="1"/>'),
    tv: s('<rect x="3" y="5" width="18" height="12" rx="1.8"/><path d="M9 20h6"/>'),
    car: s('<path d="M5 16V12l2-5h10l2 5v4"/><path d="M4 16h16"/><circle cx="8" cy="16.5" r="1.4"/><circle cx="16" cy="16.5" r="1.4"/>'),
    vol0: s('<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path d="M16 9.5l4 5M20 9.5l-4 5"/>'),
    vol1: s('<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"/>'),
    vol2: s('<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10"/>'),
    chev: s('<path d="M7 10l5 5 5-5"/>')
  };
})();
