const fs=require('node:fs');const path=require('node:path');
module.exports=async context=>{
  const platform=context.electronPlatformName,arch=['ia32','x64','armv7l','arm64'][context.arch];
  const packages=platform==='darwin'?[`@img/sharp-darwin-${arch}`,`@img/sharp-libvips-darwin-${arch}`,`@napi-rs/canvas-darwin-${arch}`]:platform==='win32'?[`@img/sharp-win32-${arch}`,`@napi-rs/canvas-win32-${arch}-msvc`]:[];
  for(const name of packages)if(!fs.existsSync(path.join(context.packager.projectDir,'node_modules',name,'package.json')))throw new Error(`${name}가 없습니다. 운영체제별 package 명령으로 다시 빌드해 주세요.`);
};
