import './loykrathong.css';
import { ICONS } from '../ui/icons.js';

/**
 * 🪷 ธีมลอยกระทง (ชั่วคราว) — ตกแต่งหน้าเข้าเกม/หน้าเริ่มเกม, HUD ระหว่างเล่น และห้องรอบตู้ (loykrathongRoom.js)
 *
 * ไม่แตะโค้ดเกมเลย: ใส่คลาส `loykrathong` ที่ <html> แล้วให้ loykrathong.css เปลี่ยนสี
 * + เติมฉากตกแต่ง (จันทร์เต็มดวง แม่น้ำ กระทง โคมลอย โคมล้านนา) เป็น DOM ที่ pointer-events: none
 *
 * เปิดเองถึงวันที่ END (ปิดอัตโนมัติแม้ลืมลบ) · ทดสอบ: ?loykrathong=1 บังคับเปิด, ?loykrathong=0 บังคับปิด
 * เอาออกหลังเทศกาล: ลบโฟลเดอร์ src/seasonal/ และบรรทัด import ใน src/main.js
 */
const END = new Date(2026, 10, 26); // 26 พ.ย. 2026 00:00 เวลาเครื่อง (วันลอยกระทง 24 พ.ย. 2026)

function enabled() {
  const force = new URLSearchParams(location.search).get('loykrathong');
  if (force === '1') return true;
  if (force === '0') return false;
  return Date.now() < END.getTime();
}

const LOTUS_FAVICON =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🪷</text></svg>";

/** กลีบตองพับรอบขอบกระทง: เรียงตามครึ่งวงรี (หลัง = โค้งบน, หน้า = โค้งล่าง) เอียงออกจากกลาง */
function leafRow(cy, rx, ry, count, size, front, cls) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const a = Math.PI * (i / (count - 1));
    const x = 60 - Math.cos(a) * rx;
    const y = cy + (front ? 1 : -1) * Math.sin(a) * ry;
    const tilt = (-Math.cos(a) * 28).toFixed(1);
    out += `<path class="${cls}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${tilt})" d="M${-size * 0.42} 0 L0 ${-size} L${size * 0.42} 0 Z"/>`;
  }
  return out;
}

const petals = (angles, len, cls) =>
  angles.map((deg) => `<path class="${cls}" transform="translate(60 56) rotate(${deg})" d="M0 0 C-7 -6 -7 -${len * 0.7} 0 -${len} C7 -${len * 0.7} 7 -6 0 0 Z"/>`).join('');

const KRATHONG_INNER = /* html */ `
  <ellipse class="lk-kt-glow" cx="60" cy="74" rx="56" ry="9"/>
  ${leafRow(60, 46, 9, 9, 15, false, 'lk-kt-leaf lk-kt-leaf-back')}
  <path class="lk-kt-base" d="M10 62 Q60 84 110 62 L104 72 Q60 90 16 72 Z"/>
  <ellipse class="lk-kt-top" cx="60" cy="61" rx="50" ry="10"/>
  ${petals([-62, 62], 22, 'lk-kt-petal')}
  ${petals([-34, 34], 26, 'lk-kt-petal')}
  <g class="lk-kt-incense"><path d="M50 58 L44 24"/><path d="M53 58 L50 22"/><path d="M56 58 L56 23"/></g>
  <circle class="lk-kt-ember" cx="44" cy="24" r="1.4"/><circle class="lk-kt-ember" cx="50" cy="22" r="1.4"/><circle class="lk-kt-ember" cx="56" cy="23" r="1.4"/>
  <rect class="lk-kt-candle" x="62" y="30" width="6" height="24" rx="1.5"/>
  <circle class="lk-kt-flame-glow" cx="65" cy="22" r="13"/>
  <path class="lk-kt-flame" d="M65 12 C60 19 61 26 65 28 C69 26 70 19 65 12 Z"/>
  <path class="lk-kt-flame-core" d="M65 18 C63 22 63 25 65 26 C67 25 67 22 65 18 Z"/>
  ${petals([-12, 12], 30, 'lk-kt-petal lk-kt-petal-front')}
  <circle class="lk-kt-marigold" cx="30" cy="64" r="4.2"/><circle class="lk-kt-marigold" cx="90" cy="64" r="4.2"/>
  <circle class="lk-kt-marigold lk-kt-marigold-2" cx="44" cy="69" r="3.6"/><circle class="lk-kt-marigold lk-kt-marigold-2" cx="76" cy="69" r="3.6"/>
  ${leafRow(62, 50, 11, 11, 13, true, 'lk-kt-leaf')}`;

