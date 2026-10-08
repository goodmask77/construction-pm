// 一次性探針 v3：全量挖首頁連結/關鍵字 + classic BPM 表單
import fs from 'node:fs'
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const r=await fetch('https://cloud.nueip.com/login/index/param',{method:'POST',body:new URLSearchParams({inputCompany:env.NUEIP_COMPANY,inputID:env.NUEIP_USER,inputPassword:env.NUEIP_PASS}),redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded'}})
const jar={}; (r.headers.getSetCookie?r.headers.getSetCookie():[]).forEach(c=>{const[kv]=c.split(';');const i=kv.indexOf('=');jar[kv.slice(0,i)]=kv.slice(i+1)})
const ck=Object.entries(jar).map(([k,v])=>`${k}=${v}`).join('; ')
console.log('✓ 登入', !!jar.PHPSESSID)
const CK={headers:{cookie:ck}}

const home=await (await fetch('https://cloud.nueip.com/home',CK)).text()
// 所有 /xxx 連結
const links=[...new Set((home.match(/\/[a-z][a-z0-9_]{3,}/gi)||[]))].filter(x=>!/assets|favicon|\.(js|css|png|svg|ico)/i.test(x)).sort()
console.log('\n== 首頁所有路徑候選 ==\n'+links.join(' '))
// 關鍵字命中
for(const kw of ['到職','入職','基本資料','表單','eform','e-form','form','employee','personnel','人事','onboard']){
  const hits=[...home.matchAll(new RegExp('.{20}'+kw+'.{20}','g'))].map(m=>m[0].replace(/\s+/g,' ')).slice(0,3)
  if(hits.length) console.log(`\n「${kw}」命中:`, hits.join(' | '))
}

async function probe(label,url,opt={}){
  try{const res=await fetch(url,{redirect:'manual',...opt});const ct=res.headers.get('content-type')||'';const loc=res.headers.get('location')||'';const txt=await res.text();let s=ct.includes('json')?txt.slice(0,400):txt.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,140);console.log(`\n[${label}] ${res.status} ${ct.split(';')[0]}${loc?' → '+loc:''}  ${s}`)}catch(e){console.log(`[${label}] ERR`,e.message)}
}
// classic BPM/表單/人事資料候選
for(const p of ['personal_work_list','leader_audit_work_list','eform','eform_list','form_list','bpm_form','personnel_profile','employee_profile','personal_data','hr_employee','member_management','staff_management','personnel_management','personnel_basic']){
  await probe('classic '+p,'https://cloud.nueip.com/'+p,CK)
}
