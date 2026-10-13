import '@fontsource/fredoka/latin-600.css';
import '@fontsource/fredoka/latin-700.css';

/** ชื่อเกม */
export const GAME_NAME = 'MyAquarium11';

/**
 * โลโก้ชื่อเกม (ใช้ทั้งหน้าเข้าสู่ระบบและหน้าเริ่มเกม)
 * "My" ตัวเล็กเอียงขึ้น · "Aquarium" ตัวใหญ่ไล่สีเหมือนน้ำ · "11" ในฟองอากาศสีทอง
 * ฟองอากาศลอยขึ้นและเส้นคลื่นใต้ชื่อเป็น CSS ล้วน (ไม่ต้องโหลดรูป)
 */
export function brandLogoHtml() {
  return /* html */ `
    <div class="brand" role="img" aria-label="${GAME_NAME}">
      <span class="brand-bubbles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
      <span class="brand-fish" aria-hidden="true">🐠</span>
      <h1 class="brand-title" aria-hidden="true">
        <span class="brand-my">My</span><span class="brand-aqua">Aquarium</span><span class="brand-num">11</span>
      </h1>
      <svg class="brand-wave" viewBox="0 0 320 18" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 9 Q 20 0 40 9 T 80 9 T 120 9 T 160 9 T 200 9 T 240 9 T 280 9 T 320 9" />
      </svg>
    </div>`;
}
