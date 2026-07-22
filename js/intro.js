// 소개 동적 섹션 — 위에서부터 순차 로드: ① 경기일정(MATCH DAY) → ② 선수 명단(SQUAD)
(function(){
  var SB_URL="https://fjgxhguogsuypcdzcieg.supabase.co";
  var SB_KEY="sb_publishable_K7TsALmaFyb2pPOZO-2i2w_UeirVr8l";
  var ENG=['SUN','MON','TUE','WED','THU','FRI','SAT'];
  function esc(s){return (s||'').replace(/[<>&]/g,function(c){return c==='<'?'&lt;':c==='>'?'&gt;':'&amp;';});}
  function linkify(s){return esc(s).replace(/(https?:\/\/[^\s<]+)/g,function(u){return '<a href="'+u+'" target="_blank" rel="noopener" style="text-decoration:underline;color:inherit;word-break:break-all">'+u+'</a>';});}
  function pad(n){return String(n).padStart(2,'0');}
  function todayStr(){var d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}

  async function loadFixtures(sb){
    var box=document.getElementById('fixtures');
    try{
      var r=await sb.from('club_settings').select('data').eq('id','current').maybeSingle();
      var sessions=(r && r.data && r.data.data && r.data.data.sessions) || [];
      var t=todayStr();
      sessions=sessions.filter(function(s){return (s.date||'')>=t;})
        .sort(function(a,b){return ((a.date||'')+(a.time||'')).localeCompare((b.date||'')+(b.time||''));});
      if(!sessions.length){ box.innerHTML='<p class="muted" style="font-size:13px">예정된 경기가 아직 없어요.</p>'; return; }
      var m=parseInt((sessions[0].date||'').split('-')[1],10);
      if(m) document.getElementById('matchMonth').textContent=m+'월 경기일정';
      box.innerHTML=sessions.map(function(s){
        var p=(s.date||'').split('-');
        var md = p.length===3 ? p[1]+'.'+p[2] : (s.date||'');
        var wd = s.date ? ENG[new Date(s.date+'T00:00').getDay()] : '';
        var place=esc(s.place||'상암풋살장');
        var time=esc(s.time||'');
        var endt=esc(s.endTime||'');
        var timerange=time+(endt?' - '+endt:'');
        var oatly = /오틀리|oatly/i.test((s.place||'')+' '+(s.label||''));
        var hasLabel = !!(s.label && String(s.label).trim());
        var label = hasLabel ? esc(s.label) : '';
        var typeVal = (s.type && String(s.type).trim()) ? String(s.type).trim() : '풋살';
        var isEtc = typeVal === '기타';
        var TYPE_LABEL = {'풋살':'풋살 경기','축구':'축구 경기'};
        var typeText = isEtc ? (hasLabel ? label : '기타') : esc(TYPE_LABEL[typeVal]||typeVal);
        var metaHtml = '<span class="meta"><span class="type">'+typeText+'</span>'
                     + ((!isEtc && hasLabel) ? '<span class="wk">'+label+'</span>' : '')
                     + '</span>';
        var purl=(s.placeUrl||'').trim(); var plink=/^https?:\/\//i.test(purl);
        var gurl=(s.guestUrl||'').trim(); var glink=/^https?:\/\//i.test(gurl);
        var hasDetail = !!(s.desc && String(s.desc).trim()) && !oatly;
        var rowAttr = oatly ? ' onclick="location.href=\'oatly/\'" style="cursor:pointer"'
                    : (hasDetail ? ' onclick="this.parentNode.classList.toggle(\'open\')"' : '');
        var locInner = plink
          ? '<a href="'+esc(purl)+'" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:inherit;text-decoration:underline">'+place+' <span style="font-size:11px;opacity:.6">↗</span></a>'
          : place+(oatly?' <span style="font-size:11px;opacity:.6">↗</span>':'');
        return '<div class="fx'+(hasDetail?' has-detail':'')+'">'
          +'<div class="fx-row"'+rowAttr+'>'
          +'<span class="when"><span class="d">'+md+(wd?'<span class="wd">'+wd+'</span>':'')+'</span>'
          +(time?'<span class="t">'+timerange+'</span>':'')+'</span>'
          +metaHtml
          +'<span class="loc"><span class="loc-t">'+locInner+'</span>'+(hasDetail?'<span class="more"></span>':'')+'</span></div>'
          +(hasDetail?'<div class="fx-detail">'+linkify(s.desc)+'</div>':'')
          +(glink?'<div class="fx-guest"><a href="'+esc(gurl)+'" target="_blank" rel="noopener" onclick="event.stopPropagation()">게스트 신청 →</a></div>':'')
          +'</div>';
      }).join('');
    }catch(e){ box.innerHTML='<p class="muted" style="font-size:13px">일정을 불러오지 못했어요.</p>'; }
  }

  async function loadSquad(sb){
    var box=document.getElementById('squad');
    try{
      var r=await sb.from('club_settings').select('data').eq('id','teambuilder').maybeSingle();
      var players=(r && r.data && r.data.data && r.data.data.players) || [];
      players=players.filter(function(p){var s=p.status||'active'; return s!=='former'&&s!=='friends';});
      players.sort(function(a,b){var ja=a.jersey==null?999:a.jersey, jb=b.jersey==null?999:b.jersey; return ja-jb || esc(a.name).localeCompare(esc(b.name));});
      if(!players.length){ box.innerHTML='<p class="muted" style="font-size:13px">명단을 준비 중이에요.</p>'; return; }
      // 최신 투표월의 MVP·성장캐 집계
      var mvpId=null, growthId=null;
      try{
        var _d=new Date(); _d.setDate(1); _d.setMonth(_d.getMonth()-1);
        var pm=_d.getFullYear()+'-'+('0'+(_d.getMonth()+1)).slice(-2);   // 전 달(확정)만 표시
        var vr=await sb.from('potm_votes').select('category,candidate_id').eq('month', pm);
        var votes=(vr&&vr.data)||[];
        function topOf(cat){ var t={}; votes.forEach(function(v){ if(v.category===cat) t[v.candidate_id]=(t[v.candidate_id]||0)+1; }); var b=null,bc=0; for(var k in t){ if(t[k]>bc){bc=t[k]; b=Number(k);} } return b; }
        mvpId=topOf('mvp'); growthId=topOf('growth');
      }catch(e){}
      var BST='font-size:9px;font-weight:800;border-radius:5px;padding:1px 5px;margin-left:6px;vertical-align:middle;';
      box.innerHTML=players.map(function(p){
        var dorm=(p.status==='dormant')?' dorm':'';
        var no=(p.jersey!=null)?p.jersey:'-';
        var badge='';
        if(p.id===mvpId) badge+=' <span style="'+BST+'background:#e0a530;color:#3a2600">MVP</span>';
        if(p.id===growthId) badge+=' <span style="'+BST+'background:var(--win);color:#fff">성장</span>';
        return '<div class="pl'+dorm+'"><span class="no">'+no+'</span><span class="nm">'+esc(p.name)+badge+'</span></div>';
      }).join('');
    }catch(e){ box.innerHTML='<p class="muted" style="font-size:13px">명단을 불러오지 못했어요.</p>'; }
  }

  (async function(){
    var sb=supabase.createClient(SB_URL,SB_KEY);
    await loadFixtures(sb);   // ① 위
    await loadSquad(sb);      // ② 아래
  })();
})();

