const fs=require('node:fs');const path=require('node:path');
function studioPaths({dataDir,packaged,projectRoot,exePath,userData}){
  let folder=dataDir||(!packaged?path.join(projectRoot,'.local'):null);
  if(!folder){
    const portableRoot=path.resolve(path.dirname(exePath),'..','..'),portableData=path.join(portableRoot,'.local');
    if(path.basename(path.dirname(exePath))==='win-unpacked'&&path.basename(path.dirname(path.dirname(exePath)))==='release'&&fs.existsSync(path.join(portableRoot,'레몬하우스 실행.cmd'))&&fs.existsSync(path.join(portableData,'studio.sqlite')))folder=portableData;
  }
  return {dataDir:folder||path.join(userData,'workspace'),userData:folder?path.join(folder,'desktop'):userData};
}
async function loadStudio(window,url){
  for(let attempt=0;attempt<3;attempt++){
    if(window.isDestroyed())return;
    try{return await window.loadURL(url);}
    catch(error){
      if(window.isDestroyed())return;
      if(!['ERR_FAILED','ERR_NETWORK_CHANGED','ERR_CONNECTION_RESET','ERR_CONNECTION_REFUSED'].includes(error.code)||attempt===2)throw error;
      console.warn(`프로그램 화면 연결 재시도 ${attempt+1}/2: ${error.code}`);
      await new Promise(resolve=>setTimeout(resolve,1500));
    }
  }
}
module.exports={loadStudio,studioPaths};
