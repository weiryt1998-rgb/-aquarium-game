# 🐠 เกมเลี้ยงปลาในตู้ปลา

เกมเลี้ยงปลา 3 มิติที่เล่นผ่านเว็บเบราว์เซอร์ สร้างด้วย **Three.js + WebGL + Vite** (ไม่ใช้ Unity หรือ Unreal)
ผู้เล่นเลี้ยงปลา ตกแต่งตู้ และดูแลให้ปลามีความสุข

**▶ เล่นออนไลน์:** https://weiryt1998-rgb.github.io/-aquarium-game/

## วิธีรัน

ต้องมี Node.js 20.19 ขึ้นไป

```bash
npm install      # ติดตั้งครั้งแรก
npm run dev      # เปิดเกมที่ http://localhost:5173
npm run build    # build ไฟล์สำหรับเอาขึ้นเว็บ (ได้โฟลเดอร์ dist/)
npm run preview  # ทดลองเปิดไฟล์ที่ build แล้ว
```

## ☁️ เซฟกลาง (เล่นต่อได้ทุกอุปกรณ์)

เกมบันทึกความคืบหน้าไว้บน **Cloud Firestore** เป็นเซฟกลางชุดเดียว (`gameSaves/global`) ผู้เล่นทุกคนกรอก **รหัสผ่านเกม** เดียวกัน
(บัญชีผู้เล่นหลักบัญชีเดียวใน Firebase Authentication) แล้วเล่นเซฟเดียวกัน เห็นข้อมูลล่าสุดตรงกันแบบเรียลไทม์

- ใช้ Firebase แผน **Spark (ฟรี)** เท่านั้น — ไม่ใช้ Cloud Functions และไม่ใช้ SQL
- บันทึกด้วย Firestore transaction + เลข `revision` กันเซฟเก่าทับเซฟใหม่ · Security Rules อนุญาตเฉพาะ UID บัญชีหลัก
- ป้ายสถานะมุมขวาบนบอกว่า บันทึกแล้ว / กำลังบันทึก / บันทึกไม่สำเร็จ / ออฟไลน์
- สำรองอัตโนมัติวันละครั้งและก่อนรีเซ็ต/กู้คืน · กู้คืนได้จากเมนู ☰ → เซฟคลาวด์
- เซฟเก่าในเบราว์เซอร์ถูกถามก่อนนำเข้า และไม่ทับเซฟกลางที่มีข้อมูลแล้ว

ขั้นตอนตั้งค่า Firebase Console, วิธีตั้งรหัสผ่านเกม, โควตาฟรี และวิธีทดสอบ: **[docs/CLOUD_SAVE.md](docs/CLOUD_SAVE.md)**

```bash
npm run set-player-uid -- <UID>   # ใส่ UID บัญชีผู้เล่นหลักลง firestore.rules
npm run check:firebase            # ตรวจค่าตั้ง Firebase ในเครื่อง
npm run deploy                    # deploy เฉพาะ Firestore Security Rules (ตรวจ UID ก่อนเสมอ)

npm test                # unit tests
npm run test:rules      # Security Rules (ต้องมี Java 21+)
npm run test:e2e        # เปิดเกมจริงใน Chrome หลายเครื่องจำลอง บน Firebase Emulator
```

## ฟีเจอร์

| ฟีเจอร์ | รายละเอียด |
| --- | --- |
| เลี้ยงปลาและเพิ่มจำนวนปลา | ปลา 12 สายพันธุ์ แต่ละชนิดมีสี รูปร่าง ระดับน้ำที่ชอบ และพฤติกรรมต่างกัน (เช่น ปลานีออนว่ายเป็นฝูง) ปลาโตจากลูกปลาเป็นตัวเต็มวัย และออกลูกได้เมื่อมีตัวผู้กับตัวเมียที่มีความสุข |
| ตกแต่งตู้ปลา | พืชน้ำ หิน ขอนไม้ ปราสาท หีบสมบัติ ปะการัง หัวทรายออกซิเจน วางบนกริด ลากย้าย หมุน และขายคืนได้ |
| ให้อาหารและดูแลปลา | ความอิ่ม สุขภาพ ความสุข และความสะอาดของน้ำ อาหารที่เหลือจะเน่าทำให้น้ำขุ่น ปลาที่ถูกปล่อยปละอาจป่วยหรือตาย |
| ระบบเงินและร้านค้า | ปลาที่มีความสุขผลิตเหรียญ (แตะเพื่อเก็บ) มีภารกิจรายวัน รางวัลประจำวัน สมุดสะสมปลา และตู้ 4 ขนาดที่ปลดล็อกได้ (แต่ละตู้มีปลาและของตกแต่งแยกกัน) |
| อื่น ๆ | เซฟกลางบนคลาวด์ (เล่นต่อได้ทุกอุปกรณ์), ได้เหรียญตอนออฟไลน์, ถ่ายภาพตู้, ติดตามปลาด้วยกล้อง, ตั้งชื่อปลา, เสียงสังเคราะห์ (ไม่ต้องมีไฟล์เสียง), ปรับคุณภาพกราฟิก, รองรับมือถือ |

