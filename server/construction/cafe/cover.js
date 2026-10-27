// 원본 PSD에서 재현한 공사전·공사중 표지. 미리보기와 JPG가 같은 배치를 쓴다.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const {chromium} = require('playwright');
const {ASSET_DIR} = require('./config');
const {동표기} = require('./names');
const template = require('../public/cover-template');
const dataURL = (buffer, mime) => `data:${mime};base64,${buffer.toString('base64')}`;

function logoFile(kind) {
  const name = template.kinds[kind]?.logo;
  if (!name) throw new Error('공사전 또는 공사중 표지를 선택해 주세요.');
  const custom = path.join(ASSET_DIR,name);
  return fs.existsSync(custom) ? custom : path.resolve(__dirname,'../public/brand',name);
}

function 표지제목({시도, 구, 동, 아파트명, 평수}) {
  const area = String(평수 || '').replace(/[^\d.]/g, '');
  return [시도, 구, 동표기({동, 아파트명}), 아파트명].map(v => String(v || '').trim()).filter(Boolean).join(' ') + (area ? ` ${area}PY` : '');
}
async function 만들기({photo, out, 분류, 제목, ...edit}) {
  if (edit.y === undefined && edit.초점Y !== undefined) edit.y = edit.초점Y;
  const cover = template.settings(분류, edit, 제목);
  if (!fs.existsSync(photo)) throw new Error('표지 사진을 찾지 못했습니다. 사진을 다시 선택해 주세요.');
  const image = await sharp(photo).rotate().resize({width:3600, height:3600, fit:'inside', withoutEnlargement:true}).png().toBuffer();
  const {width,height} = await sharp(image).metadata();
  const markup = template.markup({cover, width, height, photoURL:dataURL(image,'image/png'), logoURL:dataURL(fs.readFileSync(logoFile(분류)),'image/png')});
  const browser = await chromium.launch({channel:'chrome', headless:true});
  try {
    const page = await browser.newPage({viewport:{width:3000,height:3000},deviceScaleFactor:1});
    await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}</style></head><body>'+markup+'</body></html>',{waitUntil:'load'});
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate('('+template.fitTitle.toString()+')(document,'+cover.titleSize+')');
    const png = await page.screenshot({type:'png',clip:{x:0,y:0,width:3000,height:3000}});
    fs.mkdirSync(path.dirname(out),{recursive:true});
    await sharp(png).jpeg({quality:95,chromaSubsampling:'4:4:4'}).toFile(out);
    return out;
  } finally { await browser.close().catch(() => {}); }
}
module.exports = {만들기, 표지제목, logoFile};