const krathong = (cls) => /* html */ `
  <div class="lk-krathong ${cls}" aria-hidden="true"><svg viewBox="0 0 120 90">${KRATHONG_INNER}</svg></div>`;

/** โคมลอย (โคมไฟกระดาษ ลอยขึ้นฟ้า) */
const skyLantern = (cls) => /* html */ `
  <svg class="lk-sky ${cls}" viewBox="0 0 40 54" aria-hidden="true">
    <path class="lk-sky-body" d="M7 8 Q20 1 33 8 L37 44 Q20 50 3 44 Z"/>
    <path class="lk-sky-shine" d="M12 10 Q20 6 28 10 L30 40 Q20 44 10 40 Z"/>
    <ellipse class="lk-sky-mouth" cx="20" cy="45" rx="16" ry="3.5"/>
    <ellipse class="lk-sky-fire" cx="20" cy="45" rx="5" ry="2.4"/>
  </svg>`;

/** โคมล้านนาห้อยด้าย */
const hangingLantern = (cls) => /* html */ `
  <div class="lk-hang ${cls}" aria-hidden="true">
    <i class="lk-hang-thread"></i>
    <svg viewBox="0 0 40 74">
      <rect class="lk-hang-cap" x="12" y="0" width="16" height="5" rx="1.5"/>
      <path class="lk-hang-body" d="M12 5 C1 12 1 38 12 45 L28 45 C39 38 39 12 28 5 Z"/>
      <path class="lk-hang-rib" d="M20 5 V45 M14.5 5.5 C9 14 9 36 14.5 44.5 M25.5 5.5 C31 14 31 36 25.5 44.5"/>
      <rect class="lk-hang-cap" x="12" y="45" width="16" height="5" rx="1.5"/>
      <path class="lk-hang-tassel" d="M15 50 L13 72 M18 50 L17 73 M20 50 V74 M22 50 L23 73 M25 50 L27 72"/>
    </svg>
  </div>`;

// ── ไอคอนธีมลอยกระทง (แทนอีโมจิในแถบซ้าย ui/UI.js และโหลอาหารบนปุ่มให้อาหาร) ──

const icon = (body) => `<svg class="lk-icon" viewBox="0 0 48 48" aria-hidden="true">${body}</svg>`;
const flame = (x, y) =>
  `<circle cx="${x}" cy="${y + 3}" r="6" fill="#ffc35a" opacity=".35"/><path d="M${x} ${y - 4} C${x - 2.6} ${y - 0.5} ${x - 2} ${y + 2.4} ${x} ${y + 3} C${x + 2} ${y + 2.4} ${x + 2.6} ${y - 0.5} ${x} ${y - 4} Z" fill="#ffa52a"/><path d="M${x} ${y - 0.6} C${x - 1} ${y + 1} ${x - 0.8} ${y + 2.2} ${x} ${y + 2.5} C${x + 0.8} ${y + 2.2} ${x + 1} ${y + 1} ${x} ${y - 0.6} Z" fill="#fff3b8"/>`;
/** กลีบตองแถวหน้ากระทง (โคนอยู่บนโค้งล่างของวงรีขอบกระทง) */
const frontLeaves = [5, 11, 17.5, 24, 30.5, 37, 43]
  .map((x) => {
    const y = 34 + 5 * Math.sqrt(Math.max(0, 1 - ((x - 24) / 21) ** 2));
    return `<path d="M${x - 3.6} ${y.toFixed(1)} L${x} ${(y - 9).toFixed(1)} L${x + 3.6} ${y.toFixed(1)} Z"/>`;
  })
  .join('');

/** กระทงขนมปัง (ปลากินได้) — ใช้ทั้งปุ่มอาหารในแถบซ้ายและปุ่มให้อาหาร */
const BREAD_KRATHONG = icon(`
  <path d="M4 29 Q24 41 44 29 L42 36 Q24 47 6 36 Z" fill="#a8652a"/>
  <ellipse cx="24" cy="29" rx="20" ry="7" fill="#e7b46a" stroke="#a8652a" stroke-width="1.5"/>
  <g fill="#c98a3e"><circle cx="11" cy="29" r="1"/><circle cx="16" cy="32.5" r="1"/><circle cx="35" cy="32" r="1"/><circle cx="39" cy="28" r="1"/><circle cx="29" cy="33.5" r="1"/></g>
  <rect x="29" y="13" width="3.4" height="15" rx="1" fill="#f6eed6"/>
  ${flame(30.7, 9)}
  <ellipse cx="14" cy="25" rx="5" ry="2" fill="#4f9a3e" transform="rotate(-24 14 25)"/>
  <g fill="#f27aa8" stroke="#c2427a" stroke-width=".8"><circle cx="20" cy="22.5" r="2.8"/><circle cx="24.6" cy="24" r="2.8"/><circle cx="23.4" cy="28.6" r="2.8"/><circle cx="18.4" cy="28.6" r="2.8"/><circle cx="16.4" cy="24.2" r="2.8"/></g>
  <circle cx="20.5" cy="25.6" r="2" fill="#ffd34d"/>`);