ส่วนกราฟิกใต้น้ำ: ลายแสงระยิบระยับบนพื้น (caustics), ลำแสงจากผิวน้ำ, ฟองอากาศ, หมอกใต้น้ำที่ขุ่นขึ้นเมื่อน้ำสกปรก, พืชน้ำโยกไหว, ปลาส่ายหางด้วย vertex shader

## การควบคุม

| การกระทำ | เมาส์ / คีย์บอร์ด | มือถือ |
| --- | --- | --- |
| หมุนกล้อง | ลากซ้าย | ลากนิ้วเดียว |
| ซูม / เลื่อนกล้อง | ล้อเมาส์ / ลากขวา | หนีบสองนิ้ว |
| เก็บเหรียญ / ดูข้อมูลปลา | คลิก | แตะ |
| ให้อาหาร | ปุ่มขวาล่าง หรือกด `F` | ปุ่มขวาล่าง |
| โหมดตกแต่ง: วาง / ย้าย | คลิกพื้นทราย / ลากของ | แตะ / ลาก |
| โหมดตกแต่ง: หมุนของ / ยกเลิก | `R` / `Esc` หรือคลิกขวา | ปุ่มหมุน / ยกเลิก |
| โหมดตกแต่ง: หมุนกล้อง | ลากขวา | สองนิ้ว |

## โครงสร้างโปรเจกต์

```
├── index.html
├── vite.config.js           ตั้งค่า Vite + ปลั๊กอินสร้างรายชื่อไฟล์โมเดล
├── public/models/           ← วางไฟล์ .glb ที่นี่ (ดู public/models/README.md)
│   ├── fish/
│   └── decor/
└── src/
    ├── main.js              จุดเริ่มโปรแกรม
    ├── config.js            ค่าสมดุลเกมทั้งหมด (อัตราหิว ความสกปรก ราคาขาย ฯลฯ)
    ├── core/
    │   ├── Game.js          ตัวควบคุมหลัก: game loop และคำสั่งซื้อ ขาย ให้อาหาร
    │   ├── GameState.js     ข้อมูลเกมที่กำลังเล่น (มาจากเซฟกลาง) + ความคืบหน้าตอนออฟไลน์
    │   ├── settings.js      การตั้งค่าเสียง/กราฟิกของแต่ละอุปกรณ์
    │   ├── EventBus.js      ระบบเหตุการณ์ + รายชื่อเหตุการณ์ทั้งหมด
    │   └── Sound.js         เสียงสังเคราะห์ด้วย Web Audio
    ├── cloud/               เซฟกลาง: เข้าสู่ระบบ, โหลด/ซิงก์ Firestore, ป้ายสถานะ, นำเข้าเซฟเก่า
    ├── shared/              กฎเกม (ราคา/คำสั่ง/ตรวจข้อมูล) ที่รันใน Firestore transaction (และ Cloud Functions ถ้าย้ายไป Blaze)
    ├── data/                ข้อมูลเกม แก้หรือเพิ่มได้โดยไม่ต้องแตะโค้ดระบบ
    │   ├── fish.js          สายพันธุ์ปลา (ราคา พฤติกรรม หน้าตาโมเดลชั่วคราว path โมเดล)
    │   ├── decor.js         ของตกแต่ง
    │   ├── tanks.js         ขนาดตู้
    │   ├── food.js          อาหารและยา
    │   └── missions.js      ภารกิจ
    ├── assets/
    │   ├── AssetLoader.js   โหลด .glb/.gltf (รองรับ Draco/Meshopt/skinned mesh)
    │   ├── ModelFactory.js  เลือกใช้ไฟล์ .glb หรือโมเดลชั่วคราว
    │   └── Thumbnailer.js   เรนเดอร์รูปตัวอย่างสำหรับร้านค้า
    ├── placeholders/        โมเดลชั่วคราวที่สร้างด้วยโค้ด (ใช้จนกว่าจะมีไฟล์ .glb)
    ├── render/              shader ต่อเติม (caustics, ว่ายน้ำ, พืชโยก) และ texture ที่วาดด้วยโค้ด
    ├── world/               ฉาก: SceneManager (กล้อง/แสง), Aquarium, Substrate, Bubbles, LightRays, Room
    ├── entities/            Fish (การว่ายและค่าสถานะ), Decoration
    ├── systems/             FishManager, FoodSystem, CoinSystem, CareSystem, DecorManager,
    │                        MissionSystem, PlacementController (โหมดตกแต่ง), InputController
    ├── ui/                  HUD, หน้าต่างเมนู (panels/), แถบตกแต่ง, การ์ดปลา, หน้าเริ่มเกม
    └── styles/main.css
```

