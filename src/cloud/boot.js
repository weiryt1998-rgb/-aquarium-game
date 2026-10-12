import { formatNumber, escapeHtml, uid } from '../utils/math.js';
import { summarizeGame } from '../shared/economy.js';
import { migrateDoc } from '../shared/saveDoc.js';
import { AuthScreen } from './AuthScreen.js';
import { readCloudConfig } from './config.js';
import { authErrorInfo, currentUser, initFirebase, signInPlayer, signOutPlayer } from './firebase.js';
import { downloadJson, fileStamp, isLegacyHandled, markLegacyHandled, readLegacySave } from './legacy.js';
import { replayOrphans } from './outbox.js';
import { cloudErrorText, createTransport, errorCode } from './transports.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function summaryHtml(s, label) {
  const date = s.savedAt ? `<li><span>บันทึกล่าสุด</span><b>${escapeHtml(new Date(s.savedAt).toLocaleString('th-TH'))}</b></li>` : '';
  return `
    <ul class="auth-summary">
      ${label ? `<li class="auth-summary-head">${escapeHtml(label)}</li>` : ''}
      <li><span>เหรียญ</span><b>${formatNumber(s.coins)}</b></li>
      <li><span>เพชร</span><b>${formatNumber(s.gems)}</b></li>
      <li><span>ปลา</span><b>${formatNumber(s.fish)} ตัว</b></li>
      <li><span>ตู้</span><b>${formatNumber(s.tanks)} ตู้</b></li>
      ${date}
    </ul>`;
}

/** สร้างเซฟกลางครั้งแรก (ใหม่ หรือ นำเข้าจากเซฟเก่าในเครื่อง) — สร้างได้ครั้งเดียว ถ้ามีเครื่องอื่นสร้างก่อนจะใช้ของเครื่องนั้น */
async function setupNewSave(screen, transport, legacy) {
  for (;;) {
    let mode = 'new';
    if (legacy) {
      mode = await screen.choose({
        title: 'ยังไม่มีเซฟกลาง',
        state: 'no-save-legacy',
        body: `<p>พบเซฟเก่าในเครื่องนี้ ต้องการนำเข้าเป็นเซฟกลางหรือไม่?</p>${summaryHtml(legacy.summary)}
          <p class="hint">นำเข้าแล้วผู้เล่นทุกเครื่องจะเล่นต่อจากเซฟนี้ · เซฟในเครื่องยังเก็บไว้เหมือนเดิม ไม่ถูกลบ</p>`,
        actions: [
          { id: 'import', label: 'นำเข้าเซฟนี้', kind: 'primary' },
          { id: 'new', label: 'เริ่มเกมใหม่แทน' },
        ],
      });
      if (mode === 'new') {
        const sure = await screen.choose({
          title: 'เริ่มเกมใหม่โดยไม่นำเข้า?',
          body: '<p>เซฟเก่าในเครื่องนี้จะไม่ถูกนำขึ้นคลาวด์ (แต่ยังเก็บไว้ในเครื่อง)</p>',
          actions: [
            { id: 'yes', label: 'เริ่มเกมใหม่', kind: 'primary' },
            { id: 'back', label: 'ย้อนกลับ' },
          ],
        });
        if (sure !== 'yes') continue;
      }
    } else {
      await screen.choose({
        title: 'ยังไม่มีเซฟกลาง',
        state: 'no-save',
        body: `<p>เกมนี้ยังไม่เคยสร้างเซฟกลาง</p>
          <p class="hint">ถ้ามีเซฟเก่าอยู่ในอุปกรณ์อื่น ให้เข้าสู่ระบบจากอุปกรณ์นั้นก่อน เพื่อนำเซฟนั้นขึ้นเป็นเซฟกลาง</p>`,
        actions: [{ id: 'new', label: 'สร้างเซฟกลางใหม่', kind: 'primary' }],
      });
    }
    screen.busy(mode === 'import' ? 'กำลังนำเข้าเซฟ…' : 'กำลังสร้างเซฟกลาง…');
    try {
      const res = await transport.init({ mode, legacy: mode === 'import' ? legacy.data : undefined });
      return { doc: res.doc, created: res.created, imported: res.created && mode === 'import' };
    } catch (err) {
      console.error(err);
      await screen.choose({ title: 'สร้างเซฟกลางไม่สำเร็จ', body: `<p>${escapeHtml(cloudErrorText(err))}</p>`, actions: [{ id: 'retry', label: 'ลองใหม่', kind: 'primary' }] });
      return null;
    }
  }
}

