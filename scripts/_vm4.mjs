import puppeteer from 'puppeteer-core'
import fs from 'fs'
const key = (fs.readFileSync('.env.local','utf8').match(/OPS_BOARD_KEY="?([^"\n]+)/)||[])[1]
const br = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true, userDataDir:'/tmp/pptr-align-prof', args:['--no-first-run'] })
const pg = await br.newPage()
await pg.setViewport({ width:390, height:844, isMobile:true, hasTouch:true })
await pg.goto(`https://ground-pm.vercel.app/prep?k=${key}`, { waitUntil:'networkidle2', timeout:60000 })
await new Promise(r=>setTimeout(r,2500))
await pg.evaluate(()=>taskEmbed())
await new Promise(r=>setTimeout(r,7000))
const out = await pg.evaluate(()=>{
  // 對每個元素量 min-content 寬：clone 到隱形容器 width:0 看 scrollWidth 太貴——改用 range 檢測：找 white-space:nowrap 且實寬>330 的
  const bad = []
  document.querySelectorAll('*').forEach(el=>{
    const cs = getComputedStyle(el)
    const w = el.getBoundingClientRect().width
    if (cs.whiteSpace === 'nowrap' && el.scrollWidth > 300) {
      bad.push({ tag: el.tagName, sw: el.scrollWidth, txt: (el.textContent||'').trim().slice(0,30), st: (el.getAttribute('style')||'').slice(0,90) })
    }
    // flex 行沒 wrap 且子項總 min 寬大：粗估=scrollWidth
    if (cs.display.includes('flex') && cs.flexWrap === 'nowrap' && el.scrollWidth > 340 && w <= 360) {
      bad.push({ tag: 'FLEXROW', sw: el.scrollWidth, txt: (el.textContent||'').trim().slice(0,30), st: (el.getAttribute('style')||'').slice(0,90) })
    }
  })
  return bad.slice(0,12)
})
console.log(JSON.stringify(out, null, 1))
await br.close()