## ใส่โมเดล .glb ภายหลัง

1. วางไฟล์ตามชื่อในตาราง [public/models/README.md](public/models/README.md) เช่น `public/models/fish/goldfish.glb`
2. เสร็จแล้ว เกมจะใช้ไฟล์นั้นแทนโมเดลชั่วคราว รวมถึงรูปตัวอย่างในร้านค้าด้วย (ถ้ารัน `npm run dev` อยู่ หน้าเว็บจะรีโหลดเอง)

ไม่ต้องแก้โค้ด ถ้าจะเปลี่ยนชื่อไฟล์ ทิศของโมเดล หรือขนาด ให้แก้ฟิลด์ `model` ใน `src/data/fish.js` หรือ `src/data/decor.js`

```js
model: { url: 'models/fish/betta.glb', rotation: [0, -Math.PI / 2, 0], scale: 1.1 }
```

ไฟล์กลางอย่าง `fish.glb`, `plant.glb`, `rock.glb` ใช้แทนได้ทุกชนิดในหมวดนั้น ถ้ายังไม่มีไฟล์เฉพาะของชนิดนั้น

## ปรับแต่ง

- **สมดุลเกม**: `src/config.js` เช่น `timeScale: 10` ทำให้เวลาในเกมเร็วขึ้น 10 เท่า สะดวกตอนทดสอบระบบโตและออกลูก
- **เพิ่มปลาชนิดใหม่**: เพิ่ม object ใน `FISH_SPECIES` (`src/data/fish.js`) แล้วกำหนด `look` สำหรับโมเดลชั่วคราว
- **เพิ่มของตกแต่ง**: เพิ่มใน `DECOR_ITEMS` แล้วเลือก `placeholder` จากชนิดที่มีอยู่
  (`vallis`, `fern`, `stem`, `grass`, `rock`, `driftwood`, `castle`, `chest`, `coral`, `bubbler`)
- **ดีบัก**: เปิด DevTools แล้วพิมพ์ `game` เพื่อดูสถานะ (การแก้ตัวเลขเงินใน `game.state` ไม่ถูกบันทึก เพราะเซฟถูกคำนวณใหม่จากคำสั่งบนเซฟล่าสุดเสมอ)
- **เริ่มเกมใหม่**: ตั้งค่า → รีเซ็ตเซฟ (มีผลทุกอุปกรณ์ สำรองให้ก่อนอัตโนมัติ)

## เผยแพร่บน GitHub Pages

ทุกครั้งที่ push ขึ้น branch `main` ระบบ GitHub Actions ([.github/workflows/deploy.yml](.github/workflows/deploy.yml))
จะ build เกมและอัปโหลดขึ้น GitHub Pages ให้อัตโนมัติ (ใช้เวลาประมาณ 1–2 นาที ดูสถานะได้ที่แท็บ Actions ของ repo)
ต้องตั้งค่า Firebase เป็น repository variables (`VITE_*`) ก่อน — ดู [docs/CLOUD_SAVE.md](docs/CLOUD_SAVE.md)

## เครดิตโมเดล 3 มิติ

โมเดลปลาทั้งหมดมาจาก Sketchfab ใช้ภายใต้สัญญาอนุญาต [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/)
(นำไปใช้และเผยแพร่ได้ โดยต้องให้เครดิตผู้สร้าง) ในเกมแสดงเครดิตไว้ที่เมนู ☰ → วิธีเล่น

| ใช้เป็น | โมเดล | ผู้สร้าง |
| --- | --- | --- |
| ปลาทอง | [Fish Animated](https://sketchfab.com/3d-models/fish-animated-665ab73155a44d91908519d84e5fd002) | [Pia Krensel](https://sketchfab.com/Pidele) |
| ปลาการ์ตูน | [Clown fish](https://sketchfab.com/3d-models/clown-fish-febab3b30f514ebbab4454abfc037a8c) | [rubykamen](https://sketchfab.com/rubykamen) |
| ปลาหางนกยูง | [Guppy Fish](https://sketchfab.com/3d-models/guppy-fish-21e14e4b961e406385539f79eacdb1dc) | [BlueMesh](https://sketchfab.com/VapTor) |
| ปลาคาร์ป | [Koi Fish](https://sketchfab.com/3d-models/koi-fish-236859b809984f52b70c94fd040b9c59) | [7PLUS](https://sketchfab.com/7plus) |

ถ้าเพิ่มโมเดลใหม่ อย่าลืมเพิ่มเครดิตใน [src/data/credits.js](src/data/credits.js) และตารางนี้
