# 成本模組：把阿桑 10/06「產品與食譜成本總表.xlsx」灌進 KV 當驗收基準（規格決策 #1：快照只當驗收基準，不是正式資料源）
# 用法：python3 -I scripts/cost-snap-ingest.py <xlsx路徑> <asOf 如 2026-10-06> [host]
# 2026-10-15 成本模組已切到新殼 abgd：改打新殼維護口 /api/ops/cost/maint（Bearer CRON_SECRET；讀 ../abgd/.env.local 或環境變數 ABGD_CRON_SECRET）。GD ?costsnap 已回 409
import sys, json, datetime, os, urllib.request, site; sys.path.append(site.getusersitepackages())
import openpyxl
xlsx, asof = sys.argv[1], sys.argv[2]; host = sys.argv[3] if len(sys.argv) > 3 else 'https://ab-gd.vercel.app'
key = os.environ.get('ABGD_CRON_SECRET', '')
if not key and os.path.exists('../abgd/.env.local'):
    for ln in open('../abgd/.env.local'):
        if ln.startswith('CRON_SECRET='): key = ln.split('=', 1)[1].strip().strip('"\'')
if not key: sys.exit('缺新殼 CRON_SECRET（../abgd/.env.local 或環境變數 ABGD_CRON_SECRET）')
wb = openpyxl.load_workbook(xlsx, read_only=True)
def cv(x):
    if isinstance(x, (datetime.datetime, datetime.date)): return x.strftime('%Y-%m-%d')
    if isinstance(x, float): return round(x, 4)
    return x
M = {
 'products': ('產品總表', ['sys','sku','code','name','spec','unit','conv','supplier','tax','price','cat','store','dept','status','lastPrice','lastDate','unitCost','convUnit','minUnitCost']),
 'suppliers': ('廠商彙整', ['sys','name','status','tax','nItems','nActive','nPriced','nUnpriced','nHistItems','nHistOrders']),
 'recipes': ('食譜彙總', ['code','name','status','yieldQty','yieldUnit','nLines','nCosted','cost','unitCost','unit','appUnitCost','complete']),
 'recipeLines': ('食譜明細', ['recipeCode','recipe','recipeStatus','yieldQty','yieldUnit','recipeCost','complete','idx','code','name','qty','unit','conv','unitCost','lineCost','status']),
 'menu': ('菜單毛利', ['status','cat','name','price','cost','costNote','margin','coverage','gap','lines']),
 'menuLines': ('菜單食譜逐行', ['cat','menu','price','cost','margin','idx','code','name','qty','unit','lineCost','leaf','match']),
 'quality': ('資料品質', ['cat','sku','code','name','supplier','price','status','note']),
 'priceLog': ('價格浮動明細', None),
 'sameName': ('同品名多廠商', ['sys','name','detail']),
}
for k, (title, cols) in M.items():
    rows = list(wb[title].iter_rows(values_only=True))
    hdr = [str(h) if h is not None else f'c{i}' for i, h in enumerate(rows[0])]
    keys = (cols + hdr[len(cols):]) if cols else hdr
    out = [{keys[i]: cv(v) for i, v in enumerate(r) if i < len(keys) and v not in (None, '')} for r in rows[1:] if any(v is not None for v in r)]
    body = json.dumps({'kind': 'costsnap', 'sheet': k, 'asOf': asof, 'rows': out}, ensure_ascii=False).encode()
    req = urllib.request.Request(f'{host}/api/ops/cost/maint', data=body, headers={'content-type': 'application/json', 'authorization': f'Bearer {key}'}, method='POST')
    print(k, len(out), urllib.request.urlopen(req, timeout=120).read().decode()[:120])
