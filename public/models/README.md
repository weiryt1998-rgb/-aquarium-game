# โฟลเดอร์โมเดล 3 มิติ (.glb / .gltf)

วางไฟล์ไว้ในโฟลเดอร์นี้ แล้วเกมจะโหลดมาแทนโมเดลชั่วคราวให้อัตโนมัติ
(ตอนรัน `npm run dev` อยู่ หน้าเว็บจะรีโหลดเองเมื่อเพิ่มหรือลบไฟล์)

## ปลา — `fish/`

| ไฟล์ | ใช้กับ |
| --- | --- |
| `fish/goldfish.glb` | ปลาทอง |
| `fish/guppy.glb` | ปลาหางนกยูง (เลิกขายแล้ว — ยังใช้กับปลาที่ผู้เล่นมีอยู่) |
| `fish/neon.glb` | ปลานีออน |
| `fish/clownfish.glb` | ปลาการ์ตูน (เลิกขายแล้ว — ยังใช้กับปลาที่ผู้เล่นมีอยู่) |
| `fish/betta.glb` | ปลากัด (เลิกขายแล้ว — ยังใช้กับปลาที่ผู้เล่นมีอยู่) |
| `fish/angelfish.glb` | ปลาเทวดา (เลิกขายแล้ว — ยังใช้กับปลาที่ผู้เล่นมีอยู่) |
| `fish/yellowtang.glb` | ปลาขี้ตังเหลือง |
| `fish/bluetang.glb` | ปลาขี้ตังน้ำเงิน |
| `fish/koi.glb` | ปลาคาร์ป (เลิกขายแล้ว — ยังใช้กับปลาที่ผู้เล่นมีอยู่) |
| `fish/discus.glb` | ปลาปอมปาดัวร์ (เลิกขายแล้ว — ยังใช้กับปลาที่ผู้เล่นมีอยู่) |
| `fish/lionfish.glb` | ปลาสิงโต (เลิกขายแล้ว — ยังใช้กับปลาที่ผู้เล่นมีอยู่) |
| `fish/arowana.glb` | ปลามังกร |
| `fish/crab.glb` | ปู (เดินบนพื้น — ขาขยับด้วย shader ตาม `model.crawl`) |
| `fish/eagle_ray.glb` | ปลากระเบนนก |
| `fish/betta_galaxy.glb` | ปลากัดกาแล็กซี (ท่าว่ายจาก shader — `model.motion`) |
| `fish/seahorse.glb` | ม้าน้ำภูตแก้ว — เก็บโครงกระดูกไว้ (`--keep-skin`) เกมขยับหาง/หัว/ครีบตาม `model.rig` |
| `fish/rune_guardian.glb` | ปลาผู้พิทักษ์รูน (ท่าว่ายจาก shader — `model.motion`) |
| `fish/pumpkin_angler.glb` | ปลาตกเบ็ดฟักทอง — ทำใน Blender (`Fish/pumpkin_angler.blend`) มีกระดูก 10 ชิ้น + คลิป `Swim` — แปลงด้วย `node scripts/build-model.mjs Fish/pumpkin_angler_src.glb public/models/fish/pumpkin_angler.glb --keep-anim` |
| `fish/molly_baby.glb` | ลูกปลาสอดทุกสี (ใช้จนโต 60% แล้วเปลี่ยนเป็น molly.glb) — แปลงด้วย `node scripts/build-molly-model.mjs <ไฟล์>.glb public/models/fish/molly_baby.glb` |
| `fish/molly.glb` | ปลาสอดทรงบอลลูนทุกสีและลูกผสม (รูปทรงอย่างเดียว เกมย้อมสี/ลายใหม่ตามสายพันธุ์และยีน) — **ห้ามวางไฟล์ทับตรง ๆ** ต้องแปลงด้วย `node scripts/build-molly-model.mjs <ไฟล์จาก Meshy>.glb` |
| `fish/molly_long.glb` | ปลาสอดทรงตัวยาว (คาริโกะเข้ม ขาวซากุระ ม้าลาย เรดเฮด และลูกผสมที่ได้ยีน `shape: 'long'`) — ทำใน Blender: รัน `Fish/molly_designs.py` (`FISH = 'balloon_calico'`) แล้ว `Fish/export_molly_long.py` ได้ `Fish/molly_long_src.glb` จากนั้น `node scripts/build-molly-long-model.mjs` · ตรวจที่ `/preview/molly.html?shape=long&variant=zebra` |
| `fish/fish.glb` | **ไฟล์กลาง** ใช้กับทุกสายพันธุ์ที่ยังไม่มีไฟล์ของตัวเอง (เกมย้อมสีให้ตามสายพันธุ์) |

ข้อกำหนดของโมเดลปลา

- ตรวจทิศของไฟล์ใดก็ได้ที่หน้า `/preview/model.html?url=models/<โฟลเดอร์>/<ไฟล์>.glb` ตอนรัน `npm run dev` (ลูกศรแดง = +Z ทิศหัว)