const SIDEBAR_ICONS = {
  // ปลาว่ายใต้จันทร์เพ็ญ
  fish: icon(`
    <circle cx="32" cy="14" r="11" fill="#fff1c4"/>
    <circle cx="28" cy="11" r="2" fill="#ecd59a"/><circle cx="36" cy="18" r="2.6" fill="#ecd59a"/>
    <path d="M8 30 L2 23 L4 30 L2 37 Z" fill="#ffcf4a" stroke="#c45d00" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M6 30 C12 21 27 20 34 29 C27 38 12 38 6 30 Z" fill="#ff9f1c" stroke="#c45d00" stroke-width="1.5"/>
    <path d="M15 24 C18 19 24 19 26 23" fill="#ffcf4a" stroke="#c45d00" stroke-width="1.2"/>
    <circle cx="28.5" cy="28" r="1.8" fill="#2a1a08"/>
    <path d="M3 43 Q9 39 15 43 T27 43 T39 43 T47 43" fill="none" stroke="#6fb3ff" stroke-width="2" stroke-linecap="round"/>`),
  // กระทงใบตอง
  decor: icon(`
    <path d="M3 34 Q24 44 45 34 L42 39 Q24 48 6 39 Z" fill="#7e9a52"/>
    <ellipse cx="24" cy="34" rx="21" ry="5" fill="#e6e3bd"/>
    <rect x="22.4" y="9" width="3.2" height="16" rx="1" fill="#f6eed6"/>
    ${flame(24, 5)}
    <g fill="#f7b3cf" stroke="#d65a8e" stroke-width="1">
      <path d="M24 33 C17 31 13 25 14 19 C19 21 23 27 24 33 Z"/><path d="M24 33 C31 31 35 25 34 19 C29 21 25 27 24 33 Z"/>
      <path d="M24 33 C20 27 21 21 24 16 C27 21 28 27 24 33 Z" fill="#fcd3e3"/>
    </g>
    <g fill="#3f9442" stroke="#26672b" stroke-width="1" stroke-linejoin="round">${frontLeaves}</g>`),
  food: BREAD_KRATHONG,
  // ร้านค้าแบบแผงตลาดงานวัด มีโคมแดงห้อย
  shop: icon(`
    <rect x="7" y="17" width="3" height="27" fill="#8a5a2b"/><rect x="38" y="17" width="3" height="27" fill="#8a5a2b"/>
    <path d="M3 12 L8 4 H40 L45 12 Z" fill="#b8232f"/>
    <g>${[0, 1, 2, 3, 4, 5]
      .map((i) => {
        const x = 3 + i * 7;
        const c = i % 2 ? '#ffd35a' : '#e8452c';
        return `<rect x="${x}" y="12" width="7" height="6" fill="${c}"/><circle cx="${x + 3.5}" cy="18" r="3.5" fill="${c}"/>`;
      })
      .join('')}</g>
    <g fill="#e8452c" stroke="#a61e2a" stroke-width=".8"><ellipse cx="17" cy="27" rx="2.6" ry="3.4"/><ellipse cx="24" cy="28" rx="2.6" ry="3.4"/><ellipse cx="31" cy="27" rx="2.6" ry="3.4"/></g>
    <g fill="#ffd35a"><rect x="15.8" y="22.6" width="2.4" height="1.4"/><rect x="22.8" y="23.6" width="2.4" height="1.4"/><rect x="29.8" y="22.6" width="2.4" height="1.4"/></g>
    <circle cx="13" cy="35" r="2.6" fill="#ff9f1c"/><circle cx="18" cy="35" r="2.6" fill="#7cc04a"/><circle cx="30" cy="35" r="2.6" fill="#f27aa8"/><circle cx="35" cy="35" r="2.6" fill="#ffd35a"/>
    <rect x="4" y="37" width="40" height="8" rx="2" fill="#c98a3e" stroke="#7a4a1a" stroke-width="1.2"/>`),
  // บัวบานในอ่าง
  garden: icon(`
    <path d="M24 32 V20" stroke="#3f8a3a" stroke-width="2"/>
    <path d="M7 32 H41 C40 40 33 45 24 45 C15 45 8 40 7 32 Z" fill="#3a6fc4" stroke="#1e4588" stroke-width="1.5"/>
    <ellipse cx="24" cy="32" rx="17" ry="3.4" fill="#6fb3ff"/>
    <ellipse cx="15" cy="31.6" rx="6" ry="1.9" fill="#4f9a3e"/><ellipse cx="33" cy="31.8" rx="4.6" ry="1.5" fill="#4f9a3e"/>
    <g fill="#f7a8c8" stroke="#d65a8e" stroke-width="1">
      <path d="M24 22 C16 21 11 15 11 9 C17 11 22 15 24 22 Z"/><path d="M24 22 C32 21 37 15 37 9 C31 11 26 15 24 22 Z"/>
      <path d="M24 22 C19 19 18 12 20 7 C23 10 25 15 24 22 Z" fill="#fbc6db"/><path d="M24 22 C29 19 30 12 28 7 C25 10 23 15 24 22 Z" fill="#fbc6db"/>
      <path d="M24 22 C21.5 17 22 10 24 4 C26 10 26.5 17 24 22 Z" fill="#fde1ec"/>
    </g>`),
};

