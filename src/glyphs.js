// @ts-check
// The line-art glyph set a layer's categories and its switch can name. Shared by the
// engine's markers and the menu's chips: it is plain markup, so neither side reaches
// across the split to get at it.
/** 24x24, stroked in the caller's ink. */
export const GLYPHS = {
  monument: '<path d="M4 21h16M6 21V11M10 21V11M14 21V11M18 21V11M3 11l9-6 9 6z"/>',
  temple: '<path d="M12 2v2M8 9l4-5 4 5M6 9h12M7 9v12h10V9M12 21v-5M10 16h4"/>',
  leaf: '<path d="M4 20c0-8 6-14 16-16-2 10-8 16-16 16zM4 20l9-9"/>',
  wave: '<path d="M3 19c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0M12 4a7 7 0 0 1 7 7H5a7 7 0 0 1 7-7zM12 11v4"/>',
  mountain: '<path d="M3 20l6-11 4 6 3-4 5 9zM9 9l1.5 2.5L12 9"/>',
  paw: '<circle cx="7" cy="9" r="1.8"/><circle cx="12" cy="6" r="1.8"/><circle cx="17" cy="9" r="1.8"/><path d="M12 12c-3 0-5.5 2.6-5.5 5.2 0 1.4.9 1.8 1.8 1.8 1.6 0 2.2-.9 3.7-.9s2.1.9 3.7.9c.9 0 1.8-.4 1.8-1.8C17.5 14.6 15 12 12 12z"/>',
  city: '<path d="M3 21h18M5 21V9h5v12M10 21V4h6v17M16 21v-8h4v8M7 12h1M7 15h1M12 8h2M12 12h2M12 16h2"/>',
  pin: '<path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>',
  road: '<path d="M8 21L10 3M16 21L14 3M12 7v3M12 13v3"/>',
  rail: '<path d="M9 21L7 3M17 21L15 3M5 8h13M4 14h13"/>',
};

export function glyphSvg(name) {
  const body = GLYPHS[name] || GLYPHS.pin;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
