import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const matrix={
  'darwin-arm64':['@napi-rs/canvas-darwin-arm64@0.1.100','@img/sharp-darwin-arm64@0.35.5','@img/sharp-libvips-darwin-arm64@1.3.4'],
  'darwin-x64':['@napi-rs/canvas-darwin-x64@0.1.100','@img/sharp-darwin-x64@0.35.5','@img/sharp-libvips-darwin-x64@1.3.4'],
  'win32-x64':['@napi-rs/canvas-win32-x64-msvc@0.1.100','@img/sharp-win32-x64@0.35.5'],
};
const targets=process.argv.slice(2);if(!targets.length)targets.push(`${process.platform}-${process.arch}`);
const npm=process.env.npm_execpath;if(!npm)throw new Error('npm run package:mac 또는 npm run package:win으로 실행해 주세요.');
for(const target of targets){
  if(!matrix[target])throw new Error(`지원하지 않는 대상: ${target}`);
  const [platform,arch]=target.split('-'),dir=path.join(root,'.local','platform-modules',target);await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({name:`lemonhouse-native-${target}`,private:true}));
  console.log(`${target} 사진·PDF 처리 모듈 확인`);
  execFileSync(process.execPath,[npm,'install','--prefix',dir,`--os=${platform}`,`--cpu=${arch}`,'--force','--ignore-scripts','--no-audit','--no-fund',...matrix[target]],{cwd:root,stdio:'inherit'});
  for(const spec of matrix[target]){const name=spec.slice(0,spec.lastIndexOf('@'));await fs.cp(path.join(dir,'node_modules',name),path.join(root,'node_modules',name),{recursive:true,force:true});}
}