/** เครื่องนี้มีเซฟเก่า แต่เซฟกลางมีข้อมูลแล้ว → ไม่ทับอัตโนมัติ ให้ผู้เล่นเลือก */
async function resolveLegacyConflict(screen, transport, legacy, doc) {
  for (;;) {
    const choice = await screen.choose({
      title: 'พบเซฟเก่าในเครื่องนี้',
      state: 'legacy-conflict',
      body: `<p>เซฟกลางมีข้อมูลอยู่แล้ว จึง<b>ไม่ได้</b>นำเซฟในเครื่องนี้ขึ้นไปทับ</p>
        <div class="auth-compare">${summaryHtml(legacy.summary, 'เซฟในเครื่องนี้')}${summaryHtml(summarizeGame(doc.game), 'เซฟกลาง (คลาวด์)')}</div>`,
      actions: [
        { id: 'cloud', label: 'เล่นเซฟกลางต่อ', kind: 'primary' },
        { id: 'download', label: 'ดาวน์โหลดเซฟเครื่องนี้' },
        { id: 'replace', label: 'แทนที่เซฟกลาง…', kind: 'danger' },
      ],
    });
    if (choice === 'cloud') {
      markLegacyHandled(legacy);
      return null;
    }
    if (choice === 'download') {
      downloadJson(`aquarium-local-save-${fileStamp()}.json`, legacy.data);
      continue;
    }
    const ok = await screen.confirmTyped({
      title: 'แทนที่เซฟกลางด้วยเซฟเครื่องนี้?',
      body: '<p>ระบบจะ<b>สำรองเซฟกลางปัจจุบันไว้บนคลาวด์</b>ก่อน แล้วแทนที่ด้วยเซฟในเครื่องนี้ ผู้เล่นทุกเครื่องจะเห็นข้อมูลชุดใหม่ (กู้คืนได้จากเมนู เซฟคลาวด์)</p>',
      word: 'แทนที่',
      confirmLabel: 'แทนที่เซฟกลาง',
    });
    if (!ok) continue;
    screen.busy('กำลังสำรองและแทนที่เซฟกลาง…');
    try {
      const res = await transport.admin('replace', { legacy: legacy.data, expectedRevision: doc.revision, confirm: 'replace' });
      markLegacyHandled(legacy);
      return res.doc;
    } catch (err) {
      await screen.choose({ title: 'แทนที่ไม่สำเร็จ', body: `<p>${escapeHtml(cloudErrorText(err))}</p>`, actions: [{ id: 'ok', label: 'ตกลง', kind: 'primary' }] });
      return null;
    }
  }
}

/**
 * ขั้นตอนก่อนเริ่มเกม: ตรวจค่าตั้ง → เข้าสู่ระบบ → ตรวจสิทธิ์ → โหลดเซฟกลาง (หรือสร้าง/นำเข้าครั้งแรก)
 * เกมเริ่มได้หลังโหลดเซฟกลางสำเร็จเท่านั้น → ไม่มีทางเอาค่าเริ่มต้นไปเขียนทับเซฟบนคลาวด์
 * @returns {Promise<null | object>} null = หยุดอยู่ที่หน้าข้อความ (เช่น ยังไม่ได้ตั้งค่า)
 */
