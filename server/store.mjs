import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DEFAULT_STYLE, DEFAULT_SETTINGS, newProject, SPACES} from '../shared/domain.mjs';
export class Store {
  constructor(dir) {
    this.dir=path.resolve(dir);mkdirSync(this.dir,{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path.join(this.dir,'studio.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY,json TEXT NOT NULL);`);
    if(!this.get('settings','main'))this.put('settings','main',DEFAULT_SETTINGS);
    if(!this.get('style','main'))this.put('style','main',DEFAULT_STYLE);
    const savedStyle=this.get('style','main');if(savedStyle.formatProfile&&savedStyle.formatVersion!==4)this.put('style','main',{...savedStyle,formatProfile:undefined,formatEvidence:undefined,formatCheckedAt:undefined});
    if(!this.get('system','host'))this.put('system','host',{hostId:`urn:uuid:${randomUUID()}`});
    for(const a of this.list('asset'))if(a.role==='photo'&&!SPACES.includes(a.space))this.put('asset',a.id,{...a,space:'미분류',spaceManual:false,analysis:undefined,warning:'기존 사진입니다. 사진 분석을 눌러 새 공간 분류를 확인해 주세요.'});
    for(const job of this.list('job'))if(['running','queued','cancelling'].includes(job.status))this.put('job',job.id,{...job,status:job.kind==='publish'?'uncertain':'interrupted',message:job.kind==='publish'?'발행 작업이 중단되었습니다. 중복 방지를 위해 네이버 등록 여부를 확인해 주세요.':'작업이 중단되었습니다. 저장된 자료로 다시 시작할 수 있습니다.',updatedAt:new Date().toISOString()});
  }
  get(kind,id){const row=this.db.prepare('SELECT json FROM records WHERE kind=? AND id=?').get(kind,id);return row?JSON.parse(row.json):null;}
  put(kind,id,value){this.db.prepare('INSERT INTO records(kind,id,json) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json').run(kind,id,JSON.stringify(value));return value;}
  list(kind){return this.db.prepare('SELECT json FROM records WHERE kind=? ORDER BY rowid DESC').all(kind).map(r=>JSON.parse(r.json));}
  remove(kind,id){this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,id);}
  getCache(key){const row=this.db.prepare('SELECT json FROM cache WHERE key=?').get(key);return row?JSON.parse(row.json):null;}
  setCache(key,value){this.db.prepare('INSERT INTO cache(key,json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json').run(key,JSON.stringify(value));}
  createProject(){const p=newProject(randomUUID());this.put('project',p.id,p);return p;}
  saveProject(value, expectedRevision) {
    const current=this.get('project',value.id);
    if(!current)throw Object.assign(new Error('원고를 찾을 수 없습니다.'),{status:404});
    if(current.revision!==expectedRevision)throw Object.assign(new Error('다른 화면에서 원고가 변경되었습니다. 새로고침 후 다시 수정해 주세요.'),{status:409});
    const next={...value,revision:current.revision+1,createdAt:current.createdAt,updatedAt:new Date().toISOString()};
    this.put('project',value.id,next);return next;
  }
  updateProject(id, changes){const p=this.get('project',id);if(!p)throw new Error('원고가 없습니다.');return this.saveProject({...p,...changes},p.revision);}
  asset(id){const a=this.get('asset',id);if(!a)return null;return {...a,previewUrl:`/api/assets/${id}/preview`,originalUrl:`/api/assets/${id}/original`,pages:a.pages?.map(p=>({...p,imageUrl:p.imagePath?`/api/assets/${id}/page/${p.page}`:undefined}))};}
  assets(projectId){return this.list('asset').filter(a=>!projectId||a.projectId===projectId).map(a=>this.asset(a.id));}
  close(){this.db.close();}
}