// 갤러리 — 그리드 메이슨리(높이만큼 행 차지) + 50% 노출/더보기
(function(){
  var g=document.querySelector('.gallery'), btn=document.getElementById('galMore');
  if(!g) return;
  var imgs=[].slice.call(g.querySelectorAll('img'));
  var GAP=10;
  function span(im){
    if(im.classList.contains('gal-hidden')){ im.style.gridRowEnd=''; return; }
    if(!im.naturalWidth) return;
    var w=im.getBoundingClientRect().width || im.clientWidth;
    if(!w) return;
    var h=w*im.naturalHeight/im.naturalWidth;
    im.style.gridRowEnd='span '+Math.ceil((h+GAP)/GAP);
  }
  function layout(){ imgs.forEach(span); }
  imgs.forEach(function(im){ if(im.complete) span(im); else im.addEventListener('load',function(){ span(im); }); });
  window.addEventListener('resize', layout);
  window.addEventListener('load', layout);

  // 첫 3줄(4열×3=12장) 노출 + 더보기
  if(btn){
    var shown=10;
    if(imgs.length>shown){
      var expanded=false;
      function applyMore(){
        imgs.forEach(function(im,i){ im.classList.toggle('gal-hidden', !expanded && i>=shown); });
        btn.textContent = expanded ? '접기' : '더보기';
        imgs.forEach(function(im){ if(im.complete) span(im); else im.addEventListener('load',function(){ span(im); }); });
        layout();
      }
      btn.hidden=false;
      applyMore();
      btn.addEventListener('click', function(){
        expanded=!expanded;
        applyMore();
        if(!expanded){ var sec=document.getElementById('moments'); if(sec) sec.scrollIntoView({behavior:'smooth', block:'start'}); }
      });
      // 가려진 이미지 미리 받아두기 — 초기 로드 완료 후 idle 시점에 캐시 워밍(클릭 시 즉시 표시)
      window.addEventListener('load', function(){
        var warm=function(){ imgs.slice(shown).forEach(function(im){ var p=new Image(); p.decoding='async'; p.src=im.src; }); };
        if('requestIdleCallback' in window){ requestIdleCallback(warm,{timeout:2500}); } else { setTimeout(warm,700); }
      });
    }
  }
})();

