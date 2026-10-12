import readline from 'node:readline';

/** ถามข้อความจากผู้ใช้ในเทอร์มินัล (hidden = ไม่แสดงตัวอักษรที่พิมพ์ — ใช้กับรหัสผ่าน) */
export function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (text) => {
      if (!muted) rl.output.write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
    muted = hidden;
  });
}

/** ถามรหัสผ่านใหม่ 2 ครั้ง และตรวจความยาวขั้นต่ำ */
export async function askNewPassword(minLength = 12) {
  for (;;) {
    const first = await ask(`รหัสผ่านเกมใหม่ (อย่างน้อย ${minLength} ตัวอักษร): `, { hidden: true });
    if (first.length < minLength) {
      console.log(`× สั้นเกินไป — แนะนำวลีหลายคำที่เดายาก เช่น 4–5 คำต่อกัน`);
      continue;
    }
    const again = await ask('พิมพ์รหัสผ่านอีกครั้ง: ', { hidden: true });
    if (again !== first) {
      console.log('× รหัสผ่านสองครั้งไม่ตรงกัน ลองใหม่');
      continue;
    }
    return first;
  }
}