- หันหัวไปทางแกน **+Z** ถ้าโมเดลหันทางอื่น ให้แก้ `model.rotation` ใน `src/data/fish.js`
  เช่นหันไปทาง +X ให้ใส่ `rotation: [0, -Math.PI / 2, 0]`
- ขนาดเท่าไหร่ก็ได้ เกมจะย่อหรือขยายให้ยาวเท่ากับค่า `length` ของสายพันธุ์นั้น
- ถ้ามีแอนิเมชัน เกมจะเล่นคลิปที่ชื่อมีคำว่า `swim` ก่อน ถ้าไม่มีก็เล่นคลิปแรก
  ความเร็วแอนิเมชันจะเปลี่ยนตามความเร็วที่ปลาว่าย ถ้าไม่มีแอนิเมชันเลย เกมจะส่ายตัวปลาให้แทน
- รองรับ skinned mesh และไฟล์ที่บีบอัดด้วย Draco หรือ Meshopt (ตัวถอดรหัสมากับเกมแล้ว ไม่ต้องต่ออินเทอร์เน็ต)
- ไฟล์จาก Meshy AI (ใหญ่ 15–45 MB มีโครงกระดูกแบบคนที่ไม่มีแอนิเมชัน) ให้แปลงก่อน:
  `node scripts/build-model.mjs <ไฟล์>.glb public/models/fish/<id>.glb --fish` (ของตกแต่งไม่ต้องใส่ `--fish`)
  แล้วตั้ง `model.motion: 'fish'` (หรือ `'seahorse'`) ให้ว่ายด้วย shader — ครีบ/ชายผ้าที่แผ่ข้างจนถูกนับเป็นลำตัว ให้เพิ่ม `--flex-open 4`

## ของตกแต่ง — `decor/`

| ไฟล์ | ใช้กับ |
| --- | --- |
| `decor/plant.glb` | **ไฟล์กลาง** ของพืชน้ำทุกชนิด |
| `decor/rock.glb` | **ไฟล์กลาง** ของหินทุกชนิด |
| `decor/castle.glb` | ปราสาท |
| `decor/driftwood.glb` | ขอนไม้โค้ง |
| `decor/chest.glb` | หีบสมบัติ |
| `decor/coral.glb` | ปะการัง |
| `decor/temple_ruin.glb` | ซากวิหารโบราณ |
| `decor/seashell.glb` | เปลือกหอย |
| `decor/greek_ruin.glb` | ซากวิหารกรีก |
| `decor/snail_coral.glb` | หอยสะสมกับปะการัง |
| `decor/plant_fern.glb` `plant_red.glb` `plant_grass.glb` `plant_sword.glb` `plant_stem.glb` | พืชน้ำแต่ละชนิด (แยกจากไฟล์พืชรวม 1 ไฟล์) |
| `decor/bubbler.glb` | หัวทรายออกซิเจน |
| `decor/rock_crystal.glb` | หินคริสตัลอเมทิสต์ |
| `decor/plant_tree.glb` | ต้นเฟิร์นยักษ์ |
| `decor/plant_alien.glb` | พืชเอเลี่ยนสีฟ้า |
| `decor/driftwood_mossy.glb` | ขอนไม้มอส |
| `decor/cliff_sanctuary.glb` | วิหารผาโบราณ |
| `decor/sunken_stump.glb` | ตอไม้จม |
| `decor/dome_house.glb` | บ้านโดม |
| `decor/stone_bridge.glb` | สะพานหิน (ปลาว่ายลอดใต้โค้งได้) |
| `decor/shipwreck.glb` | เรืออับปาง |
| `decor/<id>.glb` | ไฟล์ของแต่ละชิ้นตาม `id` ใน `src/data/decor.js` เช่น `plant_fern.glb` (ถ้ามีจะใช้แทนไฟล์กลาง) |

ข้อกำหนดของโมเดลของตกแต่ง

- จุด origin ควรอยู่ที่ฐานของโมเดล (ส่วนที่วางบนพื้นทราย)
- เกมจะปรับให้สูงเท่ากับค่า `height` ของชิ้นนั้น หรือให้กว้างเท่า `model.size` ถ้าตั้ง `fit: 'width'`
- พืชน้ำจะโยกไหวตามน้ำให้อัตโนมัติ

## กระถางทานตะวันข้างตู้ — `garden/`

| ไฟล์ | ใช้กับ |
| --- | --- |
| `garden/sunflower.glb` | กระถางทานตะวันบนโต๊ะทางขวาของตู้ (ต้นไม้มีชีวิต ต้องรดน้ำ ใส่ปุ๋ย — กฎใน `src/shared/garden.js`) — แปลงจาก `Fish/Meshy_AI_sunflower_retextured_….glb` ด้วย `node scripts/build-model.mjs <ไฟล์> public/models/garden/sunflower.glb --error 0.01` |

ข้อกำหนดของโมเดลทานตะวัน

