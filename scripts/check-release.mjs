import {extractFile,listPackage} from '@electron/asar';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
const sources=[];
for(const dir of ['dist','server','shared','desktop'])for(const entry of await fs.readdir(dir,{recursive:true,withFileTypes:true}))if(entry.isFile())sources.push(path.relative('.',path.join(entry.parentPath,entry.name)).replaceAll('\\','/'));
const targets=[
  {name:'Mac Apple Silicon',resources:'release/mac-arm64/Lemonhouse Blog Studio.app/Contents/Resources',native:'@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node',architecture:'arm64'},
  {name:'Mac Intel',resources:'release/mac/Lemonhouse Blog Studio.app/Contents/Resources',native:'@napi-rs/canvas-darwin-x64/skia.darwin-x64.node',architecture:'x86_64'},
  {name:'Windows x64',resources:'release/win-unpacked/resources',native:'@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node',architecture:'x86-64'},
];
const hash=data=>createHash('sha256').update(data).digest('hex');
const results=[];
const selected=targets.filter(t=>process.platform==='win32'?t.name==='Windows x64':process.platform==='darwin'&&t.architecture===(process.arch==='arm64'?'arm64':'x86_64'));
assert.equal(selected.length,1,'지원하는 Windows 또는 Mac에서 실행해 주세요.');
for(const target of selected){
  if(process.argv[2])target.resources=path.resolve(process.argv[2]);
  const archive=target.resources+'/app.asar';
  const manifest=JSON.parse(await fs.readFile('package.json','utf8')),packaged=JSON.parse(extractFile(archive,'package.json'));
  for(const key of ['name','version','type','main','dependencies'])assert.deepEqual(packaged[key],manifest[key],`배포 package.json의 ${key}가 다릅니다.`);
  for(const source of sources)if(hash(await fs.readFile(source))!==hash(extractFile(archive,path.normalize(source))))throw new Error(`${target.name}: 최신 코드가 포함되지 않았습니다 (${source}).`);
  const entries=listPackage(archive).map(p=>p.replaceAll('\\','/'));assert(!entries.some(p=>/(?:^|\/)(?:accounts\.enc|studio\.sqlite(?:-[a-z]+)?)(?:\/|$)/.test(p)||/^\/(?:\.local|\.env(?:\.[^/]+)?|tests|scripts|src)(?:\/|$)/.test(p)),`${target.name}: 개인·개발 자료가 포함되었습니다.`);
  const nativePath=target.resources+'/app.asar.unpacked/node_modules/'+target.native;
  if(target.name==='Windows x64'){
    const native=await fs.readFile(nativePath),offset=native.readUInt32LE(0x3c);
    assert.equal(native.toString('ascii',0,2),'MZ');assert.equal(native.toString('ascii',offset,offset+4),'PE\0\0');assert.equal(native.readUInt16LE(offset+4),0x8664,'Windows x64 처리 모듈이 아닙니다.');
  }else assert(execFileSync('/usr/bin/file',[nativePath],{encoding:'utf8'}).includes(target.architecture),`${target.name}: 처리 모듈의 대상 기기가 다릅니다.`);
  results.push({target:target.name,currentSources:true,privateDataExcluded:true,nativeArchitecture:target.architecture});
}
await fs.mkdir('.local/checks',{recursive:true});await fs.writeFile('.local/checks/release-validation.json',JSON.stringify({checkedAt:new Date().toISOString(),targets:results},null,2));
console.log(JSON.stringify(results));