function themeSidebar(uiRoot) {
  for (const btn of uiRoot.querySelectorAll('.sidebar button[data-action]:not([data-lk])')) {
    const svg = SIDEBAR_ICONS[btn.dataset.action];
    const ico = btn.querySelector('.ico');
    btn.dataset.lk = '';
    if (svg && ico) ico.innerHTML = svg;
  }
}

/** ฉากเต็มจอบนหน้าเข้าสู่ระบบ / หน้าเริ่มเกม (อยู่หลังโลโก้และปุ่ม) */
const SCENE_HTML = /* html */ `
  <div class="lk-scene" aria-hidden="true">
    <div class="lk-stars"></div>
    <div class="lk-moon"></div>
    ${skyLantern('lk-rise lk-rise-1')}${skyLantern('lk-rise lk-rise-2')}${skyLantern('lk-rise lk-rise-3')}${skyLantern('lk-rise lk-rise-4')}${skyLantern('lk-rise lk-rise-5')}
    ${hangingLantern('lk-hang-1')}${hangingLantern('lk-hang-2')}${hangingLantern('lk-hang-3')}
    <div class="lk-river">
      <div class="lk-moon-path"></div>
      <div class="lk-waves"><i></i><i></i></div>
    </div>
    ${krathong('lk-float lk-float-1')}${krathong('lk-float lk-float-2')}${krathong('lk-float lk-float-3')}
  </div>`;

/** ของตกแต่งระหว่างเล่น — อยู่ระหว่างตู้ปลา (canvas) กับ HUD จึงไม่บังปุ่ม และไม่ติดในภาพถ่ายตู้ */
const AMBIENT_HTML = /* html */ `
  <div class="lk-ambient" aria-hidden="true">
    <div class="lk-vignette"></div>
    ${hangingLantern('lk-hang-game lk-hang-game-l')}${hangingLantern('lk-hang-game lk-hang-game-r')}
    ${skyLantern('lk-rise lk-rise-game')}
  </div>`;

function decorateStartScreens(uiRoot) {
  for (const screen of uiRoot.querySelectorAll(':scope > .start-screen')) {
    if (!screen.querySelector(':scope > .lk-scene')) screen.insertAdjacentHTML('afterbegin', SCENE_HTML);
  }
}

if (enabled()) {
  document.documentElement.classList.add('loykrathong');
  document.querySelector('link[rel="icon"]')?.setAttribute('href', LOTUS_FAVICON);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0b1a3a');
  // ui/UI.js สร้าง HUD ทีหลังโมดูลนี้ → เปลี่ยนไอคอนในตาราง ICONS ได้ก่อนถูกใช้
  ICONS.jar = BREAD_KRATHONG;

  const uiRoot = document.getElementById('ui');
  uiRoot?.insertAdjacentHTML('beforebegin', AMBIENT_HTML);
  if (uiRoot) {
    // หน้าเข้าสู่ระบบ (cloud/AuthScreen.js), หน้าเริ่มเกม (ui/StartScreen.js) และ HUD ถูกสร้างใหม่ทีหลัง → ตามไปเติมฉาก/ไอคอน
    const decorate = () => {
      decorateStartScreens(uiRoot);
      themeSidebar(uiRoot);
    };
    decorate();
    new MutationObserver(decorate).observe(uiRoot, { childList: true });
  }
  // ของตกแต่ง 3 มิติในห้อง (กระทง ไฟประดับ โคมล้านนา) — โหลดแยกไม่ให้หน้าเข้าสู่ระบบช้าลง
  import('./loykrathongRoom.js').catch((err) => console.warn('โหลดของตกแต่งลอยกระทงไม่สำเร็จ', err));
}
