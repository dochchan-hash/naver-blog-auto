export function readPublicationSettings(){
  const checked=text=>{const l=[...document.querySelectorAll('label')].find(e=>e.textContent.replace(/\s/g,'')===text);return !!(l&&(l.control||document.getElementById(l.htmlFor)||l.querySelector('input')))?.checked;};
  const visible=e=>e.getBoundingClientRect().width>0;
  const date=[...document.querySelectorAll('input')].find(e=>visible(e)&&/^\d{4}\.\s*\d{1,2}\.\s*\d{1,2}/.test(e.value))?.value.replace(/\s/g,'');
  const selects=[...document.querySelectorAll('select')].filter(visible);
  const h=selects.find(e=>/hour_option|예약.*시간/.test(e.className+' '+(e.getAttribute('aria-label')||'')))||selects.find(e=>e.options.length===24);
  const m=selects.find(e=>/minute_option|예약.*분/.test(e.className+' '+(e.getAttribute('aria-label')||'')))||selects.find(e=>[...e.options].map(o=>o.textContent.trim()).join(',')==='00,10,20,30,40,50');
  const hour=h?.selectedOptions[0]?.textContent.trim(),minute=m?.selectedOptions[0]?.textContent.trim();
  const input=document.querySelector('#tag-input,input[placeholder*="태그"]');const root=input?.closest('[class*="tag_textarea"]')||input?.parentElement?.parentElement;
  const chips=root?[...root.querySelectorAll('[id^="tag-item-"],span[class*="tag_text"],span[class*="tag_name"]')].map(e=>e.textContent.replace(/^#/,'').trim()).filter(Boolean):[];
  return {reserved:checked('예약'),private:checked('비공개'),public:checked('전체공개'),time:date&&hour&&minute?`${date} ${hour}:${minute}`:'',tags:root?.innerText||'',tagList:chips,inputTag:input?.value||'',category:document.querySelector('button[aria-label="카테고리 목록 버튼"]')?.textContent.replace('하위 카테고리','').trim()||''};
}
