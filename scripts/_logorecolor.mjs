// Clean + recompose the :D logo: recolor vivid, auto-trim, auto-center with even padding.
import pw from '/Users/wayz/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
const { chromium } = pw;
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'public/ops/icon-source.png';   // clean centered :D (張良 approved shape)
const VIVID = [249, 42, 27];                 // #F92A1B official brand red
const FILL = 0.80;                           // mark occupies this fraction of the icon
const OUT = [[512,'public/ops/icon-512.png'],[192,'public/ops/icon-192.png'],[180,'public/ops/icon-180.png'],
             [512,'/tmp/recolor-preview.png']];

const dataUrl = 'data:image/png;base64,' + readFileSync(SRC).toString('base64');
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.setContent(`<img id="im" src="${dataUrl}">`);
await page.waitForFunction(() => { const i=document.getElementById('im'); return i&&i.complete&&i.naturalWidth>0; });

const result = await page.evaluate(({ VIVID, OUT, FILL }) => {
  const im = document.getElementById('im');
  const W=im.naturalWidth, H=im.naturalHeight;
  const base=document.createElement('canvas'); base.width=W; base.height=H;
  const bg=base.getContext('2d'); bg.drawImage(im,0,0);
  const src=bg.getImageData(0,0,W,H); const d=src.data;
  // representative solid green to key anti-aliasing
  let sumG=0,nG=0; for(let i=0;i<d.length;i+=4){const r=d[i],g=d[i+1],b=d[i+2]; if(r>120&&g<120&&b<120){sumG+=g;nG++;}}
  const Gred=nG?Math.round(sumG/nG):40;
  // recolor + find bbox of the mark
  let x0=W,y0=H,x1=0,y1=0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const i=(y*W+x)*4; let a=(255-d[i+1])/(255-Gred); a=a<0?0:a>1?1:a;
    d[i]  =Math.round(255*(1-a)+VIVID[0]*a);
    d[i+1]=Math.round(255*(1-a)+VIVID[1]*a);
    d[i+2]=Math.round(255*(1-a)+VIVID[2]*a);
    d[i+3]=255;
    if(a>0.15){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
  }
  bg.putImageData(src,0,0);
  const bw=x1-x0+1, bh=y1-y0+1;
  const outs=[];
  for(const [size,path] of OUT){
    const c=document.createElement('canvas'); c.width=size; c.height=size;
    const g=c.getContext('2d'); g.imageSmoothingEnabled=true; g.imageSmoothingQuality='high';
    g.fillStyle='#FFFFFF'; g.fillRect(0,0,size,size);
    const scale=(size*FILL)/Math.max(bw,bh);
    const dw=bw*scale, dh=bh*scale;
    g.drawImage(base, x0,y0,bw,bh, (size-dw)/2,(size-dh)/2, dw,dh);
    outs.push({ path, dataUrl:c.toDataURL('image/png') });
  }
  return { Gred, bbox:[x0,y0,x1,y1], outs };
}, { VIVID, OUT, FILL });

for(const o of result.outs){ writeFileSync(o.path, Buffer.from(o.dataUrl.split(',')[1],'base64')); console.log('wrote',o.path); }
console.log('Gred=',result.Gred,'bbox=',result.bbox.join(','),'fill=',FILL);
await browser.close();
