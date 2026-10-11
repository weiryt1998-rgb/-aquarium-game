/** ไอคอน SVG (เส้นจาก Feather Icons — MIT) และไอคอนสี */

const stroke = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  gear: stroke(
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  ),
  camera: stroke('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
  menu: stroke('<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>'),
  close: stroke('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  plus: stroke('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  rotate: stroke('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'),
  trash: stroke('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
  check: stroke('<polyline points="20 6 9 17 4 12"/>'),
  eye: stroke('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
  home: stroke('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'),
  jar: `<svg viewBox="0 0 64 64" aria-hidden="true">
    <rect x="15" y="8" width="34" height="11" rx="4" fill="#1d63d6"/>
    <rect x="15" y="8" width="34" height="4" rx="2" fill="#5aa0ff" opacity=".7"/>
    <rect x="11" y="17" width="42" height="40" rx="11" fill="#47a8ff"/>
    <rect x="15" y="21" width="34" height="32" rx="9" fill="#9fdcff" opacity=".45"/>
    <circle cx="32" cy="38" r="10" fill="#ffd34d" stroke="#e8a80c" stroke-width="2"/>
    <circle cx="28.5" cy="36" r="2.2" fill="#8a5200"/><circle cx="35.5" cy="40.5" r="2.2" fill="#8a5200"/><circle cx="34" cy="33.5" r="1.6" fill="#8a5200"/>
    <path d="M17 24c2-2 4-3 7-3" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".8"/>
  </svg>`,
};

export const coinIcon = '<i class="coin-icon" aria-hidden="true"></i>';
export const gemIcon = '<i class="gem-icon" aria-hidden="true"></i>';
