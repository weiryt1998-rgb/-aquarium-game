/**
 * ข้อมูลสายพันธุ์ปลาทั้งหมด
 *
 * ── การใส่โมเดล .glb ภายหลัง ──
 * วางไฟล์ไว้ที่ public/models/fish/<id>.glb (เช่น goldfish.glb) เกมจะโหลดมาใช้แทนโมเดลชั่วคราวอัตโนมัติ
 * ถ้าไม่มีไฟล์ของสายพันธุ์นั้น แต่มี public/models/fish/fish.glb จะใช้ไฟล์กลางนั้นแทน (ย้อมสีตามสายพันธุ์)
 *   - โมเดลควรหันหัวไปทางแกน +Z  (ถ้าไม่ใช่ ให้ตั้ง model.rotation เช่น [0, Math.PI / 2, 0])
 *   - ขนาดไม่สำคัญ เกมจะปรับสเกลให้ยาวเท่ากับ length อัตโนมัติ
 *   - ถ้ามีแอนิเมชันในไฟล์ จะเล่นคลิปที่ชื่อมีคำว่า "swim" (หรือคลิปแรก)
 *
 * look = พารามิเตอร์ของโมเดลชั่วคราวที่สร้างด้วยโค้ด (ใช้เมื่อยังไม่มีไฟล์ .glb)
 * breedGroup = กลุ่มที่ผสมข้ามกันได้ (ไม่ระบุ = ผสมได้เฉพาะสายพันธุ์เดียวกัน) เช่น ปลาสอดทุกสีเป็น 'molly'
 * hybrid  = สายพันธุ์ของลูกผสมในกลุ่มนั้น (ลูกที่พ่อแม่ต่างสี) แต่ละตัวมีสีตามยีนของตัวเอง (fish.genes)
 * notForSale = ไม่ขายในร้าน ได้จากการผสมพันธุ์เท่านั้น (แต่แสดงในสมุดสะสม)
 * behavior.walker = เดินบนพื้นทราย (เช่น ปู) แทนการว่าย — เดินตะแคง หยุดเป็นพัก ๆ กินเฉพาะอาหารที่จมถึงพื้น
 * model.crawl = ขยับขาด้วย shader สำหรับโมเดลที่ไม่มีแอนิเมชัน (ดู createCrawlMod ใน render/shaderMods.js)
 * retired = เลิกขายแล้ว: ไม่แสดงในร้านค้าและสมุดสะสม ซื้อเพิ่มไม่ได้ แต่ปลาที่มีอยู่แล้วในตู้ยังอยู่ต่อ
 *           (ห้ามลบสายพันธุ์ออกจากรายการนี้ ไม่งั้นปลาเดิมในเซฟของผู้เล่นจะหายตอนโหลด)
 * procedural = ใช้โมเดลละเอียดที่สร้างด้วยโค้ดแทนโมเดลชั่วคราว เช่น { type: 'molly', variant: 'dalmatian' }
 *              (ดู src/models/molly/ — ถ้าใส่ไฟล์ .glb ของสายพันธุ์นั้นภายหลัง ไฟล์จะถูกใช้แทน)
 */

const fishModel = (id, extra = {}) => ({ url: `models/fish/${id}.glb`, rotation: [0, 0, 0], ...extra });

/**
 * ปลาสอดบอลลูน (Balloon Molly) — ทุกสีใช้โมเดล/พฤติกรรม/การดูแลเดียวกัน ต่างกันที่ลาย (src/models/molly/variants.js)
 * แต่ละสีเป็นสายพันธุ์แยก จึงผสมพันธุ์ได้เฉพาะสีเดียวกัน
 */
