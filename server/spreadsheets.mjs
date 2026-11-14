import fs from 'node:fs/promises';

export const excelMimes=['application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
export async function spreadsheetMime(head,filename,file){
  if(/\.xlsx$/i.test(filename)&&head.subarray(0,4).equals(Buffer.from([80,75,3,4])))return excelMimes[1];
  if(/\.xls$/i.test(filename)){
    if(head.subarray(0,8).equals(Buffer.from([208,207,17,224,161,177,26,225])))return excelMimes[0];
    const bytes=await fs.readFile(file),text=new TextDecoder(head[0]===255&&head[1]===254?'utf-16le':head[0]===254&&head[1]===255?'utf-16be':'utf-8').decode(bytes);
    if(/^\s*</.test(text)&&(/<table\b/i.test(text)&&/<tr\b/i.test(text)&&/<t[dh]\b/i.test(text)||/<(?:\w+:)?Workbook\b/i.test(text)&&/urn:schemas-microsoft-com:office:spreadsheet/i.test(text)))return excelMimes[0];
  }
  return null;
}
export async function spreadsheetPages(file,mime){
  const {read,utils}=await import('xlsx');
  const bytes=await fs.readFile(file),encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':null;
  const workbook=read(encoding?new TextDecoder(encoding).decode(bytes):bytes,{type:encoding?'string':'buffer',cellFormula:false,cellHTML:false,bookVBA:false,bookFiles:true});
  if(mime===excelMimes[1]&&!workbook.keys?.includes('xl/workbook.xml'))throw new Error('XLSX 엑셀 통합 문서가 아닙니다.');
  const pages=workbook.SheetNames.flatMap((sheet,i)=>{
    const text=utils.sheet_to_csv(workbook.Sheets[sheet],{FS:'\t',RS:'\n',blankrows:false}).trim();
    return text?[{page:i+1,sheet,text:`[시트: ${sheet}]\n${text}`,scanned:false}]:[];
  });
  if(!pages.length)throw new Error('읽을 수 있는 셀 내용이 없습니다. 수식은 엑셀에서 계산·저장한 뒤 다시 첨부해 주세요.');
  return pages;
}
