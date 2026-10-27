(function (root) {
  const kinds = {
    before: {badgeText: '공사전', badgeColor: '#FFAF26', logo: 'logo-before.png'},
    during: {badgeText: '공사중', badgeColor: '#D66F31', logo: 'logo-during.png'},
  };
  const frame = {left:396, top:566, width:2206, height:1996};
  const defaults = {x:50, y:50, zoom:1, saturation:20, titleFont:'Pretendard', titleSize:122, titleColor:'#000000', titleAlign:'center', titleWeight:400,
    titleX:319, titleY:147, badgeX:2302, badgeY:558, badgeSize:118, badgeVisible:true, logoVisible:true,
    backgroundColor:'#EEEEED', cardColor:'#ffffff', ruleColor:'#1A1E25'};
  const ranges = {x:[0,100], y:[0,100], zoom:[1,3], saturation:[0,200], titleSize:[40,200], titleX:[0,639], titleY:[0,400], badgeX:[0,2520], badgeY:[0,2520], badgeSize:[40,180]};
  const colors = ['titleColor','badgeColor','backgroundColor','cardColor','ruleColor'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function normalize(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('표지 수정값을 확인해 주세요.');
    const out = {};
    for (const [key, [min,max]] of Object.entries(ranges)) if (value[key] !== undefined) {
      if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max) throw new Error('표지 '+key+' 값의 범위를 확인해 주세요.');
      out[key] = value[key];
    }
    for (const key of colors) if (value[key] !== undefined) {
      if (typeof value[key] !== 'string' || !/^#[\da-f]{6}$/i.test(value[key])) throw new Error('표지 색상은 #RRGGBB 형식으로 입력해 주세요.');
      out[key] = value[key];
    }
    for (const [key,limit] of Object.entries({titleText:300, badgeText:20, titleFont:80})) if (value[key] !== undefined && value[key] !== null) {
      if (typeof value[key] !== 'string' || value[key].length > limit || /[\x00-\x1f]/.test(value[key]) || key === 'titleFont' && !/^[\w\s가-힣-]+$/.test(value[key])) throw new Error('표지 문구 또는 글꼴을 확인해 주세요.');
      out[key] = value[key];
    }
    for (const key of ['badgeVisible','logoVisible']) if (value[key] !== undefined) {
      if (typeof value[key] !== 'boolean') throw new Error('표지 표시 설정을 확인해 주세요.');
      out[key] = value[key];
    }
    if (value.titleAlign !== undefined) {
      if (!['left','center','right'].includes(value.titleAlign)) throw new Error('표지 제목 정렬을 확인해 주세요.');
      out.titleAlign = value.titleAlign;
    }
    if (value.titleWeight !== undefined) {
      if (![400,700].includes(value.titleWeight)) throw new Error('표지 글자 굵기를 확인해 주세요.');
      out.titleWeight = value.titleWeight;
    }
    return out;
  }

  function settings(kind, value = {}, title = '') {
    if (!kinds[kind]) throw new Error('공사전 또는 공사중 표지를 선택해 주세요.');
    return {...defaults, ...kinds[kind], titleText:title, ...normalize(value)};
  }
  function placement(width, height, cover) {
    const scale = Math.max(frame.width/width, frame.height/height)*cover.zoom;
    const w = Math.round(width*scale), h = Math.round(height*scale);
    // 틀과 너비가 같아도 가로 조절이 가능하며 기본 중앙 배치는 원본과 같다.
    const axis = (size, fitted, percent) => fitted-size > 1 ? (size-fitted)*percent/100 : (size-fitted)/2+(50-percent)/100*size;
    return {width:w, height:h, x:axis(frame.width,w,cover.x), y:axis(frame.height,h,cover.y)};
  }
  function markup({cover:c, photoURL='', logoURL='', width=frame.width, height=frame.height}) {
    const p = placement(width,height,c);
    return `<style>
      .artboard{width:3000px;height:3000px;position:relative;overflow:hidden;background:${c.backgroundColor};font-family:'${c.titleFont}','Noto Sans KR','Malgun Gothic',sans-serif;color:#000}
      .rule{position:absolute;left:319px;width:2361px;height:3px;background:${c.ruleColor}}.r1{top:144px}.r2{top:340px}
      .title{position:absolute;left:${c.titleX}px;top:${c.titleY}px;width:2361px;height:193px;display:flex;align-items:center;justify-content:${{left:'flex-start',center:'center',right:'flex-end'}[c.titleAlign]};white-space:nowrap;font-weight:${c.titleWeight};color:${c.titleColor};letter-spacing:-0.01em;font-size:${c.titleSize}px;line-height:1}
      .card{position:absolute;left:319px;top:473px;width:2361px;height:2361px;background:${c.cardColor};box-shadow:0 0 18px rgba(0,0,0,.10)}
      .photo{position:absolute;left:${frame.left}px;top:${frame.top}px;width:${frame.width}px;height:${frame.height}px;background:#ddd;overflow:hidden}
      .photo img{position:absolute;width:${p.width}px;height:${p.height}px;left:${p.x}px;top:${p.y}px;filter:saturate(${c.saturation}%);pointer-events:none}
      .badge{position:absolute;left:${c.badgeX}px;top:${c.badgeY}px;width:480px;height:480px;border-radius:50%;background:${c.badgeColor};box-shadow:0 8px 18px rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:${c.badgeSize}px;letter-spacing:-0.02em}
      .logo{position:absolute;left:1185px;top:2643px;width:638px;height:131px}
    </style><div class="artboard"><div class="rule r1"></div><div class="title" data-part="title"><span>${esc(c.titleText)}</span></div><div class="rule r2"></div><div class="card"></div><div class="photo" data-part="photo">${photoURL?`<img alt="표지 사진" src="${esc(photoURL)}">`:''}</div>${c.badgeVisible?`<div class="badge" data-part="badge">${esc(c.badgeText)}</div>`:''}${c.logoVisible&&logoURL?`<img class="logo" alt="로고" src="${esc(logoURL)}">`:''}</div>`;
  }
  // 브라우저 미리보기와 JPG 렌더러가 같은 글자 폭 계산을 사용한다.
  function fitTitle(root, size) {
    const title = root.querySelector('.title'), span = title.querySelector('span');
    title.style.fontSize = size+'px';
    const min = Math.min(size,70);
    while (span.offsetWidth > 2300 && size > min) { size -= 2; title.style.fontSize = size+'px'; }
  }
  const api = {kinds, frame, defaults, normalize, settings, placement, markup, fitTitle};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CoverTemplate = api;
})(globalThis);
