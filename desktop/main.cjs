const {app,BrowserWindow,shell,safeStorage,dialog}=require('electron');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const {BrowserBridge}=require('./browser.cjs');
const {jobNotifications}=require('./notifications.cjs');
const {loadStudio,studioPaths}=require('./startup.cjs');
const projectRoot=path.resolve(__dirname,'..');
app.setName('Lemonhouse Blog Studio');
const studio=studioPaths({dataDir:process.env.LEMONHOUSE_DATA_DIR,packaged:app.isPackaged,projectRoot,exePath:process.execPath,userData:app.getPath('userData')});
app.setPath('userData',studio.userData);
if(process.platform==='win32')app.setAppUserModelId('kr.lemonhouse.blogstudio');
let runtime,mainWindow;
const single=app.requestSingleInstanceLock();if(!single)app.quit();
app.on('second-instance',()=>{if(mainWindow&&!mainWindow.isDestroyed()){mainWindow.show();mainWindow.focus();}});
function createVault(dir){
  const file=path.join(dir,'accounts.enc');fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const read=()=>{if(!fs.existsSync(file))return {};if(!safeStorage.isEncryptionAvailable())throw new Error('계정 정보를 복호화할 수 없습니다. 운영체제의 보안 저장소를 확인해 주세요.');return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));};
  const write=values=>{if(!safeStorage.isEncryptionAvailable())throw new Error('보안 저장소가 준비되지 않았습니다. 계정 연결을 저장할 수 없습니다.');const temp=file+'.tmp';fs.writeFileSync(temp,safeStorage.encryptString(JSON.stringify(values)),{mode:0o600});fs.renameSync(temp,file);};
  return {get:k=>read()[k],set:(k,v)=>write({...read(),[k]:v}),remove:k=>{const values=read();delete values[k];write(values);},persistent:true};
}
if(single)app.whenReady().then(async()=>{
  const {createServer}=await import(pathToFileURL(path.join(projectRoot,'server','index.mjs')).href);
  const dataDir=studio.dataDir;
  const vault=createVault(dataDir);
  runtime=await createServer({dataDir,port:0,bridge:new BrowserBridge({vault}),vault,openExternal:url=>shell.openExternal(url),onJob:jobNotifications(()=>mainWindow)});
  console.log(`레몬하우스 스튜디오: ${runtime.url}`);
  mainWindow=new BrowserWindow({width:1480,height:950,minWidth:980,minHeight:680,title:'레몬하우스 · 블로그 스튜디오',backgroundColor:'#f7f8f5',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
  mainWindow.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\//.test(url))shell.openExternal(url);return {action:'deny'};});
  mainWindow.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(runtime.url+'/'))event.preventDefault();});
  mainWindow.on('closed',()=>app.quit());
  await loadStudio(mainWindow,runtime.url+'/');
  app.on('activate',()=>{mainWindow?.show();});
}).catch(error=>{dialog.showErrorBox('프로그램 실행 확인 필요',error.message);app.quit();});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{if(runtime)runtime.server.close();});
