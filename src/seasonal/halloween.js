import './halloween.css';

/**
 * 🎃 ธีมฮาโลวีน (ชั่วคราว) — ตกแต่งหน้าเข้าเกม/หน้าเริ่มเกม, HUD ระหว่างเล่น และห้องรอบตู้ (halloweenRoom.js)
 *
 * ไม่แตะโค้ดเกมเลย: ใส่คลาส `halloween` ที่ <html> แล้วให้ halloween.css เปลี่ยนสี
 * + เติมฉากตกแต่ง (ค้างคาว ฟักทอง ผี แมงมุม ใยแมงมุม) เป็น DOM ที่ pointer-events: none
 *
 * เปิดเองถึงวันที่ END (ปิดอัตโนมัติแม้ลืมลบ) · ทดสอบ: ?halloween=1 บังคับเปิด, ?halloween=0 บังคับปิด
 * เอาออกหลังเทศกาล: ลบโฟลเดอร์ src/seasonal/ และบรรทัด import ใน src/main.js
 */
const END = new Date(2026, 10, 3); // 3 พ.ย. 2026 00:00 เวลาเครื่อง

function enabled() {
  const force = new URLSearchParams(location.search).get('halloween');
  if (force === '1') return true;
  if (force === '0') return false;
  return Date.now() < END.getTime();
}

const PUMPKIN_FAVICON =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎃</text></svg>";

const bat = (cls) => /* html */ `
  <svg class="hw-bat ${cls}" viewBox="0 0 64 32" aria-hidden="true">
    <g class="hw-wing hw-wing-l"><path d="M30 14 C22 4 12 2 2 8 C8 9 10 13 9 17 C13 14 17 16 18 20 C21 16 26 16 30 18 Z"/></g>
    <g class="hw-wing hw-wing-r"><path d="M34 14 C42 4 52 2 62 8 C56 9 54 13 55 17 C51 14 47 16 46 20 C43 16 38 16 34 18 Z"/></g>
    <path d="M32 10 l-3 -4 l1 6 C27 14 27 21 32 25 C37 21 37 14 34 12 l1 -6 Z"/>
    <circle class="hw-bat-eye" cx="30.6" cy="13.5" r="0.9"/><circle class="hw-bat-eye" cx="33.4" cy="13.5" r="0.9"/>
  </svg>`;

const spider = (cls) => /* html */ `
  <div class="hw-spider ${cls}" aria-hidden="true">
    <i class="hw-thread"></i>
    <svg viewBox="0 0 40 34">
      <g class="hw-legs" fill="none" stroke-width="2" stroke-linecap="round">
        <path d="M14 14 Q6 8 2 12"/><path d="M14 17 Q5 15 1 20"/><path d="M14 20 Q6 22 3 28"/><path d="M15 22 Q10 27 9 33"/>
        <path d="M26 14 Q34 8 38 12"/><path d="M26 17 Q35 15 39 20"/><path d="M26 20 Q34 22 37 28"/><path d="M25 22 Q30 27 31 33"/>
      </g>
      <ellipse cx="20" cy="19" rx="7" ry="8"/><circle cx="20" cy="10" r="4.5"/>
      <circle class="hw-spider-eye" cx="18.3" cy="9.6" r="1.3"/><circle class="hw-spider-eye" cx="21.7" cy="9.6" r="1.3"/>
    </svg>
  </div>`;

const pumpkin = (cls) => /* html */ `
  <svg class="hw-pumpkin ${cls}" viewBox="0 0 100 86" aria-hidden="true">
    <path class="hw-pumpkin-stem" d="M47 18 C46 10 49 4 56 1 L59 5 C54 8 53 12 54 18 Z"/>
    <path class="hw-pumpkin-leaf" d="M55 9 C63 3 74 5 77 12 C70 10 63 12 57 15 Z"/>
    <ellipse class="hw-pumpkin-body" cx="50" cy="51" rx="47" ry="33"/>
    <ellipse class="hw-pumpkin-rib" cx="50" cy="51" rx="31" ry="33"/>
    <ellipse class="hw-pumpkin-rib" cx="50" cy="51" rx="13" ry="33"/>
    <g class="hw-pumpkin-face">
      <path d="M24 40 L36 30 L41 45 Z"/><path d="M76 40 L64 30 L59 45 Z"/>
      <path d="M46 52 L50 45 L54 52 Z"/>
      <path d="M20 58 Q50 84 80 58 L72 60 L68 66 L62 61 L56 68 L50 62 L44 68 L38 61 L32 66 L28 60 Z"/>
    </g>
  </svg>`;

