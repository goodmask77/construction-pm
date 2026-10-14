// 最小驗證程式：在 abgd-test 建一張模擬 GD 的 public.pm_documents，套 gd_outbox.sql v4，跑五個情境
import fs from 'node:fs'; import postgres from '../../abgd/node_modules/postgres/src/index.js'
const env=Object.fromEntries(fs.readFileSync(new URL('../../abgd/.env.local', import.meta.url),'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^"|"$/g,'')]}))
// 用 session 模式（5432）才能開多條獨立交易測併發
const url=`postgresql://postgres.${env.ABGD_TEST_REF}:${encodeURIComponent(env.ABGD_TEST_DB_PASS)}@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`
const sql=postgres(url,{ssl:'require',max:4,prepare:false,onnotice:()=>{}})
const ok=(name,cond,extra='')=>console.log((cond?'✓':'✗'),name,extra)
try{
  await sql.unsafe(`drop table if exists public.pm_documents cascade; drop table if exists public.pm_outbox cascade; drop table if exists public.pm_rev cascade; drop table if exists public.pm_domain_lock; drop table if exists public.pm_sync_applied;
    create table public.pm_documents(id text primary key, data jsonb, editor text, updated_at timestamptz);`)
  await sql.unsafe(fs.readFileSync(process.argv[2],'utf8'))
  // 模擬一般角色（authenticated）直寫：建一個無特權角色測試
  await sql.unsafe(`do $$ begin if not exists (select 1 from pg_roles where rolname='gd_app') then create role gd_app nologin; end if; end $$; grant gd_app to postgres; grant usage on schema public to gd_app; grant select, insert, update, delete on public.pm_documents to gd_app;`)
  // 1) 基本：寫入產生 outbox＋rev
  await sql`insert into pm_documents(id,data,editor,updated_at) values ('sp_test_a', ${sql.json({v:'{"x":1}'})}, 'u1', now())`
  await sql`update pm_documents set data=${sql.json({v:'{"x":2}'})} where id='sp_test_a'`
  let r=await sql`select key, rev from pm_rev where key='sp_test_a'`; ok('rev 自增到 2', r[0]?.rev==2, JSON.stringify(r))
  r=await sql`select count(*)::int n from pm_outbox where key='sp_test_a'`; ok('outbox 兩筆', r[0].n==2)
  // 2) 閘門：鎖住前綴後，一般角色寫入被擋；偽造 editor 也被擋；設 abgd.sync 但沒 epoch 也被擋
  await sql`select pm_domain_set('sp_test_', 'test', 'abgd', 3, '測試')`
  let blocked=false; try{ await sql.begin(async t=>{ await t.unsafe(`set local role gd_app`); await t`update pm_documents set data=${sql.json({v:'{"x":3}'})}, editor='abgd-sync' where id='sp_test_a'` }) }catch(e){ blocked=/ABGD_LOCKED/.test(e.message); if(!blocked) console.log('  err:',e.message.slice(0,150)) } ok('鎖住後一般角色偽造 editor=abgd-sync 仍被擋', blocked)
  blocked=false; try{ await sql.begin(async t=>{ await t.unsafe(`set local role gd_app; select set_config('abgd.sync','1',true); select set_config('abgd.epoch','2',true)`); await t`update pm_documents set data=${sql.json({v:'{"x":3}'})} where id='sp_test_a'` }) }catch(e){ blocked=/ABGD_LOCKED/.test(e.message); if(!blocked) console.log('  err:',e.message.slice(0,150)) } ok('一般角色自己設 abgd.sync 但 epoch 錯也被擋', blocked)
  // 3) 投影 RPC：正確 epoch 放行、重送同 event_id 回 dup、錯 epoch 被 fence
  const ev='11111111-1111-1111-1111-111111111111'
  r=await sql`select pm_kv_project(${ev}::uuid, 'sp_test_a', '{"x":10}', 3, false) j`; ok('投影 epoch=3 成功', r[0].j.ok===true, JSON.stringify(r[0].j))
  r=await sql`select pm_kv_project(${ev}::uuid, 'sp_test_a', '{"x":11}', 3, false) j`; ok('同 event_id 重送回 dup 不改資料', r[0].j.dup===true)
  r=await sql`select data->>'v' v from pm_documents where id='sp_test_a'`; ok('資料仍是第一次投影的 x=10', r[0].v==='{"x":10}')
  let fenced=false; try{ await sql`select pm_kv_project('22222222-2222-2222-2222-222222222222'::uuid, 'sp_test_a', '{"x":12}', 2, false) j` }catch(e){ fenced=/ABGD_FENCED/.test(e.message) } ok('錯 epoch 被 fence（例外回滾）', fenced); r=await sql`select count(*)::int n from pm_sync_applied where event_id='22222222-2222-2222-2222-222222222222'`; ok('被 fence 的 event 不留 applied 列', r[0].n===0)
  r=await sql`select origin from pm_outbox where key='sp_test_a' order by id desc limit 1`; ok('投影產生的 outbox origin=abgd', r[0].origin==='abgd')
  // 4) 領取：lease＋CAS；同鍵序列化
  await sql`select pm_domain_set('sp_test_', 'test', 'gd', 3, '解鎖')`
  await sql`insert into pm_documents(id,data,editor,updated_at) values ('sp_test_b', ${sql.json({v:'{"y":1}'})}, 'u1', now())`
  await sql`update pm_documents set data=${sql.json({v:'{"y":2}'})} where id='sp_test_b'`
  const c1=await sql`select * from pm_outbox_claim('w1', 50, 60)`; const keysC1=new Set(c1.map(x=>x.key)); ok('一次領取每鍵只一筆', c1.length===keysC1.size, `領到 ${c1.length} 筆`)
  const c2=await sql`select * from pm_outbox_claim('w2', 50, 60)`; ok('第二個 worker 領不到同鍵（序列化）', c2.filter(x=>keysC1.has(x.key)).length===0, `w2 領到 ${c2.length}`)
  const tokW1=c1[0].lease_token; const n=await sql`select pm_outbox_done(${sql.array(c1.map(x=>x.id))}::bigint[], '00000000-0000-0000-0000-000000000000'::uuid, null) n`; ok('錯 token 標不了 done', n[0].n===0)
  const n2=await sql`select pm_outbox_done(${sql.array(c1.map(x=>x.id))}::bigint[], ${tokW1}::uuid, null) n`; ok('對 token 標 done', n2[0].n===c1.length)
  // 5) 晚提交：A 先寫（取得較小 outbox id）但晚 commit；B 後寫先 commit；worker 領取不靠 max-id，兩筆最後都能領到
  const A=sql.begin(async t=>{ await t`update pm_documents set data=${sql.json({v:'{"x":20}'})} where id='sp_test_a'`; await new Promise(r=>setTimeout(r,1500)) })
  await new Promise(r=>setTimeout(r,300))
  await sql`update pm_documents set data=${sql.json({v:'{"y":3}'})} where id='sp_test_b'`
  const early=await sql`select * from pm_outbox_claim('w3', 50, 60)`; await sql`select pm_outbox_done(${sql.array(early.map(x=>x.id))}::bigint[], ${early[0]?.lease_token||'00000000-0000-0000-0000-000000000000'}::uuid, null)`; await A
  const late=await sql`select * from pm_outbox_claim('w4', 50, 60)`
  ok('晚提交的事件之後仍領得到', late.some(x=>x.key==='sp_test_a'), `early=${early.map(x=>x.key)} late=${late.map(x=>x.key)}`)
  // 6) 一致讀取：刪後重建，rev 連續、deleted 正確
  await sql`delete from pm_documents where id='sp_test_b'`; r=await sql`select * from pm_read_current(array['sp_test_b'])`; ok('刪除後 deleted=true', r[0].deleted===true)
  await sql`insert into pm_documents(id,data,editor,updated_at) values ('sp_test_b', ${sql.json({v:'{"y":9}'})}, 'u1', now())`; r=await sql`select * from pm_read_current(array['sp_test_b'])`; ok('重建後 deleted=false 且 rev 繼續', r[0].deleted===false && r[0].rev>3, 'rev='+r[0].rev)
  // 7) 併發投影同 event_id：只有一個成功（另一個 dup）
  const e2='33333333-3333-3333-3333-333333333333'; await sql`select pm_domain_set('sp_test_', 'test', 'abgd', 4, 't')`
  const [p1,p2]=await Promise.allSettled([sql`select pm_kv_project(${e2}::uuid,'sp_test_a','{"x":30}',4,false) j`, sql`select pm_kv_project(${e2}::uuid,'sp_test_a','{"x":31}',4,false) j`])
  const res=[p1,p2].map(x=>x.status==='fulfilled'?x.value[0].j:{err:x.reason.message.slice(0,60)}); ok('併發同 event_id：一成功一 dup（無例外）', res.filter(x=>x.ok&&!x.dup).length===1 && res.filter(x=>x.dup).length===1, JSON.stringify(res))
}catch(e){ console.log('ERROR',e.message) } finally { await sql.unsafe(`drop table if exists public.pm_documents cascade; drop table if exists public.pm_outbox cascade; drop table if exists public.pm_rev cascade; drop table if exists public.pm_domain_lock; drop table if exists public.pm_sync_applied;`).catch(()=>{}); await sql.end() }