// ===== UI 개선 (2026-07-22) =====
// 앵커 네비 스크롤 스파이 — 현재 보고 있는 섹션 강조
(function(){
  var links=[].slice.call(document.querySelectorAll('.anchnav a[href^="#"]'));
  if(!links.length || !('IntersectionObserver' in window)) return;
  var map={};
  links.forEach(function(a){ map[a.getAttribute('href').slice(1)]=a; });
  var current=null;
  var io=new IntersectionObserver(function(es){
    es.forEach(function(e){
      if(e.isIntersecting){
        var a=map[e.target.id]; if(!a) return;
        if(current) current.classList.remove('on');
        a.classList.add('on'); current=a;
      }
    });
  },{rootMargin:'-30% 0px -60% 0px'});
  Object.keys(map).forEach(function(id){ var s=document.getElementById(id); if(s) io.observe(s); });
})();

// 스크롤 리빌 — 섹션이 화면에 들어올 때 은은한 페이드업(모션 최소화 설정 시 미적용)
(function(){
  if(!('IntersectionObserver' in window)) return;
  if(window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches) return;
  var els=[].slice.call(document.querySelectorAll('.wrap section, .support'));
  els.forEach(function(el){ el.classList.add('rv'); });
  var io=new IntersectionObserver(function(es){
    es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } });
  },{rootMargin:'0px 0px -8% 0px'});
  els.forEach(function(el){ io.observe(el); });
})();

// 갤러리 라이트박스 — 탭하면 크게 보기, 좌우 이동·ESC 닫기
(function(){
  var g=document.querySelector('.gallery');
  if(!g) return;
  var lb=document.createElement('div');
  lb.className='lb';
  lb.innerHTML='<img alt="싸커피 활동 크게 보기">'
    +'<button class="lb-x" aria-label="닫기">✕</button>'
    +'<button class="lb-nav lb-prev" aria-label="이전">‹</button>'
    +'<button class="lb-nav lb-next" aria-label="다음">›</button>';
  document.body.appendChild(lb);
  var big=lb.querySelector('img'), idx=-1;
  function visibleImgs(){ return [].slice.call(g.querySelectorAll('img')).filter(function(im){ return !im.classList.contains('gal-hidden'); }); }
  function show(i){
    var imgs=visibleImgs();
    if(!imgs.length) return;
    idx=(i+imgs.length)%imgs.length;
    big.src=imgs[idx].src;
    lb.classList.add('open');
    document.body.style.overflow='hidden';
  }
  function close(){ lb.classList.remove('open'); document.body.style.overflow=''; }
  g.addEventListener('click',function(e){
    var im=e.target.closest('img'); if(!im) return;
    show(visibleImgs().indexOf(im));
  });
  lb.querySelector('.lb-x').addEventListener('click',close);
  lb.querySelector('.lb-prev').addEventListener('click',function(e){ e.stopPropagation(); show(idx-1); });
  lb.querySelector('.lb-next').addEventListener('click',function(e){ e.stopPropagation(); show(idx+1); });
  lb.addEventListener('click',function(e){ if(e.target===lb||e.target===big) close(); });
  document.addEventListener('keydown',function(e){
    if(!lb.classList.contains('open')) return;
    if(e.key==='Escape') close();
    else if(e.key==='ArrowLeft') show(idx-1);
    else if(e.key==='ArrowRight') show(idx+1);
  });
  // 모바일 스와이프
  var sx=null;
  lb.addEventListener('touchstart',function(e){ sx=e.touches[0].clientX; },{passive:true});
  lb.addEventListener('touchend',function(e){
    if(sx==null) return;
    var dx=e.changedTouches[0].clientX-sx; sx=null;
    if(Math.abs(dx)>48) show(idx+(dx<0?1:-1));
  },{passive:true});
})();