const ghost = (cls) => /* html */ `
  <svg class="hw-ghost ${cls}" viewBox="0 0 60 72" aria-hidden="true">
    <path class="hw-ghost-body" d="M6 30 C6 12 18 2 30 2 C42 2 54 12 54 30 L54 64 L46 58 L38 66 L30 58 L22 66 L14 58 L6 64 Z"/>
    <ellipse class="hw-ghost-eye" cx="22" cy="28" rx="3.6" ry="5"/><ellipse class="hw-ghost-eye" cx="38" cy="28" rx="3.6" ry="5"/>
    <ellipse class="hw-ghost-mouth" cx="30" cy="40" rx="4" ry="3"/>
    <ellipse class="hw-ghost-blush" cx="15" cy="37" rx="4" ry="2.2"/><ellipse class="hw-ghost-blush" cx="45" cy="37" rx="4" ry="2.2"/>
  </svg>`;

const cobweb = (cls) => /* html */ `
  <svg class="hw-cobweb ${cls}" viewBox="0 0 120 120" aria-hidden="true">
    <path d="M0 0 L120 6 M0 0 L110 46 M0 0 L84 84 M0 0 L46 110 M0 0 L6 120"/>
    <path d="M30 1.5 Q22 9 27.5 11.5 Q19 18 20.7 20.7 Q12 25 11.5 27.5 Q6 30 1.5 30"/>
    <path d="M62 3 Q48 16 57 24 Q42 34 43.5 43.5 Q32 46 24 57 Q14 50 3 62"/>
    <path d="M94 4.7 Q76 24 87 36 Q66 52 67 67 Q50 68 36 87 Q22 78 4.7 94"/>
  </svg>`;

/** ฉากเต็มจอบนหน้าเข้าสู่ระบบ / หน้าเริ่มเกม (อยู่หลังโลโก้และปุ่ม) */
const SCENE_HTML = /* html */ `
  <div class="hw-scene" aria-hidden="true">
    <div class="hw-stars"></div>
    <div class="hw-moon">${bat('hw-moon-bat')}</div>
    ${bat('hw-fly hw-fly-1')}${bat('hw-fly hw-fly-2')}${bat('hw-fly hw-fly-3')}${bat('hw-fly hw-fly-4')}
    ${spider('hw-spider-1')}${spider('hw-spider-2')}
    ${cobweb('hw-web-tl')}${cobweb('hw-web-tr')}
    ${ghost('hw-ghost-1')}${ghost('hw-ghost-2')}
    <div class="hw-fog"><i></i><i></i></div>
    ${pumpkin('hw-pumpkin-1')}${pumpkin('hw-pumpkin-2')}${pumpkin('hw-pumpkin-3')}
  </div>`;

/** ของตกแต่งระหว่างเล่น — อยู่ระหว่างตู้ปลา (canvas) กับ HUD จึงไม่บังปุ่ม และไม่ติดในภาพถ่ายตู้ */
const AMBIENT_HTML = /* html */ `
  <div class="hw-ambient" aria-hidden="true">
    <div class="hw-vignette"></div>
    ${cobweb('hw-web-tl')}${cobweb('hw-web-tr')}
    ${spider('hw-spider-game')}
    ${bat('hw-fly hw-fly-game')}
  </div>`;

function decorateStartScreens(uiRoot) {
  for (const screen of uiRoot.querySelectorAll(':scope > .start-screen')) {
    if (!screen.querySelector(':scope > .hw-scene')) screen.insertAdjacentHTML('afterbegin', SCENE_HTML);
  }
}

if (enabled()) {
  document.documentElement.classList.add('halloween');
  document.querySelector('link[rel="icon"]')?.setAttribute('href', PUMPKIN_FAVICON);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#1a0b2e');

  const uiRoot = document.getElementById('ui');
  uiRoot?.insertAdjacentHTML('beforebegin', AMBIENT_HTML);
  if (uiRoot) {
    // หน้าเข้าสู่ระบบ (cloud/AuthScreen.js) และหน้าเริ่มเกม (ui/StartScreen.js) ถูกสร้างใหม่ทีหลัง → ตามไปเติมฉาก
    decorateStartScreens(uiRoot);
    new MutationObserver(() => decorateStartScreens(uiRoot)).observe(uiRoot, { childList: true });
  }
  // ของตกแต่ง 3 มิติในห้อง (ฟักทอง เทียน ธงราว ค้างคาว) — โหลดแยกไม่ให้หน้าเข้าสู่ระบบช้าลง
  import('./halloweenRoom.js').catch((err) => console.warn('โหลดของตกแต่งฮาโลวีนไม่สำเร็จ', err));
}