function mollySpecies({ variant, name, nameEn, description, rarity, coins, economy, colors, extra = {} }) {
  const id = `molly_${variant}`;
  return {
    id,
    breedGroup: 'molly',
    ...extra,
    name,
    nameEn,
    description,
    rarity,
    price: { coins },
    sizeCm: 5,
    length: 0.7,
    minTank: 0,
    model: fishModel(id),
    procedural: { type: 'molly', variant },
    behavior: { speed: 0.7, zone: 'middle', schooling: true, agility: 2.2, tailBeat: 1.15 },
    care: { hungerRate: 0.13, growTime: 260, breedChance: 0.3 },
    economy,
    // รูปร่างจริงมาจาก src/models/molly/ — look ใช้เป็นสีเรืองหลังรูปในร้านค้า และเป็นโมเดลสำรองแบบง่ายเท่านั้น
    look: {
      body: { height: 0.55, width: 0.75, peak: 0.45, nose: 0.5, taper: 1.0, peduncle: 0.3 },
      pattern: { type: 'patches', colors, belly: '#fbf9f4', scale: 6 },
      fins: { color: colors[0], tip: '#ffffff', opacity: 0.6, tail: 'fan', tailLength: 0.45, tailHeight: 0.6, dorsal: 0.3, anal: 0.12, pectoral: 0.15 },
      eyeSize: 0.09,
      shine: 0.5,
    },
  };
}

