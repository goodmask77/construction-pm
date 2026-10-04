import puppeteer from 'puppeteer-core'
import fs from 'fs'
const key = (fs.readFileSync('.env.local','utf8').match(/OPS_BOARD_KEY="?([^"\n]+)/)||[])[1]
const br = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true, userDataDir:'/tmp/pptr-align-prof2', args:['--no-first-run'] })
const pg = await br.newPage()
await pg.setCacheEnabled(false)
await pg.setViewport({ width:390, height:844, isMobile:true, hasTouch:true })
await pg.goto(`https://ground-pm.vercel.app/prep?k=${key}`, { waitUntil:'networkidle2', timeout:60000 })
await new Promise(r=>setTimeout(r,2500))
await pg.evaluate(()=>taskEmbed())
await new Promise(r=>setTimeout(r,7000))
const out = await pg.evaluate(()=>{
  const g = [...document.querySelectorAll('div')].find(el=>(el.getAttribute('style')||'').startsWith('display:grid;gap:12px'))
  const box = document.createElement('div'); box.style.cssText='position:absolute;left:-9999px;width:0;overflow:hidden'; document.body.appendChild(box)
  const minW = el => { const c = el.cloneNode(true); box.innerHTML=''; box.appendChild(c); c.style.width='min-content'; return Math.ceil(c.getBoundingClientRect().width) }
  const kids = g ? [...g.children].map(k=>({ txt:(k.textContent||'').trim().slice(0,12), mw:minW(k) })) : null
  box.remove()
  const over = []
  document.querySelectorAll('*').forEach(el=>{
    if (el.scrollWidth > el.clientWidth + 4 && el.clientWidth > 50) {
      const cs = getComputedStyle(el)
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return
      over.push({ tag: el.tagName, cw: el.clientWidth, sw: el.scrollWidth })
    }
  })
  return { gridStyle: g ? g.getAttribute('style') : null, kids, overflows: over.slice(0,6) }
})
console.log(JSON.stringify(out))
await pg.screenshot({ path:'/tmp/task-mob-after.png' })
await br.close()
