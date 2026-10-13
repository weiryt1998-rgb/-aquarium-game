/**
 * เครดิตโมเดล 3 มิติ (สัญญาอนุญาต CC-BY-4.0 ต้องให้เครดิตผู้สร้าง)
 * ถ้าเพิ่มโมเดลใหม่ ให้เพิ่มเครดิตที่นี่ด้วย — ข้อมูลผู้สร้างมักอยู่ใน asset.extras ของไฟล์ .glb จาก Sketchfab
 */
export const MODEL_CREDITS = [
  {
    file: 'models/fish/goldfish.glb',
    usedAs: 'ปลาทอง',
    title: 'Fish Animated',
    author: 'Pia Krensel',
    authorUrl: 'https://sketchfab.com/Pidele',
    source: 'https://sketchfab.com/3d-models/fish-animated-665ab73155a44d91908519d84e5fd002',
  },
  {
    file: 'models/fish/clownfish.glb',
    usedAs: 'ปลาการ์ตูน',
    title: 'Clown fish',
    author: 'rubykamen',
    authorUrl: 'https://sketchfab.com/rubykamen',
    source: 'https://sketchfab.com/3d-models/clown-fish-febab3b30f514ebbab4454abfc037a8c',
  },
  {
    file: 'models/fish/guppy.glb',
    usedAs: 'ปลาหางนกยูง',
    title: 'Guppy Fish',
    author: 'BlueMesh',
    authorUrl: 'https://sketchfab.com/VapTor',
    source: 'https://sketchfab.com/3d-models/guppy-fish-21e14e4b961e406385539f79eacdb1dc',
  },
  {
    file: 'models/fish/koi.glb',
    usedAs: 'ปลาคาร์ป',
    title: 'Koi Fish',
    author: '7PLUS',
    authorUrl: 'https://sketchfab.com/7plus',
    source: 'https://sketchfab.com/3d-models/koi-fish-236859b809984f52b70c94fd040b9c59',
  },
  {
    file: 'models/decor/coral.glb',
    usedAs: 'ปะการัง',
    title: 'Staghorn Coral',
    author: 'PixForge',
    authorUrl: 'https://sketchfab.com/pixforge.id',
    source: 'https://sketchfab.com/3d-models/staghorn-coral-ede640745c16457a9345ef1fa9e8d4d4',
  },
  {
    file: 'models/decor/temple_ruin.glb',
    usedAs: 'ซากวิหารโบราณ',
    title: 'Temple ruin aquarium decoration - Photoscan',
    author: 'DonCoasn',
    authorUrl: 'https://sketchfab.com/DonCoasn',
    source: 'https://sketchfab.com/3d-models/temple-ruin-aquarium-decoration-photoscan-fad156666c33460a9074ceaa6ed6c93e',
  },
  {
    file: 'models/decor/seashell.glb',
    usedAs: 'เปลือกหอย',
    title: 'Sea shell',
    author: 'Solcito3D',
    authorUrl: 'https://sketchfab.com/solcito3D',
    source: 'https://sketchfab.com/3d-models/sea-shell-99d1091293a64fbe97bbef45d564a28e',
  },
].map((c) => ({ license: 'CC-BY-4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', ...c }));