export const FISH_SPECIES = [
  {
    id: 'goldfish',
    retired: true,
    name: 'ปลาทอง',
    nameEn: 'Goldfish',
    description: 'ปลาสุดคลาสสิก เลี้ยงง่าย ว่ายน้ำช้า ๆ อย่างสง่างาม',
    rarity: 1,
    price: { coins: 100 },
    sizeCm: 8,
    length: 1.0,
    minTank: 0,
    model: fishModel('goldfish'), // จาก Fish/fish_animated.glb
    behavior: { speed: 0.8, zone: 'middle', schooling: false, agility: 2.0, tailBeat: 0.9 },
    care: { hungerRate: 0.12, growTime: 300, breedChance: 0.25 },
    economy: { coinValue: 5, coinInterval: 70 },
    look: {
      body: { height: 0.62, width: 0.62, peak: 0.4, nose: 0.5, taper: 1.15, peduncle: 0.22 },
      pattern: { type: 'patches', colors: ['#ff7a1a', '#fff3e0'], belly: '#ffd2a0', scale: 3.2 },
      fins: { color: '#ff8f3a', tip: '#ffe2c4', opacity: 0.82, tail: 'double', tailLength: 0.62, tailHeight: 0.55, dorsal: 0.32, anal: 0.16, pectoral: 0.16 },
      eyeSize: 0.075,
      shine: 0.45,
    },
  },
  {
    id: 'guppy',
    name: 'ปลาหางนกยูง',
    nameEn: 'Guppy',
    description: 'ตัวเล็กสีสันสดใส หางพลิ้วสวย ชอบว่ายใกล้ผิวน้ำ',
    rarity: 1,
    price: { coins: 80 },
    sizeCm: 4,
    length: 0.45,
    minTank: 0,
    model: fishModel('guppy', { rotation: [0, Math.PI, 0] }), // จาก Fish/guppy_fish.glb (ไฟล์หันหัวไป -Z จึงหมุน 180°)
    behavior: { speed: 1.0, zone: 'top', schooling: true, agility: 3.0, tailBeat: 1.3 },
    care: { hungerRate: 0.14, growTime: 220, breedChance: 0.3 },
    economy: { coinValue: 3, coinInterval: 60 },
    look: {
      body: { height: 0.3, width: 0.5, peak: 0.32, nose: 0.6, taper: 1.3, peduncle: 0.2 },
      pattern: { type: 'gradient', colors: ['#cfe3ee', '#ff9a3c'], belly: '#f4f8ff' },
      fins: { color: '#ff4fa3', tip: '#4fb8ff', opacity: 0.88, tail: 'fan', tailLength: 0.75, tailHeight: 0.8, dorsal: 0.26, anal: 0.1, pectoral: 0.12 },
      eyeSize: 0.09,
      shine: 0.5,
    },
  },
  mollySpecies({
    variant: 'dalmatian',
    name: 'ปลาสอดดัลเมเชียน',
    nameEn: 'Dalmatian Balloon Molly',
    description: 'ปลาสอดบอลลูนตัวกลมท้องป่อง ลายจุดดำบนพื้นขาวมุก ว่ายต้วมเตี้ยมน่ารัก เลี้ยงง่ายและออกลูกเก่ง',
    rarity: 2,
    coins: 160,
    economy: { coinValue: 5, coinInterval: 70 },
    colors: ['#f3f1ec', '#111214'],
  }),
  mollySpecies({
    variant: 'redhead',
    name: 'ปลาสอดหัวแดง',
    nameEn: 'Red Head Balloon Molly',
    description: 'ปลาสอดบอลลูนลำตัวขาวมุก หัวแดงส้มสะดุดตา เหมือนสวมหมวกสีแดง',
    rarity: 2,
    coins: 180,
    economy: { coinValue: 6, coinInterval: 70 },
    colors: ['#f0541c', '#f5f2ec'],
  }),
  mollySpecies({
    variant: 'golden',
    name: 'ปลาสอดทอง',
    nameEn: 'Golden Balloon Molly',
    description: 'ปลาสอดบอลลูนสีเหลืองทองทั้งตัว เกล็ดเป็นประกายเมื่อต้องแสง',
    rarity: 2,
    coins: 150,
    economy: { coinValue: 5, coinInterval: 70 },
    colors: ['#ffd22c', '#f8b41a'],
  }),
  mollySpecies({
    variant: 'calico',
    name: 'ปลาสอดคาลิโก้',
    nameEn: 'Calico Balloon Molly',
    description: 'ปลาสอดบอลลูนลายสามสี ขาว ส้ม ดำ กระจายแบบธรรมชาติ ไม่มีตัวไหนลายซ้ำกัน หางไล่สีฟ้า',
    rarity: 3,
    coins: 240,
    economy: { coinValue: 7, coinInterval: 75 },
    colors: ['#f2882a', '#f4f1ea'],
  }),
  mollySpecies({
    variant: 'hybrid',
    name: 'ปลาสอดลูกผสม',
    nameEn: 'Hybrid Balloon Molly',
    description: 'เกิดจากการผสมปลาสอดต่างสี สีและลายสืบทอดจากพ่อแม่ บางตัวกลายพันธุ์ได้สีใหม่ ไม่มีตัวไหนเหมือนกัน — ได้จากการผสมพันธุ์เท่านั้น',
    rarity: 3,
    coins: 320,
    economy: { coinValue: 9, coinInterval: 75 },
    colors: ['#f2c24a', '#f0541c'],
    extra: { hybrid: true, notForSale: true },
  }),
  mollySpecies({
    variant: 'golddust',
    name: 'ปลาสอดโกลด์ดัสต์',
    nameEn: 'Gold Dust Balloon Molly',
    description: 'ปลาสอดบอลลูนสีทองอำพัน โรยด้วยจุดดำละเอียดเหมือนผงฝุ่นทั่วตัว ครีบไล่เป็นสีดำ',
    rarity: 3,
    coins: 260,
    economy: { coinValue: 8, coinInterval: 75 },
    colors: ['#e9a33c', '#0b0907'],
  }),
  {
    id: 'neon',
    retired: true,
    name: 'ปลานีออน',
    nameEn: 'Neon Tetra',
    description: 'ตัวจิ๋วมีแถบเรืองแสงสีฟ้า ชอบว่ายเป็นฝูง',
    rarity: 1,
    price: { coins: 50 },
    sizeCm: 3,
    length: 0.42,
    minTank: 0,
    model: fishModel('neon'),
    behavior: { speed: 1.1, zone: 'middle', schooling: true, agility: 3.2, tailBeat: 1.5 },
    care: { hungerRate: 0.13, growTime: 200, breedChance: 0.25 },
    economy: { coinValue: 2, coinInterval: 50 },
    look: {
      body: { height: 0.27, width: 0.52, peak: 0.35, nose: 0.55, taper: 1.2, peduncle: 0.22 },
      pattern: { type: 'neon', colors: ['#1fd6ff', '#ff2b45', '#56616d'], belly: '#eef3f7' },
      fins: { color: '#e4eef5', tip: '#ffffff', opacity: 0.38, tail: 'fork', tailLength: 0.34, tailHeight: 0.5, dorsal: 0.16, anal: 0.12, pectoral: 0.1 },
      eyeSize: 0.1,
      shine: 0.6,
    },
  },
  {
    id: 'crab',
    name: 'ปู',
    nameEn: 'Red Crab',
    description: 'ปูสีแดงสด เดินตะแคงไปมาบนพื้นทราย คอยเก็บเศษอาหารที่ตกถึงพื้น ช่วยให้ตู้สะอาด',
    rarity: 2,
    price: { coins: 200 },
    sizeCm: 6,
    length: 0.75,
    minTank: 0,
    // จาก Fish/New Fish/crab.glb — หันก้ามไป +Z อยู่แล้ว ไม่มีแอนิเมชันในไฟล์ จึงขยับขาด้วย shader
    // แกนในแต่ละ mesh: x = ซ้าย/ขวา, z = ขึ้น, y = หน้า/หลัง (ก้ามอยู่ทาง -y)
    model: fishModel('crab', {
      scale: 1.1,
      crawl: { legs: '^Kaki(\\d)', claws: '^Tangan', bodyHalfWidth: 1.9, legReach: 4.2, lift: 0.9, swing: 0.55 },
    }),
    behavior: { speed: 0.32, zone: 'bottom', schooling: false, agility: 2.4, walker: true },
    care: { hungerRate: 0.1, growTime: 300, breedChance: 0.15 },
    economy: { coinValue: 6, coinInterval: 75 },
    look: {
      body: { height: 0.5, width: 1.2, peak: 0.5, nose: 0.4, taper: 1, peduncle: 0.3 },
      pattern: { type: 'solid', colors: ['#e8452a'], belly: '#ffd9b0' },
      fins: { color: '#e8452a', tip: '#ff8a6a', opacity: 1, tail: 'fan', tailLength: 0.1, tailHeight: 0.2, dorsal: 0, anal: 0, pectoral: 0.3 },
      eyeSize: 0.08,
      shine: 0.4,
    },
  },
  {
    id: 'eagleray',
    name: 'ปลากระเบนนก',
    nameEn: 'Spotted Eagle Ray',
    description: 'กระเบนลายจุดขาว ครีบกว้างเหมือนปีกนก กระพือว่ายอย่างสง่างาม ต้องใช้ตู้ขนาดใหญ่',
    rarity: 4,
    price: { gems: 35 },
    sizeCm: 90,
    length: 1.9,
    minTank: 1,
    // จาก Fish/New Fish/eagle_stingray.glb (หันหัวไป +X จึงหมุน -90°) มีแอนิเมชัน "Swim cycle"
    model: fishModel('eagle_ray', { rotation: [0, -Math.PI / 2, 0] }),
    behavior: { speed: 0.6, zone: 'middle', schooling: false, agility: 1.1, tailBeat: 0.7 },
    care: { hungerRate: 0.09, growTime: 520, breedChance: 0.05 },
    economy: { coinValue: 30, coinInterval: 100 },
    look: {
      body: { height: 0.18, width: 1.6, peak: 0.4, nose: 0.5, taper: 1.1, peduncle: 0.1 },
      pattern: { type: 'solid', colors: ['#5d6268'], belly: '#f2f2f0' },
      fins: { color: '#5d6268', tip: '#9aa0a6', opacity: 1, tail: 'fork', tailLength: 0.6, tailHeight: 0.05, dorsal: 0, anal: 0, pectoral: 0.6 },
      eyeSize: 0.04,
      shine: 0.5,
    },
  },
  {
    id: 'clownfish',
    name: 'ปลาการ์ตูน',
    nameEn: 'Clownfish',
    description: 'สีส้มลายขาวสุดน่ารัก ชอบหลบตามของตกแต่ง',
    rarity: 2,
    price: { coins: 250 },
    sizeCm: 7,
    length: 0.72,
    minTank: 0,
    model: fishModel('clownfish'), // จาก Fish/clown_fish.glb
    behavior: { speed: 0.75, zone: 'bottom', schooling: false, agility: 2.6, tailBeat: 1.2 },
    care: { hungerRate: 0.12, growTime: 320, breedChance: 0.18 },
    economy: { coinValue: 8, coinInterval: 80 },
    look: {
      body: { height: 0.5, width: 0.5, peak: 0.4, nose: 0.45, taper: 1.0, peduncle: 0.3 },
      pattern: {
        type: 'bands',
        colors: ['#ff6a12', '#ffffff', '#111111'],
        belly: '#ff8a3a',
        bands: [
          [0.2, 0.06],
          [0.52, 0.07],
          [0.9, 0.04],
        ],
        edge: 0.025,
      },
      fins: { color: '#ff7a24', tip: '#121212', opacity: 0.95, tail: 'fan', tailLength: 0.32, tailHeight: 0.5, dorsal: 0.26, anal: 0.2, pectoral: 0.17 },
      eyeSize: 0.08,
      shine: 0.4,
    },
  },
  {
    id: 'betta',
    name: 'ปลากัด',
    nameEn: 'Betta',
    description: 'ครีบยาวพลิ้วไหวเหมือนผ้าไหม ว่ายช้าแต่สง่างาม',
    rarity: 2,
    price: { coins: 200 },
    sizeCm: 5,
    length: 0.72,
    minTank: 0,
    model: fishModel('betta'),
    behavior: { speed: 0.5, zone: 'top', schooling: false, agility: 1.5, tailBeat: 0.7 },
    care: { hungerRate: 0.1, growTime: 300, breedChance: 0.15 },
    economy: { coinValue: 6, coinInterval: 70 },
    look: {
      body: { height: 0.34, width: 0.42, peak: 0.36, nose: 0.6, taper: 1.0, peduncle: 0.3 },
      pattern: { type: 'gradient', colors: ['#2a4dff', '#7d2bff'], belly: '#5f7dff' },
      fins: { color: '#2f5cff', tip: '#ff3b6b', opacity: 0.86, tail: 'veil', tailLength: 1.05, tailHeight: 1.15, dorsal: 0.55, anal: 0.6, pectoral: 0.14, dorsalStart: 0.4, dorsalEnd: 0.85, analStart: 0.3, analEnd: 0.92 },
      eyeSize: 0.08,
      shine: 0.55,
      iridescence: 0.6,
    },
  },
  {
    id: 'angelfish',
    name: 'ปลาเทวดา',
    nameEn: 'Angelfish',
    description: 'ลำตัวสูงลายขาวดำ ครีบยาวสง่างาม',
    rarity: 3,
    price: { coins: 400 },
    sizeCm: 12,
    length: 0.72,
    minTank: 0,
    model: fishModel('angelfish'),
    behavior: { speed: 0.6, zone: 'middle', schooling: false, agility: 1.6, tailBeat: 0.8 },
    care: { hungerRate: 0.11, growTime: 380, breedChance: 0.12 },
    economy: { coinValue: 12, coinInterval: 90 },
    look: {
      body: { height: 0.95, width: 0.3, peak: 0.42, nose: 0.55, taper: 1.0, peduncle: 0.18 },
      pattern: {
        type: 'bands',
        colors: ['#dfe3e8', '#17171c'],
        belly: '#f2f4f6',
        bands: [
          [0.18, 0.045],
          [0.45, 0.07],
          [0.78, 0.05],
        ],
      },
      fins: { color: '#e6e9ec', tip: '#26262c', opacity: 0.8, tail: 'lunate', tailLength: 0.5, tailHeight: 0.9, dorsal: 0.95, anal: 0.95, pectoral: 0.12, dorsalStart: 0.35, dorsalEnd: 0.7, analStart: 0.35, analEnd: 0.72, sweep: 0.9 },
      eyeSize: 0.08,
      shine: 0.45,
    },
  },
  {
    id: 'yellowtang',
    retired: true,
    name: 'ปลาขี้ตังเหลือง',
    nameEn: 'Yellow Tang',
    description: 'สีเหลืองสดทั้งตัว ว่ายน้ำกระฉับกระเฉง',
    rarity: 3,
    price: { coins: 450 },
    sizeCm: 15,
    length: 0.85,
    minTank: 0,
    model: fishModel('yellowtang'),
    behavior: { speed: 0.85, zone: 'middle', schooling: false, agility: 2.2, tailBeat: 1.0 },
    care: { hungerRate: 0.12, growTime: 400, breedChance: 0.1 },
    economy: { coinValue: 14, coinInterval: 90 },
    look: {
      body: { height: 0.82, width: 0.3, peak: 0.42, nose: 0.4, taper: 1.0, peduncle: 0.16 },
      pattern: { type: 'solid', colors: ['#ffd119'], belly: '#ffe56a' },
      fins: { color: '#ffd52b', tip: '#fff1a6', opacity: 0.92, tail: 'lunate', tailLength: 0.36, tailHeight: 0.62, dorsal: 0.3, anal: 0.27, pectoral: 0.15, dorsalStart: 0.25, dorsalEnd: 0.92, analStart: 0.45, analEnd: 0.92 },
      eyeSize: 0.075,
      shine: 0.35,
    },
  },
  {
    id: 'bluetang',
    retired: true,
    name: 'ปลาขี้ตังน้ำเงิน',
    nameEn: 'Blue Tang',
    description: 'สีน้ำเงินสดหางเหลือง ขี้เล่นและอยากรู้อยากเห็น',
    rarity: 3,
    price: { coins: 500 },
    sizeCm: 15,
    length: 0.9,
    minTank: 0,
    model: fishModel('bluetang'),
    behavior: { speed: 0.95, zone: 'middle', schooling: false, agility: 2.4, tailBeat: 1.0 },
    care: { hungerRate: 0.12, growTime: 420, breedChance: 0.1 },
    economy: { coinValue: 15, coinInterval: 90 },
    look: {
      body: { height: 0.62, width: 0.32, peak: 0.42, nose: 0.42, taper: 1.0, peduncle: 0.18 },
      pattern: { type: 'tang', colors: ['#1c5bff', '#0b1030'], belly: '#4a86ff' },
      fins: { color: '#1f56f0', tip: '#0c1235', tailColor: '#ffd31c', opacity: 0.92, tail: 'lunate', tailLength: 0.36, tailHeight: 0.6, dorsal: 0.24, anal: 0.2, pectoral: 0.16, dorsalStart: 0.25, dorsalEnd: 0.92, analStart: 0.45, analEnd: 0.92 },
      eyeSize: 0.075,
      shine: 0.4,
    },
  },
  {
    id: 'koi',
    name: 'ปลาคาร์ป',
    nameEn: 'Koi',
    description: 'ปลามงคลลายแดงขาว ตัวใหญ่ ต้องการตู้กว้าง',
    rarity: 3,
    price: { coins: 650 },
    sizeCm: 30,
    length: 1.3,
    minTank: 1,
    model: fishModel('koi', { rotation: [0, -Math.PI / 2, 0] }), // จาก Fish/koi_fish.glb (ท่าว่ายหันหัวไป +X จึงหมุน -90°)
    behavior: { speed: 0.75, zone: 'bottom', schooling: false, agility: 1.4, tailBeat: 0.7 },
    care: { hungerRate: 0.1, growTime: 480, breedChance: 0.08 },
    economy: { coinValue: 18, coinInterval: 100 },
    look: {
      body: { height: 0.3, width: 0.62, peak: 0.36, nose: 0.5, taper: 1.2, peduncle: 0.22 },
      pattern: { type: 'koi', colors: ['#fbf7f2', '#e5381c'], belly: '#ffffff', scale: 2.6 },
      fins: { color: '#f6f2ee', tip: '#ffd9cc', opacity: 0.7, tail: 'fork', tailLength: 0.4, tailHeight: 0.42, dorsal: 0.16, anal: 0.1, pectoral: 0.18, dorsalStart: 0.35, dorsalEnd: 0.75 },
      eyeSize: 0.05,
      shine: 0.4,
    },
  },
  {
    id: 'discus',
    name: 'ปลาปอมปาดัวร์',
    nameEn: 'Discus',
    description: 'ราชาแห่งตู้ปลา ลวดลายคลื่นสีฟ้าบนพื้นแดง',
    rarity: 4,
    price: { gems: 25 },
    sizeCm: 15,
    length: 0.8,
    minTank: 0,
    model: fishModel('discus'),
    behavior: { speed: 0.55, zone: 'middle', schooling: false, agility: 1.5, tailBeat: 0.8 },
    care: { hungerRate: 0.1, growTime: 460, breedChance: 0.07 },
    economy: { coinValue: 22, coinInterval: 90 },
    look: {
      body: { height: 0.95, width: 0.26, peak: 0.45, nose: 0.4, taper: 0.9, peduncle: 0.14 },
      pattern: { type: 'discus', colors: ['#e5502a', '#33d2e6'], belly: '#f07a3e' },
      fins: { color: '#e05a2c', tip: '#3fd1e8', opacity: 0.9, tail: 'fan', tailLength: 0.26, tailHeight: 0.42, dorsal: 0.16, anal: 0.16, pectoral: 0.12, dorsalStart: 0.15, dorsalEnd: 0.9, analStart: 0.3, analEnd: 0.9 },
      eyeSize: 0.07,
      shine: 0.45,
    },
  },
  {
    id: 'lionfish',
    name: 'ปลาสิงโต',
    nameEn: 'Lionfish',
    description: 'ครีบแผ่กว้างเหมือนแผงคอสิงโต หายากและสะดุดตา',
    rarity: 4,
    price: { gems: 30 },
    sizeCm: 20,
    length: 0.85,
    minTank: 0,
    model: fishModel('lionfish'),
    behavior: { speed: 0.42, zone: 'bottom', schooling: false, agility: 1.2, tailBeat: 0.6 },
    care: { hungerRate: 0.1, growTime: 500, breedChance: 0.06 },
    economy: { coinValue: 27, coinInterval: 100 },
    look: {
      body: { height: 0.45, width: 0.5, peak: 0.35, nose: 0.5, taper: 1.0, peduncle: 0.22 },
      pattern: { type: 'stripes', colors: ['#b8321f', '#fff1e4'], belly: '#ffe9d9', frequency: 34 },
      fins: { color: '#d8553d', tip: '#fff2e8', opacity: 0.78, tail: 'fan', tailLength: 0.36, tailHeight: 0.5, dorsal: 0.6, anal: 0.25, pectoral: 0.55, spiky: true },
      eyeSize: 0.07,
      shine: 0.35,
    },
  },
  {
    id: 'arowana',
    name: 'ปลามังกร',
    nameEn: 'Arowana',
    description: 'ปลาหายากเกล็ดสีทองแวววาว เชื่อว่านำโชค ต้องใช้ตู้ใหญ่',
    rarity: 5,
    price: { gems: 80 },
    sizeCm: 60,
    length: 1.8,
    minTank: 2,
    model: fishModel('arowana'),
    behavior: { speed: 0.8, zone: 'top', schooling: false, agility: 1.2, tailBeat: 0.6 },
    care: { hungerRate: 0.09, growTime: 600, breedChance: 0.03 },
    economy: { coinValue: 45, coinInterval: 120 },
    look: {
      body: { height: 0.26, width: 0.5, peak: 0.45, nose: 0.75, taper: 0.9, peduncle: 0.28 },
      pattern: { type: 'scales', colors: ['#f5c542', '#a8741a'], belly: '#ffe39a', frequency: 26 },
      fins: { color: '#e7a93a', tip: '#ff7a3a', opacity: 0.85, tail: 'fan', tailLength: 0.3, tailHeight: 0.4, dorsal: 0.22, anal: 0.2, pectoral: 0.14, dorsalStart: 0.68, dorsalEnd: 0.96, analStart: 0.55, analEnd: 0.96 },
      eyeSize: 0.05,
      shine: 0.75,
      metalness: 0.55,
    },
  },
];

