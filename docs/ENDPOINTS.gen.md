# API 端點目錄（自動產生，別手改）

`node scripts/check-endpoints.mjs` 產生；加新端點前先搜這份，撞名=build 直接擋。

## api/boss-sync.js（5 個口）

- `?bosspeek=` 行 68
- `?bossraw=` 行 80
- `?fillpos=` 行 105
- `?histfill=` 行 93
- `?ping=` 行 62

## api/cron-daily.js（1 個口）

- `?dry=` 行 241

## api/hr.js（1 個口）

- `?shifts=` 行 163

## api/inline-sync.js（8 個口）

- `?backfill=` 行 306
- `?custbuild=` 行 253
- `?custdb=` 行 230
- `?custfind=` 行 244
- `?custinsights=` 行 238
- `?custtop=` 行 266
- `?kwsearch=` 行 259
- `?probe=` 行 223

## api/line-webhook.js（3 個口）

- `?ccdone=` 行 1858
- `?ccinbox=` 行 1852
- `?warm=` 行 1845

## api/mail-sync.js（106 個口）

- `?abscan=` 行 1606
- `?absinc=` 行 1850
- `?aliasget=` 行 1329
- `?aliasset=` 行 1334
- `?bindcard=` 行 2933
- `?bindcode=` 行 424
- `?bossprobe=` 行 2915
- `?buy=` 行 3299
- `?buyadd=` 行 3307
- `?buyop=` 行 3326
- `?catprobe=` 行 873
- `?debug=` 行 3493
- `?delday=` 行 819
- `?dinefill=` 行 1295
- `?docgrep=` 行 839
- `?errlog=` 行 1561
- `?errs=` 行 1595
- `?fb=` 行 1750
- `?fbj=` 行 1767
- `?fbset=` 行 1790
- `?fc=` 行 1443
- `?fcadj=` 行 1529
- `?fcrun=` 行 1551
- `?fcso=` 行 1484
- `?fcsp=` 行 1509
- `?gdrole=` 行 1420, 2590
- `?gdstaff=` 行 1391
- `?hridlock=` 行 2601
- `?hrmaster=` 行 2769
- `?hrmasterset=` 行 2828
- `?hrmasterup=` 行 2792
- `?ichefpurge=` 行 1413
- `?ingest=` 行 459
- `?inv=` 行 2267
- `?invcount=` 行 2296
- `?invset=` 行 2274
- `?kvproxy=` 行 942
- `?labor=` 行 2854
- `?laborset=` 行 2860
- `?lb=` 行 2505
- `?liffauth=` 行 2754
- `?manifest=` 行 407
- `?meet=` 行 1867
- `?meetping=` 行 2667
- `?meetset=` 行 1878
- `?menu=` 行 1673
- `?menuen=` 行 593
- `?menuimgset=` 行 1699
- `?menumv=` 行 625
- `?menunote=` 行 610
- `?menuprobe=` 行 3450
- `?menuset=` 行 1721
- `?notifycfg=` 行 1367
- `?notifyset=` 行 1375
- `?ntf=` 行 2732
- `?ntfping=` 行 2741
- `?ntfread=` 行 2720
- `?opsboard=` 行 1037
- `?payset=` 行 2838
- `?phingest=` 行 645
- `?poshide=` 行 1654
- `?prepact=` 行 2997
- `?prepapply=` 行 2570
- `?prepfav=` 行 3063
- `?prephide=` 行 3047
- `?preplog=` 行 3039
- `?prepmigrate=` 行 906
- `?prepperm=` 行 2953
- `?preppermset=` 行 2613
- `?priceset=` 行 1312
- `?punchfix=` 行 1967
- `?punchme=` 行 1956
- `?pushsub=` 行 2700
- `?revprobe=` 行 862
- `?rosterprobe=` 行 886
- `?rosterset=` 行 3422
- `?shift=` 行 1985
- `?shiftcolor=` 行 2129
- `?shiftdedup=` 行 2163
- `?shiftfill=` 行 2141
- `?shiftset=` 行 2180
- `?sop=` 行 2313
- `?sopdone=` 行 3078
- `?sopedit=` 行 3120
- `?sopfull=` 行 3354
- `?sopissue=` 行 3225
- `?soprate=` 行 2547
- `?sopref=` 行 1829
- `?sopreport=` 行 3165
- `?sopresolve=` 行 3193
- `?sopreview=` 行 3402
- `?sopset=` 行 3106
- `?sopsign=` 行 3153
- `?sopst=` 行 2358
- `?sopstamp=` 行 1815
- `?sopsugset=` 行 2453
- `?supplyingest=` 行 673
- `?supplyreset=` 行 534
- `?tabcfg=` 行 1632
- `?tabset=` 行 1638
- `?taskfill=` 行 494
- `?taskmove=` 行 473
- `?tasknotify=` 行 973
- `?txprobe=` 行 441
- `?webpushcfg=` 行 2695
- `?whoami=` 行 1024
