import {extractFile,listPackage} from '@electron/asar';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const sources=['dist/index.html',...(await fs.readdir('dist/assets')).map(name=>'dist/assets/'+name)];
for(const dir of ['server','shared','desktop'])sources.push(...(await fs.readdir(dir)).map(name=>dir+'/'+name));
const targets=[
  {name:'Mac Apple Silicon',resources:'release/mac-arm64/Lemonhouse Blog Studio.app/Contents/Resources',native:'@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node',architecture:'arm64'},
  {name:'Mac Intel',resources:'release/mac/Lemonhouse Blog Studio.app/Contents/Resources',native:'@napi-rs/canvas-darwin-x64/skia.darwin-x64.node',architecture:'x86_64'},
  {name:'Windows x64',resources:'release/win-unpacked/resources',native:'@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node',architecture:'x86-64'},
];
const hash=data=>createHash('sha256').update(data).digest('hex');
const results=[];
for(const target of targets){
  const archive=target.resources+'/app.asar';
  for(const source of sources)if(hash(await fs.readFile(source))!==hash(extractFile(archive,source)))throw new Error(`${target.name}: 최신 코드가 포함되지 않았습니다 (${source}).`);
  const entries=listPackage(archive);if(entries.some(p=>/(?:accounts\.enc|studio\.sqlite|\/\.local\/)/.test(p)))throw new Error(`${target.name}: 개인 자료 제외 검사를 통과하지 못했습니다.`);
  const native=execFileSync('/usr/bin/file',[target.resources+'/app.asar.unpacked/node_modules/'+target.native],{encoding:'utf8'});
  if(!native.includes(target.architecture))throw new Error(`${target.name}: 처리 모듈의 대상 기기가 다릅니다.`);
  results.push({target:target.name,currentSources:true,privateDataExcluded:true,nativeArchitecture:target.architecture});
}
await fs.mkdir('.local/checks',{recursive:true});await fs.writeFile('.local/checks/release-validation.json',JSON.stringify({checkedAt:new Date().toISOString(),targets:results},null,2));
console.log(JSON.stringify(results));