const BY_ID = new Map(FISH_SPECIES.map((s) => [s.id, s]));

/** สายพันธุ์ที่ยังมีในเกม (แสดงในสมุดสะสม) — ไม่รวมที่เลิกขายแล้ว */
export const AVAILABLE_SPECIES = FISH_SPECIES.filter((s) => !s.retired);

/** สายพันธุ์ที่ซื้อได้ในร้านค้า */
export const SHOP_SPECIES = AVAILABLE_SPECIES.filter((s) => !s.notForSale);
export const getSpecies = (id) => BY_ID.get(id);

/** โมเดลกลางที่ใช้แทน เมื่อไม่มีไฟล์เฉพาะสายพันธุ์ */
export const GENERIC_FISH_MODEL = 'models/fish/fish.glb';

export const ZONE_LABEL = { top: 'ชอบว่ายใกล้ผิวน้ำ', middle: 'ว่ายกลางน้ำ', bottom: 'ชอบอยู่ใกล้พื้น', any: 'ว่ายได้ทุกระดับ' };

export const FISH_NAMES = [
  'น้องส้ม', 'เจ้าจุด', 'ทองคำ', 'บับเบิ้ล', 'ฟ้าใส', 'มะลิ', 'ปุยฝ้าย', 'น้ำหวาน', 'ข้าวตู', 'โมจิ',
  'ถั่วแดง', 'เปาเปา', 'ลูกชิ้น', 'ขนมปัง', 'มะปราง', 'ส้มจี๊ด', 'นีโม่', 'ดอรี่', 'ซูชิ', 'ทาโร่',
  'วุ้นเส้น', 'ชาไทย', 'โกโก้', 'มะม่วง', 'ลำไย', 'เฉาก๊วย', 'ทับทิม', 'ไข่มุก', 'สายรุ้ง', 'เมฆ',
];
