// v15 內容校正：線上菜單 COMFORT BOWL→BOWLS、香料烤雞胸 Bánh Mì、抹茶可可 Cocoa（金鑰寫入，全開模式免token）
const K = '7ea362bae1f0274372d4ec7b27c78852';
const BASE = 'https://ground-pm.vercel.app/api/mail-sync';
const d = await (await fetch(BASE + '?menu=' + K)).json();
if (!d.ok) { console.log('讀不到菜單'); process.exit(1); }
const draft = d.draft;

const before = [];
for (const s of draft.sections) {
  if (/COMFORT|BOWL/i.test(s.name)) { before.push('分類: ' + s.name); s.name = 'BOWLS 療癒碗'; }
  for (const it of (s.items||[])) {
    if (it.name && it.name.replace(/\s+/g,'') === '香料烤雞胸越南三明治') { before.push(it.name + ': ' + it.en); it.en = 'Spiced Roast Chicken Bánh Mì'; }
    if (it.name && /抹茶\s*\/\s*可可拿鐵/.test(it.name)) { before.push(it.name + ': ' + it.en); it.en = 'Matcha / Cocoa Latte'; }
  }
}
console.log('改前:'); before.forEach(b=>console.log('  '+b));

const r = await fetch(BASE + '?menuset=' + K, { method:'POST', headers:{'content-type':'application/json'},
  body: JSON.stringify({ draft, what: 'v15內容校正(BOWLS/Bánh Mì/Cocoa)' }) });
const j = await r.json().catch(()=>null);
console.log('寫入:', r.status, JSON.stringify(j));

if (j && j.ok) {
  const d2 = await (await fetch(BASE + '?menu=' + K)).json();
  console.log('改後驗證:');
  for (const s of d2.draft.sections) {
    if (/BOWLS/i.test(s.name)) console.log('  分類 → ' + s.name);
    for (const it of (s.items||[])) {
      if (it.name && (it.name.replace(/\s+/g,'')==='香料烤雞胸越南三明治' || /抹茶\s*\/\s*可可拿鐵/.test(it.name))) console.log('  '+it.name+' → '+it.en);
    }
  }
}
