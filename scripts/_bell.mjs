import puppeteer from 'puppeteer-core'
import fs from 'fs'
const key=(fs.readFileSync('.env.local','utf8').match(/OPS_BOARD_KEY="?([^"\n]+)/)||[])[1]
const br=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,userDataDir:'/tmp/pptr-bell',args:['--no-first-run']})
const pg=await br.newPage(); await pg.setCacheEnabled(false)
await pg.setViewport({width:390,height:844,isMobile:true,hasTouch:true})
await pg.goto(`https://ground-pm.vercel.app/prep?k=${key}`,{waitUntil:'networkidle2',timeout:60000})
await new Promise(r=>setTimeout(r,4000))
const bar=await pg.evaluate(()=>{
  const fb=document.getElementById('favbar')
  const btns=[...(fb?.querySelectorAll('button')||[])].map(b=>({t:(b.querySelector('span')?.textContent||'').trim(),id:b.id||'',hasDot:!!b.querySelector('.ntfDot'),dot:b.querySelector('.ntfDot')?.textContent||''}))
  const bell=document.getElementById('favBell')
  return {count:btns.length, btns, bellLast: btns[btns.length-1]?.id==='favBell', bellRect: bell?{x:Math.round(bell.getBoundingClientRect().x),w:Math.round(bell.getBoundingClientRect().width)}:null, vw:document.documentElement.clientWidth}
})
console.log(JSON.stringify(bar))
// 點鈴鐺→開通知中心
await pg.evaluate(()=>document.getElementById('favBell')?.click())
await new Promise(r=>setTimeout(r,2000))
const opened=await pg.evaluate(()=>!!document.getElementById('ntfOv'))
console.log('ntfCenterOpened:',opened)
await pg.screenshot({path:'/tmp/bell-bar.png'})
await br.close()
