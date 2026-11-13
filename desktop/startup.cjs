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
module.exports={loadStudio};