- กระถางกับต้นไม้อยู่ใน mesh เดียวกันได้ เกมแยกด้วยความสูง: สูงกว่าผิวดิน = ต้นไม้ (โต/โค้ง/เหี่ยว/เปลี่ยนสีใน shader)
- ดอกหันไปทาง **+Z** · ถ้าเปลี่ยนไฟล์ ให้วัดตำแหน่งผิวดิน/ปากกระถาง/ดอกใหม่แล้วแก้ค่า `MODEL` ใน `src/world/Sunflower.js`
- ตรวจท่าทางทุกขั้นได้ที่หน้า `/preview/sunflower.html` ตอนรัน `npm run dev` (ไม่มีไฟล์ = ใช้โมเดลชั่วคราวจากโค้ด, `?procedural` บังคับดูโมเดลชั่วคราว)

## หอย (ระบบนิเวศใต้น้ำ) — `decor/`

หอยเป็นของตกแต่งที่มีชีวิต (หมวด 🐌 หอย ในโหมดตกแต่ง) คลานได้ ไม่ตาย ไม่ต้องดูแล ไม่ขยายพันธุ์
ตัวที่ยังไม่มีไฟล์ใช้โมเดลชั่วคราวที่สร้างด้วยโค้ด — วางไฟล์ตามชื่อด้านล่างแล้วเกมจะใช้แทนทันที
ตรวจทิศ/ขนาดได้ที่หน้า `/preview/snails.html` ตอนรัน `npm run dev` (ลูกศรแดง = ทิศหัว)

| ไฟล์ | ใช้กับ | การเคลื่อนที่ / บทบาท |
| --- | --- | --- |
| `decor/snail_nerite.glb` ✅ | หอยเนอไรต์ลายม้าลาย | คลานบนกระจกซ้าย/หลัง/ขวา · กินตะไคร่ |
| `decor/snail_bladder.glb` ✅ | หอยบลัดเดอร์ | คลานบนกระจก · กินตะไคร่ + ของเสียเล็กน้อย |
| `decor/snail_ramshorn.glb` ✅ | หอยเขาแกะแดง | คลานบนพื้นทราย · กินของเสีย (+แทะตะไคร่เล็กน้อย) |
| `decor/snail_trumpet.glb` ✅ | หอยมาเลเซีย | คลานบนพื้นทราย · กินของเสีย |
| `decor/snail_mystery.glb` | หอยเชอรี่สีทอง | คลานบนพื้นทราย · กินของเสีย |
| `decor/clam_freshwater.glb` | หอยกาบน้ำจืด | ฝังตัวอยู่กับที่ · อ้าฝากรองฝุ่นขยะในน้ำ |

(✅ = มีไฟล์แล้ว แปลงจาก `Fish/Meshy_AI_…` ด้วย `node scripts/build-model.mjs <ไฟล์> public/models/decor/<id>.glb --triangles 6000 --texture 512`)

ข้อกำหนดของโมเดลหอย

- หันหัว (ด้านที่คลานไป) ไปทางแกน **+Z** ด้านหลังเปลือกขึ้นแกน **+Y** และให้ **ฝ่าเท้าอยู่ที่ y = 0**
  (หอยที่เกาะกระจก เกมจะหมุนให้ฝ่าเท้าแนบกระจกเอง) ถ้าโมเดลหันทางอื่นให้แก้ `model.rotation` ใน `src/data/decor.js`
- ขนาดเท่าไหร่ก็ได้ เกมปรับให้สูงเท่า `height` (หอยกาบปรับตามความกว้าง `model.size`)
- ถ้ามีแอนิเมชัน เกมจะเล่นคลิปที่ชื่อมีคำว่า `crawl` `walk` หรือ `move` (ไม่มีก็คลิปแรก) — เร็วตอนคลาน ช้าตอนหยุด
  ถ้าไม่มีแอนิเมชัน เกมจะยืด-หดลำตัวเป็นจังหวะตอนคลานให้แทน
- หอยสองฝา: ตั้งชื่อ node ฝาบนว่า `shell_top` (ท่าในไฟล์ = หุบฝา) เกมจะอ้า-หุบที่บานพับด้านหลัง (ขอบ −Z)
  ถ้าฝาอ้าผิดทิศ ให้กลับเครื่องหมาย `critter.gape` ใน `src/data/decor.js`
- หอยชนิดใหม่: เพิ่มรายการใน `src/data/decor.js` หมวด `critter` (ดูคำอธิบายฟิลด์ `critter` / `ecology` ด้านบนไฟล์) แล้ววางไฟล์ `decor/<id>.glb`
- ไฟล์จาก Meshy AI ให้แปลงก่อน: `node scripts/build-model.mjs <ไฟล์>.glb public/models/decor/<id>.glb --triangles 6000 --texture 512`
  (หอยตัวเล็ก ใช้เหลี่ยมและเท็กซ์เจอร์น้อยกว่าของตกแต่งทั่วไปได้ ไฟล์จะเหลือราว 250–300 KB)