export async function startCloudSession(uiRoot) {
  const screen = new AuthScreen(uiRoot);
  const cfg = readCloudConfig();
  if (!cfg.ok) {
    screen.choose({
      title: 'ยังไม่ได้ตั้งค่า Firebase',
      state: 'config-missing',
      body: `<p>ผู้ดูแลต้องตั้งค่าตัวแปรต่อไปนี้ก่อน build เกม (ดู <code>.env.example</code> และ <code>docs/CLOUD_SAVE.md</code>)</p>
        <ul class="auth-list">${cfg.missing.map((k) => `<li><code>${escapeHtml(k)}</code></li>`).join('')}</ul>`,
      actions: [],
    });
    return null;
  }

  let fb;
  try {
    fb = initFirebase(cfg);
  } catch (err) {
    console.error(err);
    screen.choose({ title: 'เริ่มระบบ Firebase ไม่สำเร็จ', body: `<p>${escapeHtml(err.message)}</p>`, actions: [] });
    return null;
  }
  const writer = uid('w'); // หน้าเกมนี้ (ใหม่ทุกครั้งที่เปิด/รีเฟรช)
  const transport = createTransport(fb, cfg, { writer });

  screen.busy('กำลังตรวจสอบการเข้าสู่ระบบ…');
  let user = await currentUser(fb.auth);
  let loginError = null;
  const logout = async () => {
    await signOutPlayer(fb);
    user = null;
    loginError = null;
  };

  for (;;) {
    if (!user) {
      const password = await screen.askPassword({ error: loginError, email: cfg.accountEmail });
      screen.busy('กำลังเข้าสู่ระบบ…');
      try {
        user = await signInPlayer(fb, cfg.accountEmail, password);
        loginError = null;
      } catch (err) {
        loginError = authErrorInfo(err);
        // log เฉพาะประเภทและ code (ไม่มีรหัสผ่าน) เพื่อช่วยตรวจปัญหาจาก DevTools
        console.warn(`เข้าสู่ระบบไม่สำเร็จ [${loginError.kind}] ${loginError.code} · project ${cfg.firebase.projectId}`);
        if (err?.code !== 'auth/too-many-requests') await wait(700); // ชะลอการเดารหัส
        continue;
      }
    }

    screen.busy('กำลังตรวจสอบสิทธิ์…');
    if ((await transport.checkAccess(user.uid)) === 'denied') {
      const choice = await screen.choose({
        title: 'บัญชีนี้ยังไม่ได้รับสิทธิ์เข้าเซฟกลาง',
        state: 'no-access',
        body: `<p>รหัสผ่านถูกต้อง แต่บัญชีนี้ยังไม่อยู่ในรายชื่อผู้เล่น</p>
          <p class="hint">${
            cfg.mode === 'functions'
              ? `ผู้ดูแล: สร้างเอกสาร <code>gameAccess/${escapeHtml(user.uid)}</code> ใน Firestore (ดู docs/CLOUD_SAVE.md)`
              : `ผู้ดูแล: รัน <code>npm run set-player-uid -- ${escapeHtml(user.uid)}</code> แล้ว <code>npm run deploy</code> (ดู docs/CLOUD_SAVE.md)`
          }</p>`,
        actions: [
          { id: 'retry', label: 'ตรวจสอบอีกครั้ง', kind: 'primary' },
          { id: 'logout', label: 'ออกจากระบบ' },
        ],
      });
      if (choice === 'logout') await logout();
      continue;
    }

    screen.busy('กำลังโหลดเซฟกลาง…');
    let loaded;
    try {
      loaded = await transport.load();
    } catch (err) {
      console.warn(err);
      const offline = errorCode(err) === 'offline';
      const choice = await screen.choose({
        title: offline ? 'ออฟไลน์' : 'โหลดเซฟกลางไม่สำเร็จ',
        state: offline ? 'offline' : 'load-error',
        body: `<p>${escapeHtml(offline ? 'ต้องเชื่อมต่ออินเทอร์เน็ตเพื่อโหลดเซฟกลางครั้งแรกบนเครื่องนี้' : cloudErrorText(err))}</p>
          <p class="hint">เกมยังไม่เริ่ม จึงไม่มีการเขียนอะไรทับเซฟกลาง</p>`,
        actions: [
          { id: 'retry', label: 'ลองใหม่', kind: 'primary' },
          { id: 'logout', label: 'ออกจากระบบ' },
        ],
      });
      if (choice === 'logout') await logout();
      continue;
    }

    let { doc } = loaded;
    const { fromCache } = loaded;
    const notices = [];
    let isNewGame = false;
    const legacy = readLegacySave();
    if (!doc) {
      if (fromCache) {
        await screen.choose({ title: 'ออฟไลน์', state: 'offline', body: '<p>เชื่อมต่ออินเทอร์เน็ตก่อน เพื่อตรวจสอบเซฟกลาง</p>', actions: [{ id: 'retry', label: 'ลองใหม่', kind: 'primary' }] });
        continue;
      }
      const setup = await setupNewSave(screen, transport, legacy);
      if (!setup) continue;
      doc = setup.doc;
      isNewGame = setup.created && !setup.imported;
      if (setup.imported) markLegacyHandled(legacy);
      if (!setup.created) notices.push('มีอุปกรณ์อื่นสร้างเซฟกลางไว้ก่อนแล้ว — ใช้เซฟนั้น (ไม่ได้สร้างใหม่ทับ)');
    } else if (legacy && !fromCache && !isLegacyHandled(legacy)) {
      const replaced = await resolveLegacyConflict(screen, transport, legacy, doc);
      if (replaced) {
        doc = replaced;
        notices.push('แทนที่เซฟกลางด้วยเซฟเก่าของเครื่องนี้แล้ว (เซฟกลางเดิมถูกสำรองไว้บนคลาวด์)');
      }
    }

    try {
      migrateDoc(doc);
    } catch (err) {
      await screen.choose({ title: 'ต้องอัปเดตเกม', body: `<p>${escapeHtml(err.message)}</p>`, actions: [{ id: 'reload', label: 'รีเฟรชหน้าเว็บ', kind: 'primary' }] });
      location.reload();
      return null;
    }

    if (!fromCache) {
      const orphan = await replayOrphans(transport, user.uid, writer, doc);
      doc = orphan.doc;
      if (orphan.replayed) notices.push(`บันทึกการกระทำที่ค้างจากครั้งก่อนแล้ว ${orphan.replayed} รายการ${orphan.rejected ? ` (ไม่ผ่านการตรวจ ${orphan.rejected} รายการ)` : ''}`);
    } else {
      notices.push('ออฟไลน์อยู่ — แสดงเซฟล่าสุดที่เครื่องนี้เคยโหลด การเปลี่ยนแปลงจะถูกบันทึกเมื่อกลับมาออนไลน์');
    }

    screen.busy('โหลดเซฟกลางสำเร็จ กำลังเตรียมตู้ปลา…');
    return { cfg, fb, transport, user, writer, doc, fromCache, isNewGame, notices, signOut: () => signOutPlayer(fb) };
  }
}
