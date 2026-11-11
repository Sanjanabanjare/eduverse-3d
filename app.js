const modal = document.querySelector('#modal');
const body = document.querySelector('#modalBody');
let modalReturnFocus=null;
const openModal = (html) => { modalReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null; body.innerHTML = html; modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); const firstFocusable=modal.querySelector('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'); if(firstFocusable)firstFocusable.focus(); };
const closeModal = () => { if(!modal.classList.contains('open'))return; if(body.querySelector('#contactDetailsForm')||body.querySelector('#contactName'))sessionStorage.setItem('eduverse-profile-prompt-dismissed','true'); if(typeof stopCvCamera==='function')stopCvCamera(); modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); if(modalReturnFocus&&document.contains(modalReturnFocus))modalReturnFocus.focus(); modalReturnFocus=null; };
document.querySelector('#closeModal').addEventListener('click',closeModal);
let novaOpened=false;
let novaHistoryLoaded=false;
let lastNovaUserMessage=null;

/* --- Nova markdown-lite: escape ALL HTML first, then transform a safe subset
   (**bold**, *italic*, `code`, ```blocks```, - / 1. lists, [text](https://…)).
   User messages stay plain text; only Nova (assistant) messages get markdown. --- */
function novaMarkdown(text){
  const raw=String(text||'');
  const blocks=[];
  const withPlaceholders=raw.replace(/```(\w*)\n?([\s\S]*?)(?:```|$)/g,(m,lang,code)=>{
    blocks.push(code.replace(/\n$/,''));
    return '\u0001CODE'+(blocks.length-1)+'\u0001';
  });
  let html=safeText(withPlaceholders);
  html=html.replace(/`([^`\n]+)`/g,(m,code)=>'<code>'+code+'</code>');
  html=html.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  html=html.replace(/(^|[^*\w])\*([^*\n]+)\*/g,'$1<em>$2</em>');
  html=html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  const lines=html.split('\n');
  let out='',inUl=false,inOl=false,para=[];
  const flushPara=()=>{if(para.length){out+='<p>'+para.join('<br>')+'</p>';para=[];}};
  const closeLists=()=>{if(inUl){out+='</ul>';inUl=false;}if(inOl){out+='</ol>';inOl=false;}};
  for(const line of lines){
    const trimmed=line.trim();
    const codeRef=trimmed.match(/^\u0001CODE(\d+)\u0001$/);
    const ulm=trimmed.match(/^[-•]\s+(.*)$/);
    const olm=trimmed.match(/^(\d+)[.)]\s+(.*)$/);
    if(codeRef){flushPara();closeLists();out+=line;}
    else if(ulm){flushPara();if(inOl)closeLists();if(!inUl){out+='<ul>';inUl=true;}out+='<li>'+ulm[1]+'</li>';}
    else if(olm){flushPara();if(inUl)closeLists();if(!inOl){out+='<ol>';inOl=true;}out+='<li>'+olm[2]+'</li>';}
    else if(!trimmed){flushPara();closeLists();}
    else{closeLists();para.push(line);}
  }
  flushPara();closeLists();
  html=out.replace(/\u0001CODE(\d+)\u0001/g,(m,i)=>{
    const code=blocks[Number(i)];if(code==null)return '';
    return '<div class="nova-code-block"><button type="button" class="nova-code-copy" aria-label="Copy code">Copy</button><pre><code>'+safeText(code)+'</code></pre></div>';
  });
  return html||'<p></p>';
}
function novaThinking(){
  const box=document.querySelector('#novaMessages');if(!box)return null;
  const div=document.createElement('div');div.className='nova-msg nova thinking';
  const body=document.createElement('div');body.className='nova-msg-body';body.textContent='…';
  div.append(body);box.append(div);box.scrollTop=box.scrollHeight;return div;
}
function novaSetMessage(div,text){
  if(!div)return;
  let body=div.querySelector('.nova-msg-body');
  if(!body){body=document.createElement('div');body.className='nova-msg-body';div.append(body);}
  body.innerHTML=novaMarkdown(text);
  div.dataset.raw=text;
  const box=document.querySelector('#novaMessages');if(box)box.scrollTop=box.scrollHeight;
}
function attachNovaControls(div,provider){
  if(!div||div.querySelector('.nova-msg-controls'))return;
  const controls=document.createElement('div');controls.className='nova-msg-controls';
  if(provider){
    const badge=document.createElement('span');
    badge.className='nova-provider-badge '+(provider==='openai'?'ai':'local');
    badge.textContent=provider==='openai'?'AI':'Local';
    controls.append(badge);
  }
  const copy=document.createElement('button');
  copy.type='button';copy.className='nova-copy-btn';copy.textContent='Copy';
  controls.append(copy);
  div.append(controls);
}
function appendScreenButton(div,screen){
  const box=document.querySelector('#novaMessages');if(!box||!screen)return;
  const btn=document.createElement('button');btn.type='button';btn.className='nova-open-btn';btn.dataset.novaScreen=screen;btn.textContent='Open this section →';
  div.after(btn);
}
function novaAppend(text,who,screen,opts={}){
  const box=document.querySelector('#novaMessages');if(!box)return null;
  const div=document.createElement('div');div.className='nova-msg '+who;
  if(who==='nova'){
    const body=document.createElement('div');body.className='nova-msg-body';
    body.innerHTML=novaMarkdown(text);div.append(body);div.dataset.raw=text;
    attachNovaControls(div,opts.provider);
  }else{
    div.textContent=text;
  }
  box.append(div);
  if(who==='nova'&&screen)appendScreenButton(div,screen);
  box.scrollTop=box.scrollHeight;return div;
}
function novaShowSuggestions(list){const el=document.querySelector('#novaSuggestions');if(!el)return;el.innerHTML='';(list||[]).forEach(q=>{const b=document.createElement('button');b.type='button';b.textContent=q;b.addEventListener('click',()=>{const inp=document.querySelector('#novaInput');if(inp){inp.value=q;sendNovaMessage();}});el.append(b);});}
function novaGreet(){
  const name=currentUser?.name?.split(/\s+/)[0]||'learner';
  novaAppend(`Hi ${name}! I'm Nova, your learning guide. Ask me about binary search, your courses and assignments, or the Vision Lab — or tap a suggestion below.`,'nova',null,{provider:'local'});
  novaShowSuggestions(['Why do we discard the midpoint?','What assignments do I have?','How do I use the Vision Lab?']);
}
async function loadNovaHistory(){
  if(novaHistoryLoaded)return;novaHistoryLoaded=true;
  let data=null;
  try{data=await apiRequest('/chat/history');}catch{data=null;}
  const msgs=(data&&Array.isArray(data.messages))?data.messages:[];
  if(!msgs.length){novaGreet();return;}
  const provider=data.provider||'local';
  msgs.forEach(m=>{
    if(m&&m.role==='user')novaAppend(m.content||'','user');
    else if(m&&m.role==='assistant')novaAppend(m.content||'','nova',null,{provider});
  });
  const lastUser=[...msgs].reverse().find(m=>m&&m.role==='user');
  if(lastUser)lastNovaUserMessage=lastUser.content||null;
  attachRegenButton();
}
function openNovaChat(){const panel=document.querySelector('#novaPanel');if(!panel)return;panel.classList.add('open');if(!novaOpened){novaOpened=true;loadNovaHistory();}document.querySelector('#novaInput')?.focus();}
function closeNovaChat(){document.querySelector('#novaPanel')?.classList.remove('open');}
function localNovaReply(text){const q=text.toLowerCase();if(q.includes('midpoint')||q.includes('binary'))return 'Binary search only works on a sorted array. If your target is larger than the midpoint, discard the midpoint and everything to its left; if smaller, discard the right half. Each comparison removes about half of what is left.';if(q.includes('assignment'))return 'Open Assignments to see what is due and submit your work. Your teacher releases grades there once they are ready.';if(q.includes('vision')||q.includes('webcam'))return 'Open the Vision & Simulation Lab. For webcam drawing, press Start camera, allow access, and raise only your index finger to draw; an open palm lifts the pen.';return "I'm a guided assistant, not a live AI service, so I stick to EduVerse topics rather than guessing. Try asking about binary search, your courses or assignments, or the Vision Lab. (The full guide is available when the API is running.)";}
/* POST to a chat endpoint and read an SSE stream into `bubble`.
   Returns {streamed:true, reply, provider, screen, suggestions} on a `done`
   event, {streamed:false, data} when the server answered JSON instead of SSE,
   and throws on network/HTTP/stream errors so the caller can fall back. */
async function streamNovaChat(path,body,bubble){
  const jwt=getStoredJwt();
  const headers={'Content-Type':'application/json',...(jwt?{Authorization:'Bearer '+jwt}:{})};
  const bodyStr=JSON.stringify(body);
  const slot=idempotencySlot('POST',path,bodyStr);
  headers['Idempotency-Key']=pendingIdempotencyKey(slot);
  const clearSlot=()=>{pendingIdempotencyKeys.delete(slot);try{sessionStorage.removeItem(slot);}catch{}};
  const response=await fetch(`${API_BASE}${path}`,{method:'POST',headers,body:bodyStr});
  if(!response.ok){
    let msg='Chat failed';
    try{const d=await response.json();msg=d.error||msg;}catch{}
    throw new Error(msg);
  }
  const ctype=(response.headers.get('content-type')||'').toLowerCase();
  if(!ctype.includes('text/event-stream')||!response.body||typeof response.body.getReader!=='function'){
    const data=await response.json();
    clearSlot();
    return {streamed:false,data};
  }
  const reader=response.body.getReader();
  const decoder=new TextDecoder();
  let buffer='',full='',started=false;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      buffer+=decoder.decode(value,{stream:true});
      let idx;
      while((idx=buffer.indexOf('\n\n'))>=0){
        const rawEvent=buffer.slice(0,idx);buffer=buffer.slice(idx+2);
        for(const line of rawEvent.replace(/\r\n/g,'\n').split('\n')){
          if(!line.startsWith('data:'))continue;
          const payload=line.slice(5).trim();
          if(!payload)continue;
          let evt;try{evt=JSON.parse(payload);}catch{continue;}
          if(typeof evt.delta==='string'){
            if(!started){started=true;bubble.classList.remove('thinking');}
            full+=evt.delta;novaSetMessage(bubble,full);
          }else if(evt.done){
            clearSlot();
            return {streamed:true,reply:evt.reply!=null?evt.reply:full,provider:evt.provider||'openai',screen:evt.screen||null,suggestions:evt.suggestions||[]};
          }else if(evt.error){
            throw new Error(evt.error);
          }
        }
      }
    }
  }finally{try{reader.releaseLock&&reader.releaseLock();}catch{}}
  clearSlot();
  if(!started&&!full)throw new Error('Empty stream');
  return {streamed:true,reply:full,provider:'openai',screen:null,suggestions:[]};
}
function novaFinishMessage(div,out){
  if(!div)return;
  div.classList.remove('thinking');
  novaSetMessage(div,out.reply||'');
  attachNovaControls(div,out.provider);
  if(out.screen)appendScreenButton(div,out.screen);
}
function attachRegenButton(){
  const box=document.querySelector('#novaMessages');if(!box)return;
  box.querySelectorAll('.nova-regen-btn').forEach(b=>b.remove());
  if(!lastNovaUserMessage)return;
  const last=[...box.querySelectorAll('.nova-msg.nova')].pop();
  if(!last)return;
  const btn=document.createElement('button');
  btn.type='button';btn.className='nova-regen-btn';btn.textContent='↻ Regenerate response';
  last.after(btn);
}
async function sendNovaMessage(){
  const inp=document.querySelector('#novaInput');if(!inp)return;
  const text=inp.value.trim();if(!text)return;
  inp.value='';novaAppend(text,'user');lastNovaUserMessage=text;
  const thinking=novaThinking();
  let streamed=false;
  try{
    const out=await streamNovaChat('/chat',{message:text,stream:true},thinking);
    if(out.streamed){novaFinishMessage(thinking,out);novaShowSuggestions(out.suggestions);streamed=true;}
    else if(out.data){thinking.remove();novaAppend(out.data.reply||'','nova',out.data.screen||null,{provider:out.data.provider||'local'});novaShowSuggestions(out.data.suggestions);streamed=true;}
  }catch(err){if(thinking)thinking.remove();}
  if(!streamed){
    try{
      const data=await apiRequest('/chat',{method:'POST',body:JSON.stringify({message:text})});
      novaAppend(data.reply,'nova',data.screen,{provider:data.provider||'local'});
      novaShowSuggestions(data.suggestions);
    }catch(err){
      novaAppend(localNovaReply(text),'nova',null,{provider:'local'});
      novaShowSuggestions(['Why do we discard the midpoint?','What assignments do I have?','How do I use the Vision Lab?']);
    }
  }
  attachRegenButton();
}
async function regenerateNovaMessage(){
  const box=document.querySelector('#novaMessages');if(!box||!lastNovaUserMessage)return;
  const bubbles=[...box.querySelectorAll('.nova-msg.nova')];
  const last=bubbles[bubbles.length-1];if(!last)return;
  let next=last.nextSibling;
  const remove=[last];
  while(next&&next.nodeType===1&&(next.classList.contains('nova-open-btn')||next.classList.contains('nova-regen-btn'))){remove.push(next);next=next.nextSibling;}
  remove.forEach(el=>el.remove());
  const thinking=novaThinking();
  let done=false;
  try{
    const out=await streamNovaChat('/chat/regenerate',{stream:true},thinking);
    if(out.streamed){novaFinishMessage(thinking,out);novaShowSuggestions(out.suggestions);done=true;}
    else if(out.data){thinking.remove();novaAppend(out.data.reply||'','nova',out.data.screen||null,{provider:out.data.provider||'local'});novaShowSuggestions(out.data.suggestions);done=true;}
  }catch(err){if(thinking)thinking.remove();}
  if(!done){
    try{
      const data=await apiRequest('/chat/regenerate',{method:'POST',body:JSON.stringify({})});
      novaAppend(data.reply,'nova',data.screen,{provider:data.provider||'local'});
      novaShowSuggestions(data.suggestions);
    }catch(err){
      novaAppend(localNovaReply(lastNovaUserMessage),'nova',null,{provider:'local'});
      novaShowSuggestions(['Why do we discard the midpoint?','What assignments do I have?','How do I use the Vision Lab?']);
    }
  }
  attachRegenButton();
}
async function newNovaChat(){
  try{await apiRequest('/chat/clear',{method:'POST',body:JSON.stringify({})});}catch{}
  const box=document.querySelector('#novaMessages');if(box)box.innerHTML='';
  lastNovaUserMessage=null;novaHistoryLoaded=true;
  novaGreet();
}
function copyNovaText(text,btn){
  const done=()=>{
    if(!btn)return;
    const label=btn.textContent;btn.textContent='Copied ✓';
    setTimeout(()=>{btn.textContent=label;},1200);
  };
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(done).catch(()=>{try{fallbackCopy(text);done();}catch{}});
    return;
  }
  try{fallbackCopy(text);done();}catch{}
}
function fallbackCopy(text){
  const ta=document.createElement('textarea');
  ta.value=text;ta.setAttribute('readonly','');ta.style.position='fixed';ta.style.opacity='0';
  document.body.append(ta);ta.select();
  if(typeof document.execCommand==='function')document.execCommand('copy');
  ta.remove();
}
document.addEventListener('click',e=>{
  const copyBtn=e.target.closest('.nova-copy-btn');
  if(copyBtn){const msg=copyBtn.closest('.nova-msg');if(msg)copyNovaText(msg.dataset.raw||msg.textContent,copyBtn);return;}
  const codeBtn=e.target.closest('.nova-code-copy');
  if(codeBtn){const code=codeBtn.closest('.nova-code-block')?.querySelector('code');if(code)copyNovaText(code.textContent,codeBtn);return;}
  if(e.target.closest('.nova-regen-btn')){regenerateNovaMessage();return;}
  if(e.target.closest('#novaNewChat')){newNovaChat();return;}
});
async function sendRoomChat(){const inp=document.querySelector('#roomChatInput'),list=document.querySelector('#roomChatList');if(!inp||!list)return;const text=inp.value.trim().slice(0,2000);if(!text)return;inp.value='';const appendMessage=(author,message)=>{const row=document.createElement('div');row.className='lesson-row';const name=document.createElement('b');name.textContent=author;row.append(name,document.createTextNode(` ${message} `));const time=document.createElement('span');time.textContent='now';row.append(time);list.append(row);list.scrollTop=list.scrollHeight;return row;};appendMessage('You',text);const pending=appendMessage('Nova','Thinking…');try{const result=await apiRequest('/chat',{method:'POST',body:JSON.stringify({message:text})});pending.remove();appendMessage('Nova',result.reply||localNovaReply(text));}catch{pending.remove();appendMessage('Nova',localNovaReply(text));}}
document.querySelector('#novaClose')?.addEventListener('click',closeNovaChat);
document.querySelector('#novaForm')?.addEventListener('submit',e=>{e.preventDefault();sendNovaMessage();});
document.addEventListener('click',e=>{if(e.target.id==='roomChatSend')sendRoomChat();const open=e.target.closest('[data-nova-screen]');if(open){closeNovaChat();if(typeof navigate==='function')navigate(open.dataset.novaScreen);}});
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='roomChatInput'){e.preventDefault();sendRoomChat();}});

modal.addEventListener('click',e=>{if(e.target===modal)closeModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
function startChallenge(){
  openModal(`<h2 id="modalTitle">Let’s narrow it down.</h2><p>We’re looking for <b>21</b>. The sorted array is <b>[3, 8, 12, 17, 21, 29, 34]</b>. The midpoint is 17, and 21 is larger. What should happen next?</p><div class="question"><button class="answer" data-answer="wrong">Keep the left half</button><button class="answer" data-answer="right">Search the right half</button></div><div id="answerFeedback"></div>`);
  document.querySelectorAll('.answer').forEach(btn=>btn.addEventListener('click',async()=>{
    const feedback=document.querySelector('#answerFeedback');
    let savedAttempt=null;try{savedAttempt=await apiRequest('/attempts',{method:'POST',body:JSON.stringify({activityId:'binary-search-boundary',answer:btn.dataset.answer==='right'?'right':'left'})});}catch{}
    if(btn.dataset.answer==='right'){
      feedback.innerHTML='<div class="response good"><b>That’s it.</b> Since 21 is greater than 17, discard the midpoint and everything to its left. Your boundary choice is improving.</div><button class="primary-btn next-btn" id="finishChallenge">Finish challenge →</button>';
      document.querySelector('#finishChallenge').addEventListener('click',()=>{closeModal();const tag=document.querySelector('.challenge-tag');if(tag){tag.textContent='COMPLETED · NICE WORK';document.querySelector('.challenge h4').textContent='You moved the boundary correctly.';document.querySelector('.challenge p').textContent='Your next practice will check this idea with a new array.';const cta=document.querySelector('#challengeBtn');if(cta)cta.textContent='Done ✓';}document.querySelectorAll('.concept')[1]?.querySelector('.mastery span')?.style.setProperty('width','58%');const mastery=document.querySelectorAll('.concept')[1];if(mastery){const pct=savedAttempt?.progress?.concepts?.['search-boundaries']?.mastery||58;mastery.querySelector('.mastery span').style.width=`${pct}%`;mastery.querySelector('strong').textContent=`${pct}%`;mastery.querySelector('.concept-text small').textContent='Improving with practice';}});
    }else feedback.innerHTML='<div class="response teach"><b>Look at the comparison.</b> 21 is greater than 17, so it must be to the right. Keep 21 and 29 in the search space; discard the midpoint and values below it.</div>';
  }));
}
document.addEventListener('click',e=>{
 if(e.target.closest('#challengeBtn')||e.target.closest('#resumeBtn'))startChallenge();
 else if(e.target.closest('#guideBtn'))openNovaChat();
});
document.addEventListener('click',e=>{if(e.target.id==='sendGuide'){const v=document.querySelector('#guideInput').value.trim();document.querySelector('#guideReply').innerHTML=`<div class="response teach"><b>Nova</b><br>${v.toLowerCase().includes('midpoint')?'If the midpoint is 17 and your target is 21, you already know the target is larger. Because the array is sorted, values at or below 17 can no longer be the answer. Each comparison lets you safely remove half the remaining search space.':'Try the binary search challenge first. I’ll use what you do there to suggest a focused explanation and a follow-up practice.'}</div>`;}});

// Lightweight screen navigation for the first EduVerse product surfaces.
const contentRoot = document.querySelector('.content');
const dashboardMarkup = contentRoot.innerHTML;
const screenNames = {admin:'Admin dashboard',overview:'Overview',today:'My class today',timetable:'Timetable','teacher-timetable':'Timetable',notifications:'Notifications',feedback:'Feedback',twin:'Learning twin',community:'Community',assignments:'Assignments',player:'Lesson player',catalog:'Course catalog',campus:'3D virtual campus',classroom:'Virtual classroom',library:'Virtual library',notes:'Notes studio',syllabus:'Coding syllabus',languages:'Coding languages',teacher:'Teacher studio',drawing:'Webcam drawing studio', 'vision-labs':'Vision & Simulation Lab','vision-lab':'Vision & Simulation Lab', profile:'Profile & progress',onboarding:'Welcome to EduVerse',fees:'My fees',marketplace:'Course marketplace','parent-dashboard':'Parent dashboard','announcements':'Announcements','admin-announcements':'Institution announcements','admin-fees':'Fees','admin-subscriptions':'Subscriptions','admin-marketplace':'Marketplace','admin-import':'Bulk import','admin-analytics':'Usage analytics','admin-backup':'Backup & restore','admin-announcements':'Institution announcements'};
Object.assign(screenNames,{'video-player':'Video lesson',quizzes:'Quizzes','quiz-take':'Take quiz',certificates:'My certificates',billing:'Billing & plans',checkout:'Checkout',discussions:'Course discussions','live-classes':'Live classes',leaderboard:'Leaderboard','course-detail':'Course details','teacher-quizzes':'Quiz builder','question-bank':'Question bank','live-classroom':'Live classroom','admin-calendar':'Academic calendar','admin-plans':'Plans & pricing','admin-orders':'Orders & subscriptions','admin-backup':'Backup & restore'});
const coursePhoto=(title)=>({ 'Data structures, made visual':'photo-1516321318423-f06f85e504b3','Machine learning foundations':'photo-1677442136019-21780ecad995','Forces in motion':'photo-1635070041078-e363dbe005cb','Designing for people':'photo-1558655146-9f40138edfeb','Startup fundamentals':'photo-1552664730-d307ca884978','Everyday English practice':'photo-1456513080510-7bf3a84b82f8' }[title]||'photo-1516321318423-f06f85e504b3');
const inr=c=>`₹${(Number(c||0)/100).toLocaleString('en-IN')}`;
function fmtDur(s){s=Math.max(0,Math.round(Number(s)||0));const h=Math.floor(s/3600),m=Math.floor(s%3600/60),ss=s%60,p=n=>String(n).padStart(2,'0');return h?`${h}:${p(m)}:${p(ss)}`:`${m}:${p(ss)}`;}
function youtubeId(url){const m=String(url||'').match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);return m?m[1]:null;}
const courseCard=(tone,icon,tag,title,copy,duration,level,id='',priceCents=0)=>`<article class="course-tile"><div class="course-cover ${safeText(tone)}" style="background-image:linear-gradient(180deg,#1f193333,#211a4d66),url(https://images.unsplash.com/${coursePhoto(title)}?auto=format&fit=crop&w=900&q=80)">${safeText(icon)}<span class="price-badge${Number(priceCents)>0?'':' free'}">${Number(priceCents)>0?inr(priceCents):'Free'}</span></div><div class="course-content"><small>${safeText(tag)}</small><h3>${safeText(title)}</h3><p>${safeText(copy)}</p><div class="course-meta"><span>◷ ${safeText(duration)}</span><span>${safeText(level)}</span></div>${id?`${Number(priceCents)>0?`<button data-buy-course="${safeText(id)}">Buy & Enroll →</button>`:`<button data-enroll-course="${safeText(id)}">Enroll →</button>`} <button class="filter-select" data-lms-course="${safeText(id)}">Details</button> `:''}<button data-screen="player">Preview course →</button></div></article>`;
const screens={
 catalog:`<div class="screen-title"><p class="eyebrow">FIND YOUR NEXT CURIOSITY</p><h1>Course catalog</h1><p>Explore guided courses, practical labs, and new skills.</p></div><div class="screen-toolbar"><input aria-label="Search subjects, skills, or instructors" class="search-field" id="courseSearch" placeholder="⌕  Search subjects, skills, or instructors"><select aria-label="Filter by level" class="filter-select" id="levelFilter"><option value="all">All levels</option><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select><select aria-label="Sort courses" class="filter-select"><option>Most relevant</option><option>Popular</option><option>Recently added</option></select></div><div class="course-grid" id="courseGrid">${courseCard('','⌘','PROGRAMMING · DSA','Data structures, made visual','Build intuition through short interactive challenges.','4.5 hours','Beginner')}${courseCard('teal','✳','AI & MACHINE LEARNING','Machine learning foundations','Understand how models learn from examples.','6 hours','Beginner')}${courseCard('orange','▦','SCIENCE · PHYSICS','Forces in motion','Explore force and momentum in a virtual lab.','3 hours','Intermediate')}${courseCard('teal','◎','DESIGN · UX','Designing for people','Practice research, flows, and usable interfaces.','5 hours','Intermediate')}${courseCard('orange','▤','BUSINESS','Startup fundamentals','Turn a problem into a tested product idea.','3.5 hours','Beginner')}${courseCard('','文','LANGUAGES','Everyday English practice','Build confidence with guided speaking activities.','2 hours','Beginner')}</div><div id="myEnrollments"></div>`,
 today:`<div class="screen-title"><p class="eyebrow">YOUR SCHOOL DAY</p><h1>My class today</h1><p>See today’s scheduled lessons and where to join.</p></div><section id="studentTodaySchedule" class="schedule-cards screen-panel">Loading today’s classes…</section><button class="filter-select" data-screen="timetable">View full timetable →</button>`,
 timetable:`<div class="screen-title"><p class="eyebrow">YOUR SCHOOL DAY</p><h1>Timetable</h1><p>Upcoming class sessions assigned to your enrolled classes.</p></div><section id="studentTimetable" class="schedule-cards screen-panel">Loading your timetable…</section><button class="filter-select" data-screen="today">← My class today</button>`,
 player:`<div class="screen-title"><p class="eyebrow">DATA STRUCTURES · BINARY SEARCH</p><h1>Binary search, step by step</h1><p>Lesson 2 of 5 · about 12 minutes remaining</p></div><div class="screen-columns"><section class="screen-panel"><div class="video-stage"><div><button class="play-circle" id="lessonPlay" data-playing="false" aria-label="Play lesson">▶</button><small>INTERACTIVE LESSON · SEARCH BOUNDARIES</small><span id="playState" class="play-state">Tap play to begin</span></div></div><h3 id="currentLessonTitle" style="font:600 16px 'Space Grotesk';margin:16px 0 6px">Why can we discard half?</h3><p class="panel-copy" id="currentLessonText">A sorted array gives us information after every comparison. Use it to shrink the search space safely.</p><div class="lesson-controls"><button class="filter-select" id="lessonPrev" disabled>← Previous</button><span id="lessonPage">2 / 5</span><button class="filter-select" id="lessonNext">Next →</button></div><button class="primary-btn" data-challenge>Practice this idea →</button></section><aside class="screen-panel"><p class="eyebrow">LESSON CONTENTS</p><button class="lesson-row lesson-link" data-lesson="0">✓ &nbsp; The sorted array <span>Complete</span></button><button class="lesson-row lesson-link active" data-lesson="1">▶ &nbsp; Search boundaries <span>Now</span></button><button class="lesson-row lesson-link" data-lesson="2">◌ &nbsp; Complexity intuition <span>5 min</span></button><button class="lesson-row lesson-link" data-lesson="3">▤ &nbsp; Quick check <span>3 questions</span></button><p class="eyebrow" style="margin-top:20px">YOUR NOTES</p><textarea aria-label="Save a thought or question" id="lessonNote" class="search-field" style="width:100%;height:75px;resize:vertical" placeholder="Save a thought or question…"></textarea><small id="lessonNoteStatus" class="save-status">Notes save in this browser</small><p class="panel-copy">Nova hint: if the target is greater than the midpoint, what can you rule out?</p><p class="eyebrow" style="margin-top:20px">RECENTLY WATCHED</p><button class="watch-row" data-screen="player">✓ &nbsp; Sorted arrays in 8 minutes <span>Resume</span></button><button class="watch-row" data-screen="player">◷ &nbsp; Big O, visualised <span>6 min left</span></button><p class="eyebrow" style="margin-top:18px">SUGGESTED NEXT</p><button class="suggestion-card" data-screen="syllabus"><b>Hash maps: fast lookups</b><small>Recommended from your practice · 12 min</small></button></aside></div>`,
 campus:`<div class="screen-title"><p class="eyebrow">YOUR LEARNING WORLD · EXPLORE</p><h1>EduVerse campus</h1><p>A small living world for big ideas. Drag to look around; choose a portal to enter.</p></div><div class="world-wrap"><canvas id="campus3d" aria-label="Interactive 3D EduVerse campus"></canvas><div class="world-hud"><span class="live-dot"></span> CAMPUS WORLD <span>·</span> <span id="worldHint">DRAG TO ORBIT</span></div><div class="world-portals"><button data-screen="catalog"><b>01</b> Course Hall <span>Explore paths ↗</span></button><button data-screen="player"><b>02</b> Discovery Lab <span>Enter simulation ↗</span></button><button data-screen="classroom"><b>03</b> Gathering Room <span>Join a class ↗</span></button></div><button class="map-toggle" id="mapToggle">☷ 2D map</button></div>`,
 classroom:`<div class="screen-title"><p class="eyebrow">DSA STUDY CIRCLE · ROOM 04</p><h1>Virtual classroom</h1><p>Binary search workshop · Shared 3D board · 4 learners in this local demo</p></div><div class="screen-columns"><section class="screen-panel"><div class="classroom-stage"><div class="virtual-board"><div class="board-top">✦ &nbsp; CLASSROOM WHITEBOARD <span>LIVE</span></div><div class="board-writing"><div class="board-copy" id="boardCopy" contenteditable="true" spellcheck="false"><b>Binary search</b><p>Each comparison removes half of the remaining range.</p><div class="mini-array"><span>3</span><span>8</span><span>12</span><span class="midpoint">17</span><span>21</span><span>29</span><span>34</span></div><p class="board-formula">low &nbsp; + &nbsp; (high − low) ÷ 2 &nbsp; → &nbsp; midpoint</p></div><canvas id="classInkCanvas" aria-label="Class whiteboard ink drawing layer"></canvas><div id="classInkCursor" class="class-ink-cursor" hidden></div></div><div class="board-tools"><button data-tool="pen" class="selected" type="button" aria-pressed="true">✎ Pen</button><button data-tool="eraser" type="button" aria-pressed="false">⌫ Erase ink</button><button id="addBoardNote" type="button">＋ Sticky note</button><button id="saveBoard" type="button">↥ Save board</button></div></div><div class="class-air-preview" id="classAirPreview" hidden><video id="classAirVideo" autoplay playsinline muted aria-label="Mirrored local camera preview"></video><span>CAMERA ON · LOCAL PROCESSING</span></div><div class="seat-row"><i class="seat"></i><i class="seat"></i><i class="seat"></i><i class="seat"></i></div></div><div class="class-air-toolbar"><div class="class-air-actions"><button class="primary-btn" type="button" id="classAirStart">Start hand writing</button><button class="filter-select" type="button" id="classAirStop" disabled>Stop camera</button><button class="filter-select" type="button" id="classInkMouse" aria-pressed="false">Use mouse / touch</button><label class="class-ink-control">Ink color <input id="classInkColor" type="color" value="#332f46" aria-label="Ink color"></label><label class="class-ink-control">Brush <input id="classInkSize" type="range" min="2" max="28" value="7" aria-label="Brush size"></label><button class="filter-select" type="button" id="classInkUndo" disabled>Undo</button><button class="filter-select" type="button" id="classInkRedo" disabled>Redo</button><button class="filter-select" type="button" id="classInkClear">Clear ink</button><button class="filter-select" type="button" id="classInkDownload">Download PNG</button></div><p id="classAirStatus" class="class-air-status" role="status">Camera off. Start hand writing to request camera access; index finger draws and an open hand moves without drawing.</p><p class="class-air-privacy">Camera frames are sent only to the local EduVerse OpenCV service for hand landmarks. Frames are not saved. Mouse and touch drawing also work without camera access.</p></div><section class="class-pdf-panel" id="classPdfPanel"><div class="class-pdf-toolbar"><button type="button" class="filter-select class-pdf-upload" id="classPdfPick">Choose PDF</button><input id="classPdfFile" class="class-pdf-file" type="file" accept="application/pdf,.pdf" aria-label="Choose a lesson PDF"><a class="filter-select class-pdf-open" id="classPdfOpen" target="_blank" rel="noopener noreferrer" hidden>Open PDF separately ↗</a><button type="button" class="filter-select" id="classPdfPrev" disabled>← Page</button><label class="class-pdf-page-label">Page <input id="classPdfPage" type="number" min="1" value="1" disabled></label><button type="button" class="filter-select" id="classPdfNext" disabled>Page →</button><button type="button" class="filter-select" id="classPdfAnnotate" aria-pressed="false" disabled>Annotate</button><select id="classPdfInkMode" class="filter-select" aria-label="Annotation tool"><option value="pen">Pen</option><option value="highlight">Highlighter</option></select><input id="classPdfInkColor" type="color" value="#7257d9" aria-label="Pen color"><label class="class-pdf-size-label">Size <input id="classPdfInkSize" type="range" min="2" max="16" value="5" aria-label="Annotation size"></label><button type="button" class="filter-select" id="classPdfClear" disabled>Clear marks</button></div><p id="classPdfStatus" class="panel-copy" role="status">Add a PDF to read its pages and annotate them. The selected file stays in this browser.</p><div class="class-pdf-view" id="classPdfView" hidden><iframe id="classPdfFrame" title="Class lesson PDF" loading="lazy"></iframe><canvas id="classPdfInk" aria-label="PDF annotation layer"></canvas></div></section><div class="screen-toolbar"><button class="primary-btn" id="raiseHand">✋ Raise hand</button><button class="filter-select" id="pollBtn">▤ Quick poll</button><span class="panel-copy" id="boardStatus">Board changes are local to this demo</span></div></section><aside class="screen-panel"><p class="eyebrow">ROOM CHAT & PARTICIPANTS</p><div class="participant-row"><span class="person-dot">SB</span><b>You</b><small>Student</small></div><div class="participant-row"><span class="person-dot teacher-dot">NV</span><b>Nova</b><small>Teacher</small></div><div id="roomChatList"><div class="lesson-row"><b>Nova</b> What can we rule out? <span>10:02</span></div><div class="lesson-row"><b>Sam</b> Everything at or below 17. <span>10:03</span></div></div><div class="room-chat-form"><input class="search-field" id="roomChatInput" placeholder="Message the room…" aria-label="Message the classroom"><button class="primary-btn" id="roomChatSend" type="button">Send →</button></div></aside></div>`,
 drawing:`<div class="screen-title"><p class="eyebrow">OPENCV · LIVE CANVAS</p><h1>Webcam drawing studio</h1><p>Use this as a whiteboard: raise only your index finger to write. Open palm lifts the pen; two fingers cycle color, fist toggles eraser, and thumbs up/down adjusts brush size.</p></div><div class="drawing-layout"><section class="screen-panel drawing-panel"><div class="drawing-stage"><video id="drawingVideo" autoplay playsinline muted></video><canvas id="sketchCanvas" aria-label="Live OpenCV sketch filter" hidden></canvas><canvas id="drawingCanvas" aria-label="Whiteboard"></canvas><div id="handPointer" class="hand-pointer" hidden aria-label="Tracked fingertip"></div><div id="drawingPrompt" class="drawing-prompt"><span>✎</span><b>Whiteboard ready</b><small>Start the camera. One raised finger draws; an open palm lifts the pen.</small></div></div><div class="drawing-controls"><button class="primary-btn" id="startCamera">Start camera</button><button class="filter-select" id="pauseDrawing" disabled>Ⅱ Pause drawing</button><button class="filter-select" id="mouseDrawing" aria-pressed="false">Use mouse instead</button><button class="filter-select selected" id="penDrawing" aria-pressed="true">✎ Pen</button><button class="filter-select" id="eraserDrawing" aria-pressed="false">⌫ Eraser</button><button class="filter-select" id="clearDrawing">⌫ Clear board</button><button class="filter-select" id="undoDrawing" disabled>↶ Undo</button><button class="filter-select" id="redoDrawing" disabled>↷ Redo</button><button class="filter-select" id="saveDrawing">↓ Save image</button><select id="drawingMode" class="filter-select" aria-label="Camera drawing mode"><option value="hand">Hand drawing</option><option value="classic">Live Sketch · Canny 10/80</option><option value="tutorial">Live Sketch · Canny 30/60</option></select></div><div class="drawing-status"><i id="cameraDot"></i><span id="cameraStatus">Camera off · press Start camera and allow webcam access.</span><span id="trackStatus">Checking local OpenCV tracker…</span></div></section><aside class="screen-panel drawing-guide"><p class="eyebrow">WHITEBOARD TOOLS</p><div class="guide-step"><b>01</b><span>Press Start camera and allow access. Keep your hand visible against a plain background.</span></div><div class="guide-step"><b>02</b><span>Raise only your index finger and move it to write. Raise all five fingers to stop drawing without erasing.</span></div><div class="guide-step"><b>03</b><span>Pick Pen or Eraser, choose a color and size, then Clear board or Save image when finished.</span></div><label class="brush-setting">Pen color<input id="brushColor" type="color" value="#7b61dc"></label><label class="brush-setting">Brush size <input id="brushSize" type="range" min="2" max="24" value="7"><span id="brushSizeValue">7 px</span></label><div class="cv-note"><b>Tracking status</b><p>The local Python service uses OpenCV with a 21-landmark MediaPipe hand tracker. If tracking fails, the status below explains whether the camera, service, or tracker is unavailable.</p></div><div class="cv-note"><b>Gesture shortcuts</b><p>☝ One finger: draw · ✌ Two fingers: next color · ✊ Fist: toggle eraser · 👍 / 👎: brush size · 🖐 Open palm: lift pen.</p></div><div class="cv-tags"><span>OpenCV</span><span>MediaPipe</span><span>Local webcam</span></div><div class="cv-note"><b>Privacy</b><p>Camera starts only when you press Start. Frames are processed by the Python service on this computer.</p></div></aside></div>`,
 library:`<div class="screen-title"><p class="eyebrow">YOUR RESOURCE CENTRE</p><h1>Virtual library</h1><p>Reference material and revision aids for the things you’re learning now.</p></div><div class="screen-toolbar"><input aria-label="Search notes, guides, and resources" id="librarySearch" class="search-field" placeholder="⌕  Search notes, guides, and resources"><select aria-label="Filter by format" id="libraryType" class="filter-select"><option value="">All formats</option><option value="Notes">Notes</option><option value="Video">Videos</option><option value="Quick reference">Quick references</option><option value="Interactive practice">Practice</option></select></div><div class="library-context"><b>Currently studying: Binary search</b><span>These resources cover midpoint choices, sorted data, and boundary cases.</span></div><div class="library-list" id="resourceList"><button class="resource" data-resource="binary-search-notes"><span class="resource-icon">▤</span><span><b>Binary search: visual notes</b><small>Course notes · 6 pages · Accessible reading</small></span></button><button class="resource" data-resource="sorted-data-video"><span class="resource-icon">▶</span><span><b>When sorted data helps</b><small>Short video · 8 minutes · Captions</small></span></button><button class="resource" data-resource="boundary-cheatsheet"><span class="resource-icon">✳</span><span><b>Boundary conditions cheatsheet</b><small>Quick reference · Saved for you</small></span></button><button class="resource" data-resource="practice-set"><span class="resource-icon">◎</span><span><b>Binary search practice set</b><small>Interactive · Recommended next</small></span></button></div><div class="playlist-callout"><b>Your YouTube playlists</b><span>Send me your playlist links and I’ll add them to the matching coding paths here.</span><section class="screen-panel" id="libCatalogSection"><p class="eyebrow">LIBRARY CATALOG</p><h3>Books, e-books &amp; journals</h3><div class="lms-tabs" role="tablist" aria-label="Library catalog tabs"><button class="lms-tab active" data-lib-tab="browse" role="tab" aria-selected="true">Browse</button><button class="lms-tab" data-lib-tab="loans" role="tab" aria-selected="false" id="libLoansTab">My loans</button><button class="lms-tab" data-lib-tab="lists" role="tab" aria-selected="false">Reading lists</button></div><div id="libTab-browse"><div class="screen-toolbar"><input aria-label="Search title, author, ISBN" id="libSearch" class="search-field" placeholder="\u2315  Search title, author, ISBN"><select id="libKind" class="filter-select" aria-label="Kind"><option value="">All kinds</option><option value="book">Books</option><option value="ebook">E-books</option><option value="journal">Journals</option></select><input id="libSubject" class="search-field" placeholder="Subject" aria-label="Subject"></div><div id="libBrowse"><p class="panel-copy">Loading catalog\u2026</p></div></div><div id="libTab-loans" hidden><div id="libLoans"><p class="panel-copy">Loading loans\u2026</p></div></div><div id="libTab-lists" hidden><div id="libLists"><p class="panel-copy">Loading reading lists\u2026</p></div></div></section>`,
 twin:`<div class="screen-title"><p class="eyebrow">LEARNING TWIN · EVIDENCE, NOT LABELS</p><h1>Your skill map</h1><p>See what feels steady and what a little more practice could clarify.</p></div><div class="twin-summary"><div><span class="twin-orb">◉</span><h2>Growing one idea at a time.</h2><p>Estimates use your answers across practice. One mistake never defines your ability.</p></div><div class="twin-stat"><strong>3</strong><span>concepts explored</span><small>from 7 practice signals</small></div></div><div class="screen-columns" style="margin-top:14px"><section class="screen-panel"><p class="eyebrow">CONCEPT MAP</p><div class="concept twin-row"><div class="concept-icon green-icon">✓</div><div class="concept-text"><b>Sorted arrays</b><small>Strong foundation · 4 checks</small></div><div class="mastery"><span style="width:88%"></span></div><strong>88%</strong></div><div class="concept twin-row"><div class="concept-icon amber-icon">↗</div><div class="concept-text"><b>Search boundaries</b><small>Practising · 3 checks</small></div><div class="mastery"><span class="amber-bar" style="width:48%"></span></div><strong>48%</strong></div><div class="concept twin-row"><div class="concept-icon blue-icon">◌</div><div class="concept-text"><b>Time complexity</b><small>Just getting started · 1 check</small></div><div class="mastery"><span class="blue-bar" style="width:24%"></span></div><strong>24%</strong></div></section><section class="screen-panel"><p class="eyebrow">VISION LAB PROGRESS</p><h3 style="font:600 14px 'Space Grotesk'">Experiments and badges</h3><div id="visionTwinProgress" class="cv-sample-list">Loading your saved experiments…</div><button class="filter-select" data-screen="vision-lab">Return to Vision Lab →</button></section><section class="screen-panel"><p class="eyebrow">WHY THIS SUGGESTION?</p><h3 style="font:600 14px 'Space Grotesk'">Try another boundary question</h3><p class="panel-copy">Your last two answers show the midpoint comparison makes sense. The next check practises moving the lower bound.</p><button class="primary-btn" data-challenge>Try a 5-minute practice →</button></section></div>`,
 community:`<div class="screen-title"><p class="eyebrow">LEARN WITH PEOPLE</p><h1>Community</h1><p>Ask questions, share explanations, and learn together.</p></div><div class="community-grid"><section class="screen-panel"><form id="postForm" class="post-form"><label for="postText">Start a discussion</label><textarea id="postText" maxlength="5000" placeholder="Ask a question or share a helpful explanation…" required></textarea><button class="primary-btn">Post discussion →</button><span id="communityStatus" role="status"></span></form><div class="community-toolbar"><input aria-label="Search discussions" id="communitySearch" class="search-field" placeholder="Search discussions"><select id="communityFeed" class="filter-select" aria-label="Choose discussions"><option value="all">All posts</option><option value="following">Following</option><option value="bookmarks">Bookmarks</option></select></div><div id="communityPosts" aria-live="polite"><p class="panel-copy">Loading discussions…</p></div></section><aside class="screen-panel"><p class="eyebrow">STUDY ROOMS</p><h3>Drop into a focused room</h3><button class="room-card" data-screen="classroom"><b>⌘ &nbsp; DSA practice room</b><small>Open classroom →</small></button><p class="panel-copy">Be respectful. Report posts that break your community rules.</p></aside></div>`,
 assignments:`<div class="screen-title"><p class="eyebrow">YOUR CLASS WORK</p><h1>Assignments</h1><p>Know what’s due, submit your work, and see teacher feedback.</p></div><div class="assignment-summary"><div><b>1</b><span>To do</span></div><div><b>0</b><span>Submitted</span></div><div><b>0</b><span>Reviewed</span></div><button class="filter-select" id="newAssignment">＋ Create assignment (teacher)</button></div><div id="assignmentList" class="assignment-list"><p class="panel-copy">Loading assignments…</p></div><div id="studentTools" class="student-tools"></div><div id="assignmentEditor"></div>`,
 languages:`<div class="screen-title"><p class="eyebrow">LANGUAGE LIBRARY · PICK A TOOL, BUILD SOMETHING</p><h1>Explore coding languages</h1><p>Browse popular languages by what they help you build. Each card opens a starter path.</p></div><div class="screen-toolbar"><input aria-label="Search a language or use case" class="search-field" id="languageSearch" placeholder="⌕  Search a language or use case"><select aria-label="Filter by type" id="languageType" class="filter-select"><option value="all">All types</option><option value="web">Web</option><option value="general">General purpose</option><option value="systems">Systems</option><option value="data">Data & databases</option></select></div><div id="languageGrid" class="language-grid"><button class="language-card" data-kind="web"><span class="language-photo photo-web">JS</span><b>JavaScript</b><small>Web · Interactive websites</small></button><button class="language-card" data-kind="web"><span class="language-photo photo-web">TS</span><b>TypeScript</b><small>Web · Safer large apps</small></button><button class="language-card" data-kind="general"><span class="language-photo photo-code">Py</span><b>Python</b><small>AI, automation, backend</small></button><button class="language-card" data-kind="general"><span class="language-photo photo-code">Ja</span><b>Java</b><small>Backend, Android, enterprise</small></button><button class="language-card" data-kind="systems"><span class="language-photo photo-systems">C</span><b>C</b><small>Systems, embedded software</small></button><button class="language-card" data-kind="systems"><span class="language-photo photo-systems">C++</span><b>C++</b><small>Games, systems, performance</small></button><button class="language-card" data-kind="general"><span class="language-photo photo-code">C#</span><b>C#</b><small>Apps, games, .NET</small></button><button class="language-card" data-kind="systems"><span class="language-photo photo-systems">Go</span><b>Go</b><small>Cloud services, networking</small></button><button class="language-card" data-kind="systems"><span class="language-photo photo-systems">Rs</span><b>Rust</b><small>Systems, safe performance</small></button><button class="language-card" data-kind="web"><span class="language-photo photo-web">PHP</span><b>PHP</b><small>Web backends, CMS</small></button><button class="language-card" data-kind="general"><span class="language-photo photo-code">Rb</span><b>Ruby</b><small>Web apps, scripting</small></button><button class="language-card" data-kind="systems"><span class="language-photo photo-systems">Sw</span><b>Swift</b><small>Apple apps</small></button><button class="language-card" data-kind="systems"><span class="language-photo photo-systems">Kt</span><b>Kotlin</b><small>Android, JVM</small></button><button class="language-card" data-kind="data"><span class="language-photo photo-data">SQL</span><b>SQL</b><small>Query and shape data</small></button><button class="language-card" data-kind="data"><span class="language-photo photo-data">R</span><b>R</b><small>Statistics, data science</small></button><button class="language-card" data-kind="web"><span class="language-photo photo-web">HTML</span><b>HTML</b><small>Web · Structure and meaning</small></button><button class="language-card" data-kind="web"><span class="language-photo photo-web">CSS</span><b>CSS</b><small>Web · Layout and visual design</small></button><button class="language-card" data-kind="general"><span class="language-photo photo-code">Sh</span><b>Bash</b><small>Command line automation</small></button><button class="language-card" data-kind="general"><span class="language-photo photo-code">Dart</span><b>Dart</b><small>Cross-platform apps</small></button><button class="language-card" data-kind="systems"><span class="language-photo photo-systems">El</span><b>Elixir</b><small>Concurrent web systems</small></button></div><p class="panel-copy">This starter catalog covers widely used languages and tools; language ecosystems continue to evolve.</p>`,
 notifications:`<div class="screen-title"><p class="eyebrow">UPDATES · DEADLINES · CLASS NOTES</p><h1>Notifications</h1><p>All your learning reminders and classroom updates in one place.</p></div><div id="notificationList" class="notification-list"><p class="panel-copy">Loading notifications…</p></div>`,
 'parent-dashboard':`<div class="screen-title"><p class="eyebrow">FAMILY SPACE</p><h1>Your children's progress</h1><p>Academic progress, attendance, results and certificates — all in one place.</p></div><div id="parentChildren"><p class="panel-copy">Loading your linked children…</p></div><section class="screen-panel" style="margin-top:15px"><h3>Link a child</h3><p class="panel-copy">Ask your child for their 8-character parent link code (they'll find it on their Profile page), then enter it below.</p><form id="parentLinkForm" class="teacher-form"><label>Link code<input name="code" maxlength="8" placeholder="e.g. A1B2C3D4" required style="text-transform:uppercase"></label><button class="primary-btn">Link child →</button><p id="parentLinkStatus" class="panel-copy" role="status"></p></form></section><section class="screen-panel" style="margin-top:15px"><p class="eyebrow">LATEST ANNOUNCEMENTS</p><div id="parentAnnouncePreview"><p class="panel-copy">Loading…</p></div><button class="filter-select" data-screen="announcements">View all announcements →</button></section>`,
 announcements:`<div class="screen-title"><p class="eyebrow">STAY INFORMED</p><h1>Announcements</h1><p>Notices from your institution — selected for your role.</p></div><section class="screen-panel"><div id="announceFeed"><p class="panel-copy">Loading announcements…</p></div></section>`,
 feedback:`<div class="screen-title"><p class="eyebrow">HELP MAKE EDUVERSE BETTER</p><h1>Feedback & support</h1><p>Tell us what worked, what confused you, or what would help you learn.</p></div><div class="screen-columns"><section class="screen-panel"><form id="feedbackForm" class="feedback-form"><label>What is this about?<select name="category"><option>Product idea</option><option>Something is broken</option><option>Accessibility</option><option>Course content</option><option>Other</option></select></label><label class="feedback-subject-field"><span>What is it about? <b aria-hidden="true">*</b></span><input name="subject" maxlength="120" placeholder="Briefly describe your feedback" required></label><label>Your feedback<textarea name="message" required placeholder="Share details so we can understand and improve it…"></textarea></label><button class="primary-btn">Send feedback →</button><p id="feedbackStatus" class="panel-copy">Feedback is saved to this local prototype.</p></form></section><aside class="screen-panel"><p class="eyebrow">NEED HELP NOW?</p><h3 style="font:600 14px 'Space Grotesk'">Ask Nova</h3><p class="panel-copy">Get a quick explanation for a lesson or feature.</p><button class="filter-select" id="openNova">Open learning assistant →</button></aside></div>`,
 profile:`<div class="screen-title"><p class="eyebrow">YOUR LEARNING, YOUR WAY</p><h1>Profile & progress</h1><p>Review your milestones, goals, and learning preferences.</p></div><div class="profile-hero"><div class="big-avatar">?</div><div><h2>Learner</h2><p>Loading your profile…</p></div><button class="filter-select" id="editProfile" style="margin-left:auto">Edit profile</button></div><div class="identity-card"><b>ACCOUNT DETAILS</b><div><span>Account ID</span><strong id="profileId">—</strong></div><div><span>Age</span><strong id="profileAge">Not provided</strong></div><div><span>Belongs to</span><strong id="profileOrg">Personal workspace</strong></div><div><span>Joined</span><strong id="profileJoined">Not available</strong></div></div><section id="studentAnalytics" class="student-analytics screen-panel" aria-live="polite"><p class="panel-copy">Loading your learning report…</p></section><div class="metric-cards"><div class="metric-card"><strong id="learningHoursMetric">—</strong><small>Tracked learning time</small></div><div class="metric-card"><strong id="streakMetric">—</strong><small>Current streak</small></div><div class="metric-card"><strong id="courseCompletionMetric">—</strong><small>Average course completion</small></div></div><div class="screen-columns" style="margin-top:15px"><section class="screen-panel"><p class="eyebrow">SKILL MAP · BASED ON PRACTICE</p><div id="profileSkillMap"><p class="panel-copy">Loading your skill map…</p></div></section><section class="screen-panel"><p class="eyebrow">PREFERENCES</p><button class="setting-row" id="goalSetting">Daily learning goal <span>20 min · Change</span></button><button class="setting-row" id="themeSetting">Display theme <span>System · Change</span></button><button class="setting-row" id="accessibilitySetting">Accessibility & language <span>Configure →</span></button><button class="setting-row" id="privacySetting">Privacy & learning history <span>Review →</span></button></section></div><section class="screen-panel" style="margin-top:15px"><h3>Delete my account</h3><p class="panel-copy">Permanently deletes your account, notes, progress, vision history, enrollments and submissions. This cannot be undone. The last administrator account cannot be deleted this way.</p><form class="delete-account-form teacher-form"><label>Confirm with your current password<input name="password" type="password" required></label><button class="primary-btn">Delete my account permanently →</button><p class="delete-account-status panel-copy"></p></form></section>`,
 notes:`<div class="screen-title"><p class="eyebrow">CAPTURE THE CLICK MOMENT</p><h1>Notes studio</h1><p>Keep your own explanations beside your practice. Notes save to your EduVerse account.</p></div><div class="notes-layout"><aside class="screen-panel notes-list"><p class="eyebrow">YOUR NOTEBOOK</p><div id="notebookList"><p class="panel-copy">Loading notes…</p></div><button class="note-item" id="newNote">＋ &nbsp; Create a note</button></aside><section class="screen-panel note-editor"><input id="noteTitle" class="note-title" value="Untitled note" aria-label="Note title"><div id="noteContent" class="note-content" contenteditable="true" spellcheck="true"></div><div class="note-actions"><span id="noteStatus">New note · not saved yet</span><button class="primary-btn" id="saveNote">Save note ↥</button></div></section></div>`,
 syllabus:`<div class="screen-title"><p class="eyebrow">PRACTICAL PATHWAYS · LEARN BY BUILDING</p><h1>Coding syllabus</h1><p>Choose a path, move through the modules, and make a small project at each milestone.</p></div><div class="path-tabs"><button class="path-tab selected" data-path="web">Web development</button><button class="path-tab" data-path="dsa">Data structures</button><button class="path-tab" data-path="backend">Backend engineering</button><button class="path-tab" data-screen="languages">Language library</button></div><section class="screen-panel syllabus-panel"><div class="path-intro"><span class="path-orb">⌨</span><div><p class="eyebrow">STARTER PATH · 6 MODULES</p><h2 id="pathTitle">Web development</h2><p id="pathSummary">From your first page to a deployed interactive website.</p></div></div><div class="syllabus-track" id="syllabusModules"></div><div class="project-outcome"><b>CAPSTONE IDEA</b><span id="capstoneText">Build an accessible course landing page with a working search and saved progress.</span></div></section>`,
 teacher:`<div class="teacher-dashboard"><header class="teacher-dashboard-head"><div><span class="teacher-ready">READY FOR DUTY</span><h1>Dashboard</h1><p>Keep your school day moving with quick access to classes, attendance, assignments, and student progress.</p></div><div class="teacher-date-chip" id="teacherDateChip"></div></header><div id="teacherSoonBanner" class="lms-soon-banner" hidden></div><div class="teacher-dashboard-stats"><article><small>CLASSES</small><b id="teacherClassCount">0</b><span>Assigned to you</span></article><article><small>LESSONS</small><b id="teacherLessonCount">0</b><span>Scheduled sessions</span></article><article><small>ASSESSMENTS</small><b id="teacherAssessmentCount">0</b><span>Practice and tests</span></article><article><small>STUDENTS</small><b id="teacherStudentCount">0</b><span>Across your classes</span></article></div><section class="teacher-current-class"><div><p class="eyebrow">CURRENT CLASS MODE</p><h2 id="teacherFocusTitle">No class assigned yet</h2><p id="teacherFocusCopy">An administrator can assign classes and learners to your teacher account.</p></div><div class="teacher-quick-actions"><button data-teacher-jump="#attendanceClass">Take attendance</button><button data-teacher-jump="#scheduleForm">Schedule class</button><button data-teacher-jump="#testForm">Create test</button></div></section><div class="teacher-dashboard-bottom"><section class="teacher-agenda"><div class="panel-heading"><div><p class="eyebrow">LESSON FLOW</p><h3>Upcoming sessions</h3></div><button class="text-link" data-teacher-jump="#scheduleForm">Add schedule →</button></div><div id="teacherSchedulePreview"><p class="panel-copy">Your scheduled classes will appear here.</p></div></section><aside class="teacher-responsibilities"><p class="eyebrow">YOUR WORKSPACE</p><h3>Teaching tools</h3><button data-teacher-jump="#attendanceClass"><span>01</span> Take attendance</button><button data-screen="teacher-assignments"><span>02</span> Review assignments</button><button data-teacher-jump="#practiceForm"><span>03</span> Give practice</button><p id="teacherClassNotice" class="teacher-class-notice">Your classes and learner roster are private to your account.</p></aside></div></div><div class="screen-title"><p class="eyebrow">TEACHER STUDIO</p><h1>Teach, organise, and support your class.</h1><p>Plan sessions, track attendance, create practice, and run quizzes or tests from here.</p></div><div class="teacher-hero"><div><span class="pill purple-pill">TEACHER WORKSPACE</span><h2>Your class, all in one place.</h2><p>Plan a session, teach on the 3D board, then check what learners understood.</p><button class="primary-btn" data-screen="classroom">Open shared classroom →</button></div><div class="teacher-art">◈<span>3D BOARD</span></div></div><div class="teacher-tool-grid"><section class="screen-panel"><p class="eyebrow">CLASS ATTENDANCE</p><h3>Mark today’s attendance</h3><select id="attendanceClass" class="teacher-class-select" aria-label="Choose class"><option value="">Choose a class</option></select><div id="attendanceRoster"><p class="panel-copy">Loading class roster…</p></div><button class="primary-btn" id="saveAttendance">Save attendance →</button></section><section class="screen-panel"><p class="eyebrow">SCHEDULE</p><h3>Schedule a class</h3><form id="scheduleForm" class="teacher-form"><input aria-label="Class topic" name="title" placeholder="Class topic" required><select aria-label="Choose class" name="classId" class="teacher-class-select" required><option value="">Choose class</option></select><select aria-label="Choose course" name="course"><option>Data Structures & Algorithms</option><option>Web Development</option><option>AI & Machine Learning</option></select><input aria-label="Class date" name="date" type="date" required><input aria-label="Class time" name="time" type="time" required><button class="primary-btn">Add to schedule →</button></form><div id="scheduleList" class="teacher-records"></div></section><section class="screen-panel"><p class="eyebrow">PRACTICE BUILDER</p><h3>Give students a practice question</h3><form id="practiceForm" class="teacher-form"><select aria-label="Choose class" name="classId" class="teacher-class-select" required><option value="">Choose class</option></select><input aria-label="Topic" name="topic" placeholder="Topic, e.g. binary search" required><textarea aria-label="Practice question" name="question" placeholder="Write the prompt…" required></textarea><input aria-label="Expected answer or marking note" name="answer" placeholder="Expected answer or marking note" required><button class="primary-btn">Publish practice →</button></form><div id="practiceList" class="teacher-records"></div></section><section class="screen-panel"><p class="eyebrow">QUIZ & TEST</p><h3>Create a class test</h3><form id="testForm" class="teacher-form"><select aria-label="Choose class" name="classId" class="teacher-class-select" required><option value="">Choose class</option></select><input aria-label="Test name" name="title" placeholder="Test name" required><input aria-label="Duration in minutes" name="duration" type="number" min="5" max="180" placeholder="Minutes" required><textarea aria-label="Test questions, one per line" name="questions" placeholder="Add one question per line…" required></textarea><button class="primary-btn">Create test →</button></form><div id="testList" class="teacher-records"></div></section><section class="screen-panel teacher-shortcut"><p class="eyebrow">MORE CLASS TOOLS</p><button class="room-card" data-screen="teacher-assignments"><b>▧ &nbsp; Assignments</b><small>Create tasks and review student submissions.</small></button><button class="room-card" data-screen="syllabus"><b>⌨ &nbsp; Coding syllabus</b><small>Plan modules and project milestones.</small></button><button class="room-card" data-screen="profile"><b>⌁ &nbsp; Learning progress</b><small>Review concept signals and next steps.</small></button><button class="room-card" data-screen="teacher-quizzes"><b>✐ &nbsp; Quiz builder</b><small>Build quizzes, publish them, grade attempts.</small></button><button class="room-card" data-screen="live-classes"><b>● &nbsp; Live classes</b><small>Schedule sessions and join them live.</small></button></section></div>`,
 'vision-labs':`<div class="screen-title"><p class="eyebrow">EDUVERSE · BUILD, TRY, REFLECT</p><h1>Vision & Simulation Lab</h1><p>Learn computer vision, AI, and scientific concepts through interactive experiments. Camera access starts only when you choose it.</p></div><div class="cv-dashboard-controls"><input class="search-field" id="cvSearch" placeholder="⌕ Search experiments" aria-label="Search experiments"><select id="cvCategory" class="filter-select" aria-label="Filter experiments"><option value="all">All areas</option><option value="vision">Computer vision</option><option value="science">Science lab</option><option value="more">More experiments</option></select><select id="cvDifficulty" class="filter-select" aria-label="Filter difficulty"><option value="all">All levels</option><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select><button id="visionLowPerformance" class="filter-select" aria-pressed="false">Low performance: off</button><button id="visionAccessibility" class="filter-select">Accessibility</button><button class="filter-select" id="open2dFallback">2D fallback map →</button></div><div class="cv-hub-note"><b>Local processing</b><span>Webcam frames are sent to the Python OpenCV service on this device and are not saved. Mouse and keyboard controls remain available in each experiment.</span><span id="visionProgressSummary">Loading saved experiments…</span><div id="visionBadges" class="cv-badge-row"></div></div><section class="cv-labs-section"><div class="section-head"><div><p class="eyebrow">COMPUTER VISION</p><h2>See, gesture, create</h2></div></div><div class="cv-lab-grid" id="cvVisionGrid"></div></section><section class="cv-labs-section"><div class="section-head"><div><p class="eyebrow">VIRTUAL SCIENCE LABORATORY</p><h2>Explore scientific systems</h2></div></div><div class="cv-lab-grid" id="cvScienceGrid"></div></section><section class="cv-labs-section"><div class="section-head"><div><p class="eyebrow">MORE LEARNING EXPERIMENTS</p><h2>Apply what you discover</h2></div></div><div class="cv-lab-grid" id="cvMoreGrid"></div></section>`,
 onboarding:`<div class="onboarding"><div class="onboarding-card"><div class="brand-icon">e</div><p class="eyebrow" style="margin-top:16px">A PLACE TO LEARN BY DOING</p><h1>Welcome to EduVerse.</h1><p>Explore ideas, practise in interactive spaces, and get a clearer picture of what you understand. Start by choosing how you’ll use the learning space.</p><div class="onboard-actions"><button id="roleStudent">Continue as a student</button><button id="roleTeacher">I’m a teacher</button><button id="roleAdmin">I’m an administrator</button></div><p style="margin-top:14px">Accessibility, language, and learning goals can be set up next.</p></div></div>`,
 fees:`<div class="screen-title"><p class="eyebrow">PAYMENTS</p><h1>My fees</h1><p>Your fee dues and payment history. Pay at the school office or through the channels your institution provides.</p></div><div id="opsMyFees"><p class="panel-copy">Loading your fees…</p></div>`,
 marketplace:`<div class="screen-title"><p class="eyebrow">DISCOVER COURSES</p><h1>Course marketplace</h1><p>Courses listed by institutions on EduVerse. Enroll to start learning.</p></div><div class="screen-toolbar"><input aria-label="Search courses or institutions" class="search-field" id="opsMktSearch" placeholder="⌕  Search courses or institutions"></div><div class="course-grid" id="opsMarketplaceGrid"><p class="panel-copy">Loading marketplace…</p></div>`
};
const cvLabs=[
 ['drawing','✎','Live Webcam Drawing','Draw with your fingertip or turn the live video into an OpenCV edge sketch.','OPENCV · PYTHON','vision','Beginner','8 min'],
 ['hand-playground','✋','Hand Tracking Playground','See all 21 MediaPipe landmarks, fingertip coordinates, confidence, and live tracking speed.','MEDIAPIPE · PYTHON','vision','Beginner','8 min'],
 ['air-keyboard','⌨','Virtual Air Keyboard','Hover a key with your index finger and pinch thumb to index to type.','HAND TRACKING','vision','Intermediate','10 min'],
 ['gesture-deck','👋','Gesture-Controlled Presentation','Navigate a computer-vision lesson with open-hand, fist, and finger-count cues.','GESTURE RECOGNITION','vision','Intermediate','8 min'],
 ['gesture-trainer','✋','AI Hand Gesture Recognition','Collect real contour-feature examples and train a local nearest-neighbour baseline.','MACHINE LEARNING','vision','Advanced','15 min'],
 ['science','⚗','Virtual Chemistry Lab','Mix fictional solutions, vary temperature, and observe the simulated result.','CHEMISTRY','science','Beginner','12 min'],
 ['physics','➶','Virtual Physics Lab','Change speed, angle, and gravity to compare projectile range and height.','MECHANICS','science','Intermediate','12 min'],
 ['biology','🧬','Virtual Biology Lab','Explore a cell model, adjust microscope magnification, and identify organelles.','BIOLOGY','science','Beginner','10 min'],
 ['electronics','ϟ','Virtual Electronics Lab','Change voltage and resistance in an interactive Ohm’s law circuit.','ELECTRONICS','science','Intermediate','10 min'],
 ['mechanical','⚙','Virtual Mechanical Lab','Adjust gear sizes and input speed to see the driven gear ratio and direction.','MECHANICAL ENGINEERING','science','Intermediate','12 min'],
 ['object-hunt','◎','Object Color Hunt','Use OpenCV color analysis to find objects with a target color.','OBJECT DETECTION','more','Beginner','8 min'],
 ['scanner','▤','Whiteboard Scanner','Clean a board image with OpenCV, then enter an equation for a worked explanation.','IMAGE PROCESSING','more','Beginner','8 min'],
 ['gaze','◉','Eye-Control Accessibility','Try dwell selection with a rough, local OpenCV eye-region estimate.','ACCESSIBILITY','more','Intermediate','8 min'],
 ['posture','⌁','Body Framing Explorer','Check whether a full-body figure is visible and centred in the frame.','HOG PERSON DETECTOR','more','Intermediate','8 min'],
 ['object-3d','◈','Hand-Controlled 3D Object','Move and rotate a molecule with the fingertip pointer or sliders.','3D INTERACTION','more','Intermediate','10 min'],
 ['movement-game','⇆','Movement Learning Game','Move between answer lanes with your hand or keyboard.','MOTION INPUT','more','Beginner','6 min'],
 ['gesture-code','⌘','Gesture Coding Lab','Use hand cues or controls to run, submit, inspect, zoom, and stop a loop.','CODING','more','Intermediate','10 min'],
 ['avatar-motion','🧍','Webcam Avatar Motion','Move an avatar with the webcam fingertip pointer or mouse.','AVATAR CONTROL','more','Intermediate','8 min'],
 ['face-lab','☺','Face & Environment Lab','Use local face/eye-region presence to affect a virtual room.','FACE DETECTION','more','Intermediate','8 min'],
 ['teach-mode','✦','Teach EduVerse','Explain a concept, give an example, and answer a check question.','LEARN BY TEACHING','more','Beginner','10 min']
];
const cvGroupIds={vision:['drawing','hand-playground','air-keyboard','gesture-deck','gesture-trainer'],science:['science','physics','biology','electronics','mechanical']};
function renderCvLabs(){for(const [group,target] of Object.entries({vision:'cvVisionGrid',science:'cvScienceGrid',more:'cvMoreGrid'})){const grid=document.querySelector('#'+target);if(!grid)continue;const items=cvLabs.filter(item=>group==='more'?!cvGroupIds.vision.includes(item[0])&&!cvGroupIds.science.includes(item[0]):item[5]===group);grid.innerHTML=items.map(([id,icon,title,copy,tag,,level,time])=>`<article class="cv-lab-card" data-cv-category="${group}" data-cv-level="${level}"><span class="cv-lab-icon">${icon}</span><small>${tag}</small><b>${title}</b><span>${copy}</span><div class="cv-lab-meta"><span>${level}</span><span>◷ ${time}</span></div><button data-cv-lab="${id}">${id==='drawing'?'Open experiment':'Start experiment'} →</button></article>`).join('');}filterCvLabs();}
document.addEventListener('input',e=>{if(e.target.id==='cvSearch')filterCvLabs();});document.addEventListener('change',e=>{if(['cvCategory','cvDifficulty'].includes(e.target.id))filterCvLabs();});
function filterCvLabs(){const q=(document.querySelector('#cvSearch')?.value||'').trim().toLowerCase(),category=document.querySelector('#cvCategory')?.value||'all',level=document.querySelector('#cvDifficulty')?.value||'all';document.querySelectorAll('.cv-lab-card').forEach(card=>{const matchesText=!q||card.innerText.toLowerCase().includes(q),matchesCategory=category==='all'||card.dataset.cvCategory===category,matchesLevel=level==='all'||card.dataset.cvLevel===level;card.hidden=!(matchesText&&matchesCategory&&matchesLevel);});document.querySelectorAll('.cv-labs-section').forEach(section=>{const cards=[...section.querySelectorAll('.cv-lab-card')];section.hidden=cards.length>0&&cards.every(card=>card.hidden);});}
async function loadVisionProgress(){const out=document.querySelector('#visionProgressSummary'),badges=document.querySelector('#visionBadges');if(!out)return;try{const {vision}=await apiRequest('/vision/progress');const count=Object.keys(vision.completed||{}).length;out.textContent=`${count} complete · ${Number(vision.xp||0)} XP`;if(badges)badges.innerHTML=(vision.badges||[]).map(b=>`<span class="cv-badge">🏅 ${safeText(b.title)}</span>`).join('')||'<small>No badges yet</small>';}catch{const v=JSON.parse(localStorage.getItem('eduverse-vision-progress')||'{"completed":{},"events":[]}');out.textContent=`${Object.keys(v.completed||{}).length} complete · ${Number(v.xp||0)} XP · saved in this browser`;if(badges)badges.innerHTML='<small>Connect the local API to sync badges across screens.</small>';}}

function cvLabDemo(id){
 const demos={
 'hand-playground':`<h2 id="modalTitle">Hand tracking playground</h2><p>MediaPipe locates 21 points on your hand. Keep one hand in view and move slowly to see the landmark skeleton and live fingertip coordinates. No image is saved.</p><div class="cv-feedback" id="handPlaygroundReadout">Start the camera to inspect the 21 hand landmarks.</div>`,
 'air-keyboard':`<h2 id="modalTitle">Virtual air keyboard</h2><p>Move your fingertip to highlight a key, then pinch thumb and index finger to type it. Release before the next key. You can also click keys or type normally without a camera.</p><textarea aria-label="Air keyboard typed text" id="airText" class="cv-text-output" placeholder="Your typed text appears here…"></textarea><div class="air-keys">${'QWERTYUIOPASDFGHJKLZXCVBNM'.split('').map(k=>`<button data-air-key="${k}">${k}</button>`).join('')}<button data-air-key="Space">Space</button><button data-air-key="Backspace">⌫</button><button data-air-key="Enter">↵</button></div><div class="cv-control-row"><button id="checkAirTyping" class="primary-btn">Check name challenge</button><button id="clearAirTyping" class="filter-select">Clear text</button></div><div id="airChallengeResult" class="cv-feedback">Type your first name, then check your result.</div>`,
 'gesture-deck':`<h2 id="modalTitle">Gesture-controlled presentation</h2><p>Use MediaPipe hand gestures to control these slides: open palm advances, fist goes back, one finger selects, and two fingers pause. Buttons work without a camera.</p><div class="cv-control-row"><button data-deck="next">👋 Open palm · Next</button><button data-deck="previous">✊ Fist · Previous</button><button data-deck="select">☝ Select</button><button data-deck="pause">✌ Pause / play</button></div><div class="cv-demo-stage"><small>SLIDE <b id="deckPage">1</b> / 4</small><h3 id="deckTitle">Welcome to binary search</h3><p id="deckState">Open palm advances, fist goes back, one finger focuses, and two fingers pause or resume. Buttons work as an alternative.</p></div><button class="filter-select" data-screen="drawing">Try the webcam fingertip tracker →</button>`,
 'gesture-trainer':`<h2 id="modalTitle">Train a gesture classifier</h2><p>Choose labels and collect 21-point MediaPipe landmark examples. A local nearest-neighbour classifier learns from your samples as an explainable baseline.</p><div class="cv-control-row"><select aria-label="Gesture label" id="gestureLabel"><option>Start</option><option>Correct</option><option>Try again</option><option>Next</option></select><button id="collectGesture">＋ Collect example</button><button id="resetGestures">Reset examples</button></div><div id="gestureSamples" class="cv-sample-list"></div><div class="cv-feedback" id="gestureStatus">No examples collected yet.</div>`,
 'object-hunt':`<h2 id="modalTitle">OpenCV color scavenger hunt</h2><p>Point the webcam at an object. OpenCV samples the centre of the frame and estimates its dominant color; it does not identify object names.</p><div class="cv-form-grid"><label>Find this color<select id="huntTargetColor"><option>red</option><option>orange</option><option>yellow</option><option>green</option><option>blue</option><option>purple</option><option>black</option><option>white</option><option>gray</option></select></label><button id="analyzeColor" class="primary-btn">Analyze camera frame →</button></div><div id="colorResult" class="cv-feedback">Start the camera below, point at one object, and analyze.</div><div class="cv-form-grid"><label>Object name<input id="huntName" placeholder="e.g. water bottle"></label><label>Material<select id="huntMaterial"><option>Metal</option><option>Plastic</option><option>Wood</option><option>Glass</option><option>Fabric</option><option>Other</option></select></label></div><button id="addHuntItem" class="filter-select">Save observation</button><div id="huntList" class="cv-sample-list"></div>`,
 'scanner':`<h2 id="modalTitle">Whiteboard scanner</h2><p>Choose a photo or capture the live camera view to create a cleaned, high-contrast preview with OpenCV. OCR is not installed, so enter the equation below to get worked steps.</p><button id="captureBoard" class="filter-select">Capture camera frame →</button><label class="cv-upload">Choose board image<input id="boardImage" type="file" accept="image/*" capture="environment"></label><div id="scanStatus" class="cv-feedback">Image stays in your browser until you press Process locally.</div><button id="processScan" class="filter-select">Process image locally</button><canvas id="scanCanvas" class="cv-scan-canvas"></canvas><div class="cv-form-grid"><label>Equation<input id="equationInput" placeholder="2x + 5 = 15"></label><button id="solveEquation" class="primary-btn">Explain steps</button></div><div id="equationSteps" class="cv-feedback"></div>`,
 'object-3d':`<h2 id="modalTitle">Manipulate a molecule</h2><p>Move your fingertip to move and rotate the molecule; pinch thumb and index to scale it. Mouse, touch, and sliders are always available as alternatives.</p><div class="molecule-stage" id="moleculeStage"><div class="molecule-object" id="moleculeObject"><i></i><i></i><i></i><b></b></div></div><label class="cv-slider">Scale <input id="moleculeScale" type="range" min="70" max="150" value="100"></label><label class="cv-slider">Rotate <input id="moleculeRotate" type="range" min="0" max="360" value="25"></label><button class="filter-select" data-screen="drawing">Open live hand pointer →</button>`,
 'science':`<h2 id="modalTitle">Virtual science lab</h2><p><b>Objective:</b> observe how solution pairing and temperature change a fictional reaction. These demo substances are not real chemicals.</p><p>Choose solutions, set temperature, and mix. The displayed color and rate are simulation outputs, not lab instructions.</p><div class="beaker-row"><div class="beaker" id="beakerA">🧪<small>Solution A</small></div><span>+</span><div class="beaker" id="beakerB">🧪<small>Solution B</small></div><span>→</span><div class="beaker" id="beakerResult">◌<small>Result</small></div></div><div class="cv-control-row"><select aria-label="Solution A" id="solutionA"><option value="acid">Acid indicator</option><option value="base">Base indicator</option><option value="water">Water</option></select><select aria-label="Solution B" id="solutionB"><option value="base">Base indicator</option><option value="acid">Acid indicator</option><option value="salt">Salt solution</option></select><button id="mixSolutions" class="primary-btn">Mix solutions</button></div><label class="cv-slider">Temperature <input id="labTemp" type="range" min="0" max="100" value="22"><span id="labTempValue">22 °C</span></label><div id="reactionStatus" class="cv-feedback">Choose two solutions to begin.</div><button id="chemistryExplanation" class="filter-select">View explanation</button><button id="retryChemistry" class="filter-select">Try again</button><div id="chemistryResult" class="cv-feedback">Result: waiting for a mix.</div>`,
 'posture':`<h2 id="modalTitle">Posture & ergonomics explorer</h2><p>OpenCV checks whether a person-shaped figure is visible and roughly centred. This is only a framing aid, not posture analysis or health advice.</p><div class="cv-checklist"><label><input type="checkbox"> Camera is at eye level</label><label><input type="checkbox"> Screen is about an arm’s length away</label><label><input type="checkbox"> Shoulders look relaxed</label><label><input type="checkbox"> Take a short movement break</label></div><div id="postureReadout" class="cv-feedback">Start camera to check person framing.</div>`,
 'gaze':`<h2 id="modalTitle">Dwell selection accessibility demo</h2><p>Try selecting a large target by holding the pointer over it for 1.5 seconds, or use Tab and Enter. OpenCV will show a rough eye-region hint when it detects a face; it is not accurate gaze estimation.</p><div class="gaze-targets"><button data-dwell="A">A · Arrays</button><button data-dwell="B">B · Loops</button><button data-dwell="C">C · Graphs</button></div><div id="gazeStatus" class="cv-feedback">Focus or hover on a choice to start its dwell timer.</div>`,
 'face-lab':`<h2 id="modalTitle">Face & environment interaction</h2><p>OpenCV face presence controls room lighting. No emotion, identity, or personality is inferred from a face.</p><div class="face-scene" id="faceScene"><b>Virtual learning room</b><span id="faceSceneIcon">☀</span><small id="faceSceneState">Neutral scene</small></div><div class="cv-control-row"><button data-scene="bright">Brighten room</button><button data-scene="animate">Trigger animation</button><button data-scene="calm">Calm scene</button></div><p id="faceDetectionStatus" class="panel-copy">Start camera to detect face and eye regions.</p>`,
 'movement-game':`<h2 id="modalTitle">DSA runner</h2><p>Move with ← →, A/D, or the buttons. Reach the answer to this question: which structure follows Last In, First Out?</p><div class="runner-stage"><div class="runner-lane"><span>ARRAY</span><span>STACK</span><span>QUEUE</span><div id="runnerPlayer">●</div></div></div><div class="cv-control-row"><button data-runner="left">← Move left</button><button data-runner="right">Move right →</button><button id="runnerCheck" class="primary-btn">Check answer</button></div><div id="runnerStatus" class="cv-feedback">Use the lane controls to choose.</div>`,
 'gesture-code':`<h2 id="modalTitle">Gesture coding lab</h2><p>Use open palm to run, one finger to submit, two fingers for output, thumbs up to zoom, and fist to stop. Buttons are also available.</p><pre class="cv-code">for (let i = 0; i &lt; 5; i++) {\n  console.log(i);\n}</pre><div class="cv-control-row"><button data-code="run">✋ Run</button><button data-code="submit">👍 Submit</button><button data-code="output">✌ Show output</button><button data-code="zoom">🤏 Zoom</button><button data-code="stop">✊ Stop</button></div><div id="codeOutput" class="cv-feedback">Output will appear here.</div>`,
 'avatar-motion':`<h2 id="modalTitle">Webcam to avatar motion</h2><p>Move the avatar with the pointer or controls. This is a 2D pose-reactive avatar preview; full-body tracking and skeletal animation need a pose-estimation model.</p><div class="avatar-stage" id="avatarStage"><div class="demo-avatar" id="demoAvatar"><span>◡</span><i></i><b></b></div></div><div class="cv-control-row"><button data-avatar="left">←</button><button data-avatar="wave">Wave</button><button data-avatar="right">→</button><button data-avatar="reset">Reset pose</button></div><div id="avatarStatus" class="cv-feedback">Pointer-drag within the stage to move the avatar.</div>`,
 'physics':`<h2 id="modalTitle">Projectile motion lab</h2><p>Change the initial speed, launch angle, and gravity. The diagram shows a simplified trajectory with no air resistance.</p><label class="cv-slider">Speed <input id="physicsSpeed" type="range" min="10" max="50" value="30"><span id="speedValue">30 m/s</span></label><label class="cv-slider">Angle <input id="physicsAngle" type="range" min="10" max="80" value="45"><span id="angleValue">45°</span></label><label class="cv-slider">Gravity <input id="physicsGravity" type="range" min="2" max="20" value="10"><span id="gravityValue">10 m/s²</span></label><canvas id="physicsCanvas" class="physics-canvas" width="700" height="260"></canvas><div class="cv-feedback" id="physicsReadout"></div><div class="cv-control-row"><button data-physics-answer="true">Maximum range is near 45°</button><button data-physics-answer="false">Maximum range is near 10°</button></div><div id="physicsAnswer" class="cv-feedback">Choose an answer after exploring the sliders.</div>`,
 'biology':`<h2 id="modalTitle">Virtual biology lab · cell explorer</h2><p><b>Objective:</b> identify major cell structures and connect each one to its role. Select a structure in the diagram, then answer the check.</p><div class="cell-lab"><div class="cell-diagram" id="cellDiagram"><button data-cell="nucleus" class="cell-part nucleus">Nucleus</button><button data-cell="membrane" class="cell-part membrane">Membrane</button><button data-cell="mitochondrion" class="cell-part mitochondrion">Mitochondrion</button><button data-cell="cytoplasm" class="cell-part cytoplasm">Cytoplasm</button></div><label class="cv-slider">Microscope zoom <input id="cellZoom" type="range" min="80" max="160" value="100"><span id="cellZoomValue">100%</span></label><div id="cellDescription" class="cv-feedback">Select a cell structure to learn about it.</div></div><p>Quick check: which organelle helps release usable energy?</p><div class="cv-control-row"><button data-cell-answer="mitochondrion">Mitochondrion</button><button data-cell-answer="membrane">Membrane</button></div><div id="biologyResult" class="cv-feedback">Choose an answer to record your check.</div>`,
 'electronics':`<h2 id="modalTitle">Virtual electronics lab · Ohm’s law</h2><p><b>Objective:</b> explore how voltage and resistance affect current in a simple circuit. The visual follows I = V ÷ R.</p><div class="circuit-board"><div class="circuit-wire"></div><div class="circuit-battery">🔋<small id="voltageReadout">6 V</small></div><div class="circuit-led" id="circuitLed"></div><div class="circuit-resistor">Ω<small id="resistanceReadout">300 Ω</small></div></div><label class="cv-slider">Voltage<input id="circuitVoltage" type="range" min="1" max="12" value="6"><span>V</span></label><label class="cv-slider">Resistance<input id="circuitResistance" type="range" min="100" max="1000" step="50" value="300"><span>Ω</span></label><div id="circuitResult" class="cv-feedback"></div><p>Prediction check: double voltage while resistance stays the same. What happens to current?</p><div class="cv-control-row"><button data-circuit-answer="double">It doubles</button><button data-circuit-answer="same">It stays the same</button></div><div id="electronicsResult" class="cv-feedback"></div>`,
 'mechanical':`<h2 id="modalTitle">Virtual mechanical lab · gear ratios</h2><p><b>Objective:</b> observe how tooth count changes output speed and direction in a two-gear system.</p><div class="gear-stage"><div class="gear gear-a" id="gearA"><span>Input</span></div><div class="gear gear-b" id="gearB"><span>Output</span></div></div><label class="cv-slider">Input speed<input id="gearSpeed" type="range" min="30" max="180" value="90"><span id="gearSpeedValue">90 rpm</span></label><label class="cv-slider">Output gear teeth<input id="gearTeeth" type="range" min="12" max="48" step="4" value="24"><span id="gearTeethValue">24</span></label><div id="gearResult" class="cv-feedback"></div><p>Challenge: a 12-tooth driver turns a 36-tooth output gear. What is the output speed if input is 90 rpm?</p><div class="cv-control-row"><button data-gear-answer="30">30 rpm</button><button data-gear-answer="270">270 rpm</button></div><div id="mechanicalResult" class="cv-feedback"></div>`,
 'teach-mode':`<h2 id="modalTitle">Teach EduVerse</h2><p>Explain an idea in your own words, write or draw an example, then answer a check question. Feedback is a rule-based learning prompt, not AI grading.</p><label class="cv-form-label">Your explanation<textarea id="teachExplanation" placeholder="A stack follows Last In, First Out because…"></textarea></label><label class="cv-form-label">Your example<textarea id="teachExample" placeholder="Draw or describe a stack with three items…"></textarea></label><button id="submitTeaching" class="primary-btn">Ask me a follow-up →</button><div id="teachFollowup" class="cv-feedback">Complete both fields to get a reflection prompt.</div><div class="cv-control-row"><button data-teach-answer="C">C is removed next</button><button data-teach-answer="A">A is removed next</button></div><div id="teachResult" class="cv-feedback"></div>`
 };
 const demo=demos[id]||`<h2 id="modalTitle">OpenCV learning activity</h2><p>Explore this guided computer vision activity.</p>`;
 if(id==='drawing')return demo;
 return `${demo}<section class="cv-live-control"><div class="cv-live-heading"><b>Live OpenCV input</b><span>Frames stay on this computer</span></div><div class="cv-live-stage"><video id="cvCameraVideo" autoplay playsinline muted></video><canvas id="cvHandLandmarksCanvas" aria-label="MediaPipe 21 point hand landmark overlay" hidden></canvas><div id="airKeyboardSurface" class="air-keyboard-surface" aria-label="Virtual keyboard tracking area" hidden>${['QWERTYUIOP','ASDFGHJKL','ZXCVBNM'].map(row=>`<div class="air-camera-row">${row.split('').map(key=>`<button type="button" data-air-key="${key}">${key}</button>`).join('')}</div>`).join('')}<div class="air-camera-bottom"><button type="button" data-air-key="Space">SPACE</button><button type="button" data-air-key="Backspace">⌫</button><button type="button" data-air-key="Enter">↵</button></div></div><div id="cvCameraCursor">●</div><div id="cvCameraOverlay">Start the camera to use hand tracking in this activity</div></div><div class="cv-control-row"><button id="cvCameraStart" class="primary-btn">Start camera</button><button id="cvCameraStop" class="filter-select" disabled>Stop</button></div><div id="cvCameraStatus" class="cv-feedback">Camera is off. Your browser asks permission after Start.</div><div id="cvCameraResult" class="cv-feedback">Hand position and experimental gesture hint will appear here.</div></section>`;
}
let appScreenHistory=[];
function navigate(name,options={}){
 const priorScreen=document.querySelector('.crumb')?.textContent.split('/').pop()?.trim();
 const previousKey=Object.keys(screenNames).find(key=>screenNames[key]===priorScreen);
 if(!options.fromHistory&&previousKey&&previousKey!==name)appScreenHistory.push(previousKey);
 if(name==='overview'){contentRoot.innerHTML=dashboardMarkup;}else if(screens[name==='vision-lab'?'vision-labs':name]){contentRoot.innerHTML=screens[name==='vision-lab'?'vision-labs':name];}else if(currentUser?.role==='teacher'){contentRoot.innerHTML=screens.teacher;}else if(isAdminRole(currentUser?.role)){contentRoot.innerHTML=dashboardMarkup;loadAdminDashboard();}else{contentRoot.innerHTML=dashboardMarkup;}
 document.querySelectorAll('.nav-item[data-screen]').forEach(a=>a.classList.toggle('active',a.dataset.screen===name));
 document.querySelector('.crumb').innerHTML=`${portalCrumb()} <span>/</span> ${screenNames[name]||'Overview'}`;
 history.replaceState(null,'','#'+name);
 const backButton=document.querySelector('#pageBack');if(backButton){backButton.disabled=appScreenHistory.length===0;backButton.setAttribute('aria-disabled',String(backButton.disabled));}
 window.scrollTo({top:0,behavior:'smooth'});
 if(name==='vision-labs'||name==='vision-lab'){renderCvLabs();loadVisionProgress();}
 if(name==='drawing')checkDrawingService();
}
document.addEventListener('click',e=>{
 const link=e.target.closest('[data-screen]'); if(link){e.preventDefault();if(modal.classList.contains('open'))closeModal();navigate(link.dataset.screen);return;}
 const secTab=e.target.closest('[data-sec-tab]');if(secTab){renderSecTab(secTab.dataset.secTab);return;}
 const intTest=e.target.closest('[data-int-test]');if(intTest){(async()=>{const box=document.querySelector('#intTestResult');if(box)box.textContent='Testing…';try{const r=await apiRequest(`/admin/integrations/${encodeURIComponent(intTest.dataset.intTest)}/test`,{method:'POST'});if(box)box.textContent=r.message||r.result||'Test completed.';}catch(err){if(box)box.textContent='Test failed: '+err.message;}})();return;}
 const intToggle=e.target.closest('[data-int-toggle]');if(intToggle){(async()=>{try{await apiRequest(`/admin/integrations/${encodeURIComponent(intToggle.dataset.intToggle)}`,{method:'PATCH',body:JSON.stringify({status:intToggle.dataset.intStatus==='active'?'disabled':'active'})});loadAdminIntegrations();}catch(err){alert(err.message);}})();return;}
 const intEdit=e.target.closest('[data-int-edit]');if(intEdit){const it=(window._intCache||[]).find(x=>x.id===intEdit.dataset.intEdit);if(it)renderIntForm(it);return;}
 const intDel=e.target.closest('[data-int-del]');if(intDel){if(!confirm('Delete this integration?'))return;(async()=>{try{await apiRequest(`/admin/integrations/${encodeURIComponent(intDel.dataset.intDel)}`,{method:'DELETE'});loadAdminIntegrations();}catch(err){alert(err.message);}})();return;}
 if(e.target.closest('[data-challenge]')){startChallenge();return;}
 if(e.target.closest('.top-avatar')){navigate(currentUser?.role==='teacher'?'teacher-settings':currentUser?.role==='admin'?'admin-security':'onboarding');return;}
 
 if(e.target.id==='raiseHand')e.target.textContent=e.target.textContent.includes('Lower')?'✋ Raise hand':'✓ Hand raised';
 if(e.target.id==='pollBtn')openModal('<h2 id="modalTitle">Quick poll</h2><p>The target is greater than the midpoint. Which side should we inspect?</p><div class="question"><button class="answer" data-answer="wrong">Left</button><button class="answer" data-answer="right">Right</button></div><div id="answerFeedback"></div>');
 if(['roleStudent','roleTeacher','roleAdmin'].includes(e.target.id)){e.target.closest('.onboarding-card').innerHTML='<div class="brand-icon">✓</div><h1>Your learning space is ready.</h1><p>This prototype starts with a student view. Choose Course catalog or 3D Campus from the sidebar to explore.</p><div class="onboard-actions"><button data-screen="overview">Go to my dashboard</button></div>';}
});
document.addEventListener('input',e=>{if(e.target.id==='courseSearch'){const q=e.target.value.toLowerCase();document.querySelectorAll('#courseGrid .course-tile').forEach(card=>card.hidden=!card.innerText.toLowerCase().includes(q));}});
document.addEventListener('change',e=>{if(e.target.id==='levelFilter'){document.querySelectorAll('#courseGrid .course-tile').forEach(card=>card.hidden=e.target.value!=='all'&&!card.innerText.toLowerCase().includes(e.target.value.toLowerCase()));}});

const API_BASE = `${location.origin}/api`;
const pendingIdempotencyKeys = new Map();
function idempotencySlot(method,path,body){
 const source=`${method}:${path}:${typeof body==='string'?body:''}`;let a=0x811c9dc5,b=0x9e3779b9;
 for(let i=0;i<source.length;i++){const code=source.charCodeAt(i);a=Math.imul(a^code,0x01000193);b=Math.imul(b+code,0x85ebca6b);}
 return `eduverse:idempotency:${(a>>>0).toString(36)}${(b>>>0).toString(36)}:${source.length}`;
}
function pendingIdempotencyKey(slot){
 let key;try{key=sessionStorage.getItem(slot);}catch{}
 if(!key)key=pendingIdempotencyKeys.get(slot);
 if(!key){key=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;pendingIdempotencyKeys.set(slot,key);try{sessionStorage.setItem(slot,key);}catch{}}
 return key;
}
// JWT tokens for API access (the web app itself signs in with the session cookie).
// Login/signup responses carry {accessToken, refreshToken}; the access token is kept
// in localStorage as eduverse.jwt so API clients and the profile page can use it.
const JWT_KEY='eduverse.jwt',JWT_REFRESH_KEY='eduverse.refresh';
function getStoredJwt(){try{return localStorage.getItem(JWT_KEY)||'';}catch{return '';}}
function getStoredRefreshToken(){try{return localStorage.getItem(JWT_REFRESH_KEY)||'';}catch{return '';}}
function storeAuthTokens(data){try{if(data?.accessToken)localStorage.setItem(JWT_KEY,data.accessToken);if(data?.refreshToken)localStorage.setItem(JWT_REFRESH_KEY,data.refreshToken);}catch{}}
function clearStoredTokens(){try{localStorage.removeItem(JWT_KEY);localStorage.removeItem(JWT_REFRESH_KEY);}catch{}}
async function apiRequest(path, options={}) {
  const method=String(options.method||'GET').toUpperCase(),headers={'Content-Type':'application/json',...(options.headers||{})};
  let idempotencySlotKey=null;
  if(['POST','PATCH','DELETE'].includes(method)&&!headers['Idempotency-Key']&&!headers['idempotency-key']){
   idempotencySlotKey=idempotencySlot(method,path,options.body);headers['Idempotency-Key']=pendingIdempotencyKey(idempotencySlotKey);
  }
  const jwt=getStoredJwt();
  if(jwt&&!headers.Authorization)headers.Authorization='Bearer '+jwt;
  let response=await fetch(`${API_BASE}${path}`,{...options,method,headers});
  if(response.status===401&&jwt){
    // Stored token may have expired while the session cookie is still valid:
    // drop the stale token and retry cookie-only so the web app keeps working.
    clearStoredTokens();
    const retryHeaders={...headers};delete retryHeaders.Authorization;
    response=await fetch(`${API_BASE}${path}`,{...options,method,headers:retryHeaders});
  }
  if(response.ok&&idempotencySlotKey){pendingIdempotencyKeys.delete(idempotencySlotKey);try{sessionStorage.removeItem(idempotencySlotKey);}catch{}}
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'API request failed');
  return data;
}
async function loadCatalog(query='',level='all'){
  const grid=document.querySelector('#courseGrid');if(!grid)return;
  try{
    const data=await apiRequest(`/courses?q=${encodeURIComponent(query)}&level=${encodeURIComponent(level)}`);
    grid.innerHTML=data.courses.map(c=>courseCard(c.id==='dsa-binary-search'?'':c.id==='ml-foundations'?'teal':'orange',c.icon,c.category,c.title,c.description,c.duration,c.level,c.id,c.priceCents)).join('')||'<p class="panel-copy">No courses match those filters.</p>';try{const mine=await apiRequest('/my-enrollments');const box=document.querySelector('#myEnrollments');if(box&&currentUser?.role==='student')box.innerHTML=`<h3 style="font:600 15px 'Space Grotesk';margin-top:20px">My enrollments</h3>`+(mine.enrollments.length?mine.enrollments.map(e=>`<div class="teacher-record"><b>${safeText(e.course?.title||'Course')}</b><small>${e.completedLessons} lesson${e.completedLessons===1?'':'s'} marked complete</small></div>`).join(''):'<p class="panel-copy">You are not enrolled in a course yet. Use Enroll on a course above.</p>');}catch{}
  }catch{grid.insertAdjacentHTML('beforebegin','<p class="api-notice">Course API unavailable. Showing the sample catalog.</p>');}
}
async function loadProfileData(){
  try{
    const [{profile},{progress}]=await Promise.all([apiRequest('/profile'),apiRequest('/progress')]);
    const id=document.querySelector('#profileId');if(id)id.textContent=(profile.accountId||profile.id);const age=document.querySelector('#profileAge');if(age)age.textContent=profile.age||'Not provided';const org=document.querySelector('#profileOrg');if(org)org.textContent=profile.institution||'Not linked';const joined=document.querySelector('#profileJoined');if(joined&&profile.joinedAt)joined.textContent=new Date(profile.joinedAt+'T12:00:00').toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'});
    const name=document.querySelector('.profile-hero h2');if(name)name.textContent=profile.name;const avatar=document.querySelector('.big-avatar');if(avatar&&profile.name)avatar.textContent=profile.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const bio=document.querySelector('.profile-hero p');if(bio)bio.textContent=profile.bio;
    const metrics=document.querySelectorAll('.metric-card strong');if(metrics[1])metrics[1].textContent=`${progress.streakDays} days`;
    const skillMap=document.querySelector('#profileSkillMap');
    if(skillMap){
      const concepts=progress.concepts||{};
      const skillLabels={'sorted-arrays':'Sorted arrays','search-boundaries':'Search boundaries','time-complexity':'Time complexity'};
      const skillIcons={'sorted-arrays':['green-icon','✓',''],'search-boundaries':['amber-icon','↗','amber-bar'],'time-complexity':['blue-icon','◌','blue-bar']};
      const skillKeys=Object.keys(skillLabels).filter(k=>concepts[k]);
      const totalEvidence=skillKeys.reduce((n,k)=>n+Number(concepts[k].evidenceCount||0),0);
      if(!skillKeys.length||totalEvidence===0){skillMap.innerHTML='<p class="panel-copy">Complete practice to see your skill map.</p>';}
      else{skillMap.innerHTML=skillKeys.map(k=>{const c=concepts[k],pct=Math.max(0,Math.min(100,Number(c.mastery)||0)),checks=Number(c.evidenceCount||0),note=checks>0?`Evidence from ${checks} practice check${checks===1?'':'s'}`:'No practice checks yet';return `<div class="concept"><div class="concept-icon ${skillIcons[k][0]}">${skillIcons[k][1]}</div><div class="concept-text"><b>${skillLabels[k]}</b><small>${note}</small></div><div class="mastery"><span class="${skillIcons[k][2]}" style="width:${pct}%"></span></div><strong>${pct}%</strong></div>`;}).join('');}
    }
  }catch{}
  loadStudentAnalytics();
}
async function loadStudentAnalytics(){
 const root=document.querySelector('#studentAnalytics');if(!root)return;
 try{
  const a=await apiRequest('/student/analytics'),hours=(Number(a.learningHours)||0).toFixed(1),week=Number(a.weeklyLearningMinutes)||0,assign=a.assignments||{},quizzes=a.quizzes||[];
  const hoursMetric=document.querySelector('#learningHoursMetric'),streakMetric=document.querySelector('#streakMetric'),completionMetric=document.querySelector('#courseCompletionMetric');
  if(hoursMetric)hoursMetric.textContent=`${hours}h`;if(streakMetric)streakMetric.textContent=`${Number(a.streakDays)||0} days`;if(completionMetric)completionMetric.textContent=`${Number(a.courseCompletion)||0}%`;
  const assignmentRows=(assign.results||[]).map(item=>`<article class="result-row"><div><b>${safeText(item.title)}</b><small>${safeText(item.course||'Assignment')}${item.submittedAt?` · ${new Date(item.submittedAt).toLocaleDateString()}`:''}</small></div><strong>${item.status==='graded'?`${safeText(item.marks)} / ${safeText(item.maxMarks)}`:'Awaiting teacher review'}</strong>${item.feedback?`<p>${safeText(item.feedback)}</p>`:''}</article>`).join('');
  const quizRows=(quizzes.attempts||[]).map(item=>`<article class="result-row"><div><b>${safeText(item.title)}</b><small>Class test${item.submittedAt?` · ${new Date(item.submittedAt).toLocaleDateString()}`:''}</small></div><strong>${item.score===null?'Awaiting teacher review':`${item.score}%`}</strong>${item.feedback?`<p>${safeText(item.feedback)}</p>`:''}</article>`).join('');
  root.innerHTML=`<p class="eyebrow">PERSONAL PERFORMANCE REPORT</p><h2>Your learning progress</h2><div class="analytics-metrics"><article><b>${Number(a.courseCompletion)||0}%</b><span>Average course completion</span></article><article><b>${hours}h</b><span>Total tracked learning time</span></article><article><b>${week} min</b><span>Tracked this week</span></article><article><b>${Number(a.streakDays)||0} days</b><span>Current learning streak</span></article><article><b>${assign.submitted||0} / ${assign.assigned||0}</b><span>Assignments submitted</span></article><article><b>${assign.averagePercent==null?'—':`${assign.averagePercent}%`}</b><span>Released assignment average · ${assign.graded||0} graded</span></article><article><b>${quizzes.averageScore==null?'—':`${quizzes.averageScore}%`}</b><span>Teacher-scored test average · ${quizzes.scored||0} scored</span></article></div><section class="analytics-section"><h3>Course completion</h3><div class="analytics-course-list">${(a.courses||[]).map(c=>`<article class="analytics-course"><div><b>${safeText(c.title)}</b><span>${c.completion}% complete</span></div><progress max="100" value="${c.completion}"></progress><small>${c.completedLessons} of ${c.lessonCount} lessons completed</small></article>`).join('')||'<p class="panel-copy">Enroll in a course to see your completion here.</p>'}</div></section><section class="analytics-section"><h3>Marks & results</h3><p class="panel-copy">Your assignment marks and class test scores appear here after your teacher releases them.</p><div class="analytics-results"><h4>Assignments</h4>${assignmentRows||'<p class="panel-copy">No assignment submissions yet.</p>'}<h4>Class tests</h4>${quizRows||'<p class="panel-copy">No class test attempts yet.</p>'}</div></section>`;
 }catch{root.innerHTML='<p class="api-notice">Your learning report could not be loaded. Please try again.</p>';}
}
// Load course and profile data whenever their screens are opened.
/* ---------- Parent portal + announcements (family slice) ---------- */
const FAMILY_RELATIONS={father:'Father',mother:'Mother',guardian:'Guardian',other:'Other'};
async function loadParentDashboard(){
  const box=document.querySelector('#parentChildren');if(!box)return;
  try{
    const {children}=await apiRequest('/parent/children');
    if(!children.length){box.innerHTML='<section class="screen-panel"><p class="staff-empty">No children linked yet. Use the “Link a child” form below with the 8-character code from your child’s Profile page.</p></section>';}
    else{
      box.innerHTML=children.map(c=>{
        const s=c.student||{},p=c.progress||{},a=c.attendance||{};
        const attPct=a.total?Math.round(a.present/a.total*100):null;
        const progPct=p.coursesEnrolled?Math.round(p.coursesCompleted/p.coursesEnrolled*100):0;
        return `<article class="screen-panel" data-child="${safeText(s.id||'')}"><p class="eyebrow">LINKED CHILD</p><h2>${safeText(s.name||'Student')}</h2><div class="metric-cards"><div class="metric-card"><strong>✦ ${Number(p.xp||0)}</strong><small>XP · Level ${Number(p.level||1)}</small></div><div class="metric-card"><strong>${p.coursesCompleted||0}/${p.coursesEnrolled||0}</strong><small>Courses completed</small></div><div class="metric-card"><strong>${p.avgQuizScore==null?'—':Math.round(p.avgQuizScore)+'%'}</strong><small>Average quiz score</small></div><div class="metric-card"><strong>${attPct==null?'—':attPct+'%'}</strong><small>Attendance${a.total?` (${a.present}/${a.total})`:''}</small></div></div><div class="concept" style="margin-top:12px"><div class="concept-text"><b>Course progress</b><small>${p.coursesCompleted||0} of ${p.coursesEnrolled||0} courses complete</small></div><div class="mastery"><span style="width:${progPct}%"></span></div><strong>${progPct}%</strong></div><div class="child-results"><p class="panel-copy">Loading results…</p></div></article>`;
      }).join('');
      for(const c of children){loadChildResults(c.student?.id);}
    }
  }catch(err){box.innerHTML=`<p class="staff-empty">Could not load linked children: ${safeText(err.message)}</p>`;}
  try{
    const {announcements}=await apiRequest('/parent/announcements');
    const prev=document.querySelector('#parentAnnouncePreview');
    if(prev)prev.innerHTML=(announcements||[]).slice(0,3).map(a=>`<div class="audit-row"><b>${safeText(a.title)}</b><span>${safeText(String(a.body||'').slice(0,120))}${String(a.body||'').length>120?'…':''}</span><small>${a.createdAt?new Date(a.createdAt).toLocaleDateString():'—'}</small></div>`).join('')||'<p class="panel-copy">No announcements yet.</p>';
  }catch{const prev=document.querySelector('#parentAnnouncePreview');if(prev)prev.innerHTML='<p class="panel-copy">Announcements unavailable.</p>';}
}
async function loadChildResults(studentId){
  if(!studentId)return;const card=document.querySelector(`[data-child="${CSS.escape(studentId)}"] .child-results`);if(!card)return;
  try{
    const d=await apiRequest(`/parent/children/${encodeURIComponent(studentId)}/results`);
    const attempts=(d.attempts||d.results||[]).slice(0,5),certs=d.certificates||[];
    card.innerHTML=`<p class="eyebrow" style="margin-top:14px">RECENT RESULTS</p>`+(attempts.length?attempts.map(t=>`<div class="audit-row"><b>${safeText(t.quizTitle||t.title||'Quiz')}</b><span>${t.score!=null?Math.round(t.score)+'%':'—'}${t.passed===true?' · Passed':t.passed===false?' · Not passed':''}</span><small>${t.submittedAt?new Date(t.submittedAt).toLocaleDateString():'—'}</small></div>`).join(''):'<p class="panel-copy">No graded attempts yet.</p>')+`<p class="eyebrow" style="margin-top:14px">CERTIFICATES</p>`+(certs.length?certs.map(c=>`<div class="audit-row"><b>🏅 ${safeText(c.title||c.courseTitle||'Certificate')}</b><span>${safeText(c.code||'')}</span><small>${c.issuedAt?new Date(c.issuedAt).toLocaleDateString():'—'}</small></div>`).join(''):'<p class="panel-copy">No certificates earned yet.</p>');
  }catch{card.innerHTML='<p class="panel-copy">Results unavailable.</p>';}
}
async function loadAnnouncements(){
  const feed=document.querySelector('#announceFeed');if(!feed)return;
  try{
    const [{announcements=[]},teacherFeed]=await Promise.all([apiRequest('/announcements'),currentUser?.role==='student'?apiRequest('/teacher/announcements').catch(()=>({announcements:[]})):Promise.resolve({announcements:[]})]);
    const rows=[...announcements.map(a=>({...a,kind:a.audience||'all'})),...(teacherFeed.announcements||[]).map(a=>({...a,title:`Class announcement · ${a.className||'Your class'}`,body:a.message,kind:'class announcement'}))].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    feed.innerHTML=rows.map(a=>`<article class="screen-panel" style="margin-bottom:12px"><p class="eyebrow">${safeText(String(a.kind||'all').toUpperCase())} · ${a.createdAt?new Date(a.createdAt).toLocaleDateString():'—'}</p><h3 style="font:600 15px 'Space Grotesk';margin:0 0 8px">${safeText(a.title)}</h3><p class="panel-copy" style="white-space:pre-wrap">${safeText(a.body||'')}</p></article>`).join('')||'<p class="staff-empty">No announcements for your role yet.</p>';
  }catch(err){feed.innerHTML=`<p class="staff-empty">Could not load announcements: ${safeText(err.message)}</p>`;}
}
async function loadStudentLinkCode(){
  if(currentUser?.role!=='student')return;
  let panel=document.querySelector('#parentLinkPanel');
  if(!panel){
    const anchor=document.querySelector('#profile .screen-columns, .content .screen-columns');
    if(!anchor)return;
    panel=document.createElement('section');panel.className='screen-panel';panel.id='parentLinkPanel';panel.style.marginTop='15px';
    anchor.after(panel);
  }
  try{
    const d=await apiRequest('/student/link-code');
    const code=d.code||d.linkCode||'';
    panel.innerHTML=`<p class="eyebrow">FAMILY LINK</p><h3>Parent link code</h3><p class="panel-copy">Share this code with your parent or guardian so they can follow your progress. It only works for linking — it never grants sign-in.</p><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><code id="studentLinkCode" class="student-link-code">${safeText(code)}</code><button class="filter-select" id="copyLinkCode" type="button">Copy</button><button class="filter-select" id="regenLinkCode" type="button">Regenerate</button></div><p id="linkCodeStatus" class="panel-copy" role="status"></p>`;
    document.querySelector('#copyLinkCode').onclick=async()=>{try{await navigator.clipboard.writeText(code);document.querySelector('#linkCodeStatus').textContent='Copied to clipboard.';}catch{document.querySelector('#linkCodeStatus').textContent='Copy this code: '+code;}};
    document.querySelector('#regenLinkCode').onclick=async()=>{const st=document.querySelector('#linkCodeStatus');try{const r=await apiRequest('/student/link-code',{method:'POST'}).catch(()=>apiRequest('/student/link-code'));const nc=r.code||r.linkCode||code;document.querySelector('#studentLinkCode').textContent=nc;st.textContent='New code generated. Share the new one.';}catch(err){st.textContent=err.message;}};
  }catch{panel.innerHTML='<p class="eyebrow">FAMILY LINK</p><p class="panel-copy">Parent link codes are unavailable right now.</p>';}
}
async function loadAdminAnnouncements(){
  const root=document.querySelector('#staffPageBody');if(!root)return;
  try{
    const {announcements}=await apiRequest('/admin/announcements');
    root.innerHTML=(announcements||[]).map(a=>`<div class="audit-row"><b>${safeText(a.title)}</b><span><span class="pill purple-pill" style="font-size:8px">${safeText((a.audience||'all').toUpperCase())}</span> ${safeText(String(a.body||'').slice(0,140))}${String(a.body||'').length>140?'…':''}</span><small>${a.createdAt?new Date(a.createdAt).toLocaleString():'—'} <button data-admin-announce-del="${safeText(a.id)}" type="button">Delete</button></small></div>`).join('')||'<p class="staff-empty">No announcements posted yet.</p>';
  }catch(err){root.innerHTML=`<p class="staff-empty">${safeText(err.message)}</p>`;}
}
function openParentLinkModal(studentId,studentName){
  apiRequest(`/admin/parent-links?studentId=${encodeURIComponent(studentId)}`).then(async d=>{
    const links=d.links||d.parentLinks||[];
    const {users}=await apiRequest(`/admin/users?q=`).catch(()=>({users:[]}));
    const parents=users.filter(u=>u.role==='parent'&&u.status==='active');
    openModal(`<h2 id="modalTitle">Link parent — ${safeText(studentName)}</h2><p>Existing links:</p><div id="existingLinks">${links.length?links.map(l=>`<div class="audit-row"><b>${safeText(l.parentName||l.parentId)}</b><span>${safeText(FAMILY_RELATIONS[l.relation]||l.relation||'')}</span><small><button data-unlink-parent="${safeText(l.id)}" data-student="${safeText(studentId)}" type="button">Remove</button></small></div>`).join(''):'<p class="panel-copy">No parents linked yet.</p>'}</div><form id="parentLinkAdminForm" class="teacher-form" style="margin-top:12px"><label>Parent account<select name="parentId" required>${parents.map(p=>`<option value="${safeText(p.id)}">${safeText(p.name)} (${safeText(p.username||p.email||'')})</option>`).join('')||'<option value="">No parent accounts yet</option>'}</select></label><label>Relation<select name="relation">${Object.entries(FAMILY_RELATIONS).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label><button class="primary-btn">Link parent →</button><p id="parentLinkAdminStatus" class="panel-copy"></p></form>`);
    document.querySelector('#parentLinkAdminForm').onsubmit=async e=>{e.preventDefault();const f=e.target,st=document.querySelector('#parentLinkAdminStatus');try{const body=Object.fromEntries(new FormData(f));await apiRequest('/admin/parent-links',{method:'POST',body:JSON.stringify({parentId:body.parentId,studentId,relation:body.relation})});st.textContent='Parent linked.';closeModal();}catch(err){st.textContent=err.message;}};
  }).catch(err=>openModal(`<h2 id="modalTitle">Link parent</h2><p class="panel-copy">${safeText(err.message)}</p>`));
}
async function loadTwinData(){try{const [{progress},{vision}]=await Promise.all([apiRequest('/progress'),apiRequest('/vision/progress')]);const concepts=progress.concepts;const rows=[...document.querySelectorAll('.twin-row')];const keys=['sorted-arrays','search-boundaries','time-complexity'];rows.forEach((row,i)=>{const concept=concepts[keys[i]];if(!concept)return;row.querySelector('.mastery span').style.width=`${concept.mastery}%`;row.querySelector('strong').textContent=`${concept.mastery}%`;row.querySelector('.concept-text small').textContent=`Evidence from ${concept.evidenceCount} practice checks`;});const stat=document.querySelector('.twin-stat strong');if(stat)stat.textContent=Object.keys(concepts).length;const evidence=document.querySelector('.twin-stat small');if(evidence)evidence.textContent=`from ${Object.values(concepts).reduce((n,c)=>n+c.evidenceCount,0)} practice signals`;const count=Object.keys(vision.completed||{}).length,box=document.querySelector('#visionTwinProgress'),stats=Object.values(vision.experiments||{}),recent=stats.sort((a,b)=>String(b.lastActivity||'').localeCompare(String(a.lastActivity||'')))[0],skills=[...new Set(stats.flatMap(item=>item.skills||[]))];if(box)box.innerHTML=`<div class="cv-sample-row"><b>Vision experiments completed</b><span>${count}</span></div><div class="cv-sample-row"><b>XP earned</b><span>✦ ${vision.xp||0}</span></div><div class="cv-sample-row"><b>Attempts · mistakes</b><span>${vision.attempts||0} · ${vision.mistakes||0}</span></div><div class="cv-sample-row"><b>Skills practiced</b><span>${skills.length?safeText(skills.join(', ')):'Start an experiment'}</span></div><div class="cv-sample-row"><b>Recommended next</b><span>${recent?.recommendedNext?safeText(recent.recommendedNext.replaceAll('-',' ')):'Choose an experiment'}</span></div>${(vision.badges||[]).map(b=>`<div class="cv-sample-row"><b>🏅 ${safeText(b.title)}</b><span>Earned</span></div>`).join('')||'<small>Complete an experiment to earn your first badge.</small>'}`;}catch{const box=document.querySelector('#visionTwinProgress');if(box)box.textContent='Start the local EduVerse API to sync Vision Lab progress.';}}

const originalNavigate=navigate;
navigate=function(name){if(name!=='live-classroom')lmsCleanupClassroom();originalNavigate(name);if(name==='catalog')loadCatalog();if(name==='profile'){document.querySelector('#apiAccessPanel')?.remove();loadProfileData();loadStudentLinkCode();}if(name==='twin')loadTwinData();if(name==='parent-dashboard')loadParentDashboard();if(name==='announcements')loadAnnouncements();};
document.addEventListener('input',e=>{if(e.target.id==='courseSearch')loadCatalog(e.target.value,document.querySelector('#levelFilter')?.value||'all');});
document.addEventListener('change',e=>{if(e.target.id==='levelFilter')loadCatalog(document.querySelector('#courseSearch')?.value||'',e.target.value);});

const pathMeta={web:{summary:'From your first page to a deployed interactive website.',capstone:'Build an accessible course landing page with a working search and saved progress.'},dsa:{summary:'Learn to choose a data structure and explain why an algorithm works.',capstone:'Create a visual algorithm playground with sorting and search controls.'},backend:{summary:'Design small, reliable services that store and move useful data.',capstone:'Ship a learning tracker API with validated routes and persistent storage.'}};
let activeNoteId=null,accountNotes=[];
function renderNotebook(){const box=document.querySelector('#notebookList');if(!box)return;box.innerHTML=accountNotes.map(n=>`<div class="note-item-wrap"><button class="note-item${n.id===activeNoteId?' selected':''}" type="button" data-note-id="${safeText(n.id)}">✎ &nbsp; ${safeText(n.title||'Untitled note')}<small>Updated ${n.updatedAt?new Date(n.updatedAt).toLocaleDateString():'recently'}</small></button><button class="note-delete" type="button" data-delete-note="${safeText(n.id)}" aria-label="Delete ${safeText(n.title||'note')}">Delete</button></div>`).join('')||'<p class="panel-copy">Your saved notes will appear here.</p>';}

function selectNotebookNote(note){if(!note)return;activeNoteId=note.id;const title=document.querySelector('#noteTitle'),content=document.querySelector('#noteContent'),status=document.querySelector('#noteStatus');if(title)title.value=note.title||'Untitled note';if(content)content.innerText=note.content||'';if(status)status.textContent=`Saved · ${note.updatedAt?new Date(note.updatedAt).toLocaleString():'in your notebook'}`;renderNotebook();}
async function loadNotes(){try{const {notes=[]}=await apiRequest('/notes');accountNotes=notes;renderNotebook();if(notes[0])selectNotebookNote(notes[0]);else{activeNoteId=null;document.querySelector('#noteTitle').value='Untitled note';document.querySelector('#noteContent').innerText='';document.querySelector('#noteStatus').textContent='Create a note and save it to your notebook.';}}catch{const local=JSON.parse(localStorage.getItem('eduverse-notes')||'[]');accountNotes=Array.isArray(local)?local:[];renderNotebook();if(accountNotes[0])selectNotebookNote(accountNotes[0]);document.querySelector('#noteStatus').textContent='API offline · saved notes are available in this browser';}}
async function loadSyllabus(pathId='web'){
 try{const {tracks}=await apiRequest('/syllabus');const track=tracks.find(t=>t.id===pathId);if(!track)return;document.querySelector('#pathTitle').textContent=track.title;document.querySelector('#pathSummary').textContent=pathMeta[pathId].summary;document.querySelector('#capstoneText').textContent=pathMeta[pathId].capstone;const done=JSON.parse(localStorage.getItem(`eduverse-syllabus-${pathId}`)||'[]');document.querySelector('#syllabusModules').innerHTML=track.modules.map((m,i)=>`<button type="button" class="module-row syllabus-module" data-module-index="${i}" data-module-title="${safeText(m)}"><span class="module-number">${String(i+1).padStart(2,'0')}</span><span class="module-copy"><b>${safeText(m)}</b><small>${i<2?'Concepts + guided practice':'Interactive lesson + mini project'}</small></span><span class="module-state">${done.includes(i)?'✓ COMPLETE':i===0?'START HERE':'Open →'}</span></button>`).join('');}catch{document.querySelector('#syllabusModules').innerHTML='<p class="panel-copy">Start the EduVerse API to load coding paths.</p>';}
}
const baseNavigate=navigate;
navigate=function(name){baseNavigate(name);if(name==='campus')drawCampus();if(name==='notes')loadNotes();if(name==='syllabus')loadSyllabus();};
document.addEventListener('click',async e=>{
 if(e.target.matches('[data-path]')){document.querySelectorAll('.path-tab').forEach(b=>b.classList.toggle('selected',b===e.target));loadSyllabus(e.target.dataset.path);}
 if(e.target.closest('[data-module-index]')){const row=e.target.closest('[data-module-index]'),idx=Number(row.dataset.moduleIndex),path=document.querySelector('[data-path].selected')?.dataset.path||'web',title=row.dataset.moduleTitle;openModal(`<h2 id="modalTitle">${safeText(title)}</h2><p><b>Learning path:</b> ${safeText(pathMeta[path]?.summary||'Build this skill through guided practice.')}</p><p>Read or practise this topic in your class materials, then write one sentence about what you learned to keep a personal record.</p><label>Your takeaway<textarea id="syllabusTakeaway" maxlength="1000" placeholder="What did you learn in this module?"></textarea></label><button class="primary-btn" type="button" data-module-complete="${idx}" data-module-path="${safeText(path)}">Save takeaway and mark complete →</button>`);const saved=JSON.parse(localStorage.getItem(`eduverse-syllabus-notes-${path}`)||'{}');const field=document.querySelector('#syllabusTakeaway');if(field)field.value=saved[idx]||'';return;}
 if(e.target.matches('[data-module-complete]')){const btn=e.target,idx=Number(btn.dataset.moduleComplete),path=btn.dataset.modulePath,key=`eduverse-syllabus-${path}`,done=JSON.parse(localStorage.getItem(key)||'[]'),notes=JSON.parse(localStorage.getItem(`eduverse-syllabus-notes-${path}`)||'{}');notes[idx]=document.querySelector('#syllabusTakeaway')?.value.trim()||'';localStorage.setItem(`eduverse-syllabus-notes-${path}`,JSON.stringify(notes));if(!done.includes(idx))done.push(idx);localStorage.setItem(key,JSON.stringify(done));closeModal();loadSyllabus(path);return;}
 if(e.target.id==='saveNote'){const title=document.querySelector('#noteTitle').value.trim()||'Untitled note',content=document.querySelector('#noteContent').innerText;try{const result=await apiRequest(activeNoteId?`/notes/${encodeURIComponent(activeNoteId)}`:'/notes',{method:activeNoteId?'PATCH':'POST',body:JSON.stringify({title,content})}),note=result.note;if(note){accountNotes=activeNoteId?accountNotes.map(n=>n.id===note.id?note:n):[note,...accountNotes];activeNoteId=note.id;}renderNotebook();document.querySelector('#noteStatus').textContent=`Saved in your notebook · ${new Date(note?.updatedAt||Date.now()).toLocaleTimeString()}`;}catch{const note={id:activeNoteId||`local-${Date.now()}`,title,content,updatedAt:new Date().toISOString()};accountNotes=activeNoteId?accountNotes.map(n=>n.id===activeNoteId?note:n):[note,...accountNotes];activeNoteId=note.id;localStorage.setItem('eduverse-notes',JSON.stringify(accountNotes));renderNotebook();document.querySelector('#noteStatus').textContent='Saved in this browser notebook · API unavailable';}}
 if(e.target.id==='newNote'){activeNoteId=null;document.querySelector('#noteTitle').value='Untitled note';document.querySelector('#noteContent').innerText='';document.querySelector('#noteStatus').textContent='New note · not saved yet';renderNotebook();document.querySelector('#noteTitle').focus();}
 const deleteNote=e.target.closest('[data-delete-note]');if(deleteNote){const id=deleteNote.dataset.deleteNote;if(!window.confirm('Delete this note from your notebook?'))return;try{await apiRequest(`/notes/${encodeURIComponent(id)}`,{method:'DELETE'});accountNotes=accountNotes.filter(n=>n.id!==id);if(activeNoteId===id){activeNoteId=null;document.querySelector('#noteTitle').value='Untitled note';document.querySelector('#noteContent').innerText='';document.querySelector('#noteStatus').textContent='Note deleted.';}renderNotebook();}catch(err){const status=document.querySelector('#noteStatus');if(status)status.textContent=`Could not delete note: ${err.message}`;}return;}
 const noteLink=e.target.closest('[data-note-id]');if(noteLink){selectNotebookNote(accountNotes.find(n=>n.id===noteLink.dataset.noteId));return;}
 if(e.target.id==='addBoardNote'){const writing=document.querySelector('.board-writing');const note=document.createElement('textarea');note.className='sticky-note';note.maxLength=240;note.placeholder='Add a thought…';note.setAttribute('aria-label','Sticky note text');writing.append(note);note.focus();const status=document.querySelector('#boardStatus');if(status)status.textContent='Sticky note added · remember to save the board';}
 if(e.target.id==='saveBoard'){const writing=document.querySelector('.board-writing'),copy=document.querySelector('#boardCopy'),canvas=document.querySelector('#classInkCanvas');const board={content:copy?.innerText||'',stickyNotes:[...writing.querySelectorAll('.sticky-note')].map(n=>n.value).filter(Boolean),ink:canvas?.toDataURL('image/png')||'',savedAt:new Date().toISOString()};try{localStorage.setItem('eduverse-class-board',JSON.stringify(board));try{await apiRequest('/notes',{method:'POST',body:JSON.stringify({title:'Class board · Binary search',content:board.content+'\n\nSticky notes:\n'+board.stickyNotes.map(n=>'• '+n).join('\n')})});document.querySelector('#boardStatus').textContent='Board and ink saved on this device; text synced to Notes ✓';}catch{document.querySelector('#boardStatus').textContent='Board and ink saved on this device ✓';}}catch{document.querySelector('#boardStatus').textContent='Could not save this board. Reduce or clear ink and try again.';}}
 if(e.target.matches('[data-tool]')){document.querySelectorAll('[data-tool]').forEach(b=>{b.classList.toggle('selected',b===e.target);b.setAttribute('aria-pressed',String(b===e.target));});setClassInkTool(e.target.dataset.tool);const status=document.querySelector('#boardStatus');if(status)status.textContent=e.target.dataset.tool==='eraser'?'Ink eraser selected':'Board pen selected';}
 if(e.target.id==='mapToggle'){const c=document.querySelector('#campus3d');c.classList.toggle('map-view');e.target.textContent=c.classList.contains('map-view')?'◈ 3D view':'☷ 2D map';document.querySelector('#worldHint').textContent=c.classList.contains('map-view')?'FLAT MAP':'DRAG TO ORBIT';}
});
function drawCampus(){
 const canvas=document.querySelector('#campus3d');if(!canvas)return;
 const gl=canvas.getContext('webgl',{antialias:true,alpha:false});if(!gl){document.querySelector('#worldHint').textContent='3D VIEW UNAVAILABLE';return;}
 const vs=`attribute vec3 p;uniform mat4 m;void main(){gl_Position=m*vec4(p,1.0);}`;
 const fs=`precision mediump float;uniform vec4 c;void main(){gl_FragColor=c;}`;
 const shader=(type,src)=>{const sh=gl.createShader(type);gl.shaderSource(sh,src);gl.compileShader(sh);return sh;};
 const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vs));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(program);gl.useProgram(program);
 const verts=[];const faces=[[0,1,2,0,2,3],[4,6,5,4,7,6],[0,4,5,0,5,1],[3,2,6,3,6,7],[1,5,6,1,6,2],[0,3,7,0,7,4]];const corners=[[-.5,-.5,-.5],[.5,-.5,-.5],[.5,.5,-.5],[-.5,.5,-.5],[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]];faces.forEach(f=>f.forEach(i=>verts.push(...corners[i])));
 const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(verts),gl.STATIC_DRAW);const loc=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0);const mloc=gl.getUniformLocation(program,'m'),cloc=gl.getUniformLocation(program,'c');
 let yaw=-.5,pitch=.42,drag=null;const buildings=[{x:-1.15,z:-.5,w:.72,h:1.08,d:.72,c:[.66,.56,.93,1]},{x:.18,z:-.72,w:.8,h:.68,d:.75,c:[.4,.79,.75,1]},{x:1.12,z:.18,w:.8,h:1.28,d:.8,c:[.95,.67,.49,1]},{x:-.35,z:.88,w:.66,h:.46,d:.65,c:[.91,.85,.98,1]}];
 function matrix(x,y,z,w,h,d){const aspect=canvas.width/canvas.height,f=1/Math.tan(.52),near=.1,far=50;const pr=[f/aspect,0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,(2*far*near)/(near-far),0];const cy=Math.cos(yaw),sy=Math.sin(yaw),cx=Math.cos(pitch),sx=Math.sin(pitch);const tx=x*cy-z*sy,tz=x*sy+z*cy;const rx=tx,ry=y*cx-tz*sx-1.45,rz=y*sx+tz*cx-5.1;const model=[w*cy,w*sx*sy,0,0,0,h*cx,-h*sx,0,-d*sy,d*cy*sx,d*cy*cx,0,rx,ry,rz,1];const out=new Float32Array(16);for(let r=0;r<4;r++)for(let c=0;c<4;c++){let sum=0;for(let k=0;k<4;k++)sum+=pr[k*4+r]*model[c*4+k];out[c*4+r]=sum;}return out;}
 const cubes=[{x:0,y:-.16,z:0,w:4.1,h:.25,d:3.4,c:[.31,.31,.51,1]},...buildings.map(b=>({...b,y:b.h/2-.08}))];
 function frame(){if(!canvas.isConnected)return;const rect=canvas.getBoundingClientRect();const ratio=document.body.classList.contains('low-performance')?1:Math.min(devicePixelRatio||1,1.7);if(canvas.width!==Math.round(rect.width*ratio)||canvas.height!==Math.round(rect.height*ratio)){canvas.width=Math.round(rect.width*ratio);canvas.height=Math.round(rect.height*ratio);}gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(.13,.12,.23,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);cubes.forEach(b=>{gl.uniformMatrix4fv(mloc,false,matrix(b.x,b.y,b.z,b.w,b.h,b.d));gl.uniform4fv(cloc,b.c);gl.drawArrays(gl.TRIANGLES,0,36);});requestAnimationFrame(frame);}
 canvas.onpointerdown=e=>{drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId)};canvas.onpointermove=e=>{if(drag){yaw+=(e.clientX-drag[0])*.009;pitch=Math.max(-.2,Math.min(.9,pitch+(e.clientY-drag[1])*.006));drag=[e.clientX,e.clientY]}};canvas.onpointerup=()=>drag=null;frame();
}
let activeRole='student';
async function refreshRole(){try{const {profile}=await apiRequest('/profile');activeRole=profile.role||'student';}catch{}const b=document.querySelector('#roleSwitch');if(b)b.innerHTML=activeRole==='teacher'?'Teacher view <span>⇄ Student</span>':'Student view <span>⇄ Teacher</span>';}
document.querySelector('#roleSwitch')?.addEventListener('click',async()=>{activeRole=activeRole==='student'?'teacher':'student';try{await apiRequest('/profile',{method:'PATCH',body:JSON.stringify({role:activeRole})});}catch{}document.querySelector('#roleSwitch').innerHTML=activeRole==='teacher'?'Teacher view <span>⇄ Student</span>':'Student view <span>⇄ Teacher</span>';navigate(activeRole==='teacher'?'teacher':'overview');});
refreshRole();
let lastAssignments=[];
let assignUpload={fileUrl:'',fileName:'',fileData:'',mimeType:''};
function assignDueInfo(a){const raw=String(a?.dueDate||'');if(!raw)return{hasDue:false,past:false,label:''};const end=/^\d{4}-\d{2}-\d{2}$/.test(raw)?new Date(raw+'T23:59:59'):new Date(raw);if(Number.isNaN(end.getTime()))return{hasDue:false,past:false,label:raw};return{hasDue:true,past:Date.now()>end.getTime(),label:raw};}
function assignSubFile(a){const sub=(a&&typeof a.submission==='object'&&a.submission)||null;return{fileUrl:a?.fileUrl||a?.submissionFileUrl||sub?.fileUrl||'',fileName:a?.fileName||a?.submissionFileName||sub?.fileName||'',late:a?.late===true||sub?.late===true};}
function assignFileLinkHtml(fileUrl,fileName){if(!fileUrl)return'';return `<p class="assign-file-row">📎 <a href="${safeText(fileUrl)}" target="_blank" rel="noopener">${safeText(fileName||'Attached file')}</a></p>`;}
function assignLateBadgeHtml(late){return late?'<span class="late-badge">LATE</span>':'';}
async function loadAssignments(){const list=document.querySelector('#assignmentList');if(!list)return;const createButton=document.querySelector('#newAssignment');if(createButton)createButton.hidden=activeRole!=='teacher';try{const {assignments}=await apiRequest('/assignments');lastAssignments=assignments||[];list.innerHTML=assignments.map(a=>{const due=assignDueInfo(a),sub=assignSubFile(a),closed=due.hasDue&&due.past&&!a.allowLate;const deadlineNote=due.hasDue?`<p class="assign-deadline-note${closed?' closed':''}">Due ${safeText(due.label)} · ${a.allowLate?'Late submissions allowed':'No late submissions'}${closed?' · Deadline passed — submissions are closed':''}</p>`:'';const submittedView=a.status==='submitted'?`<div class="submission-preview">${a.submission?`Your submission: ${safeText(typeof a.submission==='string'?a.submission:'')}`:'Your submission:'} ${assignLateBadgeHtml(sub.late)}</div>${assignFileLinkHtml(sub.fileUrl,sub.fileName)}`:closed?`<p class="assign-deadline-note closed">Deadline passed — submissions are closed.</p>`:`<button class="primary-btn" data-submit-assignment="${safeText(a.id)}">Open and submit →</button>`;return `<article class="assignment-card"><div class="assignment-status ${a.status==='submitted'?'submitted':''}">${a.status==='submitted'?'✓ SUBMITTED':'● TO DO'}</div><div class="assignment-main"><small>${safeText(a.course)} · Due ${safeText(a.dueDate||'No date set')}</small><h2>${safeText(a.title)}</h2><p>${safeText(a.description)}</p>${deadlineNote}${Array.isArray(a.questions)&&a.questions.length?`<div class="assignment-questions"><b>Questions / tasks</b><ol>${a.questions.map(q=>`<li>${safeText(q)}</li>`).join('')}</ol></div>`:''}${a.grade?`<div class="released-grade"><b>Grade released</b><span>${safeText(a.grade.marks)} / ${safeText(a.grade.maxMarks)}${Number(a.grade.maxMarks)>0?` · ${Math.round(Number(a.grade.marks)/Number(a.grade.maxMarks)*100)}%`:''}</span></div>`:''}${a.feedback?`<div class="teacher-feedback"><b>Teacher feedback</b><br>${safeText(a.feedback)}</div>`:''}${submittedView}</div></article>`;}).join('')||'<div class="screen-panel">No assignments yet. Your teacher will post class work here.</div>';const todo=assignments.filter(a=>a.status==='assigned').length,done=assignments.filter(a=>a.status==='submitted').length;document.querySelectorAll('.assignment-summary div b')[0].textContent=todo;document.querySelectorAll('.assignment-summary div b')[1].textContent=done;}catch{list.innerHTML='<div class="api-notice">Start the EduVerse API to load and submit assignments.</div>';}}
function safeText(value){return EduVerseSecurity.escapeHtml(value);}
const previousNavigate=navigate;
navigate=function(name){previousNavigate(name);if(name==='assignments'){loadAssignments();loadStudentTools();}if(name==='fees')loadMyFees();if(name==='marketplace')loadMarketplace();if(name==='community')renderCommunityPosts();if(name==='teacher')loadTeacherWorkspace();if(name==='notifications')loadNotifications();if(name==='library'){loadResources();loadLibraryCatalog();}if(name==='classroom')hydrateBoard();if(name==='today'||name==='timetable')loadStudentScheduleView(name);if(name==='calendar')loadCalendar();if(name==='careers')loadCareers();if(name==='placement')loadPlacement();};
document.addEventListener('click',async e=>{
 if(e.target.id==='editProfile'){openModal(`<h2 id="modalTitle">Edit your profile</h2><p>Update the name and short bio shown in your learning space.</p><div class="profile-edit-form"><input aria-label="Your name" id="editName" class="search-field" value="${safeText(document.querySelector('.profile-hero h2')?.textContent||'')}"><textarea aria-label="Short bio" id="editBio" class="search-field" placeholder="A short bio">${safeText(document.querySelector('.profile-hero p')?.textContent||'')}</textarea><input aria-label="Age (optional)" id="editAge" class="search-field" inputmode="numeric" placeholder="Age (optional)" value="${safeText(document.querySelector('#profileAge')?.textContent==='Not provided'?'':document.querySelector('#profileAge')?.textContent||'')}"><input aria-label="School or organization (optional)" id="editInstitution" class="search-field" placeholder="School or organization (optional)" value="${safeText(document.querySelector('#profileOrg')?.textContent||'')}"><button class="primary-btn" id="saveProfile">Save profile</button></div>`);}
 if(e.target.id==='saveProfile'){const name=document.querySelector('#editName').value.trim(),bio=document.querySelector('#editBio').value.trim(),age=document.querySelector('#editAge').value.trim(),institution=document.querySelector('#editInstitution').value.trim();try{const result=await apiRequest('/profile',{method:'PATCH',body:JSON.stringify({name,bio,age:age||null,institution:institution||'Personal workspace'})});closeModal();navigate('profile');document.querySelector('.profile-hero h2').textContent=result.profile.name;document.querySelector('.profile-hero p').textContent=result.profile.bio;setTimeout(loadProfileData,0);}catch{document.querySelector('#modalBody').insertAdjacentHTML('beforeend','<p class="api-notice">Start the API to save profile edits.</p>');}}
 if(e.target.closest('#newAssignment')){document.querySelector('#assignmentEditor').innerHTML=`<form class="screen-panel assignment-create" id="createAssignmentForm"><h3>Create an assignment</h3><input aria-label="Assignment title" class="search-field" name="title" placeholder="Assignment title" required><input aria-label="Course name" class="search-field" name="course" placeholder="Course name" value="Data Structures, Made Visual"><select aria-label="Choose class" class="teacher-class-select" name="classId" required><option value="">Choose class</option></select><textarea aria-label="What should students learn or submit?" name="description" placeholder="What should students learn or submit?" required></textarea><label>Questions or tasks (one per line)<textarea name="questions" placeholder="Add each question or task on a new line" maxlength="10000"></textarea></label><input class="search-field" type="date" name="dueDate"><label class="auth-check"><input type="checkbox" name="allowLate"> Allow late submissions</label><button class="primary-btn">Publish assignment →</button><p class="panel-copy">Choose a class to assign this work to its enrolled students.</p></form>`;}
 if(e.target.id==='newAssignment'&&activeRole==='teacher')loadTeacherClasses();const submit=e.target.closest('[data-submit-assignment]');if(submit){const id=submit.dataset.submitAssignment;const asg=lastAssignments.find(x=>x.id===id)||{};const due=assignDueInfo(asg),closed=due.hasDue&&due.past&&!asg.allowLate;assignUpload={fileUrl:'',fileName:'',fileData:'',mimeType:''};document.querySelector('#assignmentEditor').innerHTML=`<form class="screen-panel assignment-create" id="submitAssignmentForm" data-id="${safeText(id)}"><h3>Submit your work</h3>${due.hasDue?`<p class="assign-deadline-note${closed?' closed':''}">Due ${safeText(due.label)} · ${asg.allowLate?'Late submissions allowed — a late submission will be marked LATE':'No late submissions'}${closed?' · Deadline has passed':''}</p>`:''}<textarea aria-label="Write your solution, steps, or explanation" name="submission" placeholder="Write your solution, steps, or explanation… (optional if you attach a file)"></textarea><label>Attach a file (PDF, DOC, DOCX or TXT, max 5MB)<input type="file" id="assignFileInput" accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"></label><p id="assignFileStatus" class="panel-copy"></p><button class="primary-btn" ${closed?'disabled':''}>Submit to teacher →</button>${closed?'<p class="api-notice">The submission deadline has passed and late submissions are not allowed for this assignment.</p>':''}</form>`;document.querySelector('#assignmentEditor').scrollIntoView({behavior:'smooth',block:'center'});}
 if(e.target.id==='assignFileRemove'){assignUpload={fileUrl:'',fileName:'',fileData:'',mimeType:''};const inp=document.querySelector('#assignFileInput');if(inp)inp.value='';const st=document.querySelector('#assignFileStatus');if(st)st.textContent='File removed.';return;}
 if(e.target.closest('.reply-button')){document.querySelector('#postText').focus();}
});
function updateLegalConsent(scrollBox){const form=scrollBox?.closest('form'),check=form?.querySelector('[name="terms"]'),hint=form?.querySelector('.legal-scroll-hint');if(!check)return;const reachedEnd=scrollBox.scrollTop+scrollBox.clientHeight>=scrollBox.scrollHeight-3;check.disabled=!reachedEnd;if(hint)hint.textContent=reachedEnd?'You can now agree to the Terms and Privacy Notice.':'Scroll the notice to the end to enable agreement.';}
document.addEventListener('scroll',e=>{if(e.target instanceof Element&&e.target.matches('.legal-scroll'))updateLegalConsent(e.target);},true);
document.addEventListener('focusin',e=>{if(e.target.matches?.('.legal-scroll'))updateLegalConsent(e.target);});
document.addEventListener('submit',async e=>{
 if(e.target.id==='createAssignmentForm'){e.preventDefault();const f=new FormData(e.target);try{await apiRequest('/assignments',{method:'POST',body:JSON.stringify({classId:f.get('classId'),title:f.get('title'),course:f.get('course'),description:f.get('description'),questions:f.get('questions'),dueDate:f.get('dueDate'),allowLate:f.get('allowLate')==='on'})});document.querySelector('#assignmentEditor').innerHTML='';loadAssignments();}catch(err){e.target.insertAdjacentHTML('beforeend',`<p class="api-notice">${safeText(err.message||'Could not publish this assignment.')}</p>`);}}
 if(e.target.id==='submitAssignmentForm'){e.preventDefault();const id=e.target.dataset.id,submission=String(new FormData(e.target).get('submission')||'').trim();if(!submission&&!assignUpload.fileUrl&&!assignUpload.fileData){e.target.insertAdjacentHTML('beforeend','<p class="api-notice">Write your solution or attach a file before submitting.</p>');return;}try{const body={submission,fileUrl:assignUpload.fileUrl||undefined,fileName:assignUpload.fileName||undefined};if(assignUpload.fileData){body.fileData=assignUpload.fileData;body.mimeType=assignUpload.mimeType;}const d=await apiRequest(`/assignments/${encodeURIComponent(id)}/submit`,{method:'POST',body:JSON.stringify(body)});assignUpload={fileUrl:'',fileName:'',fileData:'',mimeType:''};document.querySelector('#assignmentEditor').innerHTML=`<div class="response good">Assignment submitted. Nice work!${d&&d.late?' Submitted late — it is marked LATE.':''}</div>`;loadAssignments();}catch(err){e.target.insertAdjacentHTML('beforeend',`<p class="api-notice">${safeText(err.message||'Could not submit. Start the local API and try again.')}</p>`);}}
 if(e.target.id==='postForm'){e.preventDefault();const text=document.querySelector('#postText').value.trim();if(text){const posts=JSON.parse(localStorage.getItem('eduverse-community')||'[]');posts.unshift({text,time:new Date().toLocaleTimeString()});localStorage.setItem('eduverse-community',JSON.stringify(posts.slice(0,8)));document.querySelector('#postText').value='';renderCommunityPosts();}}
});
async function renderCommunityPosts(){const root=document.querySelector('#communityPosts');if(!root)return;const feed=document.querySelector('#communityFeed')?.value||'all',q=document.querySelector('#communitySearch')?.value||'';try{const {posts}=await apiRequest(`/community/feed?feed=${encodeURIComponent(feed)}&q=${encodeURIComponent(q)}`);root.innerHTML=posts.map(p=>{const parents=p.comments.filter(c=>!c.parentId),comments=parents.map(c=>`<div class="community-comment"><b>${safeText(c.authorName)}</b><p>${safeText(c.text)}</p><button class="filter-select" data-community-reply="${safeText(p.id)}" data-parent="${safeText(c.id)}">Reply</button> <button class="filter-select" data-community-report="comment" data-target="${safeText(c.id)}">Report</button>${p.comments.filter(r=>r.parentId===c.id).map(r=>`<div class="community-reply"><b>${safeText(r.authorName)}</b><p>${safeText(r.text)}</p></div>`).join('')}</div>`).join('');return `<article class="community-post"><header><div><b>${safeText(p.authorName)}</b><small>${safeText(new Date(p.createdAt).toLocaleString())} · ${p.followerCount} followers</small></div>${p.authorId!==currentUser?.id?`<button class="filter-select" data-community-follow="${safeText(p.authorId)}" data-active="${!p.following}">${p.following?'Following':'Follow'}</button>`:''}<button class="filter-select" data-community-report="post" data-target="${safeText(p.id)}">Report</button></header><p class="community-post-text">${safeText(p.text)}</p><div class="community-actions"><button class="filter-select" data-community-like="${safeText(p.id)}" data-active="${!p.liked}">${p.liked?'♥ Liked':'♡ Like'} · ${p.likeCount}</button><button class="filter-select" data-community-bookmark="${safeText(p.id)}" data-active="${!p.bookmarked}">${p.bookmarked?'★ Bookmarked':'☆ Bookmark'}</button><button class="filter-select" data-community-reply="${safeText(p.id)}">Reply</button></div><div class="community-comments">${comments}</div><form class="community-reply-form" data-community-comment="${safeText(p.id)}"><input aria-label="Write a comment or reply" name="text" maxlength="2000" required placeholder="Write a comment or reply"><input type="hidden" name="parentId" value=""><button class="filter-select">Comment</button></form></article>`;}).join('')||'<p class="panel-copy">No discussions found. Start one above.</p>';}catch(err){root.innerHTML=`<p class="api-notice">${safeText(err.message||'Could not load discussions. Sign in as a student and try again.')}</p>`;}}
document.addEventListener('change',e=>{if(e.target.id==='communityFeed')renderCommunityPosts();});
let communitySearchTimer;document.addEventListener('input',e=>{if(e.target.id==='communitySearch'){clearTimeout(communitySearchTimer);communitySearchTimer=setTimeout(renderCommunityPosts,250);}});
document.addEventListener('click',async e=>{const b=e.target.closest('[data-community-like],[data-community-bookmark],[data-community-follow],[data-community-report],[data-community-reply]');if(!b)return;b.disabled=true;try{if(b.hasAttribute('data-community-like'))await apiRequest(`/community/posts/${encodeURIComponent(b.dataset.communityLike)}/like`,{method:'POST',body:JSON.stringify({active:b.dataset.active==='true'})});else if(b.hasAttribute('data-community-bookmark'))await apiRequest(`/community/posts/${encodeURIComponent(b.dataset.communityBookmark)}/bookmark`,{method:'POST',body:JSON.stringify({active:b.dataset.active==='true'})});else if(b.hasAttribute('data-community-follow'))await apiRequest(`/community/follow/${encodeURIComponent(b.dataset.communityFollow)}`,{method:'POST',body:JSON.stringify({active:b.dataset.active==='true'})});else if(b.hasAttribute('data-community-report')){const reason=prompt('Choose a reason: Harassment or bullying, Spam or promotion, Hate or harmful content, or Other');if(!reason)return;await apiRequest('/community/reports',{method:'POST',body:JSON.stringify({targetType:b.dataset.communityReport,targetId:b.dataset.target,reason})});alert('Report sent to the administrators for review.');}else{const form=b.closest('.community-post')?.querySelector('.community-reply-form'),input=form?.querySelector('[name="parentId"]');if(form&&input){input.value=b.dataset.parent||'';form.querySelector('[name="text"]').focus();return;}}await renderCommunityPosts();}catch(err){b.disabled=false;alert(err.message||'That community action could not be saved.');}});
document.addEventListener('submit',async e=>{const form=e.target.closest('.community-reply-form');if(!form)return;e.preventDefault();const fields=new FormData(form);try{await apiRequest(`/community/posts/${encodeURIComponent(form.dataset.communityComment)}/comments`,{method:'POST',body:JSON.stringify({text:fields.get('text'),parentId:fields.get('parentId')||null})});await renderCommunityPosts();}catch(err){alert(err.message||'Your comment could not be saved.');}});
document.addEventListener('input',e=>{if(e.target.id==='languageSearch'||e.target.id==='languageType'){const q=document.querySelector('#languageSearch')?.value.toLowerCase()||'',type=document.querySelector('#languageType')?.value||'all';document.querySelectorAll('.language-card').forEach(card=>card.hidden=(!card.innerText.toLowerCase().includes(q))||(type!=='all'&&card.dataset.kind!==type));}});
document.addEventListener('change',e=>{if(e.target.id==='languageType'){const q=document.querySelector('#languageSearch')?.value.toLowerCase()||'',type=e.target.value;document.querySelectorAll('.language-card').forEach(card=>card.hidden=(!card.innerText.toLowerCase().includes(q))||(type!=='all'&&card.dataset.kind!==type));}});
document.addEventListener('click',async e=>{
 if(e.target.closest('#goalSetting'))openModal('<h2 id="modalTitle">Set a daily learning goal</h2><p>Choose a goal that feels realistic. You can change it any time.</p><div class="goal-options"><button class="answer" data-goal="10">10 minutes</button><button class="answer" data-goal="20">20 minutes</button><button class="answer" data-goal="30">30 minutes</button><button class="answer" data-goal="45">45 minutes</button></div><div id="goalFeedback"></div>');
 if(e.target.matches('[data-goal]')){const mins=Number(e.target.dataset.goal);try{await apiRequest('/profile',{method:'PATCH',body:JSON.stringify({dailyGoalMinutes:mins})});}catch{}document.querySelector('#goalFeedback').innerHTML=`<div class="response good">Your daily goal is now ${mins} minutes.</div>`;document.querySelector('#goalSetting span').textContent=`${mins} min · Change`;}
 if(e.target.closest('#themeToggle')){applyDisplayTheme(document.body.classList.contains('dark-mode')?'light':'dark');}
 if(e.target.closest('#themeSetting')){const current=localStorage.getItem('eduverse-theme')||'system',theme=current==='system'?'light':current==='light'?'dark':'system';applyDisplayTheme(theme);e.target.closest('#themeSetting').querySelector('span').textContent=`${theme[0].toUpperCase()+theme.slice(1)} · Change`;}
 if(e.target.closest('#privacySetting'))openModal('<h2 id="modalTitle">Your learning data</h2><p>The skill estimates use challenge answers and assignment progress. This local demo keeps data in its JSON file on this computer. There is no school account sync in this prototype.</p><div class="response teach">You can inspect the demo store in <b>eduverse-3d/backend/data/store.json</b>. Production needs account-level controls and a secure data policy.</div>');
 if(e.target.closest('#accessibilitySetting')||e.target.id==='visionAccessibility')openAccessibilitySettings();
 if(e.target.id==='visionLowPerformance'){setLowPerformance(!document.body.classList.contains('low-performance'));}
 if(e.target.id==='open2dFallback'){if(modal.classList.contains('open'))closeModal();navigate('campus');setTimeout(()=>{const map=document.querySelector('#mapToggle');if(map&&!document.querySelector('#campus3d')?.classList.contains('map-view'))map.click();},0);}
 if(e.target.matches('[data-a11y-toggle]'))toggleAccessibility(e.target.dataset.a11yToggle);
 if(e.target.closest('.concept')){const title=e.target.closest('.concept').querySelector('.concept-text b')?.textContent||'Concept';openModal(`<h2 id="modalTitle">${safeText(title)}</h2><p>This estimate reflects practice answers tagged to this concept. It should be treated as a guide for choosing the next activity, not a grade.</p><div class="response teach">More correct practice across new examples builds stronger evidence than time spent in a lesson.</div>`);}
});

async function hydrateBoard(){const writing=document.querySelector('.board-writing'),copy=document.querySelector('#boardCopy'),canvas=document.querySelector('#classInkCanvas');if(!writing||!copy||!canvas)return;let saved=null;try{saved=JSON.parse(localStorage.getItem('eduverse-class-board')||'null');}catch{}if(saved){copy.innerText=saved.content||'Binary search\nEach comparison removes half of the remaining range.';(saved.stickyNotes||[]).forEach(text=>{const note=document.createElement('textarea');note.className='sticky-note';note.maxLength=240;note.placeholder='Add a thought…';note.setAttribute('aria-label','Sticky note text');note.value=text;writing.append(note);});if(saved.ink){const image=new Image();image.onload=()=>{if(canvas.isConnected)canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);};image.src=saved.ink;}const status=document.querySelector('#boardStatus');if(status)status.textContent='Last saved board restored from this device';}resizeClassInk();}
let classAirStream=null,classAirTimer=0,classAirBusy=false,classAirFrame=null,classAirPrevious=null,classAirSmooth=null,classAirInkMode='pen',classAirMouse=false,classAirUndo=[],classAirRedo=[],classAirGestureSince=0,classAirGeneration=0;
function classAirStatus(message){const out=document.querySelector('#classAirStatus');if(out)out.textContent=message;}
function resizeClassInk(){const canvas=document.querySelector('#classInkCanvas');if(!canvas)return;const rect=canvas.getBoundingClientRect();if(rect.width<2||rect.height<2)return;const width=960,height=Math.max(240,Math.round(960*rect.height/rect.width));if(canvas.width===width&&canvas.height===height)return;let prior=null;try{if(canvas.width>300&&canvas.height>150){prior=document.createElement('canvas');prior.width=canvas.width;prior.height=canvas.height;prior.getContext('2d').drawImage(canvas,0,0);}}catch{}canvas.width=width;canvas.height=height;if(prior)canvas.getContext('2d').drawImage(prior,0,0,width,height);classAirUndo=[];classAirRedo=[];classInkUpdateHistory();classAirPrevious=null;}
function restoreClassInk(){const canvas=document.querySelector('#classInkCanvas');if(!canvas)return;let saved;try{saved=JSON.parse(localStorage.getItem('eduverse-class-board')||'null');}catch{return;}if(!saved?.ink)return;const image=new Image();image.onload=()=>{if(canvas.isConnected){resizeClassInk();canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);}};image.src=saved.ink;}
function classInkSnapshot(){const canvas=document.querySelector('#classInkCanvas');try{return canvas?.getContext('2d').getImageData(0,0,canvas.width,canvas.height)||null;}catch{return null;}}
function classInkSaveUndo(){const snapshot=classInkSnapshot();if(!snapshot)return;classAirUndo.push(snapshot);if(classAirUndo.length>12)classAirUndo.shift();classAirRedo=[];classInkUpdateHistory();}
function classInkUpdateHistory(){const undo=document.querySelector('#classInkUndo'),redo=document.querySelector('#classInkRedo');if(undo)undo.disabled=!classAirUndo.length;if(redo)redo.disabled=!classAirRedo.length;}
function classInkRestore(from,to){const canvas=document.querySelector('#classInkCanvas'),ctx=canvas?.getContext('2d');if(!ctx||!from.length)return;const current=classInkSnapshot();if(current)to.push(current);ctx.putImageData(from.pop(),0,0);classInkUpdateHistory();classAirPrevious=null;}
function setClassInkTool(mode){classAirInkMode=mode==='eraser'?'eraser':'pen';classAirPrevious=null;}
function drawClassInk(x,y){const canvas=document.querySelector('#classInkCanvas'),ctx=canvas?.getContext('2d');if(!ctx)return;const rect=canvas.getBoundingClientRect(),scale=canvas.width/rect.width,px=x*canvas.width,py=y*canvas.height;if(!classAirPrevious){classInkSaveUndo();ctx.beginPath();ctx.arc(px,py,Math.max(1,Number(document.querySelector('#classInkSize')?.value||7)*scale/2),0,Math.PI*2);ctx.fillStyle=document.querySelector('#classInkColor')?.value||'#332f46';ctx.globalCompositeOperation=classAirInkMode==='eraser'?'destination-out':'source-over';ctx.fill();classAirPrevious={x:px,y:py};return;}const nx=classAirPrevious.x+(px-classAirPrevious.x)*.62,ny=classAirPrevious.y+(py-classAirPrevious.y)*.62;ctx.beginPath();ctx.moveTo(classAirPrevious.x,classAirPrevious.y);ctx.quadraticCurveTo(classAirPrevious.x,classAirPrevious.y,(classAirPrevious.x+nx)/2,(classAirPrevious.y+ny)/2);ctx.lineWidth=Math.max(1,Number(document.querySelector('#classInkSize')?.value||7)*scale*(classAirInkMode==='eraser'?2.4:1));ctx.lineCap='round';ctx.lineJoin='round';ctx.globalCompositeOperation=classAirInkMode==='eraser'?'destination-out':'source-over';ctx.strokeStyle=document.querySelector('#classInkColor')?.value||'#332f46';ctx.stroke();classAirPrevious={x:nx,y:ny};}
function showClassInkCursor(x,y){const canvas=document.querySelector('#classInkCanvas'),cursor=document.querySelector('#classInkCursor');if(!canvas||!cursor)return;const rect=canvas.getBoundingClientRect();cursor.hidden=false;cursor.style.left=`${Math.max(0,Math.min(1,x))*rect.width}px`;cursor.style.top=`${Math.max(0,Math.min(1,y))*rect.height}px`;}
async function startClassAirCamera(){const status=document.querySelector('#classAirStatus'),video=document.querySelector('#classAirVideo'),canvas=document.querySelector('#classInkCanvas');if(!video||!canvas)return;if(!navigator.mediaDevices?.getUserMedia){classAirStatus('This browser cannot access a camera. Use mouse or touch drawing instead.');return;}const generation=++classAirGeneration;if(status)status.textContent='Checking the local hand tracker and requesting camera access…';try{const health=await fetch(`${OPENCV_URL}/health`,{cache:'no-store'});if(!health.ok)throw new Error('Local OpenCV service is unavailable');const tracker=await fetch(`${OPENCV_URL}/hands/status`,{cache:'no-store'});const state=await tracker.json();if(!tracker.ok||!state.available)throw new Error(state.reason||'MediaPipe hand tracking is unavailable. Install the optional MediaPipe environment and restart the service.');if(generation!==classAirGeneration||!document.querySelector('#classAirVideo'))return;const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640,max:960},height:{ideal:480,max:720}},audio:false});if(generation!==classAirGeneration||!document.querySelector('#classAirVideo')){stream.getTracks().forEach(track=>track.stop());return;}classAirStream=stream;video.srcObject=classAirStream;await video.play();resizeClassInk();document.querySelector('#classAirPreview').hidden=false;document.querySelector('#classAirStart').disabled=true;document.querySelector('#classAirStop').disabled=false;classAirMouse=false;canvas.classList.remove('mouse-enabled');document.querySelector('#classInkMouse')?.setAttribute('aria-pressed','false');classAirPrevious=null;classAirSmooth=null;classAirGestureSince=0;classAirStatus('Camera on · hold one raised index finger steady to write. Open palm moves without ink; close your hand to lift the pen.');trackClassAirFrame();}catch(error){if(generation!==classAirGeneration)return;if(classAirStream)classAirStream.getTracks().forEach(track=>track.stop());classAirStream=null;video.srcObject=null;document.querySelector('#classAirPreview').hidden=true;document.querySelector('#classAirStart').disabled=false;document.querySelector('#classAirStop').disabled=true;classAirStatus(error.name==='NotAllowedError'?'Camera permission was denied. Allow camera access in browser settings, or use mouse/touch drawing.':error.name==='NotFoundError'?'No camera was found. Connect a camera, or use mouse/touch drawing.':`${error.message}. You can still use mouse/touch drawing.`);}}
function stopClassAirCamera(message='Camera stopped. Ink remains on the board.'){classAirGeneration++;if(classAirStream)classAirStream.getTracks().forEach(track=>track.stop());classAirStream=null;clearTimeout(classAirTimer);classAirBusy=false;classAirPrevious=null;classAirSmooth=null;const video=document.querySelector('#classAirVideo');if(video)video.srcObject=null;const preview=document.querySelector('#classAirPreview');if(preview)preview.hidden=true;const start=document.querySelector('#classAirStart');if(start)start.disabled=false;const stop=document.querySelector('#classAirStop');if(stop)stop.disabled=true;const cursor=document.querySelector('#classInkCursor');if(cursor)cursor.hidden=true;if(document.querySelector('#classAirStatus'))classAirStatus(message);}
async function trackClassAirFrame(){const video=document.querySelector('#classAirVideo'),canvas=document.querySelector('#classInkCanvas');if(!classAirStream||!video||!canvas)return;if(!classAirBusy&&video.readyState>=2){classAirBusy=true;try{if(!classAirFrame)classAirFrame=document.createElement('canvas');const width=320,height=Math.round(320*(video.videoHeight/video.videoWidth||.75));if(classAirFrame.width!==width)classAirFrame.width=width;if(classAirFrame.height!==height)classAirFrame.height=height;classAirFrame.getContext('2d',{alpha:false}).drawImage(video,0,0,width,height);const blob=await new Promise(resolve=>classAirFrame.toBlob(resolve,'image/jpeg',.66));if(!blob)throw new Error('Could not read a camera frame');const response=await fetch(`${OPENCV_URL}/hands`,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob});if(!response.ok)throw new Error('Local hand tracking request failed');const data=await response.json();if(data.available===false)throw new Error(data.reason||'Hand tracking is unavailable');const hand=data.hands?.length===1?data.hands[0]:null;if(hand?.landmarks?.[8]){const target={x:hand.landmarks[8][0],y:hand.landmarks[8][1]};classAirSmooth=classAirSmooth?{x:classAirSmooth.x*.42+target.x*.58,y:classAirSmooth.y*.42+target.y*.58}:target;showClassInkCursor(classAirSmooth.x,classAirSmooth.y);const drawing=hand.gesture==='ONE_FINGER'&&Number(hand.gestureConfidence||0)>=.62;if(drawing){if(!classAirGestureSince)classAirGestureSince=performance.now();if(performance.now()-classAirGestureSince>=80)drawClassInk(classAirSmooth.x,classAirSmooth.y);classAirStatus(`Hand tracked · index finger ${classAirInkMode==='eraser'?'erasing ink':'writing'} · ${Math.round((hand.score||0)*100)}% confidence`);}else{classAirGestureSince=0;classAirPrevious=null;classAirStatus(hand.gesture==='OPEN_PALM'?'Open hand · move the cursor without drawing.':`Hand tracked · ${String(hand.gesture||'').replaceAll('_',' ').toLowerCase()} · raise only your index finger to write.`);}}else{classAirGestureSince=0;classAirPrevious=null;classAirSmooth=null;const cursor=document.querySelector('#classInkCursor');if(cursor)cursor.hidden=true;classAirStatus(data.handCount>1?'More than one hand detected · show one hand at a time.':'No hand detected · hold one hand clearly inside the camera frame.');}}catch(error){stopClassAirCamera(`Hand tracking stopped: ${error.message}. Check the local OpenCV service and retry.`);}finally{classAirBusy=false;}}if(classAirStream)classAirTimer=setTimeout(trackClassAirFrame,70);}
document.addEventListener('click',e=>{if(e.target.id==='classAirStart')startClassAirCamera();if(e.target.id==='classAirStop')stopClassAirCamera();if(e.target.id==='classInkMouse'){classAirMouse=!classAirMouse;if(classAirMouse&&classAirStream)stopClassAirCamera('Camera stopped · mouse/touch drawing enabled.');document.querySelector('#classInkCanvas')?.classList.toggle('mouse-enabled',classAirMouse);e.target.setAttribute('aria-pressed',String(classAirMouse));e.target.textContent=classAirMouse?'✓ Mouse / touch on':'Use mouse / touch';classAirPrevious=null;}if(e.target.id==='classInkUndo')classInkRestore(classAirUndo,classAirRedo);if(e.target.id==='classInkRedo')classInkRestore(classAirRedo,classAirUndo);if(e.target.id==='classInkClear'){const canvas=document.querySelector('#classInkCanvas');if(canvas){classInkSaveUndo();canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);}classAirPrevious=null;classAirStatus('Ink cleared. Board text remains unchanged.');}if(e.target.id==='classInkDownload'){const canvas=document.querySelector('#classInkCanvas');if(!canvas)return;try{const out=document.createElement('canvas');out.width=canvas.width;out.height=canvas.height;const ctx=out.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,out.width,out.height);ctx.drawImage(canvas,0,0);const link=document.createElement('a');link.download='eduverse-class-whiteboard.png';link.href=out.toDataURL('image/png');link.click();}catch{classAirStatus('Could not export the whiteboard image in this browser.');}}});
let classInkPointerDown=false;document.addEventListener('pointerdown',e=>{if(e.target?.id!=='classInkCanvas'||!classAirMouse)return;classInkPointerDown=true;e.target.setPointerCapture(e.pointerId);const rect=e.target.getBoundingClientRect();classAirPrevious=null;drawClassInk((e.clientX-rect.left)/rect.width,(e.clientY-rect.top)/rect.height);});document.addEventListener('pointermove',e=>{if(!classInkPointerDown||!classAirMouse)return;const canvas=document.querySelector('#classInkCanvas'),rect=canvas?.getBoundingClientRect();if(!canvas||!rect)return;drawClassInk((e.clientX-rect.left)/rect.width,(e.clientY-rect.top)/rect.height);});document.addEventListener('pointerup',()=>{classInkPointerDown=false;classAirPrevious=null;});
window.addEventListener('resize',()=>{if(document.querySelector('#classInkCanvas'))resizeClassInk();});
async function loadTeacherWorkspace(){try{const {teacherData,classes}=await apiRequest('/teacher');teacherClasses=classes||[];document.querySelectorAll('.teacher-class-select').forEach(select=>select.innerHTML='<option value="">Choose class</option>'+teacherClasses.map(c=>`<option value="${safeText(c.id)}">${safeText(c.name)}</option>`).join(''));if(teacherClasses.length===1){const attendance=document.querySelector('#attendanceClass');if(attendance){attendance.value=teacherClasses[0].id;renderAttendanceRoster(attendance.value);}}renderTeacherRecords('scheduleList',teacherData.schedule,'title','date');renderTeacherRecords('practiceList',teacherData.practice,'topic','question');renderTeacherRecords('testList',teacherData.tests,'title','duration');renderTeacherDashboard(teacherData,teacherClasses);
  loadSoonBanner('teacherSoonBanner');}catch{const target=document.querySelector('#attendanceRoster');if(target)target.innerHTML='<p class="api-notice">Class tools will load when the local API is running.</p>';}}
function renderTeacherDashboard(data,classes){const $=s=>document.querySelector(s),sessions=data.schedule||[],practice=data.practice||[],tests=data.tests||[],students=[...new Set(classes.flatMap(c=>c.students||[]).map(s=>s.id))];$('#teacherDateChip')?.replaceChildren(document.createTextNode(new Date().toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})));$('#teacherClassCount')?.replaceChildren(String(classes.length));$('#teacherLessonCount')?.replaceChildren(String(sessions.length));$('#teacherAssessmentCount')?.replaceChildren(String(practice.length+tests.length));$('#teacherStudentCount')?.replaceChildren(String(students.length));const focus=$('#teacherFocusTitle'),copy=$('#teacherFocusCopy');if(focus)focus.textContent=classes[0]?.name||'No class assigned yet';if(copy)copy.textContent=classes[0]?`${classes[0].students?.length||0} learners · ${classes[0].subject||'General'} · class roster and actions are ready.`:'An administrator can assign classes and learners to your teacher account.';const notice=$('#teacherClassNotice');if(notice)notice.textContent=classes.length?'Your classes, attendance records, and learner roster are private to your account.':'Your teacher account is approved. Ask an administrator to create a class and enroll learners.';const preview=$('#teacherSchedulePreview');if(preview)preview.innerHTML=sessions.slice(0,4).map(item=>`<div class="teacher-agenda-row"><span>${safeText(item.time||'—')}</span><div><b>${safeText(item.title||'Class session')}</b><small>${safeText(item.course||'Class')} · ${safeText(item.date||'Scheduled')}</small></div></div>`).join('')||'<p class="panel-copy">No sessions scheduled yet. Use Schedule class below to add the first one.</p>';}
document.addEventListener('click',e=>{const jump=e.target.closest('[data-teacher-jump]');if(jump)document.querySelector(jump.dataset.teacherJump)?.scrollIntoView({behavior:'smooth',block:'center'});});
function renderTeacherRecords(id,items,label,detail){const root=document.querySelector('#'+id);if(!root)return;root.innerHTML=(items||[]).slice(0,3).map(item=>`<div class="teacher-record"><b>${safeText(item[label]||'Class activity')}</b><small>${safeText(item[detail]||'Saved')}${detail==='duration'&&item.attempts?.length?` · ${item.attempts.length} submissions`:''}</small></div>`).join('');}
async function saveTeacherItem(kind,data){try{await apiRequest(`/teacher/${kind}`,{method:'POST',body:JSON.stringify(data)});loadTeacherWorkspace();return true;}catch{return false;}}
/* ---------- Global search (Slice D) ---------- */
const searchState={timer:null,items:[],activeIdx:-1,open:false};
function searchIconFor(type){return type==='course'?'\u25a4':type==='lesson'?'\u25b6':type==='quiz'?'\u2710':'\u2726';}
function searchGroupLabel(type){return type==='course'?'COURSES':type==='lesson'?'LESSONS':type==='quiz'?'QUIZZES':'RESULTS';}
async function runGlobalSearch(q){
  const box=document.querySelector('#searchResults'),input=document.querySelector('#globalSearch');
  if(!box||!input)return;
  q=(q||'').trim();
  if(q.length<2){box.hidden=true;box.innerHTML='';input.setAttribute('aria-expanded','false');searchState.open=false;searchState.items=[];return;}
  try{
    const d=await apiRequest('/search?q='+encodeURIComponent(q));
    const results=(d&&d.results)||[];
    searchState.items=results;searchState.activeIdx=-1;
    if(!results.length){box.innerHTML='<div class="search-empty">No matches for \u201c'+safeText(q)+'\u201d.</div>';}
    else{
      const groups={};
      results.forEach(r=>{(groups[r.type]=groups[r.type]||[]).push(r);});
      box.innerHTML=['course','lesson','quiz'].filter(t=>groups[t]).map(t=>
        '<div class="search-group">'+searchGroupLabel(t)+'</div>'+
        groups[t].map(r=>{const idx=searchState.items.indexOf(r);
          return '<button type="button" class="search-item" role="option" id="searchOpt'+idx+'" data-search-idx="'+idx+'" aria-selected="false"><span class="search-kind">'+searchIconFor(r.type)+'</span><span><b>'+safeText(r.title||'Untitled')+'</b><small>'+safeText(r.subtitle||r.type)+'</small></span></button>';}).join('')
      ).join('');
    }
    box.hidden=false;input.setAttribute('aria-expanded','true');searchState.open=true;
  }catch(err){box.hidden=true;input.setAttribute('aria-expanded','false');searchState.open=false;}
}
function closeGlobalSearch(){const box=document.querySelector('#searchResults'),input=document.querySelector('#globalSearch');if(box){box.hidden=true;box.innerHTML='';}if(input)input.setAttribute('aria-expanded','false');searchState.open=false;searchState.activeIdx=-1;}
function highlightSearchItem(){
  document.querySelectorAll('#searchResults .search-item').forEach((el,i)=>{
    const on=i===searchState.activeIdx;el.classList.toggle('active',on);el.setAttribute('aria-selected',on?'true':'false');
    if(on){try{if(el.scrollIntoView)el.scrollIntoView({block:'nearest'});}catch(e){}const gi=document.querySelector('#globalSearch');if(gi)gi.setAttribute('aria-activedescendant',el.id);}
  });
  if(searchState.activeIdx<0){const gi=document.querySelector('#globalSearch');if(gi)gi.removeAttribute('aria-activedescendant');}
}
function activateSearchResult(idx){
  const r=searchState.items[idx];if(!r)return;closeGlobalSearch();
  const inp=document.querySelector('#globalSearch');if(inp)inp.value='';
  if(r.type==='course'){lmsState.courseId=r.id;navigate('course-detail');}
  else if(r.type==='lesson'){if(r.courseId)lmsState.courseId=r.courseId;lmsState.lessonId=r.id;navigate('video-player');}
  else if(r.type==='quiz'){lmsState.quizId=r.id;navigate('quiz-take');}
  window.scrollTo({top:0});
}
function initGlobalSearch(){
  const input=document.querySelector('#globalSearch');if(!input||input.dataset.searchInit)return;input.dataset.searchInit='1';
  input.addEventListener('input',()=>{clearTimeout(searchState.timer);searchState.timer=setTimeout(()=>runGlobalSearch(input.value),280);});
  input.addEventListener('keydown',e=>{
    const n=searchState.items.length;
    if(e.key==='ArrowDown'&&searchState.open&&n){e.preventDefault();searchState.activeIdx=(searchState.activeIdx+1)%n;highlightSearchItem();}
    else if(e.key==='ArrowUp'&&searchState.open&&n){e.preventDefault();searchState.activeIdx=(searchState.activeIdx-1+n)%n;highlightSearchItem();}
    else if(e.key==='Enter'){if(searchState.open&&searchState.activeIdx>=0){e.preventDefault();activateSearchResult(searchState.activeIdx);}}
    else if(e.key==='Escape'){closeGlobalSearch();input.blur();}
  });
  input.addEventListener('focus',()=>{if(input.value.trim().length>=2)runGlobalSearch(input.value);});
  document.addEventListener('click',e=>{
    const item=e.target.closest('#searchResults .search-item');
    if(item){activateSearchResult(Number(item.dataset.searchIdx));return;}
    if(!e.target.closest('.header-search'))closeGlobalSearch();
  });
  document.addEventListener('focusin',e=>{if(!e.target.closest('.header-search'))closeGlobalSearch();});
}

/* ---------- Notifications (Slice D: kinds, links, badge) ---------- */
const NOTIF_ICONS={'fee_assigned':'\u20b9','fee':'\u20b9','quiz_graded':'\u2713','quiz':'\u2710','live_class':'\u25cf','live':'\u25cf','marketplace':'\u25c8','purchase':'\u25c8','announcement':'\u2667','assignment':'\u25a7'};
function notifIcon(n){const k=String(n.kind||'').toLowerCase();if(NOTIF_ICONS[k])return NOTIF_ICONS[k];for(const key of Object.keys(NOTIF_ICONS)){if(k.indexOf(key)===0)return NOTIF_ICONS[key];}const t=String(n.title||'').toLowerCase();if(t.includes('assignment'))return '\u25a7';if(t.includes('fee')||t.includes('payment'))return '\u20b9';if(t.includes('quiz')||t.includes('graded'))return '\u2713';if(t.includes('live')||t.includes('class'))return '\u25cf';if(t.includes('marketplace')||t.includes('purchase'))return '\u25c8';return '\u2726';}
function notifDate(n){const d=n.createdAt||n.date;if(!d)return '';try{return new Date(d).toLocaleString();}catch(e){return String(d);}}
function notifLinkFor(n){if(n.link)return String(n.link);return null;}
function notifScreenFor(n){
  const k=String(n.kind||'').toLowerCase();
  if(k.indexOf('fee')===0)return 'fees';
  if(k.indexOf('quiz')===0)return 'quizzes';
  if(k.indexOf('live')===0)return 'live-classes';
  if(k.indexOf('marketplace')===0||k.indexOf('purchase')===0)return 'marketplace';
  return null;
}
async function updateNotifBadge(){
  const badge=document.querySelector('#notifBadge'),btn=document.querySelector('#notificationBtn');
  if(!badge||!btn)return;
  try{
    const res=await apiRequest('/notifications');
    const unread=((res&&res.notifications)||[]).filter(n=>!n.read).length;
    if(unread>0){badge.hidden=false;badge.textContent=unread>99?'99+':String(unread);btn.setAttribute('aria-label','Notifications, '+unread+' unread');}
    else{badge.hidden=true;badge.textContent='';btn.setAttribute('aria-label','Notifications');}
  }catch(e){badge.hidden=true;}
}
async function loadNotifications(){const root=document.querySelector('#notificationList');if(!root)return;try{const resN=await apiRequest('/notifications');const notifications=resN.notifications||[];const announcements=currentUser&&currentUser.role==='student'?(await apiRequest('/teacher/announcements')).announcements||[]:[];const noticeMarkup=notifications.map(n=>{const body=n.body||n.message||'';const link=notifLinkFor(n),screen=notifScreenFor(n);const linkHtml=link?'<a class="notif-link" href="'+safeText(link)+'">Open \u2192</a>':screen?'<button type="button" class="notif-link" data-notif-screen="'+screen+'">Open \u2192</button>':'';return '<article class="notification-card '+(n.read?'read':'')+'"><div class="notification-icon">'+notifIcon(n)+'</div><div><b>'+safeText(n.title)+'</b><p>'+safeText(body)+'</p><small>'+safeText(notifDate(n))+'</small>'+linkHtml+'</div><button data-notice="'+safeText(n.id)+'" '+(n.read?'disabled':'')+'>'+(n.read?'Read':'Mark read')+'</button></article>';});const announcementMarkup=announcements.map(a=>'<article class="notification-card"><div class="notification-icon">\u2667</div><div><b>Class announcement \u00b7 '+safeText(a.className)+'</b><p>'+safeText(a.message)+'</p><small>'+new Date(a.createdAt).toLocaleString()+'</small></div></article>');root.innerHTML=announcementMarkup.concat(noticeMarkup).join('')||'<div class="screen-panel">You are all caught up.</div>';updateNotifBadge();}catch(e){root.innerHTML='<p class="api-notice">Start the local API to load notifications.</p>';}}
async function loadResources(query='',type='') {const root=document.querySelector('#resourceList');if(!root)return;try{const {resources}=await apiRequest(`/resources?q=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}`);root.innerHTML=resources.map(r=>`<button class="resource" data-resource="${safeText(r.id)}"><span class="resource-icon">${r.type==='Video'?'▶':r.type==='Interactive practice'?'◎':'▤'}</span><span><b>${safeText(r.title)}</b><small>${safeText(r.type)} · ${safeText(r.duration)} · ${safeText(r.course)}</small><small>${safeText(r.summary)}</small></span></button>`).join('')||'<p class="panel-copy">No library resources match your search.</p>';}catch{}}
async function openResource(id){try{const {resource:r}=await apiRequest(`/resources/${encodeURIComponent(id)}`);const saved=JSON.parse(localStorage.getItem('eduverse-reading-list')||'[]');openModal(`<h2 id="modalTitle">${safeText(r.title)}</h2><p><b>${safeText(r.course)} · ${safeText(r.type)} · ${safeText(r.duration)}</b></p><div class="resource-body">${safeText(r.body)}</div><button class="primary-btn" id="bookmarkResource" data-id="${safeText(r.id)}">${saved.includes(r.id)?'✓ Saved to reading list':'☆ Save to reading list'}</button>`);}catch{openModal('<h2 id="modalTitle">Resource unavailable</h2><p>Start the local API to open this library item.</p>');}}
async function showWorkspaceDetails(){try{const {profile:p}=await apiRequest('/profile');const role={student:'Student',teacher:'Teacher',admin:'Administrator'}[p.role]||'Student';const code=(p.accountId||p.id);openModal(`<h2 id="modalTitle">${safeText(p.name)}’s workspace</h2><p>Account details for this EduVerse account.</p><div class="detail-table"><div><span>Role</span><b>${role}</b></div><div><span>Account ID</span><b>${safeText(code)}</b></div><div><span>Age</span><b>${safeText(p.age||'Not provided')}</b></div><div><span>Belongs to</span><b>${safeText(p.institution||'Personal workspace')}</b></div><div><span>Joined</span><b>${p.joinedAt?new Date(p.joinedAt+'T12:00:00').toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'}):'Not available'}</b></div></div>`);}catch{openModal('<h2 id="modalTitle">Workspace details</h2><p>Start the EduVerse API to load this profile.</p>');}}
document.querySelector('#workspaceDetails')?.addEventListener('click',showWorkspaceDetails);
document.querySelector('#notificationBtn')?.addEventListener('click',()=>navigate('notifications'));
initGlobalSearch();updateNotifBadge();setInterval(updateNotifBadge,60000);
document.querySelector('#chatLauncher')?.addEventListener('click',openNovaChat);
document.addEventListener('click',e=>{if(e.target.closest('#openNova'))openNovaChat();});
document.addEventListener('click',async e=>{
 if(e.target.closest('[data-resource]')){openResource(e.target.closest('[data-resource]').dataset.resource);}
 const lang=e.target.closest('.language-card');if(lang){const title=lang.querySelector('b').textContent,desc=lang.querySelector('small').textContent;openModal(`<h2 id="modalTitle">${safeText(title)}</h2><p>${safeText(desc)}.</p><div class="response teach">Start with the matching course path, then practise by building a small project in the EduVerse lab.</div><button class="primary-btn" data-screen="syllabus">Explore learning path →</button>`);}
 if(e.target.matches('[data-community-moderate]')){try{await apiRequest(`/admin/community/reports/${encodeURIComponent(e.target.dataset.report)}`,{method:'PATCH',body:JSON.stringify({action:e.target.dataset.communityModerate})});await loadCommunityReports();}catch(err){alert(err.message||'Could not update this report.');}}
 if(e.target.matches('[data-notice]')){try{await apiRequest(`/notifications/${encodeURIComponent(e.target.dataset.notice)}/read`,{method:'POST'});loadNotifications();}catch{}}
 const ns=e.target.closest('[data-notif-screen]');if(ns){navigate(ns.dataset.notifScreen);window.scrollTo({top:0});return;}
 if(e.target.id==='bookmarkResource'){const id=e.target.dataset.id;const list=JSON.parse(localStorage.getItem('eduverse-reading-list')||'[]');if(!list.includes(id))list.push(id);localStorage.setItem('eduverse-reading-list',JSON.stringify(list));e.target.textContent='✓ Saved to reading list';}
 if(e.target.id==='saveAttendance'){const attendance=[...document.querySelectorAll('#attendanceRoster [data-student-id]')].map(s=>({studentId:s.dataset.studentId,status:s.value}));const ok=await saveTeacherItem('attendance',{classId:document.querySelector('#attendanceClass')?.value,date:new Date().toISOString().slice(0,10),attendance});e.target.textContent=ok?'Attendance saved ✓':'Could not save · start API';}
 if(e.target.matches('[data-lesson]')){const idx=Number(e.target.dataset.lesson);setLesson(idx);}
 if(e.target.id==='lessonNext'){setLesson(Math.min(3,lessonIndex+1));}
 if(e.target.id==='lessonPrev'){setLesson(Math.max(0,lessonIndex-1));}
 if(e.target.id==='lessonPlay'){const playing=e.target.dataset.playing==='true';e.target.dataset.playing=String(!playing);e.target.textContent=playing?'▶':'Ⅱ';const state=document.querySelector('#playState');if(playing){clearInterval(lessonTimer);if(state)state.textContent='Paused · resume when ready';}else{if(state)state.textContent='Walkthrough playing · lesson step updates every 4 seconds';lessonTimer=setInterval(()=>{if(lessonIndex>=3){clearInterval(lessonTimer);e.target.dataset.playing='false';e.target.textContent='▶';if(state)state.textContent='Walkthrough complete · try the quick check';return;}setLesson(lessonIndex+1);},4000);}}
 if(e.target.matches('[data-start-test]'))startTest(e.target.dataset.startTest);
});
let lessonIndex=1;
function setLesson(index){lessonIndex=index;const info=[['The sorted array','Binary search needs an ordered list. Sorting is the prerequisite that makes each comparison useful.'],['Why can we discard half?','Compare the target with the midpoint. The sort order proves which half cannot contain the answer.'],['Time complexity','Each step roughly halves the remaining range, so the number of comparisons grows with log₂(n).'],['Quick check','For target 21 and midpoint 17, move the lower boundary to 18. Try the challenge to check your understanding.']][index];const title=document.querySelector('#currentLessonTitle'),text=document.querySelector('#currentLessonText');if(title)title.textContent=info[0];if(text)text.textContent=info[1];const page=document.querySelector('#lessonPage');if(page)page.textContent=`${index+1} / 5`;const prev=document.querySelector('#lessonPrev'),next=document.querySelector('#lessonNext');if(prev)prev.disabled=index===0;if(next)next.textContent=index===3?'Quick check →':'Next →';document.querySelectorAll('[data-lesson]').forEach(b=>b.classList.toggle('active',Number(b.dataset.lesson)===index));}
async function loadStudentScheduleView(view){const target=document.querySelector(view==='today'?'#studentTodaySchedule':'#studentTimetable');if(!target)return;try{const {teacherData={},classes=[]}=await apiRequest('/teacher');const today=localDateInput(),classNames=new Map(classes.map(c=>[c.id,c.name]));const rows=(teacherData.schedule||[]).filter(x=>view!=='today'||x.date===today).slice().sort((a,b)=>`${a.date||''} ${a.time||''}`.localeCompare(`${b.date||''} ${b.time||''}`));target.innerHTML=rows.length?rows.map(x=>`<article class=\"schedule-card\"><p class=\"eyebrow\">${safeText(x.date||'Date to be confirmed')} · ${safeText(x.time||'Time to be confirmed')}</p><h2>${safeText(x.title||x.course||'Class session')}</h2><p>${safeText(classNames.get(x.classId)||x.className||'Your class')}${x.course?` · ${safeText(x.course)}`:''}</p></article>`).join(''):`<div class=\"schedule-empty\"><b>${view==='today'?'No classes scheduled for today':'No timetable entries yet'}</b><p>${view==='today'?'Your teacher has not added a session for today.':'Your teachers’ saved class sessions will appear here.'}</p></div>`;}catch{target.innerHTML='<p class=\"api-notice\">Your timetable is unavailable while the EduVerse API is offline.</p>';}}
async function loadStudentTools(){try{const {teacherData}=await apiRequest('/teacher');const target=document.querySelector('#studentTools');if(!target)return;const tests=teacherData.tests||[],practice=teacherData.practice||[];target.innerHTML=`${tests.length?`<section class="screen-panel"><p class="eyebrow">CLASS TESTS</p>${tests.map(t=>`<div class="teacher-record"><b>${safeText(t.title)}</b><small>${safeText(t.duration)} minutes · ${String(t.questions||'').split('\n').length} questions · ${(t.myAttempts||[]).filter(a=>a.grade).map(a=>`Score ${a.grade.score}%`).join(', ')||'Awaiting review'}</small><button class="filter-select" data-start-test="${safeText(t.id)}">Start test →</button></div>`).join('')}</section>`:''}${practice.length?`<section class="screen-panel"><p class="eyebrow">TEACHER PRACTICE</p>${practice.map(p=>`<div class="teacher-record"><b>${safeText(p.topic)}</b><small>${safeText(p.question)}</small><button class="filter-select" data-screen="player">Practice in lesson →</button></div>`).join('')}</section>`:''}`;}catch{}}
function startTest(id){apiRequest('/teacher').then(({teacherData})=>{const test=teacherData.tests.find(t=>t.id===id);if(!test)return;const qs=String(test.questions).split('\n').filter(Boolean);openModal(`<h2 id="modalTitle">${safeText(test.title)}</h2><p>${safeText(test.duration)} minutes · Submit your written answers to your teacher.</p><form id="testAttemptForm" data-id="${safeText(id)}">${qs.map((q,i)=>`<label class="test-question"><b>${i+1}. ${safeText(q)}</b><textarea name="answer${i}" required placeholder="Your answer…"></textarea></label>`).join('')}<button class="primary-btn">Submit test →</button></form>`);}).catch(()=>{});}
document.addEventListener('submit',async e=>{
 if(e.target.id==='scheduleForm'||e.target.id==='practiceForm'||e.target.id==='testForm'){e.preventDefault();const f=new FormData(e.target),kind=e.target.id==='scheduleForm'?'schedule':e.target.id==='practiceForm'?'practice':'tests';const data=Object.fromEntries(f.entries());const ok=await saveTeacherItem(kind,data);const status=document.createElement('p');status.className=ok?'response good':'api-notice';status.textContent=ok?'Saved to your teacher workspace ✓':'Could not save · check that the local API is running';e.target.append(status);if(ok)e.target.reset();}
 if(e.target.id==='feedbackForm'){e.preventDefault();const f=new FormData(e.target);const payload={category:f.get('category'),subject:f.get('subject'),message:f.get('message')};try{await apiRequest('/feedback',{method:'POST',body:JSON.stringify(payload)});document.querySelector('#feedbackStatus').textContent='Thanks — your feedback has been saved.';e.target.reset();}catch{const list=JSON.parse(localStorage.getItem('eduverse-feedback')||'[]');list.unshift({...payload,at:new Date().toISOString()});localStorage.setItem('eduverse-feedback',JSON.stringify(list));document.querySelector('#feedbackStatus').textContent='Saved in this browser. Start the API to sync it.';}}
 if(e.target.matches('.quiz-grade-form')){e.preventDefault();const form=e.target;try{await apiRequest(`/teacher/tests/${encodeURIComponent(form.dataset.test)}/attempts/${encodeURIComponent(form.dataset.attempt)}/grade`,{method:'PATCH',body:JSON.stringify({score:Number(new FormData(form).get('score')),feedback:new FormData(form).get('feedback')})});await loadTeacherWorkspace();}catch(err){form.insertAdjacentHTML('beforeend',`<p class="api-notice">${safeText(err.message||'Could not release quiz score.')}</p>`);}}
 if(e.target.id==='testAttemptForm'){e.preventDefault();const id=e.target.dataset.id,answers=Object.fromEntries(new FormData(e.target).entries());try{await apiRequest(`/teacher/tests/${encodeURIComponent(id)}/attempts`,{method:'POST',body:JSON.stringify({answers})});closeModal();openModal('<h2 id="modalTitle">Test submitted</h2><div class="response good">Your answers have been sent to your teacher for review.</div>');}catch{}}
});
document.addEventListener('input',e=>{if(e.target.id==='librarySearch')loadResources(e.target.value,document.querySelector('#libraryType')?.value||'');});
document.addEventListener('change',e=>{if(e.target.id==='libraryType')loadResources(document.querySelector('#librarySearch')?.value||'',e.target.value);});
document.addEventListener('input',e=>{if(e.target.id==='lessonNote'){localStorage.setItem('eduverse-lesson-note',e.target.value);const s=document.querySelector('#lessonNoteStatus');if(s)s.textContent='Saved on this device';}});
function loadLessonNote(){const note=document.querySelector('#lessonNote');if(note)note.value=localStorage.getItem('eduverse-lesson-note')||'';}
let lessonTimer=null;
const lessonNav=navigate;
navigate=function(name){if(name!=='player'&&lessonTimer)clearInterval(lessonTimer);lessonNav(name);if(name==='player')loadLessonNote();};
document.addEventListener('click',e=>{if(e.target.matches('[data-lesson="3"]'))startChallenge();if(e.target.id==='lessonNext'&&lessonIndex===3)startChallenge();});

document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='guideInput'){e.preventDefault();document.querySelector('#sendGuide')?.click();}});

const OPENCV_URL='http://127.0.0.1:4174';
let drawingStream=null,drawingPrevious=null,drawingSmoothedPoint=null,drawingPaused=false,trackerBusy=false,drawingLoop=0,drawingMissedFrames=0,
drawingPenVotes=0,drawingPenDown=false,drawingLastMid=null,drawingScratch=null;
function makeOneEuroFilter(minCutoff=1.1,beta=0.025,dcutoff=1.0){let x=null,dx=0,t=0;const alpha=(fc,dt)=>1/(1+1/(2*Math.PI*fc*dt));
function filter(v,now){const dt=Math.min(.2,Math.max(.001,(now-t)/1000))||.016;if(x===null){x=v;t=now;return v;}
const d=(v-x)/dt,ad=alpha(dcutoff,dt);dx=dx+(d-dx)*ad;const a=alpha(minCutoff+beta*Math.abs(dx),dt);x=x+(v-x)*a;t=now;return x;}
filter.reset=()=>{x=null;dx=0;t=0;};return filter;}
let drawingFilterX=makeOneEuroFilter(),drawingFilterY=makeOneEuroFilter();
function drawingFilterPoint(px,py,now){return {x:drawingFilterX(px,now),y:drawingFilterY(py,now)};}
function resetDrawingFilter(){drawingFilterX.reset();drawingFilterY.reset();drawingSmoothedPoint=null;}
function updateDrawingPen(wantPen){drawingPenVotes=Math.max(0,Math.min(3,drawingPenVotes+(wantPen?1:-1)));
if(!drawingPenDown&&drawingPenVotes>=2)drawingPenDown=true;
else if(drawingPenDown&&drawingPenVotes<=0){drawingPenDown=false;endDrawingPath();drawingPrevious=null;drawingLastMid=null;resetDrawingFilter();}
return drawingPenDown;}
function resetDrawingPen(){drawingPenVotes=0;drawingPenDown=false;drawingPrevious=null;drawingLastMid=null;resetDrawingFilter();}
function setDrawingStatus(message,online=false){const label=document.querySelector('#cameraStatus');if(label)label.textContent=message;const dot=document.querySelector('#cameraDot');if(dot)dot.classList.toggle('online',online);}
async function checkDrawingService(){const state=document.querySelector('#trackStatus');if(state)state.textContent='Checking local OpenCV connection…';try{const response=await fetch(`${OPENCV_URL}/health`,{cache:'no-store'});if(!response.ok)throw new Error(`HTTP ${response.status}`);const service=await response.json();if(state)state.textContent=service.ok?'OpenCV connected · press Start camera and allow webcam access':'OpenCV service did not confirm readiness';setDrawingStatus(service.ok?'OpenCV is ready · camera has not started yet':'OpenCV service is not ready',Boolean(service.ok));}catch(error){if(state)state.textContent='Cannot reach OpenCV at 127.0.0.1:4174. Start opencv-drawing/server.py, then refresh.';setDrawingStatus('OpenCV connection failed · check the Python service',false);}}
let drawingUsesLandmarks=false;async function beginWebcamDrawing(){const video=document.querySelector('#drawingVideo'),canvas=document.querySelector('#drawingCanvas');if(!video||!canvas)return;const state=document.querySelector('#trackStatus');if(!navigator.mediaDevices?.getUserMedia){if(state)state.textContent='Camera access is unavailable here. Open this page in a browser that allows webcam access.';setDrawingStatus('This browser context cannot access the webcam.',false);return;}try{const health=await fetch(`${OPENCV_URL}/health`);if(!health.ok)throw new Error('OpenCV service is unavailable');try{const response=await fetch(`${OPENCV_URL}/hands/status`);drawingUsesLandmarks=response.ok&&Boolean((await response.json()).available);}catch{drawingUsesLandmarks=false;}if(!drawingUsesLandmarks){if(state)state.textContent='MediaPipe hand tracking is unavailable. Use Python 3.12 and install requirements-mediapipe.txt, then restart the local service.';setDrawingStatus('MediaPipe is required for one-finger writing.',false);return;}}catch{if(state)state.textContent='OpenCV service is not reachable at 127.0.0.1:4174. Start the Python service, then try again.';setDrawingStatus('Python OpenCV service is offline · see setup instructions.',false);return;}try{drawingStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640,max:1280},height:{ideal:480,max:720}},audio:false});video.srcObject=drawingStream;await video.play();const cameraWidth=video.videoWidth||640,cameraHeight=video.videoHeight||480;if(canvas.width!==cameraWidth||canvas.height!==cameraHeight){canvas.width=cameraWidth;canvas.height=cameraHeight;drawingUndo=[];drawingRedo=[];setDrawingHistoryButtons();}canvas.classList.add('active');document.querySelector('.drawing-stage')?.classList.add('camera-on');document.querySelector('#drawingPrompt').hidden=true;document.querySelector('#startCamera').textContent='Stop camera';document.querySelector('#pauseDrawing').disabled=false;resetDrawingPen();drawingPaused=false;document.querySelector('#pauseDrawing').textContent='Ⅱ Pause drawing';setDrawingStatus('Camera on · frames are processed locally',true);if(state)state.textContent=drawingUsesLandmarks?'MediaPipe connected · raise only your index finger to draw; show all five fingers to lift the pen':'OpenCV connected · contour tracking active; show one hand clearly and move your fingertip';trackWebcamFrame();}catch(error){if(drawingStream)drawingStream.getTracks().forEach(track=>track.stop());drawingStream=null;video.srcObject=null;document.querySelector('.drawing-stage')?.classList.remove('camera-on');canvas.classList.remove('active');document.querySelector('#drawingPrompt').hidden=false;setDrawingStatus(error.name==='NotAllowedError'?'Camera permission was denied. Allow camera access in your browser settings.':error.name==='NotFoundError'?'No webcam was found. Connect a camera and try again.':`Camera could not start: ${error.message}`,false);if(state)state.textContent=error.name==='NotAllowedError'?'Allow camera permission, then press Start camera again.':'Check the webcam and browser permissions, then retry.';}}
function stopWebcamDrawing(){if(drawingStream)drawingStream.getTracks().forEach(track=>track.stop());drawingStream=null;clearTimeout(drawingLoop);const v=document.querySelector('#drawingVideo');if(v)v.srcObject=null;const c=document.querySelector('#drawingCanvas');if(c)c.classList.remove('active');const sketch=document.querySelector('#sketchCanvas');if(sketch){sketch.classList.remove('active');sketch.hidden=true;}document.querySelector('.drawing-stage')?.classList.remove('camera-on');const handPointer=document.querySelector('#handPointer');if(handPointer)handPointer.hidden=true;const prompt=document.querySelector('#drawingPrompt');if(prompt)prompt.hidden=false;const start=document.querySelector('#startCamera');if(start)start.textContent='Start camera';const pause=document.querySelector('#pauseDrawing');if(pause)pause.disabled=true;resetDrawingPen();setDrawingStatus('Camera off · press Start camera when you are ready.',false);const track=document.querySelector('#trackStatus');if(track)track.textContent='Camera stopped · your saved drawing stays on this page.';}
let drawingEraser=false,mouseDrawing=false,drawingStrokeCount=0,drawingPath=[],drawingPaths=[],sketchBusy=false,sketchFrameIndex=0,drawingUndo=[],drawingRedo=[],drawingLastGesture='',drawingGestureSince=0,drawingGestureFired='',drawingGestureMessage='';
function setDrawingHistoryButtons(){const undo=document.querySelector('#undoDrawing'),redo=document.querySelector('#redoDrawing');if(undo)undo.disabled=!drawingUndo.length;if(redo)redo.disabled=!drawingRedo.length;}
function snapshotDrawing(){const canvas=document.querySelector('#drawingCanvas');if(!canvas?.width||!canvas?.height)return null;try{return canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);}catch{return null;}}
function saveDrawingUndo(){const state=snapshotDrawing();if(!state)return;drawingUndo.push(state);if(drawingUndo.length>8)drawingUndo.shift();drawingRedo=[];setDrawingHistoryButtons();}
function restoreDrawingState(from,to){const canvas=document.querySelector('#drawingCanvas'),ctx=canvas?.getContext('2d');if(!ctx||!from.length)return;const current=snapshotDrawing();if(current)to.push(current);const next=from.pop();ctx.putImageData(next,0,0);setDrawingHistoryButtons();}
function handleDrawingGesture(hand){const now=Date.now(),gesture=hand?.gesture||'UNKNOWN';if(gesture!==drawingLastGesture){drawingLastGesture=gesture;drawingGestureSince=now;drawingGestureFired='';return;}if(now-drawingGestureSince<280||drawingGestureFired===gesture||Number(hand?.gestureConfidence||0)<.55)return;const color=document.querySelector('#brushColor'),size=document.querySelector('#brushSize');if(gesture==='TWO_FINGERS'&&color){const palette=['#7b61dc','#ef6c79','#24a899','#ed9c3d','#2f80ed'];const next=(palette.indexOf(color.value.toLowerCase())+1)%palette.length;color.value=palette[next];drawingGestureMessage=`Color changed to ${color.value}`;}else if(gesture==='FIST'){drawingEraser=!drawingEraser;const pen=document.querySelector('#penDrawing'),eraser=document.querySelector('#eraserDrawing');pen?.classList.toggle('selected',!drawingEraser);eraser?.classList.toggle('selected',drawingEraser);pen?.setAttribute('aria-pressed',String(!drawingEraser));eraser?.setAttribute('aria-pressed',String(drawingEraser));drawingGestureMessage=drawingEraser?'Eraser on':'Pen on';}else if(gesture==='THUMBS_UP'&&size){size.value=String(Math.min(24,Number(size.value)+2));drawingGestureMessage=`Brush ${size.value} px`;}else if(gesture==='THUMBS_DOWN'&&size){size.value=String(Math.max(2,Number(size.value)-2));drawingGestureMessage=`Brush ${size.value} px`;}else return;drawingGestureFired=gesture;}
function endDrawingPath(){if(drawingPath.length>8){drawingPaths.push(drawingPath);if(drawingPaths.length>80)drawingPaths.shift();}drawingPath=[];}
function simplifyPath(points,epsilon){if(points.length<3)return points;const first=points[0],last=points.at(-1);if(Math.hypot(last.x-first.x,last.y-first.y)<epsilon&&points.length>4){let far=1,dist=0;for(let i=1;i<points.length-1;i++){const d=Math.hypot(points[i].x-first.x,points[i].y-first.y);if(d>dist){dist=d;far=i;}}const left=simplifyPath(points.slice(0,far+1),epsilon),right=simplifyPath(points.slice(far),epsilon);return left.concat(right.slice(1));}const dx=last.x-first.x,dy=last.y-first.y,den=Math.hypot(dx,dy)||1;let max=0,index=0;for(let i=1;i<points.length-1;i++){const d=Math.abs(dy*points[i].x-dx*points[i].y+last.x*first.y-last.y*first.x)/den;if(d>max){max=d;index=i;}}if(max>epsilon){const left=simplifyPath(points.slice(0,index+1),epsilon),right=simplifyPath(points.slice(index),epsilon);return left.slice(0,-1).concat(right);}return[first,last];}
function looksLikeTriangle(points,width){if(points.length<24)return false;const simple=simplifyPath(points,width*.035),gap=Math.hypot(simple[0].x-simple.at(-1).x,simple[0].y-simple.at(-1).y);return gap<width*.13&&simple.length>=4&&simple.length<=7;}
const VISION_SKILLS={drawing:['visual expression','hand control'], 'hand-playground':['gesture recognition','spatial tracking'], 'air-keyboard':['fine motor control','symbol mapping'], 'gesture-deck':['gesture recognition','sequencing'], 'gesture-trainer':['classification','machine learning'], science:['scientific reasoning','variables'], physics:['projectile motion','model interpretation'], biology:['cell structures','observation'], electronics:["Ohm's law",'variables'], mechanical:['gear ratios','systems thinking'], 'object-hunt':['color analysis','observation'], scanner:['image processing','equation reasoning'], gaze:['accessible interaction','attention'], posture:['visual framing','observation'], 'object-3d':['spatial reasoning','3D manipulation'], 'movement-game':['data structures','decision making'], 'gesture-code':['sequencing','coding'], 'avatar-motion':['spatial tracking','interaction'], 'face-lab':['computer vision','environmental response'], 'teach-mode':['explanation','retrieval practice']};
const VISION_NEXT={drawing:'object-3d','hand-playground':'gesture-deck','air-keyboard':'gesture-code','gesture-deck':'gesture-trainer','gesture-trainer':'object-hunt',science:'physics',physics:'electronics',biology:'science',electronics:'mechanical',mechanical:'physics','object-hunt':'scanner',scanner:'teach-mode',gaze:'air-keyboard',posture:'avatar-motion','object-3d':'physics','movement-game':'gesture-code','gesture-code':'teach-mode','avatar-motion':'object-3d','face-lab':'gaze','teach-mode':'gesture-deck'};
async function saveVisionProgress(id,type,score,statusSelector='#drawingChallengeStatus'){const status=document.querySelector(statusSelector),skills=VISION_SKILLS[id]||['practice','reflection'],recommendedNext=VISION_NEXT[id]||'vision-lab',difficulty=(document.querySelector(`[data-cv-lab=\"${id}\"]`)?.closest('.cv-lab-card')?.dataset.cvLevel||'beginner').toLowerCase(),event={experimentId:id,type,score,skills,recommendedNext,difficulty};try{const data=await apiRequest('/vision/events',{method:'POST',body:JSON.stringify(event)});if(status)status.textContent=type==='completed'?`Mastered · +${data.xpAwarded||0} XP · next: ${recommendedNext.replaceAll('-',' ')}`:`Attempt recorded · ${score}% · ${data.mistakes||0} mistakes to learn from`;return data;}catch{const progress=JSON.parse(localStorage.getItem('eduverse-vision-progress')||'{"completed":{},"events":[],"xp":0,"experiments":{}}');progress.experiments||={};const activity=progress.experiments[id]||{attempts:0,mistakes:0,skills:[],xp:0};activity.attempts++;if(type==='challenge'&&score<60)activity.mistakes++;activity.skills=[...new Set([...activity.skills,...skills])];activity.recommendedNext=recommendedNext;activity.lastScore=score;const already=!!progress.completed[id];if(type==='completed'&&!already){progress.completed[id]=true;activity.xp+=25;}else if(type==='challenge')activity.xp+=Math.round(score/20);progress.experiments[id]=activity;progress.xp=Object.values(progress.experiments).reduce((sum,item)=>sum+item.xp,0);progress.events.unshift({...event,createdAt:new Date().toISOString(),mistake:type==='challenge'&&score<60});localStorage.setItem('eduverse-vision-progress',JSON.stringify(progress));if(status)status.textContent=type==='completed'?`Mastered · ${progress.xp} XP · next: ${recommendedNext.replaceAll('-',' ')}`:`Attempt recorded · ${score}% · retry and use the hint`;return null;}}
async function renderSketchFrame(frameBlob,mode,video){if(sketchBusy||!frameBlob)return;sketchBusy=true;try{const response=await fetch(`${OPENCV_URL}/stylize?mode=${encodeURIComponent(mode)}`,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:frameBlob});if(!response.ok)throw new Error('Sketch processing failed');const blob=await response.blob(),url=URL.createObjectURL(blob),image=new Image();image.onload=()=>{const out=document.querySelector('#sketchCanvas');if(out&&document.querySelector('#drawingMode')?.value===mode){out.width=video.videoWidth||640;out.height=video.videoHeight||480;out.getContext('2d').drawImage(image,0,0,out.width,out.height);out.hidden=false;out.classList.add('active');}URL.revokeObjectURL(url);};image.src=url;}catch{const track=document.querySelector('#trackStatus');if(track)track.textContent='Sketch filter unavailable · check the local OpenCV service.';}finally{sketchBusy=false;}}
function trackWebcamFrame(){const video=document.querySelector('#drawingVideo'),canvas=document.querySelector('#drawingCanvas');if(!video||!canvas||!drawingStream)return;if(!trackerBusy&&video.readyState>=2){trackerBusy=true;if(!drawingScratch)drawingScratch=document.createElement('canvas');const scratch=drawingScratch;scratch.width=320;scratch.height=Math.round(320*(video.videoHeight/video.videoWidth||.75));scratch.getContext('2d').drawImage(video,0,0,scratch.width,scratch.height);scratch.toBlob(async blob=>{try{const mode=document.querySelector('#drawingMode')?.value||'hand',useLandmarks=mode==='hand'&&drawingUsesLandmarks;if(mode==='hand'){const effect=document.querySelector('#sketchCanvas');if(effect){effect.classList.remove('active');effect.hidden=true;}}else if(++sketchFrameIndex%3===0)renderSketchFrame(blob,mode,video);let result,hand=null;if(useLandmarks){const response=await fetch(`${OPENCV_URL}/hands`,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob});if(!response.ok)throw new Error('MediaPipe hand tracking failed');const data=await response.json();if(data.available===false)throw new Error(data.reason||'MediaPipe tracker unavailable');hand=data.hands?.[0]||null;result=hand?{detected:true,x:hand.landmarks[8][0],y:hand.landmarks[8][1],confidence:hand.score||0,gestureHint:hand.gesture.toLowerCase()}:{detected:false};}else{const response=await fetch(`${OPENCV_URL}/track`,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob});if(!response.ok)throw new Error('OpenCV could not process this frame');result=await response.json();}if(result.detected&&useLandmarks){const filtered=drawingFilterPoint(result.x,result.y,performance.now());drawingSmoothedPoint=filtered;result.x=filtered.x;result.y=filtered.y;}if(result.detected){drawingMissedFrames=0;const handX=Math.max(0,Math.min(1,Number(result.x)||0)),handY=Math.max(0,Math.min(1,Number(result.y)||0)),x=handX*(canvas.width-1),y=handY*(canvas.height-1),pointer=document.querySelector('#handPointer'),stage=document.querySelector('.drawing-stage');if(pointer&&stage){const box=stage.getBoundingClientRect(),vw=video.videoWidth||canvas.width,vh=video.videoHeight||canvas.height,scale=Math.min(box.width/vw,box.height/vh),dw=vw*scale,dh=vh*scale;pointer.style.left=`${(box.width-dw)/2+handX*dw}px`;pointer.style.top=`${(box.height-dh)/2+handY*dh}px`;pointer.hidden=false;}if(useLandmarks)handleDrawingGesture(hand);const wantPen=!drawingPaused&&useLandmarks&&hand?.gesture==='ONE_FINGER'&&Number(hand?.gestureConfidence||0)>=.45;const penDown=updateDrawingPen(wantPen);if(mode==='hand'&&!mouseDrawing&&penDown){const ctx=canvas.getContext('2d');ctx.globalCompositeOperation=drawingEraser?'destination-out':'source-over';const brush=Number(document.querySelector('#brushSize')?.value||7),ink=document.querySelector('#brushColor')?.value||'#7b61dc';if(!drawingPrevious){saveDrawingUndo();drawingStrokeCount++;drawingPath=[];ctx.beginPath();ctx.arc(x,y,brush/2,0,Math.PI*2);ctx.fillStyle=ink;ctx.fill();drawingLastMid={x,y};}else{const mid={x:(drawingPrevious.x+x)/2,y:(drawingPrevious.y+y)/2};ctx.beginPath();ctx.moveTo(drawingLastMid.x,drawingLastMid.y);ctx.quadraticCurveTo(drawingPrevious.x,drawingPrevious.y,mid.x,mid.y);ctx.lineWidth=brush*(canvas.width/(video.clientWidth||canvas.width));ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=ink;ctx.stroke();drawingLastMid=mid;}drawingPath.push({x,y});drawingPrevious={x,y};}else if(mode==='hand'&&useLandmarks){endDrawingPath();drawingPrevious=null;}const track=document.querySelector('#trackStatus');if(track)track.textContent=useLandmarks?`MediaPipe sees ${hand.gesture.replaceAll('_',' ').toLowerCase()} · ${penDown?'pen down · drawing':'pen up · raise only index finger to draw'} · ${Math.round((hand.score||0)*100)}% confidence${drawingGestureMessage?` · ${drawingGestureMessage}`:''}`:mode==='hand'?(drawingPaused?'Tracking paused · hand detected':`Hand detected · ${Math.round(result.confidence*100)}% · ${String(result.gestureHint||'uncertain').replaceAll('_',' ')}`):`Live OpenCV sketch · ${mode==='classic'?'Canny 10/80':'Canny 30/60'}`;}else{const pointer=document.querySelector('#handPointer');if(mode==='hand'&&drawingPrevious&&drawingMissedFrames<3){drawingMissedFrames++;}else{if(pointer)pointer.hidden=true;if(mode==='hand'){endDrawingPath();drawingPrevious=null;drawingLastMid=null;resetDrawingFilter();drawingMissedFrames=0;}}const track=document.querySelector('#trackStatus');if(track)track.textContent=mode==='hand'?'No hand detected · hold your hand clearly inside the camera frame':'Live sketch running · move the camera view to animate the outline';}const size=document.querySelector('#brushSizeValue');if(size)size.textContent=`${document.querySelector('#brushSize')?.value||7} px`; }catch(error){const track=document.querySelector('#trackStatus');if(track)track.textContent=`OpenCV connection lost: ${error.message}`;stopWebcamDrawing();}finally{trackerBusy=false;}},'image/jpeg',.72);}drawingLoop=setTimeout(trackWebcamFrame,60);}
document.addEventListener('click',e=>{
 if(e.target.id==='startCamera'){if(drawingStream)stopWebcamDrawing();else beginWebcamDrawing();}
 if(e.target.id==='pauseDrawing'){drawingPaused=!drawingPaused;e.target.textContent=drawingPaused?'▶ Resume drawing':'Ⅱ Pause drawing';resetDrawingPen();}
 if(e.target.id==='undoDrawing'){restoreDrawingState(drawingUndo,drawingRedo);endDrawingPath();drawingPrevious=null;}
 if(e.target.id==='redoDrawing'){restoreDrawingState(drawingRedo,drawingUndo);endDrawingPath();drawingPrevious=null;}
 if(e.target.id==='clearDrawing'){saveDrawingUndo();for(const id of ['drawingCanvas','sketchCanvas']){const canvas=document.querySelector('#'+id);if(canvas)canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);}drawingPrevious=null;drawingPath=[];drawingPaths=[];drawingStrokeCount=0;setDrawingHistoryButtons();const status=document.querySelector('#drawingChallengeStatus');if(status)status.textContent='Canvas cleared · draw one closed triangle path to complete the challenge.';}
 if(e.target.id==='saveDrawing'){const canvas=document.querySelector('#drawingCanvas');if(!canvas)return;const out=document.createElement('canvas');out.width=canvas.width||640;out.height=canvas.height||480;const ctx=out.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,out.width,out.height);const effect=document.querySelector('#sketchCanvas');if(effect&&!effect.hidden)ctx.drawImage(effect,0,0,out.width,out.height);ctx.drawImage(canvas,0,0);const a=document.createElement('a');a.download='eduverse-webcam-drawing.png';a.href=out.toDataURL('image/png');a.click();}
 if(e.target.id==='mouseDrawing'){mouseDrawing=!mouseDrawing;const stage=document.querySelector('.drawing-stage');stage?.classList.toggle('mouse-mode',mouseDrawing);e.target.setAttribute('aria-pressed',String(mouseDrawing));e.target.textContent=mouseDrawing?'✓ Mouse drawing on':'Use mouse instead';if(mouseDrawing&&drawingStream)stopWebcamDrawing();}
 if(e.target.id==='penDrawing'||e.target.id==='eraserDrawing'){drawingLastGesture='';drawingGestureFired='';drawingEraser=e.target.id==='eraserDrawing';const pen=document.querySelector('#penDrawing'),eraser=document.querySelector('#eraserDrawing');pen?.classList.toggle('selected',!drawingEraser);eraser?.classList.toggle('selected',drawingEraser);pen?.setAttribute('aria-pressed',String(!drawingEraser));eraser?.setAttribute('aria-pressed',String(drawingEraser));const status=document.querySelector('#trackStatus');if(status)status.textContent=drawingEraser?'Eraser selected · raise one index finger and move over marks to remove them':'Pen selected · raise only one index finger to write';}
  if(e.target.id==='finishDrawingChallenge'){if(document.querySelector('#drawingMode')?.value!=='hand'){document.querySelector('#drawingChallengeStatus').textContent='Choose Hand drawing, then trace a closed triangle with the webcam pointer.';return;}endDrawingPath();const width=document.querySelector('#drawingCanvas')?.width||640,shape=drawingPaths.find(path=>looksLikeTriangle(path,width));if(!shape){document.querySelector('#drawingChallengeStatus').textContent=`Not complete yet · ${drawingStrokeCount} pen strokes detected. Trace one closed triangle with three clear sides, then finish again.`;return;}document.querySelector('#drawingChallengeStatus').textContent='Triangle detected · saving your result…';saveVisionProgress('drawing','completed',100);}
});
let mouseStroke=false;document.addEventListener('pointerdown',e=>{if(!mouseDrawing||!e.target.matches('#drawingCanvas'))return;mouseStroke=true;e.target.setPointerCapture(e.pointerId);const r=e.target.getBoundingClientRect(),x=(e.clientX-r.left)*e.target.width/r.width,y=(e.clientY-r.top)*e.target.height/r.height;saveDrawingUndo();drawingPrevious={x,y};drawingStrokeCount++;drawingPath=[{x,y}];});document.addEventListener('pointermove',e=>{if(!mouseStroke||!mouseDrawing)return;const c=document.querySelector('#drawingCanvas'),r=c.getBoundingClientRect(),x=(e.clientX-r.left)*c.width/r.width,y=(e.clientY-r.top)*c.height/r.height,ctx=c.getContext('2d');ctx.beginPath();ctx.moveTo(drawingPrevious.x,drawingPrevious.y);ctx.lineTo(x,y);ctx.lineWidth=Number(document.querySelector('#brushSize')?.value||7);ctx.lineCap='round';ctx.globalCompositeOperation=drawingEraser?'destination-out':'source-over';ctx.strokeStyle=document.querySelector('#brushColor')?.value||'#7b61dc';ctx.stroke();drawingPath.push({x,y});drawingPrevious={x,y};});document.addEventListener('pointerup',()=>{if(mouseStroke)endDrawingPath();mouseStroke=false;drawingPrevious=null;});
document.addEventListener('input',e=>{if(e.target.id==='brushSize'){const out=document.querySelector('#brushSizeValue');if(out)out.textContent=`${e.target.value} px`;}});
document.addEventListener('change',e=>{if(e.target.id==='drawingMode'){drawingPrevious=null;const effect=document.querySelector('#sketchCanvas');if(e.target.value==='hand'&&effect){effect.hidden=true;effect.classList.remove('active');}const status=document.querySelector('#trackStatus');if(status)status.textContent=e.target.value==='hand'?'Hand drawing selected':'Starting live OpenCV sketch filter…';}});
window.addEventListener('beforeunload',()=>{if(drawingStream)drawingStream.getTracks().forEach(track=>track.stop());if(classAirStream)classAirStream.getTracks().forEach(track=>track.stop());});

const drawingNavigate=navigate;navigate=function(name){if(name!=='drawing'&&drawingStream)stopWebcamDrawing();if(name!=='classroom'&&classAirStream)stopClassAirCamera();drawingNavigate(name);if(name==='classroom')setTimeout(()=>{resizeClassInk();restoreClassInk();},0);};

// Shared opt-in camera stream for real-time computer-vision activities.
let cvHandsAvailable=false,cvCurrentLab='',cvStream=null,cvLoop=0,cvBusy=false,cvFrameCanvas=null,cvLastBlob=null,cvLastResult=null,cvLastGesture='',cvGestureSince=0,cvGestureFired='',cvLastPerception=0,cvPerceptionBusy=false,cvAirKey='',cvAirSince=0,cvAirFired='',cvAirPinched=false,cvScienceFired=false,cvSmoothTime=0;
async function startCvCamera(){const video=document.querySelector('#cvCameraVideo'),status=document.querySelector('#cvCameraStatus');if(!video||!navigator.mediaDevices?.getUserMedia){if(status)status.textContent='This browser context cannot access a webcam.';return;}if(status)status.textContent='Connecting to local OpenCV and requesting camera permission…';try{const h=await fetch(`${OPENCV_URL}/health`);if(!h.ok)throw new Error('Python OpenCV service is offline');cvHandsAvailable=false;{try{const hands=await fetch(`${OPENCV_URL}/hands/status`);cvHandsAvailable=hands.ok&&Boolean((await hands.json()).available);}catch{cvHandsAvailable=false;}}cvStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640,max:1280},height:{ideal:480,max:720}},audio:false});video.srcObject=cvStream;await video.play();document.querySelector('#cvCameraStart').disabled=true;document.querySelector('#cvCameraStop').disabled=false;if(status)status.textContent=`Camera active · ${cvHandsAvailable?'MediaPipe 21-point hand tracking':'OpenCV contour fallback'} · frames stay on this computer.`;const overlay=document.querySelector('#cvCameraOverlay'),keyboard=document.querySelector('#airKeyboardSurface');if(overlay)overlay.hidden=true;if(keyboard)keyboard.hidden=cvCurrentLab!=='air-keyboard';if(!cvHandsAvailable&&['hand-playground','air-keyboard','gesture-trainer','gesture-deck'].includes(cvCurrentLab)&&status)status.textContent='MediaPipe is unavailable in this Python environment. Restart EduVerse after installing opencv-drawing/requirements-mediapipe.txt.';trackCvCamera();}catch(err){if(cvStream)cvStream.getTracks().forEach(t=>t.stop());cvStream=null;if(status)status.textContent=err.name==='NotAllowedError'?'Camera permission was denied. Allow access in browser settings and retry.':`Could not start camera: ${err.message}. Check Python service and browser permissions.`;}}
function stopCvCamera(){if(cvStream)cvStream.getTracks().forEach(t=>t.stop());cvStream=null;clearTimeout(cvLoop);cvBusy=false;cvSmoothTime=0;const video=document.querySelector('#cvCameraVideo');if(video)video.srcObject=null;const landmarks=document.querySelector('#cvHandLandmarksCanvas');if(landmarks){landmarks.hidden=true;landmarks.getContext('2d')?.clearRect(0,0,landmarks.width,landmarks.height);}const keyboard=document.querySelector('#airKeyboardSurface');if(keyboard)keyboard.hidden=true;const cursor=document.querySelector('#cvCameraCursor');if(cursor)cursor.style.display='none';const start=document.querySelector('#cvCameraStart');if(start)start.disabled=false;const stop=document.querySelector('#cvCameraStop');if(stop)stop.disabled=true;const overlay=document.querySelector('#cvCameraOverlay');if(overlay){overlay.hidden=false;overlay.textContent='Start the camera to use hand tracking in this activity';}const status=document.querySelector('#cvCameraStatus');if(status)status.textContent='Camera is off.';}
function frameFromCamera(){const video=document.querySelector('#cvCameraVideo');if(!video||video.readyState<2)return null;if(!cvFrameCanvas)cvFrameCanvas=document.createElement('canvas');const width=320,height=Math.round(320*(video.videoHeight/video.videoWidth||.75));if(cvFrameCanvas.width!==width)cvFrameCanvas.width=width;if(cvFrameCanvas.height!==height)cvFrameCanvas.height=height;cvFrameCanvas.getContext('2d',{alpha:false}).drawImage(video,0,0,width,height);return new Promise(resolve=>cvFrameCanvas.toBlob(resolve,'image/jpeg',.68));}
async function trackCvCamera(){if(!cvStream)return;if(!cvBusy){cvBusy=true;try{const blob=await frameFromCamera();if(blob){cvLastBlob=blob;let result;if(cvHandsAvailable){const response=await fetch(`${OPENCV_URL}/hands`,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob});if(!response.ok)throw new Error('MediaPipe hand tracking failed');const data=await response.json(),hand=data.hands?.[0];result=hand?{detected:true,x:hand.landmarks[8][0],y:hand.landmarks[8][1],confidence:hand.score||0,gestureHint:hand.gesture.toLowerCase(),gestureConfidence:hand.gestureConfidence||0,pinch:!!hand.pinch,pinchRatio:hand.pinchRatio,handCount:data.handCount||1,features:hand.features,landmarks:[hand.landmarks],inferenceMs:data.inferenceMs,serverFps:data.serverFps}: {detected:false};}else{const response=await fetch(`${OPENCV_URL}/track`,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob});if(!response.ok)throw new Error('OpenCV frame tracking failed');result=await response.json();}cvLastResult=result;if(result.detected)applyCvTracking(result);else{cvSmoothedPoint=null;drawCvLandmarks(null);const out=document.querySelector('#cvCameraResult');if(out)out.textContent='No hand detected · move a hand into the camera view against a clear background.';}if(['posture','gaze','face-lab'].includes(cvCurrentLab)&&Date.now()-cvLastPerception>900&&!cvPerceptionBusy){cvPerceptionBusy=true;cvLastPerception=Date.now();fetch(`${OPENCV_URL}/perceive`,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob}).then(r=>r.json()).then(updatePerception).catch(()=>{}).finally(()=>{cvPerceptionBusy=false;});}if(cvCurrentLab==='gesture-trainer'&&Date.now()-cvLastPerception>700){cvLastPerception=Date.now();fetch(`${OPENCV_URL}/classify`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({features:result.features||[]})}).then(r=>r.json()).then(pred=>{const out=document.querySelector('#gestureStatus');if(out&&pred.trained)out.textContent=`OpenCV nearest-neighbour prediction: ${pred.label} · ${Math.round(pred.confidence*100)}% · ${pred.examples} training samples`;}).catch(()=>{});}}}catch(err){const status=document.querySelector('#cvCameraStatus');if(status)status.textContent=`OpenCV connection lost: ${err.message}. Restart the Python service and try again.`;stopCvCamera();}finally{cvBusy=false;}}cvLoop=setTimeout(trackCvCamera,45);}
function updatePerception(p){if(cvCurrentLab==='posture'){const out=document.querySelector('#postureReadout');if(out)out.textContent=p.people?.length?`OpenCV found ${p.people.length} person-shaped figure${p.people.length===1?'':'s'} in frame · check your camera framing manually.`:'No full-body figure detected · step back so more of your body is visible.';}if(cvCurrentLab==='gaze'){const out=document.querySelector('#gazeStatus');if(!p.faceCount){if(out)out.textContent='No face detected · face the camera with even lighting.';window.cvGazeHint='';window.cvGazeSince=0;return;}if(out)out.textContent=`Face found · ${p.eyeRegions} eye regions · rough eye-position hint: ${p.gazeHint}. Hold a target in view for 1.5 seconds.`;if(p.gazeHint&&p.gazeHint!=='unknown'){if(window.cvGazeHint!==p.gazeHint){window.cvGazeHint=p.gazeHint;window.cvGazeSince=Date.now();}const map={left:'A',center:'B',right:'C'},choice=map[p.gazeHint];if(choice&&Date.now()-window.cvGazeSince>1500){const target=document.querySelector(`[data-dwell="${choice}"]`);if(target)target.click();window.cvGazeSince=Date.now()+4000;}}}if(cvCurrentLab==='face-lab'){const out=document.querySelector('#faceDetectionStatus'),state=document.querySelector('#faceSceneState'),scene=document.querySelector('#faceScene');if(out)out.textContent=`OpenCV face boxes: ${p.faceCount} · eye regions: ${p.eyeRegions}. No identity or emotion analysis.`;if(state)state.textContent=p.faceCount?'Learner present · room light increased':'No face in frame';if(scene)scene.classList.toggle('bright',p.faceCount>0);}}
let cvSmoothedPoint=null;function drawCvLandmarks(points){const canvas=document.querySelector('#cvHandLandmarksCanvas'),video=document.querySelector('#cvCameraVideo');if(!canvas||!video)return;if(!points?.length||!cvHandsAvailable){canvas.hidden=true;return;}canvas.hidden=false;const w=video.videoWidth||320,h=video.videoHeight||240;if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}const ctx=canvas.getContext('2d');ctx.clearRect(0,0,w,h);ctx.lineWidth=Math.max(2,w/320*1.4);ctx.strokeStyle='rgba(255,226,122,.9)';ctx.fillStyle='#fff';const links=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];for(const hand of points){for(const [a,b] of links){ctx.beginPath();ctx.moveTo(hand[a][0]*w,hand[a][1]*h);ctx.lineTo(hand[b][0]*w,hand[b][1]*h);ctx.stroke();}for(let i=0;i<hand.length;i++){ctx.beginPath();ctx.arc(hand[i][0]*w,hand[i][1]*h,i===8?Math.max(5,w/50):Math.max(2,w/130),0,Math.PI*2);ctx.fillStyle=i===8?'#ffe27a':'#fff';ctx.fill();}}}
function applyCvTracking(r){const now=performance.now(),dt=cvSmoothTime?Math.min(250,now-cvSmoothTime):80,alpha=Math.max(.2,Math.min(.68,1-Math.exp(-dt/95)));cvSmoothTime=now;cvSmoothedPoint=cvSmoothedPoint?{x:cvSmoothedPoint.x+(r.x-cvSmoothedPoint.x)*alpha,y:cvSmoothedPoint.y+(r.y-cvSmoothedPoint.y)*alpha}:{x:r.x,y:r.y};drawCvLandmarks(r.landmarks);const x=cvSmoothedPoint.x,y=cvSmoothedPoint.y;const cursor=document.querySelector('#cvCameraCursor');if(cursor){cursor.style.display='block';cursor.style.left=`${x*100}%`;cursor.style.top=`${y*100}%`;}const result=document.querySelector('#cvCameraResult');if(result)result.textContent=cvCurrentLab==='hand-playground'?`Index fingertip ${Math.round(x*100)}% across · ${Math.round(y*100)}% down · ${r.handCount||1} hand · ${r.inferenceMs??'—'} ms · ${r.serverFps??'—'} FPS`:cvCurrentLab==='air-keyboard'?`Key highlighted · ${r.pinch?'pinch detected':'pinch thumb and index to type'} · ${r.gestureHint||'hand tracking'}`:`Hand point ${Math.round(x*100)}%, ${Math.round(y*100)}% · ${r.pinch?'pinch detected · scaling':''} ${r.gestureHint||'uncertain'}`;const playground=document.querySelector('#handPlaygroundReadout');if(playground&&cvCurrentLab==='hand-playground')playground.textContent=`21 landmarks tracked · fingertip x ${x.toFixed(2)}, y ${y.toFixed(2)} · confidence ${Math.round((r.confidence||0)*100)}% · ${r.inferenceMs??'—'} ms / frame · ${r.serverFps??'—'} FPS`;const gesture=r.gestureHint||'uncertain';if(gesture!==cvLastGesture){cvLastGesture=gesture;cvGestureSince=Date.now();cvGestureFired='';cvScienceFired=false;}
 if(cvCurrentLab==='air-keyboard'){const rows=['QWERTYUIOP','ASDFGHJKL','ZXCVBNM'];let key;if(y>.82){key=x<.5?'Space':x<.76?'Backspace':'Enter';}else{const row=Math.max(0,Math.min(2,Math.floor(y/.82*3))),keys=rows[row],col=Math.max(0,Math.min(keys.length-1,Math.floor(x*keys.length)));key=keys[col];}const btn=[...document.querySelectorAll('[data-air-key]')].find(b=>b.dataset.airKey===key);document.querySelectorAll('[data-air-key]').forEach(b=>b.classList.toggle('air-hover',b===btn));if(key!==cvAirKey){cvAirKey=key;cvAirSince=Date.now();cvAirFired='';cvAirPinched=false;}const nowPinched=!!r.pinch;if(nowPinched&&!cvAirPinched){const input=document.querySelector('#airText');if(input){if(key==='Backspace')input.value=input.value.slice(0,-1);else if(key==='Space')input.value+=' ';else if(key==='Enter')input.value+='\n';else input.value+=key;input.focus();}cvAirFired=key;const out=document.querySelector('#cvCameraResult');if(out)out.textContent=`Typed ${key==='Space'?'Space':key} · move to another key and pinch again.`;}cvAirPinched=nowPinched;}
 if(cvCurrentLab==='gesture-deck'&&Date.now()-cvGestureSince>650&&cvGestureFired!==gesture){const action=gesture==='open_palm'||gesture==='open_hand'?'next':gesture==='fist'?'previous':gesture==='one_finger'?'select':gesture==='two_fingers'?'pause':'';if(action){document.querySelector(`[data-deck="${action}"]`)?.click();cvGestureFired=gesture;}}
 if(cvCurrentLab==='gesture-code'&&Date.now()-cvGestureSince>500&&cvGestureFired!==gesture){const action=gesture==='open_palm'||gesture==='open_hand'?'run':gesture==='fist'?'stop':gesture==='two_fingers'?'output':gesture==='one_finger'?'submit':gesture==='thumbs_up'?'zoom':'';if(action){document.querySelector(`[data-code="${action}"]`)?.click();cvGestureFired=gesture;}}
 if(cvCurrentLab==='movement-game'){const lane=x<.34?0:x>.66?2:1,player=document.querySelector('#runnerPlayer');if(player){player.dataset.lane=lane;player.style.left=`${[8,48,88][lane]}%`;}}
 if(cvCurrentLab==='object-3d'){const obj=document.querySelector('#moleculeObject');if(obj){obj.style.setProperty('--mol-rotate',`${x*360}deg`);const scaleControl=document.querySelector('#moleculeScale');if(r.pinch&&Number.isFinite(r.pinchRatio)){const scale=Math.max(70,Math.min(150,Math.round(70+r.pinchRatio*320)));if(scaleControl)scaleControl.value=scale;obj.style.setProperty('--mol-scale',String(scale/100));}obj.style.transform=`translate(${(x-.5)*110}px,${(y-.5)*60}px) scale(var(--mol-scale,1)) rotate(var(--mol-rotate,0deg))`;}}
 if(cvCurrentLab==='avatar-motion'){const av=document.querySelector('#demoAvatar');if(av)av.style.transform=`translate(${(x-.5)*150}px,${(y-.5)*60}px)`;}
 if(cvCurrentLab==='physics'){const angle=document.querySelector('#physicsAngle');if(angle){angle.value=String(Math.round(10+y*70));drawPhysics();}}
 if(cvCurrentLab==='science'&&gesture==='open_hand'&&x>.4&&x<.6&&Date.now()-cvGestureSince>800&&!cvScienceFired){document.querySelector('#mixSolutions')?.click();cvScienceFired=true;}
}
// Interactive activities in the OpenCV learning lab hub.
const gestureCounts = JSON.parse(localStorage.getItem('eduverse-cv-gesture-samples')||'{}');
function paintGestureCounts(){const box=document.querySelector('#gestureSamples');if(box)box.innerHTML=Object.keys(gestureCounts).length?Object.entries(gestureCounts).map(([label,count])=>`<div class="cv-sample-row"><b>${label}</b><span>${count} example${count===1?'':'s'}</span></div>`).join(''):'<small>No labeled examples yet.</small>';}
function drawPhysics(){const canvas=document.querySelector('#physicsCanvas');if(!canvas)return;const ctx=canvas.getContext('2d'),speed=Number(document.querySelector('#physicsSpeed').value),deg=Number(document.querySelector('#physicsAngle').value),g=Number(document.querySelector('#physicsGravity').value),angle=deg*Math.PI/180;canvas.width=Math.max(320,canvas.clientWidth*2);canvas.height=520;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.strokeStyle='#e9e4f2';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(25,canvas.height-34);ctx.lineTo(canvas.width-16,canvas.height-34);ctx.stroke();const scale=Math.min(canvas.width/(speed*speed*Math.sin(2*angle)/g*1.2),canvas.height/(speed*speed*Math.sin(angle)**2/(2*g)*1.3));ctx.strokeStyle='#765bdb';ctx.lineWidth=5;ctx.beginPath();for(let t=0;t<=Math.max(.1,2*speed*Math.sin(angle)/g);t+=.035){const x=24+speed*Math.cos(angle)*t*scale,y=canvas.height-34-(speed*Math.sin(angle)*t-.5*g*t*t)*scale;if(t===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();const range=speed*speed*Math.sin(2*angle)/g,height=speed*speed*Math.sin(angle)**2/(2*g);const read=document.querySelector('#physicsReadout');if(read)read.textContent=`Idealised range: ${range.toFixed(1)} m · max height: ${height.toFixed(1)} m`;['physicsSpeed','physicsAngle','physicsGravity'].forEach(id=>{const el=document.querySelector('#'+id);if(el){const v=document.querySelector('#'+({physicsSpeed:'speedValue',physicsAngle:'angleValue',physicsGravity:'gravityValue'}[id]));if(v)v.textContent=id==='physicsAngle'?`${el.value}°`:id==='physicsGravity'?`${el.value} m/s²`:`${el.value} m/s`;}});}
function getDwellTarget(btn){clearTimeout(window.cvDwellTimer);document.querySelector('#gazeStatus').textContent=`Hold on ${btn.dataset.dwell}…`;window.cvDwellTimer=setTimeout(()=>{const s=document.querySelector('#gazeStatus');if(s)s.textContent=`Selected ${btn.dataset.dwell} · ${btn.textContent.split('·')[1].trim()}`;},1500);}
document.addEventListener('click',async e=>{
 if(e.target.id==='checkAirTyping'){try{const {profile}=await apiRequest('/profile'),name=String(profile.name||'').trim().split(/\s+/)[0].toUpperCase(),typed=document.querySelector('#airText').value.replace(/[^a-z]/gi,'').toUpperCase(),out=document.querySelector('#airChallengeResult');if(name&&typed===name){await saveVisionProgress('air-keyboard','completed',100,'#airChallengeResult');}else{if(out)out.textContent=`Not yet · type your first name (“${name||'student'}”) with the keyboard, then check again.`;await saveVisionProgress('air-keyboard','challenge',0,'#airChallengeResult');}}catch{document.querySelector('#airChallengeResult').textContent='Could not load your profile. Use the on-screen keys and enter your first name.';}}
 if(e.target.id==='clearAirTyping'){document.querySelector('#airText').value='';document.querySelector('#airChallengeResult').textContent='Text cleared.';}
 if(e.target.id==='cvCameraStart'){startCvCamera();return;}if(e.target.id==='cvCameraStop'){stopCvCamera();return;}if(e.target.id==='captureBoard'){if(!cvLastBlob){document.querySelector('#scanStatus').textContent='Start the camera below and point it at your board first.';return;}const status=document.querySelector('#scanStatus');status.textContent='Cleaning captured camera frame locally…';try{const resp=await fetch(`${OPENCV_URL}/scan`,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:cvLastBlob});if(!resp.ok)throw new Error();const blob=await resp.blob(),url=URL.createObjectURL(blob),img=new Image();img.onload=()=>{const c=document.querySelector('#scanCanvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);c.hidden=false;URL.revokeObjectURL(url);};img.src=url;status.textContent='Camera frame cleaned by local OpenCV. Type the equation below; OCR is not installed.';}catch{status.textContent='Could not process the camera frame. Check the local OpenCV service.';}return;}if(e.target.id==='analyzeColor'){if(!cvLastBlob){document.querySelector('#colorResult').textContent='Start the webcam below first.';return;}try{const resp=await fetch(`${OPENCV_URL}/analyze`,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:cvLastBlob}),data=await resp.json(),goal=document.querySelector('#huntTargetColor').value;document.querySelector('#colorResult').textContent=`OpenCV centre-frame color: ${data.color} (${Math.round(data.confidence*100)}% saturation). ${data.color===goal?'Match found!':'Keep searching for '+goal+'; center the item in the frame.'}`;if(data.color===goal)saveVisionProgress('object-hunt','challenge',100,'#colorResult');}catch{document.querySelector('#colorResult').textContent='Could not analyze this frame. Check the local OpenCV service.';}return;}const card=e.target.closest('[data-cv-lab]');if(card){if(card.dataset.cvLab==='drawing'){navigate('drawing');return;}cvCurrentLab=card.dataset.cvLab;openModal(cvLabDemo(card.dataset.cvLab));if(card.dataset.cvLab==='gesture-trainer')paintGestureCounts();if(card.dataset.cvLab==='physics')setTimeout(drawPhysics,0);return;}
 if(e.target.matches('[data-air-key]')){const out=document.querySelector('#airText'),key=e.target.dataset.airKey;if(key==='Backspace')out.value=out.value.slice(0,-1);else if(key==='Space')out.value+=' ';else if(key==='Enter')out.value+='\n';else out.value+=key;out.focus();}
 if(e.target.id==='collectGesture'){const label=document.querySelector('#gestureLabel').value;if(!cvLastResult?.features){document.querySelector('#gestureStatus').textContent='Start the camera and hold a clear hand pose before collecting an example.';return;}try{const res=await fetch(`${OPENCV_URL}/learn`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label,features:cvLastResult.features})});const data=await res.json();if(!res.ok)throw new Error(data.error||'Training sample failed');gestureCounts[label]=data.count;localStorage.setItem('eduverse-cv-gesture-samples',JSON.stringify(gestureCounts));paintGestureCounts();document.querySelector('#gestureStatus').textContent=`Real OpenCV feature sample saved for “${label}” · ${data.count} examples for this label.`;if(Object.keys(gestureCounts).length>=2&&Object.values(gestureCounts).every(n=>n>=3))saveVisionProgress('gesture-trainer','completed',100,'#gestureStatus');}catch{document.querySelector('#gestureStatus').textContent='Could not save a training sample. Start the local Python service and camera first.';}}
 if(e.target.id==='resetGestures'){try{await fetch(`${OPENCV_URL}/reset`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});}catch{}Object.keys(gestureCounts).forEach(k=>delete gestureCounts[k]);localStorage.removeItem('eduverse-cv-gesture-samples');paintGestureCounts();document.querySelector('#gestureStatus').textContent='Classifier examples cleared from this Python session and this browser.';}
 if(e.target.id==='addHuntItem'){const name=document.querySelector('#huntName').value.trim();if(!name){document.querySelector('#huntName').focus();return;}const row=document.createElement('div');row.className='cv-sample-row';row.innerHTML=`<b>${name.replace(/[<>]/g,'')}</b><span>${document.querySelector('#huntMaterial').value}</span>`;document.querySelector('#huntList').prepend(row);document.querySelector('#huntName').value='';}
 if(e.target.id==='processScan'){const file=document.querySelector('#boardImage')?.files?.[0],status=document.querySelector('#scanStatus');if(!file){status.textContent='Choose a photo first.';return;}status.textContent='Sending this image to the local OpenCV service for cleanup…';try{const response=await fetch(`${OPENCV_URL}/scan`,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:file});if(!response.ok)throw new Error('Local scanner service is unavailable');const blob=await response.blob(),url=URL.createObjectURL(blob),img=new Image();img.onload=()=>{const c=document.querySelector('#scanCanvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);c.hidden=false;URL.revokeObjectURL(url);};img.src=url;status.textContent='Cleaned preview ready · OCR is not installed, so type the equation below.';}catch{status.textContent='Could not connect to local OpenCV. Start the Python service and try again.';}}
 if(e.target.id==='solveEquation'){const input=document.querySelector('#equationInput').value.replace(/\s/g,'').match(/^(-?\d*\.?\d*)x([+-]\d+\.?\d*)=(-?\d+\.?\d*)$/i),out=document.querySelector('#equationSteps');if(!input){out.textContent='Use a linear equation in the form ax + b = c, for example 2x + 5 = 15.';return;}let a=input[1]===''||input[1]==='+'?1:input[1]==='-'?-1:Number(input[1]),b=Number(input[2]),c=Number(input[3]);if(!a){out.textContent='The coefficient of x must not be zero.';return;}out.innerHTML=`Step 1 · Subtract ${b} from both sides: ${a}x = ${c-b}<br>Step 2 · Divide both sides by ${a}: x = ${((c-b)/a).toFixed(2).replace(/\.00$/,'')}`;saveVisionProgress('scanner','completed',100,'#equationSteps');}
 if(e.target.id==='mixSolutions'){const a=document.querySelector('#solutionA').value,b=document.querySelector('#solutionB').value,temp=Number(document.querySelector('#labTemp').value),status=document.querySelector('#reactionStatus'),result=document.querySelector('#beakerResult'),out=document.querySelector('#chemistryResult'),neutral=(a==='acid'&&b==='base')||(a==='base'&&b==='acid');if(neutral){status.textContent=`Demo reaction: indicator colors changed at ${temp} °C. Higher temperature increases the simulated rate; no real chemical quantities are modeled.`;result.style.background=temp>60?'linear-gradient(#eda477,#ffdd9e)':'linear-gradient(#c5b5f4,#faeaff)';}else{status.textContent=`The fictional solutions combined at ${temp} °C. Change the pair or temperature to compare outcomes.`;result.style.background='linear-gradient(#f4c6a5,#ffeacc)';}if(out)out.textContent=`Result: ${neutral?'simulated neutralization':'mixture'} · temperature ${temp} °C · ${temp>60?'faster':'slower'} simulated rate.`;saveVisionProgress('science','completed',100,'#chemistryResult');}if(e.target.id==='chemistryExplanation'){document.querySelector('#chemistryResult').textContent='Explanation: temperature changes particle motion in this teaching model. The fictional color indicator makes a change easy to observe; it is not a prediction for real substances.';}if(e.target.id==='retryChemistry'){document.querySelector('#reactionStatus').textContent='Choose a new solution pair or temperature, then mix again.';document.querySelector('#chemistryResult').textContent='Result reset · change a variable to compare.';document.querySelector('#beakerResult').style.background='';}
 if(e.target.matches('[data-deck]')){const action=e.target.dataset.deck,title=document.querySelector('#deckTitle'),state=document.querySelector('#deckState'),page=document.querySelector('#deckPage');let n=Number(page.textContent);if(action==='next')n=Math.min(4,n+1);if(action==='previous')n=Math.max(1,n-1);page.textContent=n;title.textContent=['','Welcome to binary search','Compare with the midpoint','Keep the matching half','Check your understanding'][n];state.textContent=action==='pause'?'Playback paused · press again to continue':action==='select'?'Selected this slide for discussion':`Slide ${n} of 4`;if(action==='select'&&n===4)saveVisionProgress('gesture-deck','completed',100,'#deckState')}
 if(e.target.matches('[data-scene]')){const action=e.target.dataset.scene,scene=document.querySelector('#faceScene'),icon=document.querySelector('#faceSceneIcon'),state=document.querySelector('#faceSceneState');scene.classList.toggle('bright',action==='bright');icon.textContent=action==='animate'?'✦':action==='calm'?'☾':'☀';state.textContent=action==='animate'?'User-triggered animation':action==='calm'?'Calm scene selected':'Brightness changed by user';}
 if(e.target.matches('[data-runner]')){const player=document.querySelector('#runnerPlayer'),left=Number(player.dataset.lane||1)+(e.target.dataset.runner==='left'?-1:1);player.dataset.lane=Math.max(0,Math.min(2,left));player.style.left=`${[8,48,88][Number(player.dataset.lane)]}%`;}
 if(e.target.id==='runnerCheck'){const ok=Number(document.querySelector('#runnerPlayer').dataset.lane||1)===1;document.querySelector('#runnerStatus').textContent=ok?'Correct · a stack is Last In, First Out.':'Try the middle lane: a stack is Last In, First Out.';}
 if(e.target.matches('[data-code]')){const act=e.target.dataset.code,out=document.querySelector('#codeOutput');if(act==='run'||act==='output')out.textContent='Console output: 0  1  2  3  4';else if(act==='submit')out.textContent='Submitted · your loop runs five times because i starts at 0 and stops before 5.';else if(act==='zoom')document.querySelector('.cv-code').classList.toggle('zoomed');else out.textContent='Execution stopped.';}
 if(e.target.matches('[data-avatar]')){const avatar=document.querySelector('#demoAvatar'),act=e.target.dataset.avatar;if(act==='reset'){avatar.style.transform='translateX(0)';avatar.classList.remove('wave');}else if(act==='wave')avatar.classList.toggle('wave');else avatar.style.transform=`translateX(${act==='left'?-55:55}px)`;document.querySelector('#avatarStatus').textContent=`Avatar action: ${act}`;}
 if(e.target.id==='submitTeaching'){const explain=document.querySelector('#teachExplanation').value.trim(),example=document.querySelector('#teachExample').value.trim(),ok=explain.length>=15&&example.length>=5;window.teachSubmitted=ok;document.querySelector('#teachFollowup').textContent=ok?'Follow-up: In your example, which item is at the top of the stack, and what happens when it is removed?':'Add an explanation (15+ characters) and an example (5+ characters) first.';}
 if(e.target.matches('[data-physics-answer]')){const correct=e.target.dataset.physicsAnswer==='true',out=document.querySelector('#physicsAnswer');if(out)out.textContent=correct?'Correct · for the same launch and landing height with no air resistance, the ideal range peaks at 45°.':'Try again · in the ideal model, sin(2θ) is largest at 45°.';saveVisionProgress('physics',correct?'completed':'challenge',correct?100:0,'#physicsAnswer');}
 if(e.target.matches('[data-cell]')){const facts={nucleus:'Nucleus · stores DNA and helps direct cell activity.',membrane:'Cell membrane · controls what enters and leaves the cell.',mitochondrion:'Mitochondrion · releases usable energy through cellular respiration.',cytoplasm:'Cytoplasm · fluid where many cell reactions take place.'};document.querySelector('#cellDescription').textContent=facts[e.target.dataset.cell];document.querySelectorAll('[data-cell]').forEach(b=>b.classList.toggle('selected',b===e.target));}
 if(e.target.matches('[data-cell-answer]')){const correct=e.target.dataset.cellAnswer==='mitochondrion';document.querySelector('#biologyResult').textContent=correct?'Correct · mitochondria help release usable energy.':'Try again · think about the organelle involved in cellular respiration.';saveVisionProgress('biology',correct?'completed':'challenge',correct?100:0,'#biologyResult');}
 if(e.target.matches('[data-circuit-answer]')){const correct=e.target.dataset.circuitAnswer==='double';document.querySelector('#electronicsResult').textContent=correct?'Correct · with resistance fixed, doubling voltage doubles current (I = V/R).':'Try again · Ohm’s law is I = V/R, so increasing V with fixed R increases current.';saveVisionProgress('electronics',correct?'completed':'challenge',correct?100:0,'#electronicsResult');}
 if(e.target.matches('[data-gear-answer]')){const correct=e.target.dataset.gearAnswer==='30';document.querySelector('#mechanicalResult').textContent=correct?'Correct · 90 × (12/36) = 30 rpm. The larger driven gear turns more slowly and in the opposite direction.':'Try again · output speed = input speed × driver teeth / driven teeth.';saveVisionProgress('mechanical',correct?'completed':'challenge',correct?100:0,'#mechanicalResult');}
 if(e.target.matches('[data-teach-answer]')){const correct=e.target.dataset.teachAnswer==='C';document.querySelector('#teachResult').textContent=correct?'Correct · the newest item, C, is removed first in a stack.':'Not quite · stacks remove the most recently added item first, so C comes off before A.';if(correct)saveVisionProgress('teach-mode','completed',100,'#teachResult');else saveVisionProgress('teach-mode','challenge',0,'#teachResult');}

});
document.addEventListener('pointerover',e=>{const target=e.target.closest('[data-dwell]');if(target)getDwellTarget(target);});
document.addEventListener('focusin',e=>{const target=e.target.closest('[data-dwell]');if(target)getDwellTarget(target);});
document.addEventListener('pointerout',e=>{if(e.target.closest('[data-dwell]'))clearTimeout(window.cvDwellTimer);});
document.addEventListener('click',e=>{if(e.target.matches('[data-dwell]')){clearTimeout(window.cvDwellTimer);document.querySelector('#gazeStatus').textContent=`Selected ${e.target.dataset.dwell} · ${e.target.textContent.split('·')[1].trim()}`;}});
document.addEventListener('input',e=>{
 if(e.target.id==='moleculeScale'){document.querySelector('#moleculeObject').style.setProperty('--mol-scale',Number(e.target.value)/100);}
 if(e.target.id==='moleculeRotate'){document.querySelector('#moleculeObject').style.setProperty('--mol-rotate',`${e.target.value}deg`);}
 if(e.target.id==='labTemp')document.querySelector('#labTempValue').textContent=`${e.target.value} °C`;
 if(e.target.id==='cellZoom'){document.querySelector('#cellZoomValue').textContent=`${e.target.value}%`;document.querySelector('#cellDiagram').style.transform=`scale(${Number(e.target.value)/100})`; }
 if(e.target.id==='circuitVoltage'||e.target.id==='circuitResistance'){const v=Number(document.querySelector('#circuitVoltage').value),r=Number(document.querySelector('#circuitResistance').value),i=v/r;document.querySelector('#voltageReadout').textContent=`${v} V`;document.querySelector('#resistanceReadout').textContent=`${r} Ω`;document.querySelector('#circuitResult').textContent=`Current: ${i.toFixed(3)} A · I = V/R`;document.querySelector('#circuitLed').style.opacity=String(Math.min(1,.18+i*6));document.querySelector('#circuitLed').style.boxShadow=`0 0 ${Math.round(8+i*45)}px #f0ca55`; }
 if(e.target.id==='gearSpeed'||e.target.id==='gearTeeth'){const speed=Number(document.querySelector('#gearSpeed').value),teeth=Number(document.querySelector('#gearTeeth').value),out=speed*12/teeth;document.querySelector('#gearSpeedValue').textContent=`${speed} rpm`;document.querySelector('#gearTeethValue').textContent=String(teeth);document.querySelector('#gearResult').textContent=`Gear ratio 12:${teeth} · output ${out.toFixed(1)} rpm · output turns opposite to input`;document.querySelector('#gearA').style.animationDuration=`${60/speed}s`;document.querySelector('#gearB').style.animationDuration=`${60/out}s`; }
 if(['physicsSpeed','physicsAngle','physicsGravity'].includes(e.target.id))drawPhysics();
});
let moleculeDrag=false;
document.addEventListener('pointerdown',e=>{if(e.target.closest('#moleculeStage')){moleculeDrag=true;e.target.setPointerCapture?.(e.pointerId);}});
document.addEventListener('pointermove',e=>{if(moleculeDrag){const obj=document.querySelector('#moleculeObject');if(obj)obj.style.setProperty('--mol-rotate',`${(e.clientX*0.8+e.clientY*0.4)%360}deg`);}const stage=e.target.closest?.('#avatarStage');if(stage&&e.buttons){const r=stage.getBoundingClientRect(),avatar=document.querySelector('#demoAvatar');avatar.style.transform=`translateX(${Math.max(-100,Math.min(100,e.clientX-r.left-r.width/2))}px) translateY(${Math.max(-22,Math.min(22,e.clientY-r.top-r.height/2))}px)`;}});
document.addEventListener('pointerup',()=>{moleculeDrag=false;});
document.addEventListener('keydown',e=>{if(!modal.classList.contains('open'))return;if(e.key==='ArrowLeft'||e.key.toLowerCase()==='a'){const b=document.querySelector('[data-runner="left"]');if(b)b.click();}if(e.key==='ArrowRight'||e.key.toLowerCase()==='d'){const b=document.querySelector('[data-runner="right"]');if(b)b.click();}});

// Restore deep-linked screens on refresh (including the live webcam studio).
const initialScreen=decodeURIComponent(window.location.hash.slice(1));
if(initialScreen&&screenNames[initialScreen])setTimeout(()=>navigate(initialScreen),0);

function setLowPerformance(enabled){document.body.classList.toggle('low-performance',enabled);localStorage.setItem('eduverse-low-performance',String(enabled));const button=document.querySelector('#visionLowPerformance');if(button){button.setAttribute('aria-pressed',String(enabled));button.textContent=`Low performance: ${enabled?'on':'off'}`;}}
function applyDisplayTheme(theme,persist=true){const systemDark=window.matchMedia?.('(prefers-color-scheme: dark)').matches;document.body.classList.toggle('dark-mode',theme==='dark'||(theme==='system'&&systemDark));document.body.dataset.theme=theme;localStorage.setItem('eduverse-theme',theme);const setting=document.querySelector('#themeSetting span');if(setting)setting.textContent=`${theme[0].toUpperCase()+theme.slice(1)} · Change`;const toggle=document.querySelector('#themeToggle');if(toggle){const dark=document.body.classList.contains('dark-mode');toggle.setAttribute('aria-pressed',String(dark));toggle.setAttribute('aria-label',`Switch to ${dark?'light':'dark'} mode`);toggle.innerHTML=`${dark?'☾':'☼'} <span>${dark?'Dark':'Light'}</span>`;}if(persist)apiRequest('/profile',{method:'PATCH',body:JSON.stringify({preferences:{theme}})}).then(({profile})=>{if(currentUser&&profile)currentUser.preferences=profile.preferences;}).catch(()=>{});}
function openAccessibilitySettings(){const flags=['high-contrast','large-text','reduce-motion','low-performance'];openModal(`<h2 id="modalTitle">Accessibility & device options</h2><p>Camera use is optional. Every lab has click, keyboard, slider, or mouse controls. The 2D map and low-performance mode are available for simpler devices.</p><div class="cv-control-row">${flags.map(flag=>`<button class="filter-select" data-a11y-toggle="${flag}" aria-pressed="${document.body.classList.contains(flag)}">${flag.replaceAll('-',' ')}: ${document.body.classList.contains(flag)?'on':'off'}</button>`).join('')}</div><button class="filter-select" id="open2dFallback">Open 2D campus map →</button>`);}
function toggleAccessibility(flag){const allowed=['high-contrast','large-text','reduce-motion','low-performance'];if(!allowed.includes(flag))return;const enabled=!document.body.classList.contains(flag);document.body.classList.toggle(flag,enabled);localStorage.setItem(`eduverse-${flag}`,String(enabled));if(flag==='low-performance')setLowPerformance(enabled);document.querySelectorAll(`[data-a11y-toggle="${flag}"]`).forEach(button=>{button.setAttribute('aria-pressed',String(enabled));button.textContent=`${flag.replaceAll('-',' ')}: ${enabled?'on':'off'}`;});}
async function restoreDisplayPreferences(){const theme=localStorage.getItem('eduverse-theme');applyDisplayTheme(['light','dark','system'].includes(theme)?theme:'system',false);setLowPerformance(localStorage.getItem('eduverse-low-performance')==='true');for(const flag of ['high-contrast','large-text','reduce-motion'])document.body.classList.toggle(flag,localStorage.getItem(`eduverse-${flag}`)==='true');}
restoreDisplayPreferences();
applyInstitutionBranding();



// Authentication and role portals. Authorization comes from the server session cookie.
if(location.protocol==='file:')location.replace(`http://127.0.0.1:4173${location.hash||''}`);
const authRoot=document.querySelector('#authRoot');
let currentUser=null;
const roleNames={student:'Student',teacher:'Teacher',parent:'Parent',admin:'Administrator',super_admin:'Super Administrator',institution_admin:'Institution Admin'};
const ADMIN_ROLES=['admin','super_admin','institution_admin'];
const isAdminRole=r=>ADMIN_ROLES.includes(r);
function expandAdminRoles(){for(const k of Object.keys(screenRole)){if(screenRole[k].includes('admin')){for(const r of['super_admin','institution_admin'])if(!screenRole[k].includes(r))screenRole[k].push(r);}}}
const portalScreens={
 student:[['LEARN',[['overview','◫','Overview'],['player','⌘','My learning labs'],['twin','◉','Learning twin'],['community','◎','Community'],['campus','⌂','3D Campus'],['classroom','▣','Classroom'],['library','▥','Library'],['notes','✎','My notes'],['syllabus','⌨','Coding paths']]],['YOUR SPACE',[['catalog','▤','Course catalog'],['marketplace','◈','Marketplace'],['assignments','▧','Assignments'],['fees','₹','My fees'],['today','◷','My class today'],['timetable','▦','Timetable'],['profile','⌁','Progress & profile'],['notifications','♧','Notifications'],['feedback','✉','Send feedback']]]],
 teacher:[['TEACHING',[['teacher','◫','Dashboard'],['teacher-classes','▣','My classes'],['teacher-students','♙','Students'],['teacher-attendance','✓','Attendance'],['teacher-courses','▤','Courses'],['teacher-assignments','▧','Assignments'],['teacher-grading','✎','Grading'],['teacher-analytics','▥','Learning analytics'],['teacher-timetable','▦','Timetable']]],['CLASSROOM & SUPPORT',[['drawing','✎','Webcam drawing'],['vision-labs','◈','Vision & simulation lab'],['teacher-announcements','♧','Announcements'],['announcements','♧','Institution notices'],['teacher-vision','◈','Vision lab assignments'],['classroom','▣','Classroom & whiteboard'],['library','▥','Teaching library'],['marketplace','◈','Marketplace'],['teacher-settings','⌑','Account security'],['notifications','♧','Notifications'],['feedback','✉','Send feedback']]]],
 parent:[['FAMILY',[['parent-dashboard','◫','Dashboard'],['announcements','♧','Announcements']]],['ACCOUNT',[['profile','⌁','Profile'],['notifications','♧','Notifications'],['feedback','✉','Send feedback']]]],
 admin:[['CONTROL CENTER',[['admin','◫','Overview'],['admin-users','♙','Users & approvals'],['admin-teachers','✦','Teachers'],['admin-students','♙','Students'],['admin-classes','▣','Classes & enrollment'],['admin-courses','▤','Courses'],['admin-institutions','⌂','Institutions & terms'],['admin-calendar','▦','Academic calendar'],['admin-enrollments','▧','Enrollments'],['admin-fees','₹','Fees'],['admin-subscriptions','◈','Subscriptions'],['admin-marketplace','▤','Marketplace']]],['GOVERNANCE & REPORTS',[['admin-roles','⚿','Roles & permissions'],['admin-reports','▥','Reports'],['admin-import','⇪','Bulk import'],['admin-analytics','◉','Usage analytics'],['admin-audit','≋','Audit log'],['admin-security','⌑','Security & MFA'],['admin-announcements','♧','Announcements'],['admin-settings','⚙','Platform settings'],['admin-integrations','◈','Integrations'],['admin-backup','⛁','Backup & restore'],['notifications','♧','Notifications']]]]
};
portalScreens.super_admin=portalScreens.admin;
portalScreens.institution_admin=portalScreens.admin;
const screenRole={teacher:['teacher'],admin:['admin'],'teacher-timetable':['teacher'],'teacher-classes':['teacher'],'teacher-students':['teacher'],'teacher-attendance':['teacher'],'teacher-courses':['teacher'],'teacher-assignments':['teacher'],'teacher-grading':['teacher'],'teacher-analytics':['teacher'],'teacher-announcements':['teacher'],'teacher-vision':['teacher'],'teacher-settings':['teacher'],'admin-users':['admin'],'admin-teachers':['admin'],'admin-students':['admin'],'admin-classes':['admin'],'admin-courses':['admin'],'admin-institutions':['admin'],'admin-enrollments':['admin'],'admin-roles':['admin'],'admin-reports':['admin'],'admin-audit':['admin'],'admin-security':['admin'],'admin-settings':['admin'],'admin-integrations':['admin'],'overview':['student'],'catalog':['student'],'marketplace':['student','teacher','admin'],'fees':['student'],'player':['student'],'twin':['student'],'community':['student'],'campus':['student'],'drawing':['teacher'],'vision-labs':['teacher'],'vision-lab':['teacher'],'today':['student'],'timetable':['student'],'notes':['student'],'syllabus':['student'],'languages':['student'],'assignments':['student'],'profile':['student','parent'],'onboarding':['student'],'parent-dashboard':['parent'],'announcements':['student','teacher','parent','admin'],'admin-announcements':['admin'],'admin-fees':['admin'],'admin-subscriptions':['admin'],'admin-marketplace':['admin'],'admin-import':['admin'],'admin-analytics':['admin'],'admin-backup':['admin']};
expandAdminRoles();
screenRole['admin-calendar']=['admin','super_admin','institution_admin'];
function authView(mode='welcome',role='student',message=''){
 if(!authRoot)return;delete document.body.dataset.portalRole;authRoot.hidden=false;document.querySelector('.app-shell').hidden=true;document.querySelector('#chatLauncher').hidden=true;
 const brand='<div class="auth-brand"><span class="brand-icon">e</span><span><b>eduverse<span class="brand-dot">.</span></b><small>LEARNING SPACE</small></span><select id="langSwitchAuth" class="lang-switch auth-lang-switch" aria-label="'+tx('hdr_language')+'">'+UI_LANGS.map(l=>'<option value="'+l+'" '+(l===uiLang?'selected':'')+'>'+(UI_LANG_NAMES[l]||l)+'</option>').join('')+'</select></div>';
 const AUTH_FIELD_KEYS={'Username or email address':'auth_field_user','Password':'auth_field_password','Full name':'auth_field_name','Username':'auth_field_username','Password (12+ characters)':'auth_field_password12','Administrator setup code':'auth_field_setup_code','Email address':'auth_field_email','Recovery code':'auth_field_recovery_code','New password (12+ characters)':'auth_field_new_password','Authenticator code (only if MFA is enabled)':'auth_field_mfa'};
const field=(label,name,type='text',attrs='')=>{label=tx(AUTH_FIELD_KEYS[label]||'x_'+label,label);return `<label class="auth-field">${label}${type==='password'?`<span class="auth-password-wrap"><input name="${name}" type="${type}" ${attrs} required><button class="password-toggle" type="button" aria-label="Show password">Show</button></span>`:`<input name="${name}" type="${type}" ${attrs} required>`}</label>`};
 const googleBtnMarkup=`<div class="google-auth-wrap" hidden><div class="auth-divider"><span>or</span></div><a class="google-btn" href="/api/auth/google"><span class="google-g">G</span> Continue with Google</a><p class="panel-copy google-note">New Google accounts join as students. Teachers are approved by an administrator afterwards.</p></div>`;
 const legalConsent=`<section class="legal-consent"><div class="legal-scroll" tabindex="0" aria-label="Terms and privacy summary. Scroll to the end to enable agreement."><h2>Terms of use</h2><p>Use EduVerse responsibly for educational purposes. Keep your account credentials private. Teacher access may need administrator approval. Do not access other users’ records without authorization.</p><h2>Privacy notice</h2><p>EduVerse stores account and learning records on the server running this prototype. Teachers and administrators may access records needed for their role. Optional camera activities send frames to the local OpenCV service for processing. See the full notices for details and current limitations.</p><p><a href="/terms.html" target="_blank" rel="noopener">Read the full Terms of Use</a> · <a href="/privacy.html" target="_blank" rel="noopener">Read the full Privacy Notice</a></p><p>These notices describe the current prototype and require operator/legal review before production use.</p></div><label class="auth-check"><input type="checkbox" name="terms" required disabled> I have read and agree to the <a href="/terms.html" target="_blank" rel="noopener">Terms</a> and acknowledge the <a href="/privacy.html" target="_blank" rel="noopener">Privacy Notice</a>.</label><p class="legal-scroll-hint" aria-live="polite">Scroll the notice to the end to enable agreement.</p></section>`;
 const otpMarkup=`<div class=\"demo-otp-block\"><label class=\"auth-field\">Verification code *<span class=\"demo-otp-row\"><input name=\"otpCode\" type=\"text\" inputmode=\"numeric\" pattern=\"[0-9]{4,8}\" maxlength=\"8\" autocomplete=\"one-time-code\" required><button type=\"button\" data-demo-otp-send>Send demo OTP</button><button type=\"button\" data-demo-otp-verify>Verify</button></span></label><input type=\"hidden\" name=\"otpVerified\" value=\"false\"><p class=\"demo-otp-status\">Demo mode: codes are not sent. After selecting Send demo OTP, any 4–8 digit code is accepted.</p></div>`;
 const roleCard=(r,icon,title,copy)=>`<button class="role-card ${role===r?'selected':''}" data-auth-role="${r}" type="button"><span>${icon}</span><b>${title}</b><small>${copy}</small></button>`;
 let content='';
 if(mode==='welcome')content=`<div class="auth-hero"><p class="eyebrow">${tx('auth_welcome_kicker')}</p><h1>${tx('auth_welcome_title')}</h1><p>${tx('auth_welcome_sub')}</p><div class="auth-highlights"><span>${tx('auth_hl1')}</span><span>${tx('auth_hl2')}</span><span>${tx('auth_hl3')}</span></div><div class="auth-actions"><button class="primary-btn" data-auth-mode="roles">${tx('auth_signup_first')}</button><button class="filter-select" data-auth-mode="signin-roles">${tx('auth_signin_existing')}</button><button class="filter-select" data-auth-mode="setup">${tx('auth_setup_admin')}</button></div></div><div class="auth-side"><p class="eyebrow">${tx('auth_your_eduverse')}</p><h2>${tx('auth_choose_space')}</h2><p>${tx('auth_choose_space_sub')}</p><div class="role-card-grid">${roleCard('student','⌘',tx('role_student'),tx('role_student_copy'))}${roleCard('teacher','✦',tx('role_teacher'),tx('role_teacher_copy'))}${roleCard('parent','♡',tx('role_parent'),tx('role_parent_copy'))}${roleCard('admin','⚙',tx('role_admin'),tx('role_admin_copy'))}</div></div>`;
 else if(mode==='roles'||mode==='signin-roles')content=`<div class="auth-form-head"><p class="eyebrow">${tx('auth_roles_kicker')}</p><h1>${mode==='signin-roles'?'Sign in to your account':tx('auth_roles_title')}</h1><p>${mode==='signin-roles'?'Choose your role to continue to the correct sign-in page.':tx('auth_roles_sub')}</p></div><div class="role-card-grid role-card-grid-large">${roleCard('student','⌘',tx('role_student'),tx('auth_roles_student_copy'))}${roleCard('teacher','✦',tx('role_teacher'),tx('auth_roles_teacher_copy'))}${roleCard('parent','♡',tx('role_parent'),tx('auth_roles_parent_copy'))}${roleCard('admin','⚙',tx('role_admin'),tx('role_admin_copy'))}</div><div class="auth-actions"><button class="primary-btn" data-auth-mode="${mode==='signin-roles'?'signin-selected':'signup'}">${tx('auth_continue')}</button><button class="filter-select" data-auth-mode="welcome">${tx('auth_back')}</button></div>`;
 else if(mode==='signin')content=`<div class="auth-form-head"><p class="eyebrow">${tx('auth_signin_kicker')} · ${roleNames[role].toUpperCase()}</p><h1>${tx('auth_signin_title')}</h1><p>${tx('auth_signin_sub')}</p></div><form id="authSignin" class="auth-form">${field('Username or email address','identifier','text','autocomplete="username"')}${field('Password','password','password','autocomplete="current-password"')}${['teacher','admin','super_admin','institution_admin'].includes(role)?`<label class="auth-field">Authenticator code (only if MFA is enabled)<input name="mfaCode" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code"></label>`:''}<button class="auth-inline" type="button" data-auth-mode="forgot">${tx('auth_forgot')}</button>${message?`<p class="auth-message" role="alert">${safeText(message)}</p>`:''}<button class="primary-btn" type="submit">${tx('auth_signin_btn')}</button>${googleBtnMarkup}</form><p class="auth-switch">${tx('auth_new_here')} <button data-auth-mode="roles">${tx('auth_create_account')}</button></p>`;
 else if(mode==='signup')content=`<div class="auth-form-head"><p class="eyebrow">${roleNames[role].toUpperCase()} ${tx('auth_account_word')}</p><h1>${tx('auth_signup_title')}</h1><p>${role==='teacher'?tx('auth_signup_teacher_sub'):role==='parent'?tx('auth_signup_parent_sub'):tx('auth_signup_student_sub')}</p></div><form id="authSignup" class="auth-form">${field('Full name','name','text','autocomplete="name" maxlength="80"')}${field('Username','username','text','autocomplete="username" minlength="3" maxlength="30" pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,29}"')}${role==='teacher'?otpMarkup:''}${field('Password (12+ characters)','password','password','autocomplete="new-password" minlength="12"')}<label class="auth-field">${tx('auth_field_confirm')}<span class="auth-password-wrap"><input name="confirmPassword" type="password" autocomplete="new-password" required><button class="password-toggle" type="button" aria-label="Show password">Show</button></span></label>${legalConsent}${message?`<p class="auth-message" role="alert">${safeText(message)}</p>`:''}<button class="primary-btn" type="submit">${tx('auth_create_btn')}</button>${googleBtnMarkup}</form><p class="auth-switch">${tx('auth_have_account')} <button data-auth-mode="signin-roles">${tx('auth_signin_link')}</button></p>`;
 else if(mode==='setup')content=`<div class="auth-form-head"><p class="eyebrow">${tx('auth_setup_kicker')}</p><h1>${tx('auth_setup_title')}</h1><p>${tx('auth_setup_sub')}</p></div><form id="authSetup" class="auth-form">${field('Full name','name','text','autocomplete="name" maxlength="80"')}${field('Username','username','text','autocomplete="username" minlength="3" maxlength="30" pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,29}"')}${field('Administrator setup code','setupCode','password','autocomplete="off" minlength="6" maxlength="64"')}${otpMarkup}${field('Password (12+ characters)','password','password','autocomplete="new-password" minlength="12"') }<label class="auth-field">${tx('auth_field_confirm')}<span class="auth-password-wrap"><input name="confirmPassword" type="password" autocomplete="new-password" required><button class="password-toggle" type="button" aria-label="Show password">Show</button></span></label>${legalConsent}${message?`<p class="auth-message" role="alert">${safeText(message)}</p>`:''}<button class="primary-btn" type="submit">${tx('auth_create_admin_btn')}</button></form><p class="auth-switch">${tx('auth_have_account')} <button data-auth-mode="signin-roles">${tx('auth_signin_link')}</button></p>`;
 else if(mode==='forgot')content=`<div class="auth-form-head"><p class="eyebrow">${tx('auth_forgot_kicker')}</p><h1>${tx('auth_forgot_title')}</h1><p>${tx('auth_forgot_sub')}</p></div><form id="authForgotForm" class="auth-form"><label class="auth-field">Email address<input name="email" type="email" required></label><button class="primary-btn" type="submit">${tx('auth_request_recovery')}</button><p id="forgotStatus" class="panel-copy"></p></form><form id="authResetForm" class="auth-form"><label class="auth-field">Recovery code<input name="token" type="text" required></label><label class="auth-field">New password (12+ characters)<input name="password" type="password" minlength="12" required></label><button class="primary-btn" type="submit">${tx('auth_set_password')}</button><p id="resetStatus" class="panel-copy"></p></form><p class="auth-switch"><button data-auth-mode="signin">${tx('auth_back_to_signin')}</button></p>`;
 const backControl=mode==='welcome'?'':`<button class="auth-back" id="authBack" type="button">${tx('auth_back_btn')}</button>`;
 authRoot.innerHTML=`${brand}<main class="auth-card ${mode==='welcome'?'auth-welcome':''}">${backControl}${content}</main><footer class="auth-footer">${tx('auth_footer')} <span>EduVerse 3D</span></footer>`;
 authRoot.dataset.mode=mode;authRoot.dataset.role=role;
 requestAnimationFrame(()=>authRoot.scrollTo({top:0,behavior:'smooth'}));
 checkGoogleStatus();
}
// Google sign-in is env-optional on the server: the button only appears when the
// backend reports it configured. Any failure here hides the button (fail closed).
let googleConfigured=null;
async function checkGoogleStatus(){
  const show=()=>{document.querySelectorAll('.google-auth-wrap').forEach(w=>{w.hidden=!googleConfigured;});};
  if(googleConfigured!==null){show();return googleConfigured;}
  try{
    const res=await fetch(`${API_BASE}/auth/google/status`,{cache:'no-store'});
    const d=await res.json().catch(()=>({}));
    googleConfigured=res.ok&&(d.configured===true||d.enabled===true||d.available===true||d.googleConfigured===true||d.status==='configured');
  }catch{googleConfigured=false;}
  show();return googleConfigured;
}
function promptMissingDetails(user){
 if(!user||sessionStorage.getItem('eduverse-profile-prompt-dismissed')==='true')return;
 if(user.email&&user.phone&&user.age&&user.institution)return;
 openModal(`<h2 id="modalTitle">Complete your account details</h2><p>Welcome, ${safeText(user.name)}. Add your Gmail, mobile number, age, and school or workspace. You can finish this later.</p><div class="profile-completion-form"><label class="auth-field">Full name<input id="contactName" value="${safeText(user.name||'')}" maxlength="80" required></label><label class="auth-field">Gmail or email address<input id="contactEmail" type="email" value="${safeText(user.email||'')}" autocomplete="email" required></label><label class="auth-field">Mobile number<input id="contactPhone" type="tel" autocomplete="tel" placeholder="Include country code if needed" required></label><label class="auth-field">Age<input id="contactAge" type="number" min="5" max="120" value="${safeText(user.age||'')}" required></label><label class="auth-field">School or workspace<input id="contactInstitution" value="${safeText(user.institution||'')}" placeholder="Enter Personal workspace if you do not belong to a school" maxlength="120" required></label><p id="contactDetailsStatus" class="panel-copy" role="alert"></p><div class="profile-completion-actions"><button class="primary-btn" id="saveContactDetails" type="button">Save details →</button><button class="filter-select" id="deferProfileDetails" type="button">I’ll do this later</button></div></div>`);
}
function renderPortalShell(user){
 currentUser=user;appScreenHistory=[];activeRole=user.role;document.body.dataset.portalRole=user.role;authRoot.hidden=true;document.querySelector('.app-shell').hidden=false;document.querySelector('#chatLauncher').hidden=false;
 const sections=portalScreens[user.role]||portalScreens.student,nav=document.querySelectorAll('.sidebar nav');nav.forEach((n,i)=>{const group=sections[i];n.innerHTML=group?group[1].filter(([id])=>id!=='admin-roles'||user.role!=='institution_admin').map(([id,icon,label])=>`<a class="nav-item" href="#${id}" data-screen="${id}"><span>${icon}</span> ${label}</a>`).join(''):'';const label=document.querySelectorAll('.sidebar .nav-label')[i];if(label)label.textContent=group?group[0]:'';});
 const workspaceTitle=user.role==='teacher'?`${user.name}’s teaching workspace`:user.role==='parent'?`${user.name}’s family space`:isAdminRole(user.role)?`${user.name}’s administration console`:`${user.name}’s learning space`;
 const workspaceSub=user.role==='teacher'?`Teaching workspace${user.status==='pending'?' · pending approval':''}`:user.role==='parent'?'Family space':isAdminRole(user.role)?'Administration console':'Learning space';
 const workspace=document.querySelector('#workspaceDetails');workspace.innerHTML=`<span class="avatar">${safeText(user.name.split(/\s+/).map(n=>n[0]).slice(0,2).join('').toUpperCase())}</span><div><b>${safeText(workspaceTitle)}</b><small>${workspaceSub}</small></div><span class="chevron">⌄</span>`;
 document.querySelector('#sidebarUserName').textContent=user.name;document.querySelector('#sidebarUserRole').textContent=`${roleNames[user.role]} account`;document.querySelector('#roleIndicator').textContent=`${roleNames[user.role]} Portal`;
 const brandSmall=document.querySelector('.sidebar .brand small');if(brandSmall)brandSmall.textContent=user.role==='teacher'?'TEACHING WORKSPACE':user.role==='parent'?'FAMILY SPACE':isAdminRole(user.role)?'ADMINISTRATION CONSOLE':'LEARNING SPACE';
 const helpTitle=document.querySelector('.help-card b');if(helpTitle)helpTitle.textContent=user.role==='teacher'?'Teaching help':user.role==='parent'?'Family help':isAdminRole(user.role)?'Admin help':'Need a hand?';
 const helpText=document.querySelector('.help-card p');if(helpText)helpText.textContent=user.role==='teacher'?'Classes, grading, attendance and analytics are in your sidebar.':user.role==='parent'?'Link your child with their code, then follow their progress here.':isAdminRole(user.role)?'User approvals, permissions, reports and the audit log are in your sidebar.':'Your learning guide is here whenever you need it.';
 const initials=user.name.split(/\s+/).map(n=>n[0]).slice(0,2).join('').toUpperCase();const topAvatar=document.querySelector('.top-avatar');if(topAvatar)topAvatar.textContent=initials;const profileAvatar=document.querySelector('.profile-avatar');if(profileAvatar)profileAvatar.textContent=initials;
 const name=document.querySelector('.welcome h1');if(name)name.innerHTML=`A little progress adds up,<br><span>${safeText(user.name.split(/\s+/)[0])}.</span>`;
 if(isAdminRole(user.role)){navigate('admin');}else navigate(user.role==='teacher'?'teacher':user.role==='parent'?'parent-dashboard':'overview');setTimeout(()=>promptMissingDetails(user),180);
}
function portalCrumb(){return currentUser?.role==='teacher'?'Teaching workspace':currentUser?.role==='parent'?'Family space':isAdminRole(currentUser?.role)?'Administration':'My workspace';}
function roleHome(){return currentUser?.role==='teacher'?'teacher':currentUser?.role==='parent'?'parent-dashboard':isAdminRole(currentUser?.role)?'admin':'overview';}
function navigateForRole(name){const restricted=screenRole[name];if(!restricted)return true;if(!currentUser){authRoot.hidden=false;return false;}if(restricted.includes(currentUser.role))return true;const home=roleHome();if(name!==home)navigate(home);return false;}
const navigateBeforeAuth=navigate;navigate=function(name,options={}){if(!navigateForRole(name))return;navigateBeforeAuth(name,options);if(name==='admin')loadAdminDashboard();};
function safeRoleFromUser(user){return ['student','teacher','parent','admin','super_admin','institution_admin'].includes(user?.role)?user.role:'student';}
async function authRequest(path,body){const res=await fetch(`/api/auth/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||'We could not complete that request.');return data;}
async function restoreSession(){
  const params=new URLSearchParams(location.search),googleResult=params.get('google');
  if(googleResult==='ok'||googleResult==='error'){try{history.replaceState(null,'',location.pathname);}catch{}}
  try{
    const res=await fetch('/api/auth/me',{cache:'no-store'});if(!res.ok)throw new Error('No session');
    const {user}=await res.json();
    if(user.status==='pending'){authView('signin',user.role,'Your teacher access request is waiting for administrator approval.');return;}
    renderPortalShell({...user,role:safeRoleFromUser(user)});
    if(googleResult==='ok'){lmsToast('Signed in with Google.');
      // Google callback can't carry tokens in the URL — exchange the fresh session for a JWT pair.
      try{const tok=await fetch('/api/auth/token',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(tok.ok)storeAuthTokens(await tok.json());}catch{}}
    else if(googleResult==='error')lmsToast('Google sign-in did not complete. You are still signed in.');
  }catch{
    if(googleResult==='ok')authView('signin','student','Google sign-in finished, but your session could not be restored. Please sign in.');
    else if(googleResult==='error')authView('signin','student','Google sign-in did not complete. Try again, or sign in with your username and password.');
    else authView('welcome');
  }
}
async function loadAdminDashboard(){const root=document.querySelector('.content');if(!root||!currentUser||!isAdminRole(currentUser.role))return;root.innerHTML=`<div class="screen-title"><p class="eyebrow">INSTITUTION ADMINISTRATION</p><h1>Admin dashboard</h1><p>Monitor EduVerse accounts and manage access. Account controls are enforced by the server.</p></div><div class="admin-metrics" id="adminMetrics"><article class="admin-metric"><small>REGISTERED USERS</small><b>—</b></article><article class="admin-metric"><small>STUDENTS</small><b>—</b></article><article class="admin-metric"><small>TEACHERS</small><b>—</b></article><article class="admin-metric"><small>PENDING APPROVAL</small><b>—</b></article><article class="admin-metric"><small>CLASSES</small><b>—</b></article></div><section class="admin-columns"><article class="screen-panel admin-users"><div class="panel-heading"><div><p class="eyebrow">USER MANAGEMENT</p><h3>Accounts & access</h3></div><input id="adminUserSearch" class="search-field" placeholder="Search users" aria-label="Search users"></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Action</th></tr></thead><tbody id="adminUsers"><tr><td colspan="5">Loading authorized user records…</td></tr></tbody></table></div></article><aside class="screen-panel"><p class="eyebrow">ROLE PERMISSIONS</p><h3>Access boundaries</h3><div class="permission-list"><div><b>Student</b><span>Courses, assignments, own progress, learning labs</span></div><div><b>Teacher</b><span>Classroom tools and teaching workflows</span></div><div><b>Administrator</b><span>User approvals and account status controls</span></div></div><p class="admin-note">Role changes are recorded in the audit log. Public registration cannot create administrator accounts.</p></aside></section><section class="screen-panel admin-classes"><p class="eyebrow">CLASS MANAGEMENT</p><h3>Create a class and enroll learners</h3><form id="adminClassForm" class="teacher-form"><input aria-label="Class name" name="name" placeholder="Class name" maxlength="100" required><input aria-label="Subject" name="subject" placeholder="Subject"><label>Teachers<select name="teacherIds" id="adminClassTeachers" multiple required></select></label><label>Students<select name="studentIds" id="adminClassStudents" multiple></select></label><button class="primary-btn">Create class →</button><p class="panel-copy">Only active student accounts and approved teachers can be added.</p></form><div id="adminClassList" class="teacher-records"></div></section><section class="screen-panel admin-audit"><p class="eyebrow">RECENT ADMIN ACTIVITY</p><div id="adminAudit">Loading audit activity…</div></section>`;loadAdminUsers();loadAdminClasses();}
async function loadAdminUsers(query=''){try{const {users,metrics,audit}=await apiRequest(`/admin/users?q=${encodeURIComponent(query)}`);const vals=[metrics.total,metrics.students,metrics.teachers,metrics.pendingTeachers,metrics.classes||0];document.querySelectorAll('#adminMetrics .admin-metric b').forEach((el,i)=>el.textContent=vals[i]);const tbody=document.querySelector('#adminUsers');if(tbody)tbody.innerHTML=users.map(u=>`<tr><td>${safeText(u.name)}</td><td>${safeText(u.email||u.username||'Contact details pending')}</td><td><span class="admin-role-pill">${roleNames[u.role]||u.role}</span></td><td><span class="account-status ${u.status}">${u.status}</span></td><td>${u.role==='teacher'&&u.status==='pending'?`<button data-admin-action="approve" data-user-id="${safeText(u.id)}">Approve</button><button data-admin-action="reject" data-user-id="${safeText(u.id)}">Reject</button>`:''}${u.role==='student'?`<button data-admin-linkparent="${safeText(u.id)}" data-admin-linkname="${safeText(u.name)}">Link parent</button>`:''}${u.role!=='admin'?`<button data-admin-action="${u.status==='rejected'?'restore':u.status==='active'?'suspend':'activate'}" data-user-id="${safeText(u.id)}">${u.status==='rejected'?'Restore':u.status==='active'?'Suspend':'Activate'}</button><button data-admin-recovery="${safeText(u.id)}">Recovery code</button>`: 'Protected'}</td></tr>`).join('')||'<tr><td colspan="5">No matching accounts.</td></tr>';const log=document.querySelector('#adminAudit');if(log)log.innerHTML=audit.slice(0,8).map(a=>`<div class="audit-row"><b>${safeText(a.action)}</b><span>${safeText(a.target||'Account')}</span><small>${new Date(a.at).toLocaleString()}</small></div>`).join('')||'<p>No administrative actions yet.</p>';}catch(err){const tbody=document.querySelector('#adminUsers');if(tbody)tbody.innerHTML=`<tr><td colspan="5">${safeText(err.message)}</td></tr>`;}}
async function loadAdminClasses(){try{const {classes,users}=await apiRequest('/admin/classes');for(const [id,role] of [['adminClassTeachers','teacher'],['adminClassStudents','student']]){const select=document.querySelector('#'+id);if(select)select.innerHTML=users.filter(u=>u.role===role).map(u=>`<option value="${safeText(u.id)}">${safeText(u.name)}${role==='student'&&u.registrationNumber?` · ${safeText(u.registrationNumber)}`:''}${role==='student'&&u.rollNumber?` · Roll ${safeText(u.rollNumber)}`:''} · ${safeText(u.email||u.username||'Contact details pending')}</option>`).join('');}const root=document.querySelector('#adminClassList');if(root)root.innerHTML=classes.map(c=>`<div class="teacher-record"><b>${safeText(c.name)}</b><small>${safeText(c.subject)} · ${c.teachers.length} teacher${c.teachers.length===1?'':'s'} · ${c.students.length} student${c.students.length===1?'':'s'}</small></div>`).join('')||'<p class="panel-copy">No classes have been created yet.</p>';document.querySelectorAll('#adminMetrics .admin-metric b')[4]?.replaceChildren(String(classes.length));}catch{}}
let teacherClasses=[],adminStudentRecords=[];function localDateInput(date=new Date()){return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,10);}async function loadStaffAttendanceRoster(){const f=document.querySelector('#staffAttendanceForm'),root=document.querySelector('#staffAttendanceRoster'),status=document.querySelector('#staffAttendanceStatus');if(!f||!root)return;const classId=f.classId.value,date=f.date.value;if(!classId){root.innerHTML='<p class="staff-empty">Choose a class to load its student roster.</p>';return;}if(!date){root.innerHTML='<p class="staff-empty">Choose a date to load the roster.</p>';return;}root.innerHTML='<p class="staff-empty">Loading class roster…</p>';try{const {class:klass,students,attendance}=await apiRequest(`/teacher/attendance?classId=${encodeURIComponent(classId)}&date=${encodeURIComponent(date)}`),saved=new Map((attendance||[]).map(item=>[item.studentId,item.status]));root.innerHTML=`<div class="attendance-roster-head"><div><b>${safeText(klass.name)}</b><span>${students.length} enrolled student${students.length===1?'':'s'} · ${new Date(`${date}T00:00:00`).toLocaleDateString()}</span></div><div class="attendance-bulk"><button type="button" data-attendance-all="present">All present</button><button type="button" data-attendance-all="absent">All absent</button><button type="button" data-attendance-all="late">All late</button></div></div>${students.length?`<div class="attendance-list">${students.map((student,index)=>`<div class="attendance-person"><span class="attendance-index">${index+1}</span><span class="attendance-student-name"><b>${safeText(student.name)}</b><small>${safeText([student.registrationNumber&&`Reg. ${student.registrationNumber}`,student.rollNumber&&`Roll ${student.rollNumber}`,[student.grade,student.section].filter(Boolean).join(' · ')].filter(Boolean).join(' · ')||'Registration and roll numbers not assigned')}</small></span><label class="attendance-status-field">Status<select data-student-id="${safeText(student.id)}" required><option value="" ${saved.has(student.id)?'':'selected'} disabled>Choose status</option><option value="present" ${saved.get(student.id)==='present'?'selected':''}>Present</option><option value="absent" ${saved.get(student.id)==='absent'?'selected':''}>Absent</option><option value="late" ${saved.get(student.id)==='late'?'selected':''}>Late</option></select></label></div>`).join('')}</div>`:'<p class="staff-empty">No active students are enrolled. Ask an administrator to assign students.</p>'}`;if(status)status.textContent=attendance?.length?'Saved attendance loaded. Changes update this date’s record.':'';const submit=f.querySelector('[type="submit"]');if(submit)submit.disabled=!students.length;}catch(err){root.innerHTML=`<p class="staff-empty">${safeText(err.message||'Could not load the roster.')}</p>`;}}function renderAttendanceRoster(classId){const klass=teacherClasses.find(c=>c.id===classId),root=document.querySelector('#attendanceRoster');if(!root)return;const students=klass?.students||[];root.innerHTML=students.map(student=>`<label class="attendance-person"><span><b>${safeText(student.name)}</b><small>${safeText(student.registrationNumber||student.id.slice(0,8))}</small></span><select data-student-id="${safeText(student.id)}"><option value="present">Present</option><option value="absent">Absent</option><option value="late">Late</option></select></label>`).join('')||'<p class="panel-copy">Choose an assigned class to mark attendance.</p>';const save=document.querySelector('#saveAttendance');if(save)save.disabled=!students.length;}
async function loadTeacherClasses(){try{const {classes}=await apiRequest('/teacher');teacherClasses=classes||[];document.querySelectorAll('.teacher-class-select').forEach(select=>{const selected=select.value;select.innerHTML='<option value="">Choose class</option>'+teacherClasses.map(c=>`<option value="${safeText(c.id)}">${safeText(c.name)}</option>`).join('');if(teacherClasses.some(c=>c.id===selected))select.value=selected;});const attendance=document.querySelector('#attendanceClass');if(attendance&&teacherClasses.length===1){attendance.value=teacherClasses[0].id;renderAttendanceRoster(attendance.value);}const form=document.querySelector('#staffAttendanceForm');if(form){if(!form.date.value)form.date.value=localDateInput();if(teacherClasses.length===1){form.classId.value=teacherClasses[0].id;loadStaffAttendanceRoster();}}}catch{}}
document.addEventListener('change',e=>{if(e.target.id==='attendanceClass')renderAttendanceRoster(e.target.value);});
let adminSearchTimer;document.addEventListener('input',e=>{if(e.target.id==='adminUserSearch'){clearTimeout(adminSearchTimer);adminSearchTimer=setTimeout(()=>loadAdminUsers(e.target.value),200);}});
document.addEventListener('click',async e=>{
 if(e.target.closest('#pageBack')){const previous=appScreenHistory.pop();if(previous)navigate(previous,{fromHistory:true});else navigate(roleHome(),{fromHistory:true});return;}
 if(e.target.closest('#authBack')){const mode=authRoot.dataset.mode,role=authRoot.dataset.role||'student';const target=mode==='forgot'?'signin':mode==='signin'?'signin-roles':mode==='signin-roles'?'welcome':mode==='roles'?'welcome':'roles';authView(target,role,'');return;}
 if(e.target.closest('#confirmLogout')){try{await authRequest('logout',{refreshToken:getStoredRefreshToken()});}catch{}clearStoredTokens();currentUser=null;appScreenHistory=[];closeModal();authView('welcome');return;}
 if(e.target.closest('#cancelLogout')){closeModal();return;}
 const demoSend=e.target.closest('[data-demo-otp-send]');if(demoSend){const block=demoSend.closest('.demo-otp-block');block.dataset.sent='true';block.querySelector('.demo-otp-status').textContent='Demo OTP requested. Enter any 4–8 digit code, then select Verify.';return;}
 const demoVerify=e.target.closest('[data-demo-otp-verify]');if(demoVerify){const block=demoVerify.closest('.demo-otp-block'),code=block.querySelector('[name=otpCode]').value.trim(),status=block.querySelector('.demo-otp-status');if(block.dataset.sent!=='true'){status.textContent='Select Send demo OTP first.';return;}if(!/^\d{4,8}$/.test(code)){status.textContent='Enter 4–8 digits to verify.';return;}block.querySelector('[name=otpVerified]').value='true';status.textContent='Demo OTP verified.';return;}
 if(e.target.id==='deferProfileDetails'){sessionStorage.setItem('eduverse-profile-prompt-dismissed','true');closeModal();return;}
 if(e.target.id==='saveContactDetails'){const name=document.querySelector('#contactName').value.trim(),email=document.querySelector('#contactEmail').value.trim(),phone=document.querySelector('#contactPhone').value.trim(),age=document.querySelector('#contactAge').value,institution=document.querySelector('#contactInstitution').value.trim(),status=document.querySelector('#contactDetailsStatus');if(!name||!email||!phone||!age||!institution){status.textContent='Fill in each detail to save your profile.';return;}try{const result=await apiRequest('/profile',{method:'PATCH',body:JSON.stringify({name,email,phone,age,institution})});currentUser={...currentUser,...result.profile};sessionStorage.removeItem('eduverse-profile-prompt-dismissed');closeModal();}catch(err){status.textContent=err.message;}}
 const toggle=e.target.closest('.password-toggle');if(toggle){const input=toggle.parentElement.querySelector('input');const visible=input.type==='password';input.type=visible?'text':'password';toggle.textContent=visible?'Hide':'Show';toggle.setAttribute('aria-label',visible?'Hide password':'Show password');return;}
 const mode=e.target.closest('[data-auth-mode]');if(mode){const requested=mode.dataset.authMode;const role=authRoot.dataset.role||'student';const target=requested==='signin-selected'?'signin':requested==='signup'&&role==='admin'?'setup':requested;authView(target,role,'');return;}
 const role=e.target.closest('[data-auth-role]');if(role){authRoot.dataset.role=role.dataset.authRole;authRoot.querySelectorAll('[data-auth-role]').forEach(c=>c.classList.toggle('selected',c===role));if(authRoot.dataset.mode==='welcome'){authView(role.dataset.authRole==='admin'?'setup':'signup',role.dataset.authRole,'');}return;}
 if(e.target.closest('#logoutButton')){openModal(`<h2 id="modalTitle">Sign out of EduVerse?</h2><p>You’ll need to sign in again to return to your workspace.</p><div class="logout-confirm-actions"><button class="primary-btn" id="confirmLogout" type="button">Yes, sign out</button><button class="filter-select" id="cancelLogout" type="button">No, stay signed in</button></div>`);return;}
 const action=e.target.closest('[data-admin-action]');if(action){const label=action.dataset.adminAction==='approve'?'approve this teacher account':`${action.dataset.adminAction} this account`;if(!confirm(`Are you sure you want to ${label}?`))return;try{await apiRequest(`/admin/users/${encodeURIComponent(action.dataset.userId)}`,{method:'PATCH',body:JSON.stringify({action:action.dataset.adminAction})});loadAdminUsers(document.querySelector('#adminUserSearch')?.value||'');}catch(err){alert(err.message);}}
});
document.addEventListener('submit',async e=>{
 if(e.target.id==='authSignin'){e.preventDefault();const f=e.target;const button=f.querySelector('button[type=submit]');button.disabled=true;button.textContent='Signing in…';try{const data=await authRequest('login',{identifier:f.identifier.value.trim(),password:f.password.value,mfaCode:f.mfaCode?f.mfaCode.value.trim():''});storeAuthTokens(data);if(data.user.status==='pending'){authView('signin',data.user.role,'Your teacher access request is waiting for administrator approval.');return;}renderPortalShell(data.user);}catch{authView('signin',authRoot.dataset.role||'student','We couldn’t sign you in. If you have not created an account yet, sign up first, then return here.');}finally{button.disabled=false;}}
 if(e.target.id==='adminClassForm'){e.preventDefault();const f=e.target,teacherIds=[...f.elements.namedItem('teacherIds').selectedOptions].map(o=>o.value),studentIds=[...f.elements.namedItem('studentIds').selectedOptions].map(o=>o.value);try{await apiRequest('/admin/classes',{method:'POST',body:JSON.stringify({name:f.elements.namedItem('name').value.trim(),subject:f.elements.namedItem('subject').value.trim(),teacherIds,studentIds})});f.reset();loadAdminClasses();loadAdminDashboard();}catch(err){const old=f.querySelector('.auth-message');if(old)old.remove();const p=document.createElement('p');p.className='auth-message';p.textContent=err.message;f.append(p);}}
 if(e.target.id==='authSetup'){e.preventDefault();const f=e.target;if(f.password.value!==f.confirmPassword.value){authView('setup','admin','The passwords do not match.');return;}if(f.otpVerified.value!=='true'){authView('setup','admin','Verify the demo OTP before creating the administrator account.');return;}const button=f.querySelector('button[type=submit]');button.disabled=true;button.textContent='Creating account…';try{const setupData=await authRequest('setup-admin',{name:f.elements.namedItem('name').value.trim(),username:f.username.value.trim(),setupCode:f.setupCode.value,otpCode:f.otpCode.value,otpVerified:true,password:f.password.value,termsAccepted:f.terms.checked});storeAuthTokens(setupData);authView('signin','admin','Administrator account created. Sign in with your username and password.');}catch(err){authView('setup','admin',err.message);}finally{button.disabled=false;}}
 if(e.target.id==='authSignup'){e.preventDefault();const f=e.target,role=authRoot.dataset.role||'student';if(role==='admin'){authView('setup','admin','');return;}if(f.password.value!==f.confirmPassword.value){authView('signup',role,'The passwords do not match.');return;}if(role==='teacher'&&f.otpVerified.value!=='true'){authView('signup',role,'Verify the demo OTP before requesting a teacher account.');return;}const button=f.querySelector('button[type=submit]');button.disabled=true;button.textContent='Creating account…';try{const data=await authRequest('signup',{name:f.elements.namedItem('name').value.trim(),username:f.username.value.trim(),otpCode:f.otpCode?.value||'',otpVerified:f.otpVerified?.value==='true',password:f.password.value,role,termsAccepted:f.terms.checked});storeAuthTokens(data);if(data.pending){authView('signin','teacher','Your teacher request was saved. An administrator must approve your access before you can sign in.');}else authView('signin',role,'Your account was created. Sign in with your username and password to continue.');}catch(err){authView('signup',role,err.message);}finally{button.disabled=false;}}
});
document.addEventListener('DOMContentLoaded',restoreSession);

// Dedicated staff portal pages. These are routed inside the existing EduVerse shell;
// every page loads its content from the protected API instead of embedding sample rows.
const staffPageTitles={'teacher-timetable':'Timetable','teacher-classes':'My classes','teacher-students':'Students','teacher-attendance':'Attendance','teacher-courses':'Teaching courses','teacher-assignments':'Assignments','teacher-grading':'Grading','teacher-analytics':'Learning analytics','teacher-announcements':'Class announcements','teacher-vision':'Vision lab assignments','teacher-settings':'Account security','admin-users':'Users & approvals','admin-teachers':'Teachers','admin-students':'Students','admin-classes':'Classes & enrollment','admin-courses':'Course oversight','admin-institutions':'Institutions & terms','admin-calendar':'Academic calendar','admin-enrollments':'Enrollments','admin-roles':'Roles & permissions','admin-reports':'Institution reports','admin-audit':'Audit log','admin-security':'Security & MFA','admin-settings':'Platform settings','admin-integrations':'Integrations','admin-fees':'Fees','admin-subscriptions':'Subscriptions','admin-marketplace':'Marketplace','admin-import':'Bulk import','admin-analytics':'Usage analytics','admin-backup':'Backup & restore','admin-announcements':'Institution announcements'};
const staffPageMarkup={
 'teacher-timetable':`<div class="screen-title"><p class="eyebrow">TEACHING WORKSPACE</p><h1>Timetable</h1><p>Review scheduled sessions for your assigned classes.</p></div><section class="screen-panel"><h3>Schedule a class</h3><form id="staffScheduleForm" class="teacher-form"><label>Class<select name="classId" class="teacher-class-select" required><option value="">Choose a class</option></select></label><input name="title" placeholder="Lesson or session title" maxlength="120" required><input aria-label="Subject" name="course" placeholder="Subject" maxlength="100"><label>Date<input name="date" type="date" required></label><label>Time<input name="time" type="time" required></label><button class="primary-btn">Add to timetable →</button><p id="staffScheduleStatus" class="panel-copy" role="status"></p></form></section><section id="staffPageBody" class="screen-panel">Loading timetable…</section>`,
 'teacher-classes':`<div class="screen-title"><p class="eyebrow">TEACHING WORKSPACE</p><h1>My classes</h1><p>Only classes assigned to your teacher account appear here.</p></div><div id="staffPageBody" class="staff-grid"><p class="panel-copy">Loading your classes…</p></div>`,
 'teacher-students':`<div class="screen-title"><p class="eyebrow">AUTHORIZED ROSTERS</p><h1>Students</h1><p>View learners in classes assigned to you, with their recorded submission activity.</p></div><div id="staffPageBody" class="screen-panel staff-table-wrap">Loading assigned students…</div>`,
 'teacher-attendance':`<div class="screen-title"><p class="eyebrow">CLASS RECORDS</p><h1>Attendance</h1><p>Choose a class and date, then mark each enrolled learner present, absent, or late. Existing records for that date can be updated.</p></div><section class="screen-panel"><form id="staffAttendanceForm" class="teacher-form attendance-form"><div class="attendance-filters"><label>Class<select name="classId" class="teacher-class-select" required><option value="">Choose a class</option></select></label><label>Date<input name="date" type="date" value="${localDateInput()}" required></label></div><div id="staffAttendanceRoster"><p class="staff-empty">Choose a class to load its student roster.</p></div><div class="attendance-save-row"><p id="staffAttendanceStatus" class="panel-copy" role="status"></p><button class="primary-btn" type="submit">Save attendance →</button></div></form></section>` ,
 'teacher-courses':`<div class="screen-title"><p class="eyebrow">COURSE CATALOG · CLASS SUBJECTS</p><h1>Teaching courses</h1><p>Create drafts, add modules, lessons and resources, then publish a course so enrolled students can see it. Drafts stay hidden from students.</p></div><section class="screen-panel"><h3>Create a course draft</h3><form id="staffCourseForm" class="teacher-form"><input aria-label="Course title" name="title" placeholder="Course title" maxlength="120" required><input aria-label="Subject or category" name="category" placeholder="Subject or category"><select aria-label="Course level" name="level"><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select><textarea aria-label="Course description" name="description" placeholder="Course description" maxlength="2000"></textarea><textarea aria-label="Learning objectives, one per line" name="objectives" placeholder="Learning objectives, one per line"></textarea><textarea aria-label="Prerequisites, one per line" name="prerequisites" placeholder="Prerequisites, one per line"></textarea><textarea aria-label="Module titles, one per line" name="modules" placeholder="Module titles, one per line"></textarea><label>Price in ₹ (0 = free)<input name="price" type="number" min="0" step="1" value="0"></label><button class="primary-btn">Save draft →</button><p id="staffCourseStatus" class="panel-copy"></p></form></section><section class="screen-panel"><div id="staffPageBody">Loading course records…</div></section>`,
 'teacher-assignments':`<div class="screen-title"><p class="eyebrow">CLASS ASSESSMENT</p><h1>Assignments</h1><p>Create text assignments for your assigned classes and track submitted work.</p></div><section class="screen-panel"><h3>Create an assignment</h3><form id="staffAssignmentForm" class="teacher-form"><label>Class<select name="classId" class="teacher-class-select" required><option value="">Choose a class</option></select></label><input name="title" placeholder="Assignment title" maxlength="120" required><input aria-label="Course or subject" name="course" placeholder="Course or subject"><textarea aria-label="Instructions for students" name="description" placeholder="Instructions for students" maxlength="2000" required></textarea><label>Questions or tasks (one per line)<textarea name="questions" placeholder="Add each question or task on a new line" maxlength="10000"></textarea></label><div id="staffRubricRows"></div><button type="button" class="filter-select" id="staffRubricAdd">+ Add rubric criterion</button><p class="panel-copy"><small>Optional: split the marks across criteria for rubric-based grading.</small></p><label>Due date<input name="dueDate" type="date"></label><label class="auth-check"><input type="checkbox" name="allowLate"> Allow late submissions</label><button class="primary-btn">Publish to class →</button><p id="staffAssignmentStatus" class="panel-copy"></p></form></section><section class="screen-panel"><p class="eyebrow">PUBLISHED WORK</p><div id="staffPageBody">Loading assignments…</div></section>`,
 'teacher-grading':`<div class="screen-title"><p class="eyebrow">ASSESSMENT REVIEW</p><h1>Grading</h1><p>Review submitted text work, save a draft grade, or release marks and feedback to the student.</p></div><div id="staffPageBody" class="staff-grid">Loading submissions…</div>`,
 'teacher-analytics':`<div class="screen-title"><p class="eyebrow">LEARNING EVIDENCE</p><h1>Learning analytics</h1><p>Figures below are calculated from assigned classes, recorded attendance, submissions, and saved practice evidence.</p></div><div id="staffPageBody">Loading recorded learning data…</div>`,
 'teacher-announcements':`<div class="screen-title"><p class="eyebrow">CLASS COMMUNICATION</p><h1>Announcements</h1><p>Save a class notice for your assigned learners. Email and push delivery are not configured.</p></div><section class="screen-panel"><form id="staffAnnouncementForm" class="teacher-form"><label>Class<select name="classId" class="teacher-class-select" required><option value="">Choose a class</option></select></label><textarea name="message" placeholder="Write a class announcement" maxlength="1500" required></textarea><button class="primary-btn">Post announcement →</button><p id="staffAnnouncementStatus" class="panel-copy"></p></form></section><section class="screen-panel"><div id="staffPageBody">Loading saved announcements…</div></section>`,
 'admin-users':`<div class="screen-title"><p class="eyebrow">ACCOUNT GOVERNANCE</p><h1>Users & approvals</h1><p>Search registered accounts, approve or reject teacher requests, manage account status, and issue a one-time recovery code (shown once, share it out of band).</p></div><section class="screen-panel"><h3>Create an account</h3><p class="panel-copy">Administrators can create student, teacher, or administrator accounts here. Public registration can never create an administrator. Creating an administrator asks for confirmation because it grants full platform control.</p><form id="adminCreateUserForm" class="teacher-form"><input aria-label="Full name" name="name" placeholder="Full name" maxlength="80" required><input aria-label="Email" name="email" type="email" placeholder="Email" required><input aria-label="Temporary password" name="password" type="password" placeholder="Temporary password (12+ characters)" minlength="12" required><label>Role<select name="role"><option value="teacher">Teacher</option><option value="student">Student</option><option value="admin">Administrator</option></select></label><button class="primary-btn">Create account →</button><p id="adminCreateUserStatus" class="panel-copy"></p></form></section><section class="screen-panel"><input aria-label="Search name, email, role, or status" id="adminUserSearch" class="search-field" placeholder="Search name, email, role, or status"><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Action</th></tr></thead><tbody id="adminUsers"><tr><td colspan="5">Loading accounts…</td></tr></tbody></table></div></section><section class="screen-panel admin-community-reports"><p class="eyebrow">COMMUNITY MODERATION</p><h3>Reported student content</h3><div id="adminCommunityReports">Loading reports…</div></section>`,
 'admin-classes':`<div class="screen-title"><p class="eyebrow">INSTITUTIONAL ROSTERS</p><h1>Classes & enrollment</h1><p>Create classes and assign active approved teachers and student accounts.</p></div><section class="screen-panel"><form id="adminClassForm" class="teacher-form"><input aria-label="Class name" name="name" placeholder="Class name" maxlength="100" required><input aria-label="Subject" name="subject" placeholder="Subject"><label>Teachers<select name="teacherIds" id="adminClassTeachers" multiple required></select></label><label>Students<select name="studentIds" id="adminClassStudents" multiple></select></label><button class="primary-btn">Create class →</button></form><div id="adminClassList" class="teacher-records"></div></section>`,
 'teacher-vision':`<div class="screen-title"><p class="eyebrow">VISION & SIMULATION LAB</p><h1>Vision lab assignments</h1><p>Assign an existing lab experiment to one of your classes and review recorded student attempts.</p></div><section class="screen-panel"><form id="staffVisionForm" class="teacher-form"><label>Class<select name="classId" class="teacher-class-select" required><option value="">Choose a class</option></select></label><label>Experiment<select name="experimentId" required><option value="drawing">Webcam drawing</option><option value="air-keyboard">Virtual air keyboard</option><option value="gesture-trainer">Gesture training</option><option value="gesture-deck">Gesture presentation</option><option value="physics">Physics lab</option><option value="chemistry">Chemistry lab</option><option value="science">Science lab</option></select></label><input name="title" placeholder="Assignment title" maxlength="120"><textarea aria-label="Objectives and instructions" name="instructions" placeholder="Objectives and instructions" maxlength="1500"></textarea><label>Difficulty<select name="difficulty"><option>beginner</option><option>intermediate</option><option>advanced</option></select></label><label>Due date<input name="dueDate" type="date"></label><button class="primary-btn">Assign experiment →</button><p id="staffVisionStatus" class="panel-copy"></p></form></section><section class="screen-panel"><div id="staffPageBody">Loading assignments…</div></section>`,
 'teacher-settings':`<div class="screen-title"><p class="eyebrow">TEACHER ACCOUNT</p><h1>Account security</h1><p>Change your own password. Your role and account status can only be changed by an administrator.</p></div><section class="screen-panel"><form id="changePasswordForm" class="teacher-form"><label>Current password<input name="currentPassword" type="password" required></label><label>New password (12+ characters)<input name="newPassword" type="password" minlength="12" required></label><button class="primary-btn">Change password →</button><p id="changePasswordStatus" class="panel-copy"></p></form></section><section class="screen-panel" style="margin-top:15px"><h3>Delete my account</h3><p class="panel-copy">Permanently deletes your account, notes, progress, vision history, enrollments and submissions. This cannot be undone. The last administrator account cannot be deleted this way.</p><form class="delete-account-form teacher-form"><label>Confirm with your current password<input name="password" type="password" required></label><button class="primary-btn">Delete my account permanently →</button><p class="delete-account-status panel-copy"></p></form></section>`,
 'admin-teachers':`<div class="screen-title"><p class="eyebrow">STAFF ADMINISTRATION</p><h1>Teachers</h1><p>Approved and pending teacher accounts, with the classes assigned to each teacher.</p></div><section class="screen-panel"><form id="adminCreateUserForm" class="teacher-form"><input aria-label="Full name" name="name" placeholder="Full name" maxlength="80" required><input aria-label="Email" name="email" type="email" placeholder="Email" required><input aria-label="Temporary password" name="password" type="password" placeholder="Temporary password (12+ characters)" minlength="12" required><label>Role<select name="role"><option value="teacher">Teacher</option><option value="student">Student</option><option value="admin">Administrator</option></select></label><button class="primary-btn">Create account →</button><p id="adminCreateUserStatus" class="panel-copy"></p></form></section><section class="screen-panel"><div id="staffPageBody">Loading teachers…</div></section>`,
 'admin-students':`<div class="screen-title"><p class="eyebrow">LEARNER ADMINISTRATION</p><h1>Students</h1><p>Every student account, with class memberships and course enrollments.</p></div><section class="screen-panel"><div id="staffPageBody">Loading students…</div></section>`,
 'admin-institutions':`<div class="screen-title"><p class="eyebrow">INSTITUTION STRUCTURE</p><h1>Institutions</h1><p>Manage institutions, their campuses and departments, and each institution's branding. Select an institution to manage its detail.</p></div><section class="screen-panel"><h3>Create institution</h3><form id="adminInstitutionForm" class="teacher-form"><input aria-label="Institution name" name="name" placeholder="Institution name" maxlength="120" required><input aria-label="URL slug" name="slug" placeholder="URL slug \u2014 lowercase letters, numbers, dashes" maxlength="40" pattern="[a-z0-9-]{2,40}" required><button class="primary-btn">Create institution \u2192</button><p id="adminInstitutionStatus" class="panel-copy"></p></form></section><section class="screen-panel"><div id="staffPageBody">Loading institutions\u2026</div></section>`,
 'admin-calendar':`<div class="screen-title"><p class="eyebrow">ACADEMIC CALENDAR</p><h1>Academic years & semesters</h1><p>Define academic years per institution, nest semesters inside them, and mark the current year and semester.</p></div><section class="screen-panel"><h3>Create academic year</h3><form id="adminYearForm" class="teacher-form"><label>Institution<select name="institutionId" id="adminYearInstitution" required></select></label><input name="name" placeholder="e.g. 2026-27" maxlength="120" required><label>Starts<input name="startsAt" type="date" required></label><label>Ends<input name="endsAt" type="date" required></label><button class="primary-btn">Create year \u2192</button><p id="adminYearStatus" class="panel-copy"></p></form></section><section class="screen-panel"><div id="staffPageBody">Loading academic calendar\u2026</div></section>`,
 'admin-enrollments':`<div class="screen-title"><p class="eyebrow">ENROLMENT CONTROL</p><h1>Enrollments</h1><p>Enroll an active student in a class or a course. Duplicates are rejected by the server.</p></div><section class="screen-panel"><form id="adminEnrollClassForm" class="teacher-form"><label>Student<select name="studentId" class="admin-student-select" required></select></label><label>Class<select name="classId" class="admin-class-select" required></select></label><button class="primary-btn">Enroll in class →</button><p id="adminEnrollStatus" class="panel-copy"></p></form><form id="adminEnrollCourseForm" class="teacher-form" style="margin-top:14px"><label>Student<select name="studentId" class="admin-student-select" required></select></label><label>Course<select name="courseId" class="admin-course-select" required></select></label><button class="primary-btn">Enroll in course →</button><p id="adminEnrollCourseStatus" class="panel-copy"></p></form></section><section class="screen-panel"><div id="staffPageBody">Loading enrollments…</div></section>`,
 'admin-courses':`<div class="screen-title"><p class="eyebrow">PLATFORM CATALOG</p><h1>Course oversight</h1><p>Publish, draft, or archive any course, reassign a course to an approved teacher, or place a course inside your institution structure. Changes are recorded in the audit log.</p></div><section class="screen-panel"><form id="adminCourseAssignForm" class="teacher-form"><label>Course<select name="courseId" class="admin-course-select" required></select></label><label>Assign to teacher<select name="ownerId" class="admin-teacher-select" required></select></label><button class="primary-btn">Reassign course →</button><p id="adminCourseAssignStatus" class="panel-copy"></p></form><form id=\"adminCourseOrgForm\" class=\"teacher-form\" style=\"margin-top:14px\"><h3>Course organization</h3><label>Course<select name=\"courseId\" class=\"admin-course-select\" required></select></label><label>Institution<select name=\"institutionId\" class=\"admin-org-institution\"><option value=\"\">None</option></select></label><label>Campus<select name=\"campusId\" class=\"admin-org-campus\"><option value=\"\">None</option></select></label><label>Department<select name=\"departmentId\" class=\"admin-org-dept\"><option value=\"\">None</option></select></label><label>Semester<select name=\"semesterId\" class=\"admin-org-semester\"><option value=\"\">None</option></select></label><button class=\"primary-btn\">Save organization \u2192</button><p id=\"adminCourseOrgStatus\" class=\"panel-copy\"></p></form></section><section class="screen-panel"><div id="staffPageBody">Loading courses…</div></section>`,
 'admin-roles':`<div class="screen-title"><p class="eyebrow">ACCESS GOVERNANCE</p><h1>Roles & permissions</h1><p>Toggle what each role may do. Changes apply to the new institution endpoints immediately; the backend enforces them on every request. Only super administrators can edit this matrix.</p></div><section class="screen-panel"><div id="staffPageBody">Loading roles\u2026</div></section>`,
 'admin-reports':`<div class="screen-title"><p class="eyebrow">INSTITUTION OVERVIEW</p><h1>Reports</h1><p>Counts are derived from stored users, classes, enrollments, assignments, and vision lab events.</p></div><div id="staffPageBody">Loading institution metrics…</div>`,
 'admin-audit':`<div class="screen-title"><p class="eyebrow">ACCOUNTABILITY</p><h1>Audit log</h1><p>Recent administrator actions stored by the backend.</p></div><section class="screen-panel"><div id="staffPageBody">Loading audit history…</div></section>`,
 'admin-settings':`<div class="screen-title"><p class="eyebrow">PLATFORM CONTROL</p><h1>Platform settings</h1><p>These settings are stored on the server. Registration and teacher-approval switches change real signup behaviour.</p></div><section class="screen-panel"><form id="adminSettingsForm" class="teacher-form"><div id="staffPageBody">Loading settings…</div><button class="primary-btn">Save settings →</button><p id="adminSettingsStatus" class="panel-copy"></p></form></section>`,
 'admin-integrations':`<div class="screen-title"><p class="eyebrow">CONNECTED SERVICES</p><h1>Integrations</h1><p>Live status of the services EduVerse actually uses. Email delivery is not configured, so password recovery uses administrator-issued codes.</p></div><section class="screen-panel"><div id="staffPageBody">Checking services…</div></section>`,
 'admin-announcements':`<div class="screen-title"><p class="eyebrow">FAMILY & INSTITUTION</p><h1>Institution announcements</h1><p>Post notices for students, parents, teachers — or everyone.</p></div><section class="screen-panel"><form id="adminAnnounceForm" class="teacher-form"><label>Title<input name="title" maxlength="120" required></label><label>Message<textarea name="body" maxlength="2000" rows="3" required></textarea></label><label>Audience<select name="audience"><option value="all">Everyone</option><option value="students">Students</option><option value="parents">Parents</option><option value="teachers">Teachers</option></select></label><button class="primary-btn">Post announcement →</button><p id="adminAnnounceStatus" class="panel-copy" role="status"></p></form></section><section class="screen-panel" style="margin-top:14px"><h3>Posted announcements</h3><div id="staffPageBody">Loading…</div></section>`,
 'admin-backup':`<div class="screen-title"><p class="eyebrow">DATA PROTECTION</p><h1>Backup & restore</h1><p>Download a full copy of the platform data, or restore from a backup file. Restoring replaces everything — use with care.</p></div><section class="screen-panel"><div id="staffPageBody">Loading backup info…</div></section>`,
 'admin-security':`<div class="screen-title"><p class="eyebrow">SERVICE & SECURITY STATUS</p><h1>Security & MFA</h1><p>Service health, login activity, security incidents, and optional authenticator-app MFA for administrator accounts.</p></div><div class="lms-tabs" role="tablist" aria-label="Security sections"><button class="lms-tab active" data-sec-tab="status" role="tab" aria-selected="true">Service status</button><button class="lms-tab" data-sec-tab="logins" role="tab" aria-selected="false">Login activity</button><button class="lms-tab" data-sec-tab="incidents" role="tab" aria-selected="false">Incidents</button></div><div id="staffPageBody">Checking API health…</div><section class="screen-panel"><h3>Administrator MFA</h3><p class="panel-copy">Generate a secret, add it to an authenticator app, then verify a 6-digit code. Once enabled, sign-in requires that code.</p><button class="primary-btn" id="mfaSetupBtn">Generate MFA secret →</button><p id="mfaSecret" class="panel-copy"></p><form id="mfaVerifyForm" class="teacher-form"><input aria-label="6-digit authenticator code" name="code" placeholder="6-digit authenticator code" maxlength="6" required><button class="primary-btn">Enable MFA →</button><p id="mfaVerifyStatus" class="panel-copy"></p></form><form id="mfaDisableForm" class="teacher-form"><input aria-label="Current code to disable MFA" name="code" placeholder="Current code to disable MFA" maxlength="6"><button class="primary-btn">Disable MFA →</button><p id="mfaDisableStatus" class="panel-copy"></p></form><h3 style="margin-top:16px">Change my password</h3><form id="changePasswordForm" class="teacher-form"><label>Current password<input name="currentPassword" type="password" required></label><label>New password (12+ characters)<input name="newPassword" type="password" minlength="12" required></label><button class="primary-btn">Change password →</button><p id="changePasswordStatus" class="panel-copy"></p></form><h3 style="margin-top:16px">Delete my account</h3><p class="panel-copy">Permanently deletes your account, notes, progress, vision history, enrollments and submissions. This cannot be undone. The last administrator account cannot be deleted this way.</p><form class="delete-account-form teacher-form"><label>Confirm with your current password<input name="password" type="password" required></label><button class="primary-btn">Delete my account permanently →</button><p class="delete-account-status panel-copy"></p></form></section>`,
 'admin-fees':`<div class="screen-title"><p class="eyebrow">FEE MANAGEMENT</p><h1>Fees</h1><p>Create fee structures per academic year, assign them to grades or students, and record payments.</p></div><section class="screen-panel"><h3>Create fee structure</h3><form id="adminFeeStructureForm" class="teacher-form"><label>Institution<select name="institutionId" class="admin-fee-institution" required></select></label><label>Academic year<select name="academicYearId" class="admin-fee-year"><option value="">None</option></select></label><input name="name" placeholder="Fee name, e.g. Term 1 tuition" maxlength="120" required><label>Amount (₹)<input name="amount" type="number" min="1" step="1" required></label><label>Due date<input name="dueDate" type="date" required></label><input name="grade" placeholder="Grade (optional — leave blank for all)" maxlength="40"><button class="primary-btn">Create structure →</button><p id="adminFeeStructureStatus" class="panel-copy"></p></form></section><section class="screen-panel"><h3>Fee structures</h3><div id="opsFeeStructures">Loading…</div></section><section class="screen-panel"><h3>Fee records</h3><div class="attendance-filters"><label>Status<select id="opsFeeStatusFilter" class="filter-select"><option value="">All</option><option value="pending">Pending</option><option value="partial">Partial</option><option value="paid">Paid</option><option value="overdue">Overdue</option></select></label><label class="auth-check"><input type="checkbox" id="opsFeeOverdueOnly"> Overdue only</label><button class="filter-select" id="opsFeeRefresh">Refresh</button></div><div id="opsFeeRecords">Loading…</div></section>`,
 'admin-subscriptions':`<div class="screen-title"><p class="eyebrow">COMMERCIAL PLANS</p><h1>Subscriptions</h1><p>Manage subscription plans and assign them to institutions. Only super administrators can create plans.</p></div><section class="screen-panel"><h3>Create plan</h3><form id="adminSubPlanForm" class="teacher-form"><input aria-label="Plan name" name="name" placeholder="Plan name, e.g. Starter" maxlength="120" required><label>Price (₹)<input name="price" type="number" min="0" step="1" required></label><label>Billing cycle<select name="billingCycle"><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label><label>Max students<input name="maxStudents" type="number" min="1" value="100"></label><label>Max teachers<input name="maxTeachers" type="number" min="1" value="10"></label><input name="features" placeholder="Features, comma separated" maxlength="500"><button class="primary-btn">Create plan →</button><p id="adminSubPlanStatus" class="panel-copy"></p></form></section><section class="screen-panel"><h3>Plans</h3><div id="opsSubPlans">Loading…</div></section><section class="screen-panel"><h3>Institution subscriptions</h3><form id="adminSubAssignForm" class="teacher-form"><label>Institution<select name="institutionId" class="admin-sub-institution" required></select></label><label>Plan<select name="planId" class="admin-sub-plan" required></select></label><button class="primary-btn">Assign plan →</button><p id="adminSubAssignStatus" class="panel-copy"></p></form><div id="opsInstitutionSubs">Loading…</div></section>`,
 'admin-marketplace':`<div class="screen-title"><p class="eyebrow">COURSE MARKETPLACE</p><h1>Marketplace</h1><p>List your institution's published courses for students across institutions to discover and enroll.</p></div><section class="screen-panel"><h3>List a course</h3><form id="adminMarketplaceForm" class="teacher-form"><label>Course<select name="courseId" class="admin-mkt-course" required></select></label><label>Price (₹, 0 = free)<input name="price" type="number" min="0" step="1" value="0" required></label><button class="primary-btn">List course →</button><p id="adminMarketplaceStatus" class="panel-copy"></p></form></section><section class="screen-panel"><h3>My listings</h3><div id="opsMarketplaceListings">Loading…</div></section>`,
 'admin-import':`<div class="screen-title"><p class="eyebrow">BULK ONBOARDING</p><h1>Bulk import</h1><p>Paste CSV or upload a file. Columns: <b>name,username,email,password,grade,section</b> — one header row, then one account per line. Passwords need 12+ characters. Teachers are created as pending and need approval.</p></div><section class="screen-panel"><h3>Import students</h3><form id="adminImportStudentsForm" class="teacher-form"><textarea aria-label="Student import data (CSV)" name="csv" rows="6" placeholder="name,username,email,password,grade,section&#10;Asha Rao,asha.rao,asha@example.com,TempPass123456,10,A" maxlength="200000"></textarea><label>Or upload a CSV file<input type="file" id="opsImportStudentsFile" accept=".csv,text/csv"></label><button class="primary-btn">Import students →</button><p id="adminImportStudentsStatus" class="panel-copy"></p></form><div id="opsImportStudentsResult"></div></section><section class="screen-panel"><h3>Import teachers</h3><form id="adminImportTeachersForm" class="teacher-form"><textarea aria-label="Teacher import data (CSV)" name="csv" rows="6" placeholder="name,username,email,password,grade,section&#10;Ravi Menon,ravi.menon,ravi@example.com,TempPass123456,," maxlength="200000"></textarea><label>Or upload a CSV file<input type="file" id="opsImportTeachersFile" accept=".csv,text/csv"></label><button class="primary-btn">Import teachers →</button><p id="adminImportTeachersStatus" class="panel-copy"></p></form><div id="opsImportTeachersResult"></div></section>`,
 'admin-analytics':`<div class="screen-title"><p class="eyebrow">PLATFORM INSIGHT</p><h1>Usage analytics</h1><p>Activity across the platform for the selected period, counted from stored records.</p></div><section class="screen-panel"><div class="attendance-filters"><label>Period<select id="opsAnalyticsDays" class="filter-select"><option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option></select></label></div><div id="opsAnalyticsCards" class="admin-metrics">Loading…</div><div id="opsAnalyticsBars"></div></section>`
};
function staffTable(headers,rows,empty='No records are available yet.'){return rows.length?`<div class="staff-table-wrap"><table class="admin-table"><thead><tr>${headers.map(h=>`<th>${safeText(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`:`<p class="staff-empty">${safeText(empty)}</p>`;}
function lmsGradeMarksHtml(s){
 const rubric=(s.rubric||[]).filter(r=>r.criterion);
 if(!rubric.length)return `<label>Marks<input name="marks" type="number" min="0" max="10000" value="${Number(s.grade?.marks)||0}" required></label><label>Out of<input name="maxMarks" type="number" min="1" max="10000" value="${Number(s.grade?.maxMarks)||100}" required></label>`;
 const total=rubric.reduce((n,r)=>n+Number(r.maxPoints||0),0);
 const scored=rubric.reduce((n,r)=>n+(s.grade&&s.grade.rubricScores?Number(s.grade.rubricScores[r.id])||0:0),0);
 return `<div class="lms-rubric-grade">${rubric.map(r=>{const sv=s.grade&&s.grade.rubricScores?Number(s.grade.rubricScores[r.id])||0:0;return `<label><span>${safeText(r.criterion)} <small>(max ${r.maxPoints})</small></span><input type="number" min="0" max="${r.maxPoints}" value="${sv}" data-rubric-q="${safeText(r.id)}" data-rubric-max="${r.maxPoints}" aria-label="${safeText(r.criterion)}"></label>`;}).join('')}</div><p class="panel-copy"><small>Rubric total: <b data-rubric-total>${scored}</b> / <span data-rubric-maxtotal>${total}</span></small></p><input type="hidden" name="marks" value="0"><input type="hidden" name="maxMarks" value="${total}">`;
}
/* ---------- Institution-ready admin (slice A) ---------- */
let adminInstitutionsCache=[],adminSelectedInstitutionId=null;
const ORG_PERMISSIONS=['org.manage','users.manage','courses.publish','fees.manage','reports.view','settings.manage','branding.manage'];
const ORG_PERMISSION_LABELS={'org.manage':'Manage institutions','org.view':'View organizations','users.manage':'Manage users','courses.manage':'Manage courses','courses.create':'Create courses','courses.publish':'Publish courses','courses.enroll':'Enroll in courses','assignments.manage':'Manage assignments','assignments.submit':'Submit assignments','fees.manage':'Manage fees','reports.view':'View reports','settings.manage':'Platform settings','branding.manage':'Manage branding','roles.manage':'Manage roles','integrations.manage':'Manage integrations'};

async function loadAdminInstitutions(){
  const root=document.querySelector('#staffPageBody');if(!root)return;
  try{
    const {institutions}=await apiRequest('/admin/institutions');
    adminInstitutionsCache=institutions||[];
    if(!adminSelectedInstitutionId||!adminInstitutionsCache.some(i=>i.id===adminSelectedInstitutionId))
      adminSelectedInstitutionId=adminInstitutionsCache[0]?.id||null;
    root.innerHTML='<h3>Institutions</h3>'+staffTable(['Name','Slug','Status','Action'],
      adminInstitutionsCache.map(i=>`<tr><td><b>${safeText(i.name)}</b>${i.id===adminSelectedInstitutionId?' <span class="pill purple-pill">SELECTED</span>':''}</td><td>${safeText(i.slug)}</td><td><span class="account-status ${safeText(i.status)}">${safeText(i.status)}</span></td><td><button data-org-inst="select" data-id="${safeText(i.id)}">Manage</button> ${i.status==='active'?`<button data-org-inst="suspend" data-id="${safeText(i.id)}">Suspend</button>`:`<button data-org-inst="activate" data-id="${safeText(i.id)}">Activate</button>`} <button data-org-inst="delete" data-id="${safeText(i.id)}">Delete</button></td></tr>`),
      'No institutions yet. Create the first one above.');
    const sel=adminInstitutionsCache.find(i=>i.id===adminSelectedInstitutionId);
    if(sel)await renderInstitutionDetail(sel,root);
  }catch(err){root.innerHTML=`<p class="staff-empty">${safeText(err.message)}</p>`;}
}

async function renderInstitutionDetail(inst,root){
  const [campuses,depts]=await Promise.all([
    apiRequest(`/admin/institutions/${encodeURIComponent(inst.id)}/campuses`).catch(()=>({campuses:[]})),
    apiRequest(`/admin/departments?institutionId=${encodeURIComponent(inst.id)}`).catch(()=>({departments:[]})),
  ]);
  const campusList=campuses.campuses||[],deptList=(depts.departments||depts)||[];
  const b=inst.branding||{},brandColor=/^#[0-9a-fA-F]{6}$/.test(b.primaryColor||'')?b.primaryColor:'#7257d9';
  root.insertAdjacentHTML('beforeend',`
   <h3 style="margin-top:20px">Managing: ${safeText(inst.name)}</h3>
   <section class="screen-panel"><h3>Campuses</h3>
     <form id="adminCampusForm" class="teacher-form"><input aria-label="Campus name" name="name" placeholder="Campus name" maxlength="120" required><input aria-label="City" name="city" placeholder="City" maxlength="80"><input aria-label="Address" name="address" placeholder="Address" maxlength="200"><button class="primary-btn">Add campus \\u2192</button><p id="adminCampusStatus" class="panel-copy"></p></form>
     ${staffTable(['Name','City','Address','Action'],campusList.map(c=>`<tr><td>${safeText(c.name)}</td><td>${safeText(c.city||'\\u2014')}</td><td>${safeText(c.address||'\\u2014')}</td><td><button data-org-campus="delete" data-id="${safeText(c.id)}">Delete</button></td></tr>`),'No campuses yet.')}
   </section>
   <section class="screen-panel"><h3>Departments</h3>
     <form id="adminDeptForm" class="teacher-form"><input aria-label="Department name" name="name" placeholder="Department name" maxlength="120" required><label>Campus<select name="campusId"><option value="">No specific campus</option>${campusList.map(c=>`<option value="${safeText(c.id)}">${safeText(c.name)}</option>`).join('')}</select></label><button class="primary-btn">Add department \\u2192</button><p id="adminDeptStatus" class="panel-copy"></p></form>
     ${staffTable(['Name','Campus','Action'],deptList.map(d=>`<tr><td>${safeText(d.name)}</td><td>${safeText(campusList.find(c=>c.id===d.campusId)?.name||'\\u2014')}</td><td><button data-org-dept="delete" data-id="${safeText(d.id)}">Delete</button></td></tr>`),'No departments yet.')}
   </section>
   <section class="screen-panel"><h3>Branding</h3>
     <form id="adminBrandingForm" class="teacher-form">
       <label>Logo URL<input name="logoUrl" placeholder="https://\\u2026 or /assets/\\u2026" maxlength="2000" value="${safeText(b.logoUrl||'')}"></label>
       <label>Primary color<input name="primaryColor" type="color" value="${safeText(brandColor)}"></label>
       <label>Favicon URL<input name="faviconUrl" placeholder="https://\\u2026 or /assets/\\u2026" maxlength="2000" value="${safeText(b.faviconUrl||'')}"></label>
       <button class="primary-btn">Save branding \\u2192</button><p id="adminBrandingStatus" class="panel-copy"></p>
     </form>
     <div id="adminBrandPreview" class="brand-preview"><span class="brand-preview-chip">Aa</span><div><b>${safeText(inst.name)}</b><small>Live preview \\u2014 pick a color to see it</small></div></div>
   </section>`);
  const form=document.querySelector('#adminBrandingForm'),chip=document.querySelector('#adminBrandPreview .brand-preview-chip');
  const paint=()=>{if(chip)chip.style.background=form.primaryColor.value;};
  form.primaryColor.addEventListener('input',paint);paint();
}

async function loadAdminCalendar(){
  const root=document.querySelector('#staffPageBody');if(!root)return;
  try{
    const {institutions}=await apiRequest('/admin/institutions');
    const instList=institutions||[];
    const instSel=document.querySelector('#adminYearInstitution');
    if(instSel)instSel.innerHTML=instList.map(i=>`<option value="${safeText(i.id)}">${safeText(i.name)}</option>`).join('');
    const years=[];
    for(const inst of instList){
      const {academicYears}=await apiRequest(`/admin/academic-years?institutionId=${encodeURIComponent(inst.id)}`).catch(()=>({academicYears:[]}));
      for(const y of (academicYears||[]))years.push({...y,institutionName:inst.name});
    }
    for(const y of years){
      const {semesters}=await apiRequest(`/admin/academic-years/${encodeURIComponent(y.id)}/semesters`).catch(()=>({semesters:[]}));
      y.semesters=semesters||[];
    }
    root.innerHTML=years.length?years.map(y=>`
      <article class="screen-panel" style="margin-bottom:12px"><div class="panel-heading"><div><p class="eyebrow">${safeText(y.institutionName)}</p><h3>${safeText(y.name)} ${y.isCurrent?'<span class="pill purple-pill">CURRENT</span>':''}</h3><p class="panel-copy">${safeText((y.startsAt||'').slice(0,10))} \\u2192 ${safeText((y.endsAt||'').slice(0,10))}</p></div><div>${y.isCurrent?'':`<button data-org-year="current" data-id="${safeText(y.id)}">Set current</button>`} <button data-org-year="delete" data-id="${safeText(y.id)}">Delete</button></div></div>
      <h4>Semesters</h4>
      ${staffTable(['Name','Dates','Current','Action'],y.semesters.map(s=>`<tr><td>${safeText(s.name)}</td><td>${safeText((s.startsAt||'').slice(0,10))} \\u2192 ${safeText((s.endsAt||'').slice(0,10))}</td><td>${s.isCurrent?'\\u2713':''}</td><td>${s.isCurrent?'':`<button data-org-sem="current" data-id="${safeText(s.id)}" data-year="${safeText(y.id)}">Set current</button>`} <button data-org-sem="delete" data-id="${safeText(s.id)}" data-year="${safeText(y.id)}">Delete</button></td></tr>`),'No semesters yet.')}
      <form class="teacher-form" data-org-semform="${safeText(y.id)}" style="margin-top:10px"><input aria-label="Semester name" name="name" placeholder="Semester name" maxlength="120" required><label>Starts<input name="startsAt" type="date" required></label><label>Ends<input name="endsAt" type="date" required></label><button class="primary-btn">Add semester \\u2192</button></form>
      </article>`).join(''):'<p class="staff-empty">No academic years yet. Create one above.</p>';
  }catch(err){root.innerHTML=`<p class="staff-empty">${safeText(err.message)}</p>`;}
}

async function loadAdminRoles(){
  const root=document.querySelector('#staffPageBody');if(!root)return;
  if(currentUser?.role==='institution_admin'){root.innerHTML='<p class="staff-empty">Only super administrators can view and edit the roles matrix.</p>';return;}
  try{
    const data=await apiRequest('/admin/role-permissions');
    const rp=data.matrix||data.rolePermissions||{};
    const roles=['super_admin','institution_admin','teacher','student'];
    const perms=[...new Set([...ORG_PERMISSIONS,...Object.values(rp).flatMap(v=>Array.isArray(v)?v:[])])];
    root.innerHTML=`<form id="adminRolesForm"><div class="staff-table-wrap"><table class="admin-table"><thead><tr><th>Permission</th>${roles.map(r=>`<th>${safeText(roleNames[r]||r)}</th>`).join('')}</tr></thead><tbody>${perms.map(p=>`<tr><td><b>${safeText(ORG_PERMISSION_LABELS[p]||p)}</b><br><small>${safeText(p)}</small></td>${roles.map(r=>`<td style="text-align:center"><input type="checkbox" name="perm" value="${safeText(r)}:${safeText(p)}" ${(rp[r]||[]).includes(p)?'checked':''} aria-label="${safeText(r)} ${safeText(p)}"></td>`).join('')}</tr>`).join('')}</tbody></table></div><button class="primary-btn" style="margin-top:12px">Save permissions \\u2192</button><p id="adminRolesStatus" class="panel-copy"></p></form><p class="admin-note">Checked permissions are enforced by the backend on the new institution endpoints.</p>`;
  }catch(err){root.innerHTML=`<p class="staff-empty">${safeText(err.message)}</p>`;}
}

/* ---------- Slice C: security monitoring, backup/restore, integrations ---------- */
const secState={tab:'status',loginDays:'7',sev:'',etype:'',days:'7'};
function secSevPill(sev){const s=['low','medium','high','critical'].includes(String(sev||'').toLowerCase())?String(sev).toLowerCase():'low';return `<span class="pill sec-sev-${s}">${safeText(s.toUpperCase())}</span>`;}
async function renderSecTab(tab){
  secState.tab=tab;
  document.querySelectorAll('[data-sec-tab]').forEach(b=>{const on=b.dataset.secTab===tab;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));});
  if(tab==='logins')return loadSecLogins();
  if(tab==='incidents')return loadSecIncidents();
  return loadSecStatus();
}
async function loadSecStatus(){
  const root=document.querySelector('#staffPageBody');if(!root)return;
  try{
    const svc=await apiRequest('/admin/services');
    root.innerHTML=`<div class="admin-metrics"><article class="admin-metric"><small>API SERVICE</small><b>${svc.api.ok?'Available':'Unavailable'}</b></article><article class="admin-metric"><small>OPENCV / MEDIAPIPE</small><b>${svc.opencv.available?'Available':'Not running'}</b></article><article class="admin-metric"><small>SESSION</small><b>HttpOnly · 12 hours</b></article><article class="admin-metric"><small>LOGIN THROTTLE</small><b>8 / minute</b></article><article class="admin-metric"><small>ACTIVE SESSIONS</small><b>${svc.sessions}</b></article></div><p class="admin-note">OpenCV runs locally at 127.0.0.1:4174 when its Python environment is installed. If it is not running, the drawing studio keeps its browser fallback and the lab explains the setup state. Email delivery is not configured; use administrator-issued recovery codes.</p>`;
  }catch(err){root.innerHTML=`<p class="staff-empty">${safeText(err.message)}</p>`;}
}
async function loadSecLogins(){
  const root=document.querySelector('#staffPageBody');if(!root)return;
  root.innerHTML=`<div class="staff-subsection"><h3>Login activity</h3><p class="panel-copy">Recent sign-ins across your institution scope. Failed attempts also appear under Incidents.</p><label class="cv-form-label">Period <select id="secLoginDays" class="search-field"><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label></div><div id="secLoginTable"><p class="panel-copy">Loading…</p></div>`;
  const sel=root.querySelector('#secLoginDays');sel.value=secState.loginDays;
  sel.onchange=()=>{secState.loginDays=sel.value;fillSecLogins();};
  await fillSecLogins();
}
async function fillSecLogins(){
  const box=document.querySelector('#secLoginTable');if(!box)return;
  try{
    const d=await apiRequest(`/admin/security/logins?days=${encodeURIComponent(secState.loginDays)}`);
    const rows=d.logins||d.events||[];
    box.innerHTML=staffTable(['Time','User','Role','IP','User agent'],rows.map(l=>`<tr><td>${new Date(l.at||l.createdAt).toLocaleString()}</td><td>${safeText(l.name||l.username||l.userId||'—')}<small>${safeText(l.email||'')}</small></td><td>${safeText(l.role||'—')}</td><td>${safeText(l.ip||'—')}</td><td>${safeText((l.userAgent||'').slice(0,60))||'—'}</td></tr>`),'No login activity in this period.');
  }catch(err){box.innerHTML=`<p class="staff-empty">${safeText(err.message)}</p>`;}
}
async function loadSecIncidents(){
  const root=document.querySelector('#staffPageBody');if(!root)return;
  root.innerHTML=`<div id="secSummary"><p class="panel-copy">Loading…</p></div><div class="staff-subsection"><h3>Incidents</h3><div class="cv-control-row" style="display:flex;gap:8px;flex-wrap:wrap"><label>Severity <select id="secSev" class="search-field"><option value="">All</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><label>Type <select id="secType" class="search-field"><option value="">All</option><option value="login_failed">Failed login</option><option value="brute_force">Brute force</option><option value="rate_limited">Rate limited</option><option value="forbidden_admin">Forbidden admin access</option></select></label><label>Period <select id="secDays" class="search-field"><option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label><button class="primary-btn" id="secFilterBtn">Apply →</button></div></div><div id="secEvents"><p class="panel-copy">Loading…</p></div>`;
  root.querySelector('#secSev').value=secState.sev;root.querySelector('#secType').value=secState.etype;root.querySelector('#secDays').value=secState.days;
  root.querySelector('#secFilterBtn').onclick=()=>{secState.sev=root.querySelector('#secSev').value;secState.etype=root.querySelector('#secType').value;secState.days=root.querySelector('#secDays').value;fillSecIncidents();};
  try{
    const s=await apiRequest('/admin/security/summary');
    const c=s.bySeverity||s.counts||{};
    root.querySelector('#secSummary').innerHTML=`<div class="admin-metrics"><article class="admin-metric"><small>CRITICAL</small><b>${c.critical||0}</b></article><article class="admin-metric"><small>HIGH</small><b>${c.high||0}</b></article><article class="admin-metric"><small>MEDIUM</small><b>${c.medium||0}</b></article><article class="admin-metric"><small>LOW</small><b>${c.low||0}</b></article></div>`;
  }catch(err){root.querySelector('#secSummary').innerHTML=`<p class="staff-empty">${safeText(err.message)}</p>`;}
  await fillSecIncidents();
}
async function fillSecIncidents(){
  const box=document.querySelector('#secEvents');if(!box)return;
  try{
    const d=await apiRequest(`/admin/security/events?days=${encodeURIComponent(secState.days)}${secState.sev?`&severity=${encodeURIComponent(secState.sev)}`:''}${secState.etype?`&type=${encodeURIComponent(secState.etype)}`:''}`);
    const rows=d.events||[];
    box.innerHTML=staffTable(['Time','Severity','Type','Actor','Detail','IP'],rows.map(e=>`<tr><td>${new Date(e.at).toLocaleString()}</td><td>${secSevPill(e.severity)}</td><td>${safeText(e.type)}</td><td>${safeText(e.actor||'—')}</td><td>${safeText(e.detail||'—')}<small>${safeText(e.institutionId||'')}</small></td><td>${safeText(e.ip||'—')}</td></tr>`),'No incidents match these filters.');
  }catch(err){box.innerHTML=`<p class="staff-empty">${safeText(err.message)}</p>`;}
}
async function loadAdminBackup(){
  const root=document.querySelector('#staffPageBody');if(!root)return;
  try{
    const info=await apiRequest('/admin/backup/info');
    const cols=info.collections||{},colList=Object.entries(cols).map(([k,v])=>`${safeText(k)}: ${v}`).join(' · ')||'—';
    const size=info.sizeBytes?(info.sizeBytes>1048576?`${(info.sizeBytes/1048576).toFixed(1)} MB`:`${Math.round(info.sizeBytes/1024)} KB`):'—';
    root.innerHTML=`<div class="admin-metrics"><article class="admin-metric"><small>BACKUP SIZE</small><b>${size}</b></article><article class="admin-metric"><small>COLLECTIONS</small><b>${Object.keys(cols).length}</b></article><article class="admin-metric"><small>LAST BACKUP</small><b style="font-size:16px">${info.lastBackupAt?new Date(info.lastBackupAt).toLocaleDateString():'Never'}</b></article></div><p class="panel-copy">${colList}</p><div class="staff-subsection"><h3>Download</h3><p class="panel-copy">Saves a full JSON copy of the platform data to your device.</p><button class="primary-btn" id="backupDownloadBtn">Download backup →</button></div><div class="staff-subsection"><h3>Restore</h3><p class="panel-copy"><b>Warning:</b> restoring replaces ALL current data — users, courses, enrollments, everything. This cannot be undone.</p><form id="backupRestoreForm" class="teacher-form"><label>Backup file<input type="file" id="backupFile" accept="application/json,.json" required></label><label>Type CONFIRM to proceed<input id="backupConfirm" placeholder="CONFIRM" maxlength="10" required></label><button class="primary-btn" id="backupRestoreBtn">Restore from backup →</button><p id="backupRestoreStatus" class="panel-copy" role="status"></p></form></div>`;
    root.querySelector('#backupDownloadBtn').onclick=()=>{window.location.href=`${API_BASE}/admin/backup/download`;};
    root.querySelector('#backupRestoreForm').onsubmit=async e=>{
      e.preventDefault();const st=root.querySelector('#backupRestoreStatus'),file=root.querySelector('#backupFile').files[0];
      if(root.querySelector('#backupConfirm').value.trim()!=='CONFIRM'){st.textContent='Type CONFIRM exactly to proceed.';return;}
      if(!file){st.textContent='Choose a backup file first.';return;}
      st.textContent='Reading file…';
      try{
        const text=await file.text();let backup;try{backup=JSON.parse(text);}catch{st.textContent='That file is not valid JSON.';return;}
        if(!backup||!Array.isArray(backup.users)){st.textContent='Not a valid EduVerse backup (missing users array).';return;}
        st.textContent='Restoring… do not close this page.';
        await apiRequest('/admin/backup/restore',{method:'POST',body:JSON.stringify({backup,confirm:true})});
        st.textContent='Restore complete. Reloading…';setTimeout(()=>location.reload(),1200);
      }catch(err){st.textContent=err.message;}
    };
  }catch(err){root.innerHTML=`<p class="staff-empty">${safeText(err.message)}</p>`;}
}
const INT_KINDS=['email','payment','storage','webhook'];
async function loadAdminIntegrations(){
  const root=document.querySelector('#staffPageBody');if(!root)return;
  try{
    const [svc,ints]=await Promise.all([apiRequest('/admin/services'),apiRequest('/admin/integrations').catch(()=>({integrations:[]}))]);
    const list=ints.integrations||[];
    root.innerHTML=`<h3>Service status</h3>`+staffTable(['Service','Status','Detail'],[['EduVerse API',svc.api.ok?'Available':'Unavailable','Local Node API'],['OpenCV / MediaPipe hand tracking',svc.opencv.available?'Available':'Not running','127.0.0.1:4174 — install opencv-drawing requirements to enable'],['Email delivery','Not configured','Password recovery uses administrator-issued codes'],['Live multi-user video','Not connected','Classroom board is a single-browser demo; scheduled sessions are recorded, not streamed']].map(r=>`<tr><td>${safeText(r[0])}</td><td>${safeText(r[1])}</td><td>${safeText(r[2])}</td></tr>`))+`<div class="staff-subsection"><h3>Managed integrations</h3><p class="panel-copy">API keys are stored server-side and never shown back. Use Test to verify a webhook URL.</p><button class="primary-btn" id="intAddBtn">Add integration →</button></div><div id="intTable">`+staffTable(['Name','Kind','Status','Secret','Updated','Action'],list.map(i=>`<tr><td>${safeText(i.name)}<small>${safeText(i.id||'')}</small></td><td>${safeText(i.kind)}</td><td><span class="account-status ${i.status==='active'?'active':'pending'}">${safeText(i.status)}</span></td><td>${i.hasSecret?'Stored':'—'}</td><td>${i.updatedAt?new Date(i.updatedAt).toLocaleDateString():'—'}</td><td><button data-int-test="${safeText(i.id)}">Test</button><button data-int-toggle="${safeText(i.id)}" data-int-status="${safeText(i.status)}">${i.status==='active'?'Disable':'Enable'}</button><button data-int-edit="${safeText(i.id)}">Edit</button><button data-int-del="${safeText(i.id)}">Delete</button></td></tr>`),'No integrations configured yet.')+`</div><div id="intFormWrap"></div><p id="intTestResult" class="panel-copy" role="status"></p>`;
    root.querySelector('#intAddBtn').onclick=()=>renderIntForm(null);
    window._intCache=list;
  }catch(err){root.innerHTML=`<p class="staff-empty">${safeText(err.message)}</p>`;}
}
function renderIntForm(existing){
  const wrap=document.querySelector('#intFormWrap');if(!wrap)return;
  const it=existing||{kind:'webhook',name:'',config:{},status:'active'};
  let cfg='';try{cfg=JSON.stringify(it.config||{},null,2);}catch{}
  wrap.innerHTML=`<section class="screen-panel" style="margin-top:12px"><h3>${existing?'Edit':'Add'} integration</h3><form id="intForm" class="teacher-form"><label>Kind<select name="kind" required>${INT_KINDS.map(k=>`<option value="${k}" ${it.kind===k?'selected':''}>${k}</option>`).join('')}</select></label><label>Name<input name="name" value="${safeText(it.name||'')}" maxlength="80" required></label><label>Config (JSON)<textarea name="config" rows="4" placeholder='{"url":"https://…"}' spellcheck="false">${safeText(cfg)}</textarea></label><label>Secret / API key (stored securely, never shown)<input name="secret" type="password" autocomplete="new-password" placeholder="${existing?'Leave blank to keep current':''}"></label><button class="primary-btn">${existing?'Save changes':'Add integration'} →</button><button type="button" class="filter-select" id="intCancel">Cancel</button><p id="intFormStatus" class="panel-copy" role="status"></p></form></section>`;
  wrap.querySelector('#intCancel').onclick=()=>{wrap.innerHTML='';};
  wrap.querySelector('#intForm').onsubmit=async e=>{
    e.preventDefault();const f=e.target,st=wrap.querySelector('#intFormStatus');
    let config={};try{config=f.config.value.trim()?JSON.parse(f.config.value):{};}catch{st.textContent='Config is not valid JSON.';return;}
    const payload={kind:f.kind.value,name:f.name.value.trim(),config};
    if(f.secret.value)payload.secret=f.secret.value;
    try{
      if(existing)await apiRequest(`/admin/integrations/${encodeURIComponent(existing.id)}`,{method:'PATCH',body:JSON.stringify(payload)});
      else await apiRequest('/admin/integrations',{method:'POST',body:JSON.stringify(payload)});
      loadAdminIntegrations();
    }catch(err){st.textContent=err.message;}
  };
}
/* ---------- end Slice C ---------- */

/* Boot-time institution branding: public endpoint, fail silent offline. */
async function applyInstitutionBranding(){
  try{
    const res=await fetch('/api/institution/branding',{cache:'no-store'});
    if(!res.ok)return;
    const b=await res.json(),root=document.documentElement;
    if(b.name)document.title=`${b.name} — Learning Lab`;
    if(/^#[0-9a-fA-F]{6}$/.test(b.primaryColor||'')){root.style.setProperty('--brand',b.primaryColor);root.style.setProperty('--purple',b.primaryColor);}
    if(b.faviconUrl){let l=document.querySelector('link[rel="icon"]');if(!l){l=document.createElement('link');l.rel='icon';document.head.appendChild(l);}l.href=b.faviconUrl;}
    if(b.logoUrl){document.querySelectorAll('.brand-icon').forEach(el=>{el.innerHTML=`<img src="${b.logoUrl}" alt="" style="width:100%;height:100%;object-fit:contain;border-radius:12px">`;});}
  }catch{}
}

async function loadStaffPage(name){const root=document.querySelector('#staffPageBody');if(!root&&!['admin-users','admin-classes'].includes(name))return;try{
 if(name==='teacher-timetable'){const {teacherData,classes}=await apiRequest('/teacher');const byId=new Map(classes.map(c=>[c.id,c.name]));const rows=(teacherData.schedule||[]).slice().sort((a,b)=>`${a.date||''} ${a.time||''}`.localeCompare(`${b.date||''} ${b.time||''}`));root.innerHTML='<h3>Upcoming class sessions</h3>'+staffTable(['Date','Time','Class','Lesson'],rows.map(x=>`<tr><td>${safeText(x.date||'—')}</td><td>${safeText(x.time||'—')}</td><td>${safeText(byId.get(x.classId)||x.className||'Class')}</td><td>${safeText(x.title||x.course||'Lesson')}</td></tr>`),'No sessions scheduled yet. Add a class session from your dashboard.');return;}
 if(name==='teacher-classes'){const {classes}=await apiRequest('/teacher');root.innerHTML=classes.length?classes.map(c=>`<article class="screen-panel"><p class="eyebrow">${safeText(c.subject||'CLASS')}</p><h2>${safeText(c.name)}</h2><p>${(c.students||[]).length} enrolled learner${(c.students||[]).length===1?'':'s'}</p>${staffTable(['Student','Email'],(c.students||[]).map(s=>`<tr><td>${safeText(s.name)}</td><td>${safeText(s.email)}</td></tr>`),'No learners have been assigned to this class.')}</article>`).join(''):'<p class="staff-empty">No classes are assigned to your account yet. Contact an administrator to be assigned a class.</p>';return;}
 if(name==='teacher-students'){const data=await apiRequest('/teacher/analytics');root.innerHTML=staffTable(['Student','Assigned classes','Assignments','Submitted','Completion'],data.students.map(s=>`<tr><td>${safeText(s.name)}<small>${safeText(s.email)}</small></td><td>${safeText(s.classes.join(', '))}</td><td>${s.assignments}</td><td>${s.submitted}</td><td>${s.completion===null?'No assignment data':`${s.completion}%`}</td></tr>`),'No students belong to your assigned classes.');return;}
 if(name==='teacher-courses'){const [catalog,workspace,drafts,progress]=await Promise.all([apiRequest('/courses'),apiRequest('/teacher'),apiRequest('/teacher/courses'),apiRequest('/teacher/course-progress').catch(()=>({courses:[]} ))]);teacherCourseCache=drafts.courses||[];const subjects=[...new Set(workspace.classes.map(c=>c.subject).filter(Boolean))];root.innerHTML=`<div class="staff-subsection"><h3>Subjects in your assigned classes</h3><p>${subjects.length?safeText(subjects.join(' · ')):'No class subjects assigned yet.'}</p></div><h3>Your courses</h3>${staffTable(['Course','Status','Level','Modules','Action'],drafts.courses.map(c=>`<tr><td>${safeText(c.title)}</td><td>${safeText(c.status||'draft')}</td><td>${safeText(c.level)}</td><td>${c.modules?.length||0}</td><td>${c.status==='published'?`<button data-course-action="draft" data-course-id="${safeText(c.id)}">Unpublish</button>`:`<button data-course-action="published" data-course-id="${safeText(c.id)}">Publish</button>`} <button data-course-action="archived" data-course-id="${safeText(c.id)}">Archive</button></td></tr>`),'No courses saved yet. Use the draft form above.')}<h3>Course structure</h3><form id="staffModuleForm" class="teacher-form"><label>Course<select name="courseId" required>${drafts.courses.map(c=>`<option value="${safeText(c.id)}">${safeText(c.title)}</option>`).join('')}</select></label><input name="name" placeholder="New module name" maxlength="120" required><button class="primary-btn">Add module →</button><p id="staffModuleStatus" class="panel-copy"></p></form><form id="staffLessonForm" class="teacher-form" style="margin-top:12px"><label>Course<select name="courseId" id="staffLessonCourse" required>${drafts.courses.map(c=>`<option value="${safeText(c.id)}">${safeText(c.title)}</option>`).join('')}</select></label><label>Module<select name="moduleId" id="staffLessonModule" required></select></label><input name="title" placeholder="Lesson title" maxlength="160" required><label>Lesson type<select name="kind"><option value="">Auto (video if URL, else reading)</option><option value="video">Video lesson</option><option value="reading">Reading material</option><option value="interactive">Interactive activity</option><option value="pdf">PDF resource</option><option value="coding">Coding practice</option><option value="quiz">Quiz</option><option value="assignment">Assignment</option></select></label><textarea name="content" placeholder="Lesson content or notes" maxlength="4000"></textarea><input aria-label="Video URL (mp4 or YouTube)" name="videoUrl" placeholder="Video URL (mp4 or YouTube) — optional" maxlength="2000"><textarea aria-label="Quality variants, one per line" name="videoSources" placeholder="Quality variants, one per line: 1080p|https://…/hd.mp4 (mp4 only)" maxlength="4000" rows="2"></textarea><textarea aria-label="Captions, one per line" name="captions" placeholder="Captions, one per line: English|en|https://…/subs.vtt (WebVTT)" maxlength="4000" rows="2"></textarea><textarea aria-label="Video transcript" name="transcript" placeholder="Video transcript — use [mm:ss] for clickable timestamps" maxlength="20000" rows="3"></textarea><button class="primary-btn">Add lesson →</button><p id="staffLessonStatus" class="panel-copy"></p></form><form id="staffLessonVideoForm" class="teacher-form" style="margin-top:12px"><p class="eyebrow">EDIT LESSON VIDEO</p><label>Course<select name="courseId" id="staffLessonVideoCourse" required>${drafts.courses.map(c=>`<option value="${safeText(c.id)}">${safeText(c.title)}</option>`).join('')}</select></label><label>Module<select name="moduleId" id="staffLessonVideoModule" required></select></label><label>Lesson<select name="lessonId" id="staffLessonVideoLesson" required></select></label><input name="videoUrl" placeholder="Video URL (mp4 or YouTube)" maxlength="2000" aria-label="Video URL"><button class="primary-btn">Save video URL →</button><p id="staffLessonVideoStatus" class="panel-copy" role="status"></p></form><form id="staffResourceForm" class="teacher-form" style="margin-top:12px"><label>Course<select name="courseId" required>${drafts.courses.map(c=>`<option value="${safeText(c.id)}">${safeText(c.title)}</option>`).join('')}</select></label><input name="title" placeholder="Resource title" maxlength="160" required><input aria-label="Resource link" name="url" placeholder="https://… link" required><label>Type<select name="type"><option value="video">Video</option><option value="document">Document</option><option value="link">Link</option><option value="practice">Practice</option></select></label><button class="primary-btn">Add resource →</button><p id="staffResourceStatus" class="panel-copy"></p></form><h3>Enrollment & completion</h3>${staffTable(['Course','Status','Enrolled','Students'],(progress.courses||[]).map(c=>`<tr><td>${safeText(c.title)}</td><td>${safeText(c.status)}</td><td>${c.enrolled}</td><td>${c.students.map(x=>`${safeText(x.name)} (${x.completion}%)`).join(', ')||'—'}</td></tr>`),'No owned courses yet.')}<h3>EduVerse catalog</h3>${staffTable(['Course','Category','Level','Duration'],catalog.courses.map(c=>`<tr><td>${safeText(c.title)}</td><td>${safeText(c.category)}</td><td>${safeText(c.level)}</td><td>${safeText(c.duration)}</td></tr>`),'The catalog is empty.')}`;const lc=document.querySelector('#staffLessonCourse');if(lc)fillLessonModules(lc.value);const lvc=document.querySelector('#staffLessonVideoCourse');if(lvc)fillLessonVideoModules(lvc.value);return;}
 if(name==='teacher-assignments'){const {assignments}=await apiRequest('/assignments');root.innerHTML=staffTable(['Assignment','Class','Due','Submissions'],assignments.map(a=>{const klass=teacherClasses.find(c=>c.id===a.classId);return `<tr><td>${safeText(a.title)}<small>${safeText(a.course||'')}</small></td><td>${safeText(klass?.name||'Assigned class')}</td><td>${safeText(a.dueDate||'—')}</td><td>${(a.submissions||[]).length} / ${(a.studentIds||[]).length}</td></tr>`;}),'No assignments have been published by you.');return;}
 if(name==='teacher-grading'){const {submissions=[]}=await apiRequest('/teacher/grading'),pending=submissions.filter(s=>!s.grade).length,drafts=submissions.filter(s=>s.grade&&!s.grade.releasedAt).length,released=submissions.filter(s=>s.grade?.releasedAt).length;root.innerHTML=`<div class="grading-overview"><article><small>ALL SUBMISSIONS</small><b>${submissions.length}</b></article><article><small>NEEDS GRADING</small><b>${pending}</b></article><article><small>DRAFTS</small><b>${drafts}</b></article><article><small>RELEASED</small><b>${released}</b></article></div><div class="grading-toolbar"><label>Show <select id="gradingFilter"><option value="all">All submissions</option><option value="pending">Needs grading</option><option value="draft">Saved drafts</option><option value="released">Released grades</option></select></label></div><div class="grading-list">${submissions.map(s=>{const state=s.grade?.releasedAt?'released':s.grade?'draft':'pending';return `<article class="screen-panel grading-card" data-grading-state="${state}"><p class="eyebrow">${safeText(s.className)} · ${safeText(s.studentName)}</p><h3>${safeText(s.title)}</h3><p class="grading-text">${safeText(s.text||'No written response was attached.')}</p>${assignLateBadgeHtml(s.late===true)}${assignFileLinkHtml(s.fileUrl||(s.file&&s.file.url)||'',s.fileName||(s.file&&s.file.name)||'')}<small>Submitted ${s.submittedAt?new Date(s.submittedAt).toLocaleString():'Submission time unavailable'}</small><form class="teacher-form grade-form" data-assignment-id="${safeText(s.assignmentId)}" data-student-id="${safeText(s.studentId)}">${lmsGradeMarksHtml(s)}<textarea aria-label="Feedback for the learner" name="feedback" placeholder="Feedback for the learner" maxlength="3000">${safeText(s.grade?.feedback||'')}</textarea><label class="auth-check"><input name="release" type="checkbox" ${s.grade?.releasedAt?'checked':''}> Release marks and feedback to student</label><button class="primary-btn" type="submit">Save grade</button><small>${s.grade?.releasedAt?'Released to student':s.grade?'Draft · hidden from student':'Not graded yet · hidden from student'}</small><span class="grade-save-status" role="status"></span></form></article>`;}).join('')||'<p class="staff-empty">No student submissions are waiting for review.</p>'}</div>`;return;}
 if(name==='teacher-analytics'){const d=await apiRequest('/teacher/analytics');const total=d.assignments.reduce((n,a)=>n+a.assignedCount,0),submitted=d.assignments.reduce((n,a)=>n+a.submittedCount,0);root.innerHTML=`<div class="admin-metrics"><article class="admin-metric"><small>ASSIGNED CLASSES</small><b>${d.classes.length}</b></article><article class="admin-metric"><small>AUTHORIZED STUDENTS</small><b>${d.students.length}</b></article><article class="admin-metric"><small>SUBMISSION RATE</small><b>${total?Math.round(submitted/total*100):'—'}${total?'%':''}</b></article><article class="admin-metric"><small>ATTENDANCE RECORDS</small><b>${d.attendance.records}</b></article></div><div class="staff-grid"><section class="screen-panel"><h3>Assignment activity</h3>${staffTable(['Assignment','Due','Submitted','Graded / released'],d.assignments.map(a=>`<tr><td>${safeText(a.title)}</td><td>${safeText(a.dueDate||'—')}</td><td>${a.submittedCount} / ${a.assignedCount}</td><td>${a.gradedCount}</td></tr>`),'No assignment data has been recorded.')}</section><section class="screen-panel"><h3>Attendance totals</h3><p>Present ${d.attendance.present} · Absent ${d.attendance.absent} · Late ${d.attendance.late}</p><p class="panel-copy">Course completion and question-level performance are not stored by this installation.</p></section><section class="screen-panel"><h3>Students needing a follow-up</h3>${staffTable(['Student','Submitted','Assigned'],d.students.filter(s=>s.assignments>s.submitted).map(s=>`<tr><td>${safeText(s.name)}</td><td>${s.submitted}</td><td>${s.assignments}</td></tr>`),'No incomplete assignments are recorded.')}</section></div>`;return;}
 if(name==='teacher-announcements'){const {announcements}=await apiRequest('/teacher/announcements');root.innerHTML=announcements.length?announcements.map(a=>`<div class="audit-row"><b>${safeText(a.className)}</b><span>${safeText(a.message)}</span><small>${new Date(a.createdAt).toLocaleString()}</small></div>`).join(''):'<p class="staff-empty">No saved class announcements yet.</p>';return;}
 if(name==='admin-users'){await Promise.all([loadAdminUsers(document.querySelector('#adminUserSearch')?.value||''),loadCommunityReports()]);return;}
 if(name==='admin-classes'){await loadAdminClasses();return;}
 if(name==='admin-courses'){const {courses}=await apiRequest('/admin/courses');document.querySelectorAll('.admin-course-select').forEach(sel=>{sel.innerHTML=courses.map(c=>`<option value="${safeText(c.id)}">${safeText(c.title)}</option>`).join('');});try{const {institutions}=await apiRequest('/admin/institutions');const instList=institutions||[];document.querySelectorAll('.admin-org-institution').forEach(sel=>{sel.innerHTML='<option value="">None</option>'+instList.map(i=>`<option value="${safeText(i.id)}">${safeText(i.name)}</option>`).join('');});let campuses=[],depts=[],sems=[];for(const inst of instList){const c=await apiRequest(`/admin/institutions/${encodeURIComponent(inst.id)}/campuses`).catch(()=>({campuses:[]}));campuses.push(...(c.campuses||[]).map(x=>({...x,instName:inst.name})));const d=await apiRequest(`/admin/departments?institutionId=${encodeURIComponent(inst.id)}`).catch(()=>({departments:[]}));depts.push(...((d.departments||[]).map(x=>({...x,instName:inst.name}))));const y=await apiRequest(`/admin/academic-years?institutionId=${encodeURIComponent(inst.id)}`).catch(()=>({academicYears:[]}));for(const yr of (y.academicYears||[])){const sm=await apiRequest(`/admin/academic-years/${encodeURIComponent(yr.id)}/semesters`).catch(()=>({semesters:[]}));sems.push(...(sm.semesters||[]).map(x=>({...x,instName:inst.name,yearName:yr.name})));}}document.querySelectorAll('.admin-org-campus').forEach(sel=>{sel.innerHTML='<option value="">None</option>'+campuses.map(c=>`<option value="${safeText(c.id)}">${safeText(c.instName)} \u2014 ${safeText(c.name)}</option>`).join('');});document.querySelectorAll('.admin-org-dept').forEach(sel=>{sel.innerHTML='<option value="">None</option>'+depts.map(d=>`<option value="${safeText(d.id)}">${safeText(d.instName)} \u2014 ${safeText(d.name)}</option>`).join('');});document.querySelectorAll('.admin-org-semester').forEach(sel=>{sel.innerHTML='<option value="">None</option>'+sems.map(x=>`<option value="${safeText(x.id)}">${safeText(x.instName)} \u2014 ${safeText(x.yearName)} \u2014 ${safeText(x.name)}</option>`).join('');});}catch{}const teachers=await apiRequest('/admin/teachers').catch(()=>({users:[]}));document.querySelectorAll('.admin-teacher-select').forEach(sel=>{sel.innerHTML=(teachers.users||[]).filter(u=>u.status==='active').map(u=>`<option value="${safeText(u.id)}">${safeText(u.name)}</option>`).join('');});root.innerHTML=staffTable(['Course','Owner','Status','Enrolled','Action'],courses.map(c=>`<tr><td>${safeText(c.title)}</td><td>${safeText(c.ownerName)}</td><td>${safeText(c.status||'catalog')}</td><td>${c.enrolled}</td><td><button data-admin-course-action="published" data-course-id="${safeText(c.id)}">Publish</button> <button data-admin-course-action="draft" data-course-id="${safeText(c.id)}">Draft</button> <button data-admin-course-action="archived" data-course-id="${safeText(c.id)}">Archive</button></td></tr>`),'No courses in the catalog.');return;}
 if(name==='admin-roles'){await loadAdminRoles();return;}
 if(name==='admin-reports'){await loadOpsReports('overview');return;}
 if(name==='admin-audit'){const {audit}=await apiRequest('/admin/audit');root.innerHTML=audit.length?audit.map(a=>`<div class="audit-row"><b>${safeText(a.action)}</b><span>${safeText(a.target||'—')}</span><small>${new Date(a.at).toLocaleString()} · ${safeText(a.actor||'system')}</small></div>`).join(''):'<p class="staff-empty">No administrator activity has been recorded.</p>';return;}
 if(name==='admin-security'){await renderSecTab(secState.tab||'status');return;}

 if(name==='teacher-vision'){const [assign,results]=await Promise.all([apiRequest('/teacher/vision-assignments'),apiRequest('/teacher/vision-results')]);root.innerHTML=`<h3>Assigned experiments</h3>${staffTable(['Experiment','Class','Difficulty','Due'],assign.assignments.map(a=>`<tr><td>${safeText(a.title||a.experimentId)}</td><td>${safeText(a.className)}</td><td>${safeText(a.difficulty)}</td><td>${safeText(a.dueDate||'—')}</td></tr>`),'No experiments assigned yet.')}<h3>Student attempts (assigned experiments only)</h3>${staffTable(['Student','Class','Experiment','Score','Type'],results.results.map(r=>`<tr><td>${safeText(r.studentName)}</td><td>${safeText(r.className)}</td><td>${safeText(r.experimentId)}</td><td>${r.score}</td><td>${safeText(r.type)}</td></tr>`),'No attempts recorded for assigned experiments yet.')}`;return;}
 if(name==='teacher-settings'){root.innerHTML='<p class="panel-copy">Use the Account security form above to change your password.</p>';return;}
 if(name==='admin-teachers'){const {users,classes}=await apiRequest('/admin/teachers');root.innerHTML=staffTable(['Teacher','Email','Status','Classes'],users.map(u=>`<tr><td>${safeText(u.name)}</td><td>${safeText(u.email||u.username||'Contact details pending')}</td><td>${safeText(u.status)}</td><td>${classes.filter(c=>c.teacherIds.includes(u.id)).map(c=>safeText(c.name)).join(', ')||'—'}</td></tr>`),'No teacher accounts yet.');return;}
 if(name==='admin-students'){const {users,enrollments,classes}=await apiRequest('/admin/students');adminStudentRecords=users;root.innerHTML=`<section class="screen-panel"><h3>Student identification & guardian details</h3><p class="panel-copy">Assign the official registration number and class roll number. Roll numbers must be unique within a grade and section.</p><form id="adminStudentRecordForm" class="teacher-form student-record-form"><label>Student<select name="studentId" id="adminStudentRecordStudent" required><option value="">Choose a student</option>${users.map(u=>`<option value="${safeText(u.id)}">${safeText(u.name)} · ${safeText(u.username||u.email||'student account')}</option>`).join('')}</select></label><div class="student-record-fields"><label>Registration number<input name="registrationNumber" maxlength="30" placeholder="e.g. EV-2026-001" required></label><label>Roll number<input name="rollNumber" maxlength="20" placeholder="e.g. 12" required></label><label>Grade / class<input name="grade" maxlength="50" placeholder="e.g. Grade 7"></label><label>Section<input name="section" maxlength="30" placeholder="e.g. A"></label><label>Parent / guardian name<input name="guardianName" maxlength="80"></label><label>Guardian phone<input name="guardianPhone" type="tel" maxlength="20"></label></div><button class="primary-btn" type="submit">Save student record →</button><p id="adminStudentRecordStatus" class="panel-copy" role="status"></p></form></section>${staffTable(['Student','Registration no.','Roll no.','Grade / section','Guardian','Status','Classes'],users.map(u=>`<tr><td>${safeText(u.name)}<small>${safeText(u.email||u.username||'Contact details pending')}</small></td><td>${safeText(u.registrationNumber||'Not assigned')}</td><td>${safeText(u.rollNumber||'Not assigned')}</td><td>${safeText([u.grade,u.section].filter(Boolean).join(' · ')||'—')}</td><td>${safeText(u.guardianName||'—')}<small>${safeText(u.guardianPhone||'')}</small></td><td>${safeText(u.status)}</td><td>${classes.filter(c=>c.studentIds.includes(u.id)).map(c=>safeText(c.name)).join(', ')||'—'}</td></tr>`),'No student accounts yet.')}<p class="panel-copy">Course enrollments recorded: ${enrollments.length}</p>`;return;}
 if(name==='admin-institutions'){await loadAdminInstitutions();return;}
 if(name==='admin-calendar'){await loadAdminCalendar();return;}
 if(name==='admin-events'){await loadAdminEvents();return;}
 if(name==='admin-careers'){await loadAdminCareers();return;}
 if(name==='teacher-placement'){await loadTeacherPlacement();return;}
 if(name==='admin-enrollments'){const [data,users,courses,classes]=await Promise.all([apiRequest('/admin/enrollments'),apiRequest('/admin/users'),apiRequest('/admin/courses'),apiRequest('/admin/classes')]);document.querySelectorAll('.admin-student-select').forEach(sel=>{sel.innerHTML=users.users.filter(u=>u.role==='student'&&u.status==='active').map(u=>`<option value="${safeText(u.id)}">${safeText(u.name)}</option>`).join('');});document.querySelectorAll('.admin-class-select').forEach(sel=>{sel.innerHTML=classes.classes.map(c=>`<option value="${safeText(c.id)}">${safeText(c.name)}</option>`).join('');});document.querySelectorAll('.admin-course-select').forEach(sel=>{sel.innerHTML=courses.courses.map(c=>`<option value="${safeText(c.id)}">${safeText(c.title)}</option>`).join('');});root.innerHTML=`<h3>Course enrollments</h3>${staffTable(['Student','Course','Enrolled'],data.enrollments.map(e=>`<tr><td>${safeText(e.studentName)}</td><td>${safeText(e.courseTitle)}</td><td>${new Date(e.enrolledAt).toLocaleDateString()}</td></tr>`),'No course enrollments yet.')}<h3>Class memberships</h3>${staffTable(['Class','Students'],data.classes.map(c=>`<tr><td>${safeText(c.name)}</td><td>${c.students.map(x=>safeText(x.name)).join(', ')||'—'}</td></tr>`),'No classes yet.')}`;return;}
 if(name==='admin-settings'){const {settings}=await apiRequest('/admin/settings');root.innerHTML=`<label>Platform name<input name="platformName" value="${safeText(settings.platformName)}" maxlength="80"></label><label>Institution<input name="institution" value="${safeText(settings.institution)}" maxlength="120"></label><label>Timezone<input name="timezone" value="${safeText(settings.timezone)}" maxlength="60"></label><label>Locale<input name="locale" value="${safeText(settings.locale)}" maxlength="20"></label><label>Default theme<select name="defaultTheme"><option value="system" ${settings.defaultTheme==='system'?'selected':''}>System</option><option value="light" ${settings.defaultTheme==='light'?'selected':''}>Light</option><option value="dark" ${settings.defaultTheme==='dark'?'selected':''}>Dark</option></select></label><label>Maintenance message<textarea name="maintenanceMessage" maxlength="300">${safeText(settings.maintenanceMessage)}</textarea></label><label>Max upload (MB)<input name="maxUploadMB" type="number" min="1" max="500" value="${settings.maxUploadMB}"></label><label class="auth-check"><input type="checkbox" name="allowStudentRegistration" ${settings.allowStudentRegistration?'checked':''}> Allow public student registration</label><label class="auth-check"><input type="checkbox" name="requireTeacherApproval" ${settings.requireTeacherApproval?'checked':''}> Require administrator approval for teachers</label>`;return;}
 if(name==='teacher-quizzes'){await loadTeacherQuizzes();return;}
 if(name==='question-bank'){await loadQuestionBank();return;}
 if(name==='admin-plans'){await loadAdminPlans();return;}
 if(name==='admin-orders'){await loadAdminOrders();return;}
 if(name==='admin-integrations'){await loadAdminIntegrations();return;}
 if(name==='admin-backup'){await loadAdminBackup();return;}
 if(name==='admin-announcements'){await loadAdminAnnouncements();return;}
 if(name==='admin-fees'){await loadOpsFees();return;}
 if(name==='admin-subscriptions'){await loadOpsSubscriptions();return;}
 if(name==='admin-marketplace'){await loadOpsMarketplaceAdmin();return;}
 if(name==='admin-import'){return;}
 if(name==='admin-analytics'){await loadOpsAnalytics();return;}
 if(name==='admin-library'){await loadAdminLibrary();return;}
 if(name==='reading-lists'){await loadReadingLists();return;}
 }catch(err){root.innerHTML=`<p class="staff-empty">Could not load this page: ${safeText(err.message)}</p>`;}}
function renderStaffPage(name){const title=staffPageTitles[name];if(!title)return false;contentRoot.innerHTML=staffPageMarkup[name];document.querySelectorAll('.nav-item[data-screen]').forEach(a=>a.classList.toggle('active',a.dataset.screen===name));document.querySelector('.crumb').innerHTML=`${portalCrumb()} <span>/</span> ${safeText(title)}`;history.replaceState(null,'','#'+name);window.scrollTo({top:0,behavior:'smooth'});if(name.startsWith('teacher-'))loadTeacherClasses().then(()=>loadStaffPage(name));else loadStaffPage(name);return true;}
const previousStaffNavigate=navigate;navigate=function(name){if(!navigateForRole(name))return;if(staffPageMarkup[name]){renderStaffPage(name);return;}previousStaffNavigate(name);if(name==='admin')loadAdminDashboard();};
document.addEventListener('submit',async e=>{
 if(e.target.id==='staffAssignmentForm'){e.preventDefault();const f=e.target,status=document.querySelector('#staffAssignmentStatus');try{const body=Object.fromEntries(new FormData(f));body.allowLate=!!f.querySelector('input[name="allowLate"]')?.checked;body.rubric=[...document.querySelectorAll('#staffRubricRows .lms-rubric-row')].map(r=>{const ins=r.querySelectorAll('input');return {id:tqNewId('rc'),criterion:ins[0].value.trim(),maxPoints:Math.max(1,Math.min(100,Number(ins[1].value)||1))};}).filter(x=>x.criterion);if(!body.rubric.length)delete body.rubric;await apiRequest('/assignments',{method:'POST',body:JSON.stringify(body)});status.textContent='Assignment published to the selected class.';f.reset();document.querySelector('#staffRubricRows').innerHTML='';loadStaffPage('teacher-assignments');}catch(err){status.textContent=err.message;}}
 if(e.target.id==='staffRubricAdd'){tqRubricRow('staff');return;}
 if(e.target.id==='staffScheduleForm'){e.preventDefault();const f=e.target;try{await apiRequest('/teacher/schedule',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(f)))});const status=document.querySelector('#staffScheduleStatus');if(status)status.textContent='Class session added to your timetable.';f.reset();loadStaffPage('teacher-timetable');}catch{setStatus('#staffScheduleStatus','Could not save this session. Check your connection and try again.');}}
 if(e.target.id==='staffCourseForm'){e.preventDefault();const f=e.target,status=document.querySelector('#staffCourseStatus');try{const body=Object.fromEntries(new FormData(f));body.priceCents=Math.max(0,Math.round(Number(body.price||0)*100));delete body.price;await apiRequest('/teacher/courses',{method:'POST',body:JSON.stringify(body)});status.textContent='Course draft saved to your account.';f.reset();loadStaffPage('teacher-courses');}catch(err){status.textContent=err.message;}}
 /* --- Institution admin forms (slice A) --- */
 if(e.target.id==='adminInstitutionForm'){e.preventDefault();const f=e.target;try{const body=Object.fromEntries(new FormData(f));await apiRequest('/admin/institutions',{method:'POST',body:JSON.stringify(body)});setStatus('#adminInstitutionStatus','Institution created.');f.reset();loadStaffPage('admin-institutions');}catch(err){setStatus('#adminInstitutionStatus',err.message);}}
 if(e.target.id==='adminCampusForm'){e.preventDefault();const f=e.target;try{const body=Object.fromEntries(new FormData(f));await apiRequest(`/admin/institutions/${encodeURIComponent(adminSelectedInstitutionId)}/campuses`,{method:'POST',body:JSON.stringify(body)});setStatus('#adminCampusStatus','Campus added.');f.reset();loadStaffPage('admin-institutions');}catch(err){setStatus('#adminCampusStatus',err.message);}}
 if(e.target.id==='adminDeptForm'){e.preventDefault();const f=e.target;try{const body=Object.fromEntries(new FormData(f));if(!body.campusId)delete body.campusId;body.institutionId=adminSelectedInstitutionId;await apiRequest('/admin/departments',{method:'POST',body:JSON.stringify(body)});setStatus('#adminDeptStatus','Department added.');f.reset();loadStaffPage('admin-institutions');}catch(err){setStatus('#adminDeptStatus',err.message);}}
 if(e.target.id==='adminBrandingForm'){e.preventDefault();const f=e.target;try{const fd=new FormData(f),body={branding:{logoUrl:String(fd.get('logoUrl')||'').trim(),primaryColor:String(fd.get('primaryColor')||'#7257d9'),faviconUrl:String(fd.get('faviconUrl')||'').trim()}};await apiRequest(`/admin/institutions/${encodeURIComponent(adminSelectedInstitutionId)}`,{method:'PATCH',body:JSON.stringify(body)});setStatus('#adminBrandingStatus','Branding saved. Reloading preview…');applyInstitutionBranding();loadStaffPage('admin-institutions');}catch(err){setStatus('#adminBrandingStatus',err.message);}}
 if(e.target.id==='adminYearForm'){e.preventDefault();const f=e.target;try{const body=Object.fromEntries(new FormData(f));await apiRequest('/admin/academic-years',{method:'POST',body:JSON.stringify(body)});setStatus('#adminYearStatus','Academic year created.');f.reset();loadStaffPage('admin-calendar');}catch(err){setStatus('#adminYearStatus',err.message);}}
 if(e.target.matches('[data-org-semform]')){e.preventDefault();const f=e.target,yid=f.dataset.orgSemform;try{const body=Object.fromEntries(new FormData(f));await apiRequest(`/admin/academic-years/${encodeURIComponent(yid)}/semesters`,{method:'POST',body:JSON.stringify(body)});loadStaffPage('admin-calendar');}catch(err){alert(err.message);}}
 if(e.target.id==='adminRolesForm'){e.preventDefault();const f=e.target,perms={};for(const el of f.querySelectorAll('input[name="perm"]:checked')){const [role,perm]=el.value.split(':');(perms[role]=perms[role]||[]).push(perm);}for(const r of['super_admin','institution_admin','teacher','student'])if(!perms[r])perms[r]=[];try{await apiRequest('/admin/role-permissions',{method:'PATCH',body:JSON.stringify({rolePermissions:perms})});setStatus('#adminRolesStatus','Permissions saved and enforced by the backend.');}catch(err){setStatus('#adminRolesStatus',err.message);}}
 if(e.target.id==='adminCourseOrgForm'){e.preventDefault();const f=e.target;try{const fd=new FormData(f),body={};for(const k of['institutionId','campusId','departmentId','semesterId']){const v=String(fd.get(k)||'').trim();if(v)body[k]=v;}await apiRequest(`/admin/courses/${encodeURIComponent(fd.get('courseId'))}`,{method:'PATCH',body:JSON.stringify(body)});setStatus('#adminCourseOrgStatus','Course organization saved.');loadStaffPage('admin-courses');}catch(err){setStatus('#adminCourseOrgStatus',err.message);}}
 if(e.target.id==='staffAttendanceForm'){e.preventDefault();const f=e.target,status=document.querySelector('#staffAttendanceStatus'),attendance=[...f.querySelectorAll('#staffAttendanceRoster [data-student-id]')].map(el=>({studentId:el.dataset.studentId,status:el.value}));if(!attendance.length){status.textContent='Choose a class with enrolled students first.';return;}if(attendance.some(row=>!row.status)){status.textContent='Choose a status for every student before saving.';return;}try{await apiRequest('/teacher/attendance',{method:'POST',body:JSON.stringify({classId:f.classId.value,date:f.date.value,attendance})});status.textContent=`Attendance saved for ${attendance.length} students on ${new Date(`${f.date.value}T00:00:00`).toLocaleDateString()}.`;}catch(err){status.textContent=err.message;}}
 if(e.target.id==='staffAnnouncementForm'){e.preventDefault();const f=e.target,status=document.querySelector('#staffAnnouncementStatus');try{await apiRequest('/teacher/announcements',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(f)))});status.textContent='Announcement saved for this class.';f.reset();loadStaffPage('teacher-announcements');}catch(err){status.textContent=err.message;}}
 /* family slice: parent link form, admin announcements, link-parent actions */
 if(e.target.id==='parentLinkForm'){e.preventDefault();const f=e.target,status=document.querySelector('#parentLinkStatus');try{const body=Object.fromEntries(new FormData(f));await apiRequest('/parent/link',{method:'POST',body:JSON.stringify({code:String(body.code||'').trim().toUpperCase()})});status.textContent='Child linked successfully.';f.reset();loadParentDashboard();}catch(err){status.textContent=err.message;}}
 if(e.target.id==='adminAnnounceForm'){e.preventDefault();const f=e.target,status=document.querySelector('#adminAnnounceStatus');try{await apiRequest('/admin/announcements',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(f)))});status.textContent='Announcement posted.';f.reset();loadAdminAnnouncements();}catch(err){status.textContent=err.message;}}
 const annDel=e.target.closest('[data-admin-announce-del]');if(annDel){if(!confirm('Delete this announcement?'))return;try{await apiRequest(`/admin/announcements/${encodeURIComponent(annDel.dataset.adminAnnounceDel)}`,{method:'DELETE'});loadAdminAnnouncements();}catch(err){alert(err.message);}return;}
 const linkParent=e.target.closest('[data-admin-linkparent]');if(linkParent){openParentLinkModal(linkParent.dataset.adminLinkparent,linkParent.dataset.adminLinkname||'Student');return;}
 const unlink=e.target.closest('[data-unlink-parent]');if(unlink){if(!confirm('Remove this parent link?'))return;try{await apiRequest(`/admin/parent-links/${encodeURIComponent(unlink.dataset.unlinkParent)}`,{method:'DELETE'});closeModal();}catch(err){alert(err.message);}return;}
 if(e.target.matches('.grade-form')){e.preventDefault();const f=e.target,button=f.querySelector('[type="submit"]'),status=f.querySelector('.grade-save-status');if(button)button.disabled=true;if(status)status.textContent='Saving grade…';try{await apiRequest(`/teacher/grading/${encodeURIComponent(f.dataset.assignmentId)}/${encodeURIComponent(f.dataset.studentId)}`,{method:'PATCH',body:JSON.stringify((()=>{const rub=[...f.querySelectorAll('[data-rubric-q]')];if(!rub.length)return {marks:f.elements.namedItem('marks').value,maxMarks:f.elements.namedItem('maxMarks').value,feedback:f.elements.namedItem('feedback').value,release:f.elements.namedItem('release').checked};const rubricScores={};let tot=0,mx=0;rub.forEach(el=>{const cap=Number(el.dataset.rubricMax);const v=Math.max(0,Math.min(cap,Number(el.value)||0));rubricScores[el.dataset.rubricQ]=v;tot+=v;mx+=cap;});return {marks:tot,maxMarks:mx,feedback:f.elements.namedItem('feedback').value,release:f.elements.namedItem('release').checked,rubricScores};})())});const released=f.elements.namedItem('release').checked,card=f.closest('.grading-card'),note=f.querySelector('small:last-of-type');f.dataset.dirty='false';if(card)card.dataset.gradingState=released?'released':'draft';if(note)note.textContent=released?'Released to student':'Draft · hidden from student';if(status)status.textContent=released?'Grade saved and released to the student.':'Draft grade saved. It is still hidden from the student.';const counts={pending:0,draft:0,released:0};document.querySelectorAll('.grading-card').forEach(c=>{if(counts[c.dataset.gradingState]!==undefined)counts[c.dataset.gradingState]++;});const metrics=document.querySelectorAll('.grading-overview article b');if(metrics[1])metrics[1].textContent=counts.pending;if(metrics[2])metrics[2].textContent=counts.draft;if(metrics[3])metrics[3].textContent=counts.released;}catch(err){if(status)status.textContent=err.message||'Could not save this grade.';}finally{if(button)button.disabled=false;}}
});
document.addEventListener('change',e=>{if(e.target.matches('#staffAttendanceForm [name="classId"],#staffAttendanceForm [name="date"]'))loadStaffAttendanceRoster();if(e.target.id==='gradingFilter'){document.querySelectorAll('.grading-card').forEach(card=>{card.hidden=e.target.value!=='all'&&card.dataset.gradingState!==e.target.value;});}if(e.target.id==='adminStudentRecordStudent'){const user=adminStudentRecords.find(item=>item.id===e.target.value),form=document.querySelector('#adminStudentRecordForm');if(user&&form){for(const key of ['registrationNumber','rollNumber','grade','section','guardianName','guardianPhone'])form.elements.namedItem(key).value=user[key]||'';document.querySelector('#adminStudentRecordStatus').textContent='';}}});
document.addEventListener('click',e=>{const bulk=e.target.closest('[data-attendance-all]');if(!bulk)return;document.querySelectorAll('#staffAttendanceRoster [data-student-id]').forEach(select=>{select.value=bulk.dataset.attendanceAll;});});

// Refresh shared, published records when a portal tab returns or while its
// read-only view remains open. Never replace a focused field or edited grade.
async function refreshSharedPortalView(){
 if(!currentUser||document.hidden||!authRoot.hidden||modal.classList.contains('open'))return;
 if(document.activeElement?.matches?.('input,textarea,select,[contenteditable="true"]'))return;
 await updateNotificationBadge();
 const screen=location.hash.slice(1).split('?')[0];
 if(screen==='assignments'){await Promise.all([loadAssignments(),loadStudentTools()]);return;}
 if(screen==='announcements')return loadAnnouncements();
 if(screen==='notifications'){await loadNotifications();await updateNotificationBadge();return;}
 if(screen==='profile')return loadStudentAnalytics();
 if(screen==='catalog')return loadCatalog(document.querySelector('#courseSearch')?.value||'',document.querySelector('#levelFilter')?.value||'all');
 if(screen==='marketplace')return loadMarketplace();
 if(screen==='live-classes')return loadLiveClasses();
 if(screen==='teacher')return loadTeacherWorkspace();
 if(screen==='today'||screen==='timetable')return loadStudentScheduleView(screen);
 if(['teacher-announcements','teacher-assignments','teacher-classes','teacher-timetable','teacher-quizzes','question-bank'].includes(screen))return loadStaffPage(screen);
 if(screen==='teacher-grading'){if(document.querySelector('.grade-form[data-dirty="true"]'))return;return loadStaffPage(screen);}
 if(screen==='quizzes')return loadQuizzes();
}
document.addEventListener('input',e=>{if(e.target.closest?.('.grade-form'))e.target.closest('.grade-form').dataset.dirty='true';});
document.addEventListener('change',e=>{if(e.target.closest?.('.grade-form'))e.target.closest('.grade-form').dataset.dirty='true';});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshSharedPortalView();});
window.addEventListener('focus',refreshSharedPortalView);
setInterval(refreshSharedPortalView,25000);

let teacherCourseCache=[];
function fillLessonModules(courseId){const sel=document.querySelector('#staffLessonModule');if(!sel)return;const course=(teacherCourseCache||[]).find(c=>c.id===courseId);const mods=course?.modules||[];sel.innerHTML=mods.map(m=>`<option value="${safeText(m.id)}">${safeText(m.name||'')}</option>`).join('')||'<option value="">Add a module first</option>';}
document.addEventListener('change',e=>{if(e.target.id==='staffLessonCourse')fillLessonModules(e.target.value);});
document.addEventListener('click',async e=>{
 const enroll=e.target.closest('[data-enroll-course]');if(enroll){e.preventDefault();try{await apiRequest(`/courses/${encodeURIComponent(enroll.dataset.enrollCourse)}/enroll`,{method:'POST',body:'{}'});enroll.textContent='Enrolled ✓';loadCatalog();}catch(err){if(/pay|price|subscription|402/i.test(err.message))startCheckout('course',enroll.dataset.enrollCourse);else alert(err.message);}return;}
 const ca=e.target.closest('[data-course-action]');if(ca){try{await apiRequest(`/teacher/courses/${encodeURIComponent(ca.dataset.courseId)}`,{method:'PATCH',body:JSON.stringify({status:ca.dataset.courseAction})});loadStaffPage('teacher-courses');}catch(err){alert(err.message);}return;}
 const aca=e.target.closest('[data-admin-course-action]');if(aca){try{await apiRequest(`/admin/courses/${encodeURIComponent(aca.dataset.courseId)}`,{method:'PATCH',body:JSON.stringify({status:aca.dataset.adminCourseAction})});loadStaffPage('admin-courses');}catch(err){alert(err.message);}return;}
 /* --- Institution admin clicks (slice A) --- */
 const oi=e.target.closest('[data-org-inst]');if(oi){const id=oi.dataset.id,act=oi.dataset.orgInst;
  if(act==='select'){adminSelectedInstitutionId=id;loadStaffPage('admin-institutions');return;}
  try{
    if(act==='suspend')await apiRequest(`/admin/institutions/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({status:'suspended'})});
    else if(act==='activate')await apiRequest(`/admin/institutions/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({status:'active'})});
    else if(act==='delete'){if(!confirm('Delete this institution? Only empty institutions can be deleted.'))return;await apiRequest(`/admin/institutions/${encodeURIComponent(id)}`,{method:'DELETE'});if(adminSelectedInstitutionId===id)adminSelectedInstitutionId=null;}
    loadStaffPage('admin-institutions');
  }catch(err){alert(err.message);}return;}
 const oc=e.target.closest('[data-org-campus]');if(oc){if(!confirm('Delete this campus?'))return;try{await apiRequest(`/admin/institutions/${encodeURIComponent(adminSelectedInstitutionId)}/campuses/${encodeURIComponent(oc.dataset.id)}`,{method:'DELETE'});loadStaffPage('admin-institutions');}catch(err){alert(err.message);}return;}
 const od=e.target.closest('[data-org-dept]');if(od){if(!confirm('Delete this department?'))return;try{await apiRequest(`/admin/departments/${encodeURIComponent(od.dataset.id)}`,{method:'DELETE'});loadStaffPage('admin-institutions');}catch(err){alert(err.message);}return;}
 const oy=e.target.closest('[data-org-year]');if(oy){const id=oy.dataset.id,act=oy.dataset.orgYear;
  try{
    if(act==='current')await apiRequest(`/admin/academic-years/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({isCurrent:true})});
    else if(act==='delete'){if(!confirm('Delete this academic year and its semesters?'))return;await apiRequest(`/admin/academic-years/${encodeURIComponent(id)}`,{method:'DELETE'});}
    loadStaffPage('admin-calendar');
  }catch(err){alert(err.message);}return;}
 const os=e.target.closest('[data-org-sem]');if(os){const id=os.dataset.id,yid=os.dataset.year,act=os.dataset.orgSem;
  try{
    if(act==='current')await apiRequest(`/admin/academic-years/${encodeURIComponent(yid)}/semesters/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({isCurrent:true})});
    else if(act==='delete'){if(!confirm('Delete this semester?'))return;await apiRequest(`/admin/academic-years/${encodeURIComponent(yid)}/semesters/${encodeURIComponent(id)}`,{method:'DELETE'});}
    loadStaffPage('admin-calendar');
  }catch(err){alert(err.message);}return;}
 const exp=e.target.closest('[data-export-type]');if(exp){try{const res=await fetch(`/api/admin/reports/export?type=${encodeURIComponent(exp.dataset.exportType)}`);if(!res.ok)throw new Error('Export failed');const blob=await res.blob(),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`eduverse-${exp.dataset.exportType}.csv`;a.click();}catch(err){alert(err.message);}return;}
 const rec=e.target.closest('[data-admin-recovery]');if(rec){if(!confirm('Issue a one-time recovery code for this account? It expires in 15 minutes and must be shared securely, out of band.'))return;try{const data=await apiRequest(`/admin/users/${encodeURIComponent(rec.dataset.adminRecovery)}/recovery`,{method:'POST',body:'{}'});openModal(`<h2 id="modalTitle">Recovery code — show once</h2><p>Share this code securely with the account owner. It expires in 15 minutes and cannot be shown again.</p><p style="font-family:monospace;word-break:break-all;background:#f5f2ff;padding:12px;border-radius:8px">${data.recoveryToken}</p><p class="panel-copy">The owner enters it on the Forgot password screen with a new password.</p>`);}catch(err){alert(err.message);}return;}
 const mfa=e.target.closest('#mfaSetupBtn');if(mfa){try{const data=await apiRequest('/auth/mfa/setup',{method:'POST',body:'{}'});const el=document.querySelector('#mfaSecret');if(el)el.textContent=data.secret?`Authenticator secret: ${data.secret} (MFA currently ${data.mfaEnabled?'enabled':'not enabled'})`:'MFA is only available for administrator accounts.';}catch(err){alert(err.message);}return;}
 const aa=e.target.closest('[data-admin-action]');if(aa){const cur=location.hash.replace('#','');if(staffPageMarkup[cur]&&cur!=='admin')setTimeout(()=>loadStaffPage(cur),300);}
});
document.addEventListener('submit',async e=>{
 const setStatus=(id,msg)=>{const el=document.querySelector(id);if(el)el.textContent=msg;};
 if(e.target.id==='authForgotForm'){e.preventDefault();try{await fetch('/api/auth/forgot-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e.target.email.value.trim()})});setStatus('#forgotStatus','Request recorded. Ask an administrator for a recovery code, then use the form below.');}catch(err){setStatus('#forgotStatus',err.message);}}
 if(e.target.id==='authResetForm'){e.preventDefault();try{const res=await fetch('/api/auth/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:e.target.token.value.trim(),password:e.target.password.value})});const d=await res.json();if(!res.ok)throw new Error(d.error||'Reset failed');storeAuthTokens(d);setStatus('#resetStatus','Password updated. You can sign in now.');}catch(err){setStatus('#resetStatus',err.message);}}
 if(e.target.id==='changePasswordForm'){e.preventDefault();const f=e.target;try{await apiRequest('/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword:f.currentPassword.value,newPassword:f.newPassword.value})});setStatus('#changePasswordStatus','Password changed.');f.reset();try{await authRequest('logout',{});}catch{}authView('signin',currentUser?.role||'student','Password changed. All sessions were signed out — sign in with your new password.');}catch(err){setStatus('#changePasswordStatus',err.message);}}
 if(e.target.classList?.contains('delete-account-form')){e.preventDefault();const f=e.target;if(!confirm('Permanently delete your account and all your personal data? This cannot be undone.'))return;try{await apiRequest('/auth/account',{method:'DELETE',body:JSON.stringify({password:f.password.value})});try{await authRequest('logout',{});}catch{}authView('welcome','student','Your account has been deleted.');}catch(err){const st=f.querySelector('.delete-account-status');if(st)st.textContent=err.message;}}
 if(e.target.id==='staffModuleForm'){e.preventDefault();const f=e.target;try{const d=await apiRequest(`/teacher/courses/${encodeURIComponent(f.courseId.value)}/modules`,{method:'POST',body:JSON.stringify({name:f.name.value})});teacherCourseCache=teacherCourseCache.map(c=>c.id===f.courseId.value?d.course:c);setStatus('#staffModuleStatus','Module added.');f.reset();loadStaffPage('teacher-courses');}catch(err){setStatus('#staffModuleStatus',err.message);}}
 if(e.target.id==='staffLessonForm'){e.preventDefault();const f=e.target;try{await apiRequest(`/teacher/courses/${encodeURIComponent(f.courseId.value)}/modules/${encodeURIComponent(f.moduleId.value)}/lessons`,{method:'POST',body:JSON.stringify({title:f.title.value,content:f.content.value,kind:f.kind.value||undefined,videoUrl:f.videoUrl.value.trim(),videoSources:f.videoSources.value.trim(),captions:f.captions.value.trim(),transcript:f.transcript.value.trim()})});setStatus('#staffLessonStatus','Lesson added.');f.reset();loadStaffPage('teacher-courses');}catch(err){setStatus('#staffLessonStatus',err.message);}}
 if(e.target.id==='staffResourceForm'){e.preventDefault();const f=e.target;try{await apiRequest(`/teacher/courses/${encodeURIComponent(f.courseId.value)}/resources`,{method:'POST',body:JSON.stringify({title:f.title.value,url:f.url.value,type:f.type.value})});setStatus('#staffResourceStatus','Resource added.');f.reset();}catch(err){setStatus('#staffResourceStatus',err.message);}}
 if(e.target.id==='staffResourceUploadForm'){e.preventDefault();const f=e.target,file=f.elements.file.files[0],status=document.querySelector('#staffResourceUploadStatus');if(!file)return;status.textContent='Uploading…';try{const url=new URL(`/api/teacher/courses/${encodeURIComponent(f.courseId.value)}/resources/upload`,location.origin);url.searchParams.set('title',f.elements.title.value.trim());const response=await fetch(url,{method:'POST',headers:{'Content-Type':file.type||({pdf:'application/pdf',mp4:'video/mp4',webm:'video/webm',txt:'text/plain',md:'text/markdown'}[file.name.split('.').pop().toLowerCase()]||'application/octet-stream')},body:file,credentials:'same-origin'}),data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Upload failed.');status.textContent='Material uploaded and attached to the course.';f.reset();}catch(err){status.textContent=err.message;}}
 if(e.target.matches('.course-review-form')){e.preventDefault();const f=e.target,courseId=f.dataset.courseReview,status=f.querySelector('[role="status"]');try{await apiRequest(`/courses/${encodeURIComponent(courseId)}/reviews`,{method:'POST',body:JSON.stringify({rating:Number(f.elements.rating.value),comment:f.elements.comment.value})});status.textContent='Your course review was saved.';await loadMyCourses();const course=catalogCoursesCache.find(item=>item.id===courseId);if(course&&modal.classList.contains('open'))await showCourseDetails(course);}catch(err){status.textContent=err.message;}}
 if(e.target.id==='staffVisionForm'){e.preventDefault();const f=e.target;try{await apiRequest('/teacher/vision-assignments',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(f)))});setStatus('#staffVisionStatus','Experiment assigned to the class.');f.reset();loadStaffPage('teacher-vision');}catch(err){setStatus('#staffVisionStatus',err.message);}}
 if(e.target.id==='adminCreateUserForm'){e.preventDefault();const f=e.target;const fd=new FormData(f);if(fd.get('role')==='admin'&&!confirm('Create a full administrator account? Administrators can manage users, permissions, settings and reports. Only create accounts for people you trust with full platform control.'))return;try{await apiRequest('/admin/users',{method:'POST',body:JSON.stringify(Object.fromEntries(fd))});setStatus('#adminCreateUserStatus','Account created.');f.reset();loadStaffPage('admin-teachers');loadStaffPage('admin-users');}catch(err){setStatus('#adminCreateUserStatus',err.message);}}
 if(e.target.id==='adminStudentRecordForm'){e.preventDefault();const f=e.target,status=document.querySelector('#adminStudentRecordStatus'),body=Object.fromEntries(new FormData(f));try{await apiRequest(`/admin/students/${encodeURIComponent(body.studentId)}/record`,{method:'PATCH',body:JSON.stringify(body)});await loadStaffPage('admin-students');const refreshedStatus=document.querySelector('#adminStudentRecordStatus');if(refreshedStatus)refreshedStatus.textContent='Student identification and guardian details saved.';}catch(err){status.textContent=err.message;}} if(e.target.id==='adminOrgForm'){e.preventDefault();const f=e.target;try{await apiRequest('/admin/org',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(f)))});setStatus('#adminOrgStatus','Record created.');f.reset();loadStaffPage('admin-institutions');}catch(err){setStatus('#adminOrgStatus',err.message);}}
 if(e.target.id==='adminEnrollClassForm'){e.preventDefault();const f=e.target;try{await apiRequest('/admin/enrollments',{method:'POST',body:JSON.stringify({classId:f.classId.value,studentId:f.studentId.value})});setStatus('#adminEnrollStatus','Student enrolled in the class.');loadStaffPage('admin-enrollments');}catch(err){setStatus('#adminEnrollStatus',err.message);}}
 if(e.target.id==='adminEnrollCourseForm'){e.preventDefault();const f=e.target;try{await apiRequest('/admin/enrollments',{method:'POST',body:JSON.stringify({courseId:f.courseId.value,studentId:f.studentId.value})});setStatus('#adminEnrollCourseStatus','Student enrolled in the course.');loadStaffPage('admin-enrollments');}catch(err){setStatus('#adminEnrollCourseStatus',err.message);}}
 if(e.target.id==='adminCourseAssignForm'){e.preventDefault();const f=e.target;try{await apiRequest(`/admin/courses/${encodeURIComponent(f.courseId.value)}`,{method:'PATCH',body:JSON.stringify({ownerId:f.ownerId.value})});setStatus('#adminCourseAssignStatus','Course reassigned.');loadStaffPage('admin-courses');}catch(err){setStatus('#adminCourseAssignStatus',err.message);}}
 if(e.target.id==='adminPermissionsForm'){e.preventDefault();const f=e.target,perms={teacher:{},student:{}};for(const el of f.querySelectorAll('input[type=checkbox]')){const [role,key]=el.name.split('.');if(perms[role])perms[role][key]=el.checked;}try{await apiRequest('/admin/permissions',{method:'PATCH',body:JSON.stringify({permissions:perms})});setStatus('#adminPermissionsStatus','Permissions saved and enforced by the backend.');}catch(err){setStatus('#adminPermissionsStatus',err.message);}}
 if(e.target.id==='adminSettingsForm'){e.preventDefault();const f=e.target,body={platformName:f.platformName.value,institution:f.institution.value,timezone:f.timezone.value,locale:f.locale.value,defaultTheme:f.defaultTheme.value,maintenanceMessage:f.maintenanceMessage.value,maxUploadMB:f.maxUploadMB.value,allowStudentRegistration:f.allowStudentRegistration.checked,requireTeacherApproval:f.requireTeacherApproval.checked};try{await apiRequest('/admin/settings',{method:'PATCH',body:JSON.stringify(body)});setStatus('#adminSettingsStatus','Settings saved.');}catch(err){setStatus('#adminSettingsStatus',err.message);}}
 if(e.target.id==='mfaVerifyForm'){e.preventDefault();const f=e.target;try{await apiRequest('/auth/mfa/verify',{method:'POST',body:JSON.stringify({code:f.code.value})});setStatus('#mfaVerifyStatus','MFA enabled for this administrator account.');}catch(err){setStatus('#mfaVerifyStatus',err.message);}}
 if(e.target.id==='mfaDisableForm'){e.preventDefault();const f=e.target;try{await apiRequest('/auth/mfa/disable',{method:'POST',body:JSON.stringify({code:f.code.value})});setStatus('#mfaDisableStatus','MFA disabled.');}catch(err){setStatus('#mfaDisableStatus',err.message);}}
});

/* ================= EduVerse LMS expansion (frontend) ================= */

/* ================= Nova AI Tools (frontend) ================= */
const NOVA_TOOL_META={
 tutor:{name:'AI Personal Tutor',icon:'📖'},
 doubt:{name:'AI Doubt Solver',icon:'❓'},
 notes:{name:'AI Notes Generator',icon:'📝'},
 quizgen:{name:'AI Quiz Generator',icon:'✏️'},
 flashcards:{name:'AI Flashcards',icon:'🗂️'},
 summarizer:{name:'AI Summarizer',icon:'📄'},
 planner:{name:'AI Study Planner',icon:'📅'},
 assignment:{name:'AI Assignment Assistant',icon:'📋'},
 codementor:{name:'AI Coding Mentor',icon:'💻'},
 writing:{name:'AI Writing Assistant',icon:'✍️'},
 research:{name:'AI Research Assistant',icon:'🔍'},
 recommend:{name:'AI Learning Recommendations',icon:'🧭'},
 teacher:{name:'AI Teacher Assistant',icon:'🍎'},
 performance:{name:'AI Performance Analyzer',icon:'📊'}
};
let novaToolsCache=null;
let novaToolsLoadToken=0;
function novaProviderBadge(p){return `<span class="nova-provider-badge${p==='openai'?' ai':''}">${p==='openai'?'AI':'Built-in'}</span>`;}
function novaResultBadge(p){return `<span class="nova-result-badge${p==='openai'?' ai':''}">${p==='openai'?'Answered by AI':'Built-in logic'}</span>`;}
function novaSetTab(tab){
 const panel=document.querySelector('#novaPanel');if(!panel)return;
 panel.classList.toggle('tools-active',tab==='tools');
 panel.querySelectorAll('.nova-tab').forEach(b=>{const on=b.dataset.novaTab===tab;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));});
 const pane=document.querySelector('#novaToolsPane');if(pane)pane.hidden=tab!=='tools';
 if(tab==='tools'&&!novaToolsCache)novaLoadTools();
}
async function novaLoadTools(){
 const bodyEl=document.querySelector('#novaToolsBody');if(!bodyEl)return;
 const token=++novaToolsLoadToken;
 bodyEl.innerHTML='<p class="panel-copy">Loading AI tools…</p>';
 try{const d=await apiRequest('/nova/tools');if(token!==novaToolsLoadToken)return;novaToolsCache=d;novaRenderToolGrid();}
 catch(err){if(token!==novaToolsLoadToken)return;bodyEl.innerHTML=`<div class="nova-error">${safeText(err.message)}</div>`;}
}
function novaRenderToolGrid(){
 const bodyEl=document.querySelector('#novaToolsBody'),d=novaToolsCache;if(!bodyEl||!d)return;
 const isStaff=currentUser&&(currentUser.role==='teacher'||currentUser.role==='admin');
 const cards=(d.tools||[]).filter(t=>t.id!=='teacher'||isStaff).map(t=>{
  const m=NOVA_TOOL_META[t.id]||{name:t.id,icon:'✦'};
  return `<button class="nova-tool-card" data-nova-tool="${safeText(t.id)}" type="button"><span class="ticon">${m.icon}</span><span><b>${safeText(m.name)}</b><small>${safeText(t.desc||'')}</small></span></button>`;
 }).join('');
 bodyEl.innerHTML=`<div class="nova-tools-head"><b>AI Tools</b>${novaProviderBadge(d.provider)}</div><div class="nova-tool-grid">${cards||'<p class="panel-copy">No tools available.</p>'}</div>`;
 bodyEl.querySelectorAll('[data-nova-tool]').forEach(b=>b.addEventListener('click',()=>novaOpenTool(b.dataset.novaTool)));
}
const NOVA_TOOL_FORMS={
 tutor:[{k:'topic',label:'Topic',type:'text',ph:'e.g. Photosynthesis',req:1}],
 doubt:[{k:'q',label:'Your question',type:'textarea',ph:'Ask anything…',req:1},{k:'useLesson',label:'Use the lesson open in the video player as context',type:'check'}],
 notes:[{k:'topic',label:'Topic',type:'text',ph:'Lesson topic'},{k:'text',label:'Lesson text',type:'textarea',ph:'Paste lesson content…',req:1}],
 quizgen:[{k:'text',label:'Study material',type:'textarea',ph:'Paste the material to quiz on…',req:1},{k:'count',label:'Number of questions (1–10)',type:'number',min:1,max:10,value:5}],
 flashcards:[{k:'text',label:'Material for cards',type:'textarea',ph:'Paste text — or pick a quiz below'},{k:'quizId',label:'Or generate from a quiz',type:'quizselect'}],
 summarizer:[{k:'text',label:'Text to summarize',type:'textarea',ph:'Paste a long lesson or PDF text…',req:1}],
 planner:[{k:'days',label:'Plan length in days (1–30)',type:'number',min:1,max:30,value:7}],
 assignment:[{k:'assignmentId',label:'Assignment',type:'assignselect',req:1}],
 codementor:[{k:'language',label:'Language',type:'langselect'},{k:'code',label:'Your code',type:'textarea',ph:'Paste code…',req:1}],
 writing:[{k:'text',label:'Your text',type:'textarea',ph:'Paste writing to improve…',req:1}],
 research:[{k:'text',label:'References / notes (one per line)',type:'textarea',ph:'One reference per line…',req:1}],
 recommend:[],
 teacher:[{k:'topic',label:'Topic',type:'text',ph:'e.g. Fractions',req:1},{k:'kind',label:'Material kind',type:'kindselect'}],
 performance:[]
};
function novaFieldHtml(f,quizzes,assignments){
 const req=f.req?' required':'';
 if(f.type==='textarea')return `<label>${safeText(f.label)}<textarea name="${f.k}" placeholder="${safeText(f.ph||'')}" rows="4"${req}></textarea></label>`;
 if(f.type==='text')return `<label>${safeText(f.label)}<input type="text" name="${f.k}" placeholder="${safeText(f.ph||'')}" maxlength="500"${req}></label>`;
 if(f.type==='number')return `<label>${safeText(f.label)}<input type="number" name="${f.k}" min="${f.min}" max="${f.max}" value="${f.value}"></label>`;
 if(f.type==='check')return `<label class="nova-check"><input type="checkbox" name="${f.k}"> ${safeText(f.label)}</label>`;
 if(f.type==='quizselect')return `<label>${safeText(f.label)}<select name="${f.k}"><option value="">— use the text above —</option>${(quizzes||[]).map(q=>`<option value="${safeText(q.id)}">${safeText(q.title||'Quiz')}</option>`).join('')}</select></label>`;
 if(f.type==='assignselect')return `<label>${safeText(f.label)}<select name="${f.k}"${req}><option value="">Choose…</option>${(assignments||[]).map(a=>`<option value="${safeText(a.id)}">${safeText(a.title||'Assignment')}</option>`).join('')}</select></label>`;
 if(f.type==='langselect')return `<label>${safeText(f.label)}<select name="${f.k}"><option value="javascript">JavaScript</option><option value="python">Python</option><option value="java">Java</option><option value="other">Other</option></select></label>`;
 if(f.type==='kindselect')return `<label>${safeText(f.label)}<select name="${f.k}"><option value="lesson-outline">Lesson outline</option><option value="quiz">Quiz</option><option value="worksheet">Worksheet</option></select></label>`;
 return '';
}
async function novaOpenTool(id){
 const bodyEl=document.querySelector('#novaToolsBody');if(!bodyEl)return;
 const meta=NOVA_TOOL_META[id]||{name:id,icon:'✦'};
 const tool=(novaToolsCache&&novaToolsCache.tools||[]).find(t=>t.id===id)||{};
 const fields=NOVA_TOOL_FORMS[id]||[];
 let quizzes=[],assignments=[];
 if(fields.some(f=>f.type==='quizselect')){try{quizzes=(await apiRequest('/quizzes')).quizzes||[];}catch{}}
 if(fields.some(f=>f.type==='assignselect')){try{assignments=(await apiRequest('/assignments')).assignments||[];}catch{}}
 bodyEl.innerHTML=`<button class="nova-back" id="novaBack" type="button">← All tools</button>
 <div class="nova-tool-title"><b>${meta.icon} ${safeText(meta.name)}</b>${novaProviderBadge(novaToolsCache&&novaToolsCache.provider)}</div>
 <p class="nova-tool-desc">${safeText(tool.desc||'')}</p>
 <form class="nova-tool-form" id="novaToolForm">${fields.map(f=>novaFieldHtml(f,quizzes,assignments)).join('')}<button class="primary-btn" type="submit" style="margin-top:10px">Run →</button></form>
 <div id="novaToolResult"></div>`;
 document.querySelector('#novaBack').addEventListener('click',novaRenderToolGrid);
 document.querySelector('#novaToolForm').addEventListener('submit',e=>{
  e.preventDefault();
  const input=novaCollectInput(id,e.target);
  if(input===null)return;
  novaSubmitTool(id,input);
 });
 if(!fields.length)novaSubmitTool(id,{});
}
function novaCollectInput(id,form){
 const fd=new FormData(form),input={};
 for(const f of (NOVA_TOOL_FORMS[id]||[])){
  if(f.type==='check'){input[f.k]=fd.get(f.k)==='on';continue;}
  let v=String(fd.get(f.k)||'').trim();
  if(f.req&&!v){const r=document.querySelector('#novaToolResult');if(r)r.innerHTML='<div class="nova-error">Please fill the required field.</div>';return null;}
  if(f.type==='number')input[f.k]=Math.max(f.min,Math.min(f.max,Number(v)||f.value));
  else input[f.k]=v;
 }
 if(id==='doubt'&&input.useLesson){input.lessonText=novaCurrentLessonText();delete input.useLesson;}
 if(id==='flashcards'&&input.quizId&&!input.text)delete input.text;
 return input;
}
function novaCurrentLessonText(){
 const t=document.querySelector('.lms-transcript-body');
 const n=document.querySelector('.lms-lesson-notes');
 return (((t&&t.textContent)||'')+'\n'+((n&&n.textContent)||'')).trim().slice(0,4000);
}
async function novaSubmitTool(id,input){
 const resEl=document.querySelector('#novaToolResult');if(!resEl)return;
 resEl.innerHTML='<p class="panel-copy">Working…</p>';
 try{
  const d=await apiRequest('/nova',{method:'POST',body:JSON.stringify({tool:id,input})});
  novaRenderResult(id,d,resEl);
 }catch(err){resEl.innerHTML=`<div class="nova-error">${safeText(err.message)}</div>`;}
}
function novaMd(src){
 let h=safeText(src);
 h=h.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>');
 const lines=h.split('\n');let out='',inList=false;
 for(const ln of lines){
  const t=ln.trim();let m;
  if(m=t.match(/^###\s+(.*)/)){if(inList){out+='</ul>';inList=false;}out+=`<h4>${m[1]}</h4>`;}
  else if(m=t.match(/^##\s+(.*)/)){if(inList){out+='</ul>';inList=false;}out+=`<h3>${m[1]}</h3>`;}
  else if(m=t.match(/^[-•*]\s+(.*)/)){if(!inList){out+='<ul>';inList=true;}out+=`<li>${m[1]}</li>`;}
  else{if(inList){out+='</ul>';inList=false;}out+=t?`<p>${t}</p>`:'';}
 }
 if(inList)out+='</ul>';
 return out||'<p>No result.</p>';
}
function novaRenderResult(id,d,resEl){
 const badge=novaResultBadge(d.provider);
 if(d.result&&typeof d.result==='object'){
  if(id==='flashcards')return novaRenderFlashcards(d.result,resEl,badge);
  if(id==='quizgen')return novaRenderQuizgen(d.result,resEl,badge);
  if(id==='planner')return novaRenderPlanner(d.result,resEl,badge);
  if(id==='recommend')return novaRenderRecommend(d.result,resEl,badge);
  if(id==='performance')return novaRenderPerformance(d.result,resEl,badge);
 }
 resEl.innerHTML=`<div class="nova-result">${badge}<div>${novaMd(String(d.result??''))}</div></div>`;
}
function novaRenderFlashcards(result,resEl,badge){
 const cards=Array.isArray(result.cards)?result.cards:[];
 if(!cards.length){resEl.innerHTML=`<div class="nova-result">${badge}<p>No cards generated. Provide text or pick a quiz.</p></div>`;return;}
 let i=0,flipped=false;
 const draw=()=>{
  const c=cards[i]||{};
  resEl.innerHTML=`<div class="nova-result">${badge}
  <div class="nova-flashcard" id="novaFc" role="button" tabindex="0" aria-label="Flashcard ${i+1} of ${cards.length}, activate to flip">
   <div><div class="${flipped?'fc-back':''}">${safeText(String(flipped?(c.back??''):c.front??''))}</div><span class="fc-hint">${flipped?'Answer — tap to see the question':'Tap to flip'}</span></div>
  </div>
  <div class="nova-fc-nav"><button id="novaFcPrev" type="button">← Prev</button><span>${i+1} / ${cards.length}</span><button id="novaFcNext" type="button">Next →</button></div></div>`;
  const fc=document.querySelector('#novaFc');
  const flip=()=>{flipped=!flipped;draw();};
  if(fc){fc.addEventListener('click',flip);fc.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();flip();}});}
  const pv=document.querySelector('#novaFcPrev'),nx=document.querySelector('#novaFcNext');
  if(pv)pv.addEventListener('click',()=>{i=(i-1+cards.length)%cards.length;flipped=false;draw();});
  if(nx)nx.addEventListener('click',()=>{i=(i+1)%cards.length;flipped=false;draw();});
 };
 draw();
}
function novaRenderQuizgen(result,resEl,badge){
 const qs=Array.isArray(result.questions)?result.questions:[];
 const isStaff=currentUser&&(currentUser.role==='teacher'||currentUser.role==='admin');
 const html=qs.map((q,qi)=>{
  const opts=(q.options||[]).map((o,oi)=>`<li class="${oi===q.correctIndex?'correct':''}">${safeText(String(o))}${oi===q.correctIndex?' ✓':''}</li>`).join('');
  return `<div class="nova-qgen"><p>Q${qi+1}. ${safeText(String(q.prompt||''))}</p><ul>${opts}</ul>${q.explanation?`<div class="explain">${safeText(String(q.explanation))}</div>`:''}${isStaff?`<button class="nova-bank-btn" data-bank="${qi}" type="button">+ Add to question bank</button>`:''}</div>`;
 }).join('');
 resEl.innerHTML=`<div class="nova-result">${badge}${qs.length?html:'<p>No questions generated.</p>'}</div>`;
 if(isStaff)resEl.querySelectorAll('[data-bank]').forEach(b=>b.addEventListener('click',async()=>{
  const q=qs[Number(b.dataset.bank)]||{};b.disabled=true;
  try{
   await apiRequest('/teacher/question-bank',{method:'POST',body:JSON.stringify({type:'mcq',prompt:String(q.prompt||'').slice(0,2000),options:(q.options||[]).map(o=>String(o).slice(0,300)),correctIndex:Number(q.correctIndex)||0,explanation:String(q.explanation||'').slice(0,2000),points:1,tags:['nova-generated']})});
   b.textContent='✓ Added to bank';
  }catch(err){b.disabled=false;const e2=document.createElement('div');e2.className='nova-error';e2.textContent=err.message;b.after(e2);}
 }));
}
function novaRenderPlanner(result,resEl,badge){
 const plan=Array.isArray(result.plan)?result.plan:[];
 const rows=plan.map(p=>`<div class="nova-plan-row"><b>Day ${p.day}</b><span><strong>${safeText(String(p.focus||''))}</strong> — ${safeText(String(p.task||''))}</span></div>`).join('');
 resEl.innerHTML=`<div class="nova-result">${badge}${plan.length?rows:'<p>No plan generated.</p>'}</div>`;
}
function novaRenderRecommend(result,resEl,badge){
 const r=result||{};
 const weak=(r.weakTopics||[]).map(w=>{const pct=Math.min(100,Math.round((Number(w.rate)||0)*100));return `<div class="nova-rec-item"><div class="nova-perf-top"><b>${safeText(String(w.topic||''))}</b><span>${pct}% wrong · ${w.n||0} attempts</span></div><div class="nova-bar"><i style="width:${pct}%"></i></div></div>`;}).join('');
 const cont=(r.continueLessons||[]).map(c=>`<div class="nova-rec-item">▶ <b>${safeText(String(c.lesson||''))}</b><br><small style="color:#8b8998">${safeText(String(c.course||''))}</small></div>`).join('');
 resEl.innerHTML=`<div class="nova-result">${badge}${r.summary?`<p>${safeText(String(r.summary))}</p>`:''}${weak?`<h4>Weak topics — revise first</h4>${weak}`:''}${cont?`<h4>Continue learning</h4>${cont}`:''}${!weak&&!cont&&!r.summary?'<p>Enroll in a course and take a quiz to unlock recommendations.</p>':''}</div>`;
}
function novaRenderPerformance(result,resEl,badge){
 const r=result||{};
 const rows=(r.topics||[]).map(t=>{const acc=Math.max(0,Math.min(100,Number(t.accuracy)||0));return `<div class="nova-perf-row"><div class="nova-perf-top"><b>${safeText(String(t.topic||''))}</b><span>${acc}% · ${t.attempts||0} attempts</span></div><div class="nova-bar"><i style="width:${acc}%"></i></div><div class="nova-perf-tip">${safeText(String(t.suggestion||''))}</div></div>`;}).join('');
 resEl.innerHTML=`<div class="nova-result">${badge}${r.summary?`<p>${safeText(String(r.summary))}</p>`:''}${rows||'<p>No topic data yet — take a quiz first.</p>'}</div>`;
}
document.querySelectorAll('[data-nova-tab]').forEach(b=>b.addEventListener('click',()=>novaSetTab(b.dataset.novaTab)));
const lmsState={courseId:null,lessonId:null,quizId:null,quiz:null,attemptId:null,discussionCourseId:null,discussionId:null,checkoutOrder:null,checkoutKind:null,checkoutRef:null,videoTimer:null,ytPlayer:null,ytApiLoading:null,watchedSec:0,quizTimer:null,quizDraft:{questions:[]},editingQuizId:null,certs:[]};
function lmsSetStatus(sel,msg){const el=document.querySelector(sel);if(el)el.textContent=msg;}
async function lmsCourseById(id){const d=await apiRequest('/courses');return (d.courses||[]).find(c=>String(c.id)===String(id))||null;}
function lmsLessons(course){const out=[];(course.modules||[]).forEach(m=>{(m.lessons||[]).forEach(l=>out.push(Object.assign({},l,{moduleName:m.name||m.title||''})));});return out;}

const lmsScreens={
'video-player':`<div class="screen-title"><p class="eyebrow">VIDEO LESSON</p><h1 id="vpTitle">Video lesson</h1><p id="vpSub">Loading\u2026</p></div><section class="screen-panel"><div id="vpStage" class="lms-video-stage"><p class="panel-copy">Loading player\u2026</p></div><div class="lms-player-actions"><button class="primary-btn" id="vpComplete" hidden>Mark lesson complete \u2192</button><button class="filter-select" id="vpNext" hidden>Next lesson \u2192</button> <button class="filter-select" data-screen="course-detail">\u2190 Back to course</button> <button class="filter-select" id="vpDownload" type="button">\u2913 Download lesson</button> <button class="filter-select" id="vpSync" type="button">\u21ea Sync offline</button></div><p class="panel-copy" id="vpOfflineNote"><small>Downloads save the lesson text for offline reading; videos need a connection. Full offline mode needs the mobile app.</small></p><p id="vpStatus" class="panel-copy" role="status" aria-live="polite"></p></section>`,
'course-detail':`<div class="screen-title"><p class="eyebrow" id="cdEyebrow">COURSE</p><h1 id="cdTitle">Course details</h1><p id="cdSub"></p></div><div id="cdBody"><p class="panel-copy">Loading course\u2026</p></div>`,
quizzes:`<div class="screen-title"><p class="eyebrow">TEST YOURSELF</p><h1>Quizzes</h1><p>Published quizzes from your enrolled courses.</p></div><div id="quizList" class="lms-quiz-list"><p class="panel-copy">Loading quizzes\u2026</p></div>`,
'quiz-take':`<div class="screen-title"><p class="eyebrow">QUIZ</p><h1>Take quiz</h1><p>Answer carefully \u2014 the timer starts when you begin.</p></div><section class="screen-panel" id="quizTakeBody"><p class="panel-copy">Loading quiz\u2026</p></section>`,
certificates:`<div class="screen-title"><p class="eyebrow">ACHIEVEMENTS</p><h1>My certificates</h1><p>Complete every lesson and pass every quiz in a course to earn one.</p></div><section class="screen-panel"><h3>Issue a certificate</h3><div id="certIssue"><p class="panel-copy">Loading your courses\u2026</p></div></section><div id="certList" class="lms-cert-grid"><p class="panel-copy">Loading certificates\u2026</p></div><section class="screen-panel"><h3>Verify a certificate</h3><p class="panel-copy">Enter a 12-character code to check any EduVerse certificate \u2014 no sign-in needed.</p><form id="certVerifyForm" class="lms-verify-form"><input id="certVerifyCode" placeholder="Certificate code" maxlength="32" required aria-label="Certificate code"><button class="primary-btn" type="submit">Verify \u2192</button></form><div id="certVerifyOut" role="status" aria-live="polite"></div></section>`,
billing:`<div class="screen-title"><p class="eyebrow">PLANS & PAYMENTS</p><h1>Billing</h1><p>Manage your subscription and review past orders.</p></div><div id="billingBody"><p class="panel-copy">Loading billing\u2026</p></div>`,
checkout:`<div class="screen-title"><p class="eyebrow">SECURE CHECKOUT</p><h1>Checkout</h1><p>Review your order before confirming.</p></div><div id="checkoutBody"><p class="panel-copy">Loading order\u2026</p></div>`,
discussions:`<div class="screen-title"><p class="eyebrow">LEARN TOGETHER</p><h1>Course discussions</h1><p>Ask questions and help fellow learners.</p></div><div id="discussBody"><p class="panel-copy">Loading forum\u2026</p></div>`,
'live-classes':`<div class="screen-title"><p class="eyebrow">LEARN LIVE</p><h1>Live classes</h1><p>Join scheduled sessions or catch the next one.</p></div><div id="liveBody"><p class="panel-copy">Loading sessions\u2026</p></div>`,
'live-classroom':`<div class="screen-title"><p class="eyebrow">● LIVE CLASSROOM</p><h1 id="lcTitle">Live classroom</h1><p id="lcSub" class="panel-copy">Connecting…</p></div><div id="lcRoot"><p class="panel-copy">Connecting…</p></div>`,

leaderboard:`<div class="screen-title"><p class="eyebrow">FRIENDLY COMPETITION</p><h1>Leaderboard</h1><p>Top learners by experience points.</p></div><section class="screen-panel" id="leaderBody"><p class="panel-copy">Loading leaderboard\u2026</p></section>`
};
Object.assign(screens,lmsScreens);
Object.assign(screenRole,{'video-player':['student'],quizzes:['student'],'quiz-take':['student'],certificates:['student'],billing:['student'],checkout:['student'],discussions:['student'],'live-classes':['student','teacher'],'live-classroom':['student','teacher'],leaderboard:['student'],'course-detail':['student'],'teacher-quizzes':['teacher'],'question-bank':['teacher'],'admin-plans':['admin'],'admin-orders':['admin']});
expandAdminRoles();
Object.assign(staffPageTitles,{'teacher-quizzes':'Quiz builder','question-bank':'Question bank','admin-plans':'Plans & pricing','admin-orders':'Orders & subscriptions'});
Object.assign(staffPageMarkup,{
'teacher-quizzes':`<div class="screen-title"><p class="eyebrow">ASSESSMENT BUILDER</p><h1>Quizzes</h1><p>Build quizzes with auto-graded questions, publish them, and grade short answers.</p></div><div id="staffPageBody" class="screen-panel">Loading quizzes\u2026</div>`,
 'question-bank':`<div class="screen-title"><p class="eyebrow">REUSABLE QUESTIONS</p><h1>Question bank</h1><p>Store questions once and reuse them across quizzes \u2014 pick them when building, or draw random sets.</p></div><div id="staffPageBody" class="screen-panel">Loading question bank\u2026</div>`,
'admin-plans':`<div class="screen-title"><p class="eyebrow">MONETISATION</p><h1>Plans & pricing</h1><p>Create subscription plans and one-time prices.</p></div><div id="staffPageBody" class="screen-panel">Loading plans\u2026</div>`,
'admin-orders':`<div class="screen-title"><p class="eyebrow">MONETISATION</p><h1>Orders & subscriptions</h1><p>All test-mode orders and active subscriptions.</p></div><div id="staffPageBody" class="screen-panel">Loading orders\u2026</div>`});
portalScreens.student[1][1].push(['video-player','\u25b6','My videos'],['quizzes','?','Quizzes'],['certificates','\u2726','Certificates'],['discussions','\u25cc','Discussions'],['live-classes','\u25cf','Live classes'],['billing','\u20b9','Billing'],['leaderboard','\u265b','Leaderboard']);
portalScreens.teacher[0][1].push(['teacher-quizzes','\u2710','Quizzes'],['question-bank','\u2756','Question bank']);
portalScreens.teacher[1][1].push(['live-classes','\u25cf','Live classes']);
portalScreens.admin[1][1].push(['admin-plans','\u20b9','Plans & pricing'],['admin-orders','\u224b','Orders']);

/* ---------- video player ---------- */
function lmsStopVideo(){if(lmsState.videoTimer){clearInterval(lmsState.videoTimer);lmsState.videoTimer=null;}if(lmsState.ytPlayer&&lmsState.ytPlayer.destroy){try{lmsState.ytPlayer.destroy();}catch{}}lmsState.ytPlayer=null;}
function lmsStopQuizTimer(){if(lmsState.quizTimer){clearInterval(lmsState.quizTimer);lmsState.quizTimer=null;}}
async function loadVideoPlayer(){
 lmsStopVideo();
 const stage=document.querySelector('#vpStage');if(!stage)return;
 if(!lmsState.lessonId){await renderContinueLearning(stage);return;}
 try{
  const course=await lmsCourseById(lmsState.courseId);
  const lesson=course?lmsLessons(course).find(l=>String(l.id)===String(lmsState.lessonId)):null;
  if(!lesson){stage.innerHTML='<p class="panel-copy">Lesson not found.</p>';return;}
  document.querySelector('#vpTitle').textContent=lesson.title||'Video lesson';
  document.querySelector('#vpSub').textContent=`${course.title||''}${lesson.moduleName?` \u00b7 ${lesson.moduleName}`:''}`;
  let prog={};try{const d=await apiRequest(`/video/progress?courseId=${encodeURIComponent(course.id)}`);prog=d.progress||d||{};}catch{}
  const saved=prog[lesson.id]||{};
  const vtype=lesson.videoType||(youtubeId(lesson.videoUrl)?'youtube':/^https?:\/\//i.test(String(lesson.videoUrl||''))?'mp4':null);
  lmsState.watchedSec=Math.max(0,Number(saved.watchedSec)||0);
  if(vtype==='youtube')await renderYoutubePlayer(stage,lesson,saved);
  else if(vtype==='mp4')renderMp4Player(stage,lesson,saved);
  else{stage.innerHTML=`<p class="panel-copy">This lesson has no video attached yet.</p>${lesson.content?`<div class="lms-lesson-text">${safeText(lesson.content)}</div>`:''}`;}
  const comp=document.querySelector('#vpComplete');if(comp)comp.onclick=()=>lmsMarkComplete();
  wireNextLesson(course,lesson);
  lmsState.lesson=lesson;lmsState.course=course;libWireOffline();
  if(saved.completed)lmsShowComplete();
 }catch(err){stage.innerHTML=`<p class="panel-copy">Could not load the video: ${safeText(err.message)}</p>`;}
}
function renderMp4Player(stage,lesson,saved){
 const pos=Math.max(0,Number(saved.positionSec)||0);
 const sources=[{label:'Auto',src:lesson.videoUrl}].concat(((lesson.videoSources||[]).map(s=>({label:String(s.label||''),src:String(s.src||'')}))).filter(s=>s.src&&s.src!==lesson.videoUrl));
 const tracks=(lesson.captions||[]).map((c,i)=>`<track kind="captions" label="${safeText(c.label)}" srclang="${safeText(c.srclang)}" src="${safeText(c.src)}"${i===0?' default':''}>`).join('');
 const canPiP=!!(document.pictureInPictureEnabled);
 stage.innerHTML=`<video id="lmsVideo" class="lms-video" src="${safeText(lesson.videoUrl)}" playsinline preload="metadata" aria-label="Lesson video">${tracks}</video>
 <div class="lms-controls" role="group" aria-label="Video controls"><button id="lmsPlayPause" class="lms-ctrl-btn" aria-label="Play or pause">\u25b6</button><input id="lmsSeek" type="range" min="0" max="1000" value="0" aria-label="Seek"><span id="lmsTime" class="lms-time">0:00</span>${sources.length>1?`<label class="lms-quality">Quality <select id="lmsQuality" aria-label="Video quality">${sources.map((s,i)=>`<option value="${i}"${i===0?' selected':''}>${safeText(s.label)}</option>`).join('')}</select></label>`:''}${tracks?`<button id="lmsCC" class="lms-ctrl-btn lms-cc" aria-label="Toggle captions" aria-pressed="true">CC</button>`:''}${canPiP?`<button id="lmsPip" class="lms-ctrl-btn" aria-label="Picture in picture">\u29c9</button>`:''}<label class="lms-speed">Speed <select id="lmsSpeed" aria-label="Playback speed"><option value="0.5">0.5\u00d7</option><option value="0.75">0.75\u00d7</option><option value="1" selected>1\u00d7</option><option value="1.25">1.25\u00d7</option><option value="1.5">1.5\u00d7</option><option value="2">2\u00d7</option></select></label><button id="lmsFull" class="lms-ctrl-btn" aria-label="Fullscreen">\u26f6</button></div>
 ${lesson.transcript?`<details class="lms-transcript"><summary>Video transcript</summary><div class="lms-transcript-body">${lmsTranscriptHtml(lesson.transcript)}</div></details>`:''}
 <div class="lms-video-notes"><div class="lms-video-notes-head"><b>Video notes</b><button id="lmsNoteAt" class="filter-select" type="button">\u002b Note at current time</button></div><div id="lmsNoteForm" hidden><textarea id="lmsNoteText" rows="2" maxlength="12000" placeholder="Write a note about this moment\u2026" aria-label="Note text"></textarea><div class="lms-note-form-actions"><button id="lmsNoteSave" class="primary-btn" type="button">Save note</button><button id="lmsNoteCancel" class="filter-select" type="button">Cancel</button></div><p class="panel-copy" id="lmsNoteStatus" role="status"></p></div><div id="lmsVideoNotes"><p class="panel-copy">Loading notes\u2026</p></div></div>
 ${lesson.content?`<details class="lms-lesson-notes"><summary>Lesson notes</summary><p>${safeText(lesson.content)}</p></details>`:''}`;
 const v=document.querySelector('#lmsVideo');
 v.addEventListener('loadedmetadata',()=>{const t=document.querySelector('#lmsTime');if(t)t.textContent=`0:00 / ${fmtDur(v.duration)}`;if(pos>0&&pos<v.duration-5){v.currentTime=pos;lmsSetStatus('#vpStatus',`Resumed from ${fmtDur(pos)}.`);}});
 v.addEventListener('timeupdate',()=>{const s=document.querySelector('#lmsSeek');if(v.duration)s.value=Math.round(v.currentTime/v.duration*1000);const t=document.querySelector('#lmsTime');if(t)t.textContent=`${fmtDur(v.currentTime)} / ${fmtDur(v.duration||0)}`;});
 document.querySelector('#lmsPlayPause').onclick=()=>{if(v.paused)v.play();else v.pause();};
 v.addEventListener('play',()=>{const b=document.querySelector('#lmsPlayPause');if(b)b.textContent='\u23f8';});
 v.addEventListener('pause',()=>{const b=document.querySelector('#lmsPlayPause');if(b)b.textContent='\u25b6';lmsHeartbeat(false);});
 v.addEventListener('ended',()=>{lmsHeartbeat(true);});
 document.querySelector('#lmsSeek').oninput=e=>{if(v.duration)v.currentTime=e.target.value/1000*v.duration;};
 document.querySelector('#lmsSpeed').onchange=e=>{v.playbackRate=Number(e.target.value);};
 document.querySelector('#lmsFull').onclick=()=>{const st=document.querySelector('#vpStage');if(document.fullscreenElement)document.exitFullscreen();else if(st&&st.requestFullscreen)st.requestFullscreen();};
 const qsel=document.querySelector('#lmsQuality');
 if(qsel)qsel.onchange=()=>{const s=sources[Number(qsel.value)];if(!s||!s.src)return;const t=v.currentTime,wasPaused=v.paused,rate=v.playbackRate;v.src=s.src;v.playbackRate=rate;v.addEventListener('loadedmetadata',function once(){v.removeEventListener('loadedmetadata',once);if(t<v.duration)v.currentTime=t;if(!wasPaused)v.play().catch(()=>{});});v.load();lmsSetStatus('#vpStatus',`Quality: ${s.label}.`);};
 const cc=document.querySelector('#lmsCC');
 if(cc){const applyCC=()=>{const tr=v.textTracks;let showing=-1;for(let i=0;i<tr.length;i++)if(tr[i].mode==='showing')showing=i;const next=showing<0?0:(showing+1>tr.length-1?-1:showing+1);for(let i=0;i<tr.length;i++)tr[i].mode=(i===next?'showing':'disabled');cc.setAttribute('aria-pressed',String(next>=0));cc.textContent=next>=0?`CC ${next+1}`:'CC';lmsSetStatus('#vpStatus',next>=0?`Captions on (${next+1}/${tr.length}).`:'Captions off.');};cc.onclick=applyCC;}
 const pip=document.querySelector('#lmsPip');
 if(pip)pip.onclick=async()=>{try{if(document.pictureInPictureElement)await document.exitPictureInPicture();else await v.requestPictureInPicture();}catch(err){lmsSetStatus('#vpStatus','Picture-in-picture is not available for this video.');}};
 lmsState.videoTimer=setInterval(()=>lmsHeartbeat(false),10000);
 lmsWireVideoNotes(lesson);
}
/** Transcript: [mm:ss] markers become seek buttons. */
function lmsTranscriptHtml(t){
 return safeText(t).replace(/\[(\d{1,3}):([0-5]\d)(?::([0-5]\d))?\]/g,(m,h,mi,s)=>{
  const sec=s!==undefined?Number(h)*3600+Number(mi)*60+Number(s):Number(h)*60+Number(mi);
  return `<button class="lms-ts-link" data-seek="${sec}" type="button" aria-label="Jump to ${h}:${mi}${s!==undefined?':'+s:''}">[${h}:${mi}${s!==undefined?':'+s:''}]</button>`;
 }).replace(/\n/g,'<br>');
}
/** Seek the active player (mp4 or YouTube) to a timestamp. */
function lmsSeekTo(sec){
 const v=document.querySelector('#lmsVideo');
 if(v&&isFinite(v.duration)){v.currentTime=Math.min(Math.max(0,sec),v.duration||sec);v.focus();return;}
 if(lmsState.ytPlayer&&lmsState.ytPlayer.seekTo){try{lmsState.ytPlayer.seekTo(sec,true);}catch{}}
}
/** Timestamp notes under the player. */
async function lmsWireVideoNotes(lesson){
 const list=document.querySelector('#lmsVideoNotes');if(!list)return;
 const atBtn=document.querySelector('#lmsNoteAt'),form=document.querySelector('#lmsNoteForm');
 const curPos=()=>{const v=document.querySelector('#lmsVideo');if(v&&isFinite(v.currentTime))return Math.floor(v.currentTime);if(lmsState.ytPlayer&&lmsState.ytPlayer.getCurrentTime){try{return Math.floor(lmsState.ytPlayer.getCurrentTime())||0;}catch{}}return 0;};
 const refresh=async()=>{
  try{
   const d=await apiRequest('/notes');const notes=(d.notes||[]).filter(n=>String(n.lessonId||'')===String(lesson.id)).sort((a,b)=>(a.videoTimestampSec||0)-(b.videoTimestampSec||0));
   list.innerHTML=notes.length?notes.map(n=>`<div class="lms-vnote"><button class="lms-ts-link" data-seek="${Number(n.videoTimestampSec)||0}" type="button" aria-label="Jump to note timestamp">${fmtDur(Number(n.videoTimestampSec)||0)}</button><div><b>${safeText(n.title)}</b><p>${safeText(String(n.content||'').slice(0,280))}</p></div></div>`).join(''):'<p class="panel-copy">No timestamped notes yet. Pause at a key moment and add one.</p>';
  }catch{list.innerHTML='<p class="panel-copy">Notes unavailable right now.</p>';}
 };
 if(atBtn)atBtn.onclick=()=>{const t=curPos();atBtn.textContent=`\u002b Note at ${fmtDur(t)}`;form.hidden=false;document.querySelector('#lmsNoteText').focus();};
 const cancel=document.querySelector('#lmsNoteCancel');
 if(cancel)cancel.onclick=()=>{form.hidden=true;document.querySelector('#lmsNoteText').value='';atBtn.textContent='\u002b Note at current time';};
 const save=document.querySelector('#lmsNoteSave');
 if(save)save.onclick=async()=>{
  const text=document.querySelector('#lmsNoteText').value.trim();const st=document.querySelector('#lmsNoteStatus');
  if(!text){st.textContent='Write the note first.';return;}
  const t=curPos();st.textContent='Saving\u2026';
  try{await apiRequest('/notes',{method:'POST',body:JSON.stringify({title:`Note @ ${fmtDur(t)}`,content:text,courseId:lmsState.courseId,lessonId:lesson.id,videoTimestampSec:t})});document.querySelector('#lmsNoteText').value='';form.hidden=true;atBtn.textContent='\u002b Note at current time';st.textContent='';await refresh();}
  catch(err){st.textContent=err.message;}
 };
 await refresh();
}
function lmsLoadYtApi(){if(window.YT&&window.YT.Player)return Promise.resolve();if(lmsState.ytApiLoading)return lmsState.ytApiLoading;lmsState.ytApiLoading=new Promise(res=>{const t=document.createElement('script');t.src='https://www.youtube.com/iframe_api';t.onload=()=>{const check=()=>{if(window.YT&&window.YT.Player)res();else setTimeout(check,250);};check();};t.onerror=()=>res();document.head.appendChild(t);setTimeout(()=>res(),9000);});return lmsState.ytApiLoading;}
async function renderYoutubePlayer(stage,lesson,saved){
 const vid=youtubeId(lesson.videoUrl);
 stage.innerHTML=`<div id="lmsYt" class="lms-video"></div>${lesson.content?`<details class="lms-lesson-notes"><summary>Lesson notes</summary><p>${safeText(lesson.content)}</p></details>`:''}<p class="panel-copy"><small>Tip: use YouTube\u2019s own player controls for captions and quality.</small></p>`;
 await lmsLoadYtApi();
 if(!(window.YT&&window.YT.Player)){stage.insertAdjacentHTML('afterbegin',`<iframe class="lms-video" src="https://www.youtube.com/embed/${vid}" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen title="Lesson video"></iframe>`);const d=document.querySelector('#lmsYt');if(d)d.remove();return;}
 lmsState.ytPlayer=new YT.Player('lmsYt',{videoId:vid,width:'100%',events:{onReady:e=>{const p=Math.max(0,Number(saved.positionSec)||0);if(p>5)e.target.seekTo(p,true);},onStateChange:e=>{if(e.data===YT.PlayerState.PLAYING){if(!lmsState.videoTimer)lmsState.videoTimer=setInterval(()=>lmsHeartbeat(false),10000);}else{lmsHeartbeat(false);if(lmsState.videoTimer){clearInterval(lmsState.videoTimer);lmsState.videoTimer=null;}}if(e.data===YT.PlayerState.ENDED)lmsHeartbeat(true);}}});
}
async function lmsHeartbeat(done){
 let pos=0;const v=document.querySelector('#lmsVideo');
 if(v&&isFinite(v.currentTime))pos=v.currentTime;
 else if(lmsState.ytPlayer&&lmsState.ytPlayer.getCurrentTime){try{pos=lmsState.ytPlayer.getCurrentTime()||0;}catch{}}
 if(!lmsState.lessonId||!lmsState.courseId)return;
 lmsState.watchedSec=Math.max(lmsState.watchedSec||0,pos);
 try{const d=await apiRequest('/video/progress',{method:'POST',body:JSON.stringify({courseId:lmsState.courseId,lessonId:lmsState.lessonId,positionSec:Math.round(pos),watchedSec:Math.round(lmsState.watchedSec),completed:!!done})});
 if(d.completed)lmsShowComplete();lmsSetStatus('#vpStatus',`Progress saved \u00b7 ${fmtDur(pos)} watched.`);}catch{libQueueProgress(lmsState.lessonId,Math.round(pos),!!done);}
}
function lmsShowComplete(){const c=document.querySelector('#vpComplete');if(c)c.hidden=false;}
async function lmsMarkComplete(){try{await apiRequest('/video/progress',{method:'POST',body:JSON.stringify({courseId:lmsState.courseId,lessonId:lmsState.lessonId,positionSec:Math.round(lmsState.watchedSec||0),watchedSec:Math.round(lmsState.watchedSec||0),completed:true})});lmsSetStatus('#vpStatus','Lesson complete! Nice work.');const c=document.querySelector('#vpComplete');if(c)c.hidden=true;}catch(err){lmsSetStatus('#vpStatus',err.message);}}
function wireNextLesson(course,lesson){const lessons=lmsLessons(course);const i=lessons.findIndex(l=>String(l.id)===String(lesson.id));const n=document.querySelector('#vpNext');if(n&&lessons[i+1]){n.hidden=false;n.onclick=()=>{lmsState.lessonId=lessons[i+1].id;loadVideoPlayer();window.scrollTo({top:0});};}}
async function renderContinueLearning(stage){
 document.querySelector('#vpTitle').textContent='Continue learning';
 document.querySelector('#vpSub').textContent='Pick up where you left off';
 try{
  const {enrollments}=await apiRequest('/my-enrollments');const items=[];
  for(const e of (enrollments||[]).slice(0,6)){
   try{const d=await apiRequest(`/video/progress?courseId=${encodeURIComponent(e.courseId)}`);const prog=d.progress||d||{};
   const course=e.course||await lmsCourseById(e.courseId).catch(()=>null);if(!course)continue;
   lmsLessons(course).forEach(l=>{const p=prog[l.id];if(p&&(Number(p.positionSec)>0||Number(p.watchedSec)>0)&&!p.completed)items.push({course,lesson:l,p});});}catch{}
  }
  stage.innerHTML=items.length?items.slice(0,8).map(it=>`<button class="lms-resume-row" data-lms-play data-course="${safeText(it.course.id)}" data-lesson="${safeText(it.lesson.id)}"><span class="lms-resume-play">\u25b6</span><span><b>${safeText(it.lesson.title)}</b><small>${safeText(it.course.title)} \u00b7 ${fmtDur(it.p.positionSec)} watched</small></span></button>`).join(''):'<p class="panel-copy">No in-progress videos yet. Open a course to start watching.</p><button class="filter-select" data-screen="catalog">Browse courses \u2192</button>';
 }catch(err){stage.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}

/* ---------- course detail ---------- */
const LESSON_KIND_META={video:['\u25b6','Video lesson'],reading:['\u2630','Reading'],interactive:['\u2726','Interactive activity'],pdf:['\ud83d\udcd5','PDF resource'],coding:['\u2328','Coding practice'],quiz:['?','Quiz'],assignment:['\u270e','Assignment']};
function lmsKindPill(l){const m=LESSON_KIND_META[l.kind]||LESSON_KIND_META[l.videoUrl?'video':'reading'];return `<span class="lms-kind" title="${m[1]}">${m[0]} ${m[1]}</span>`;}
async function loadCourseDetail(){
 const body=document.querySelector('#cdBody');if(!body)return;
 if(!lmsState.courseId){body.innerHTML='<p class="panel-copy">Choose a course from the catalog.</p><button class="filter-select" data-screen="catalog">Open catalog \u2192</button>';return;}
 try{
  const course=await lmsCourseById(lmsState.courseId);
  if(!course){body.innerHTML='<p class="panel-copy">Course not found.</p>';return;}
  document.querySelector('#cdTitle').textContent=course.title||'Course';
  document.querySelector('#cdSub').textContent=`${course.category||''}${course.level?` \u00b7 ${course.level}`:''}`;
  let enrolled=false;try{const m=await apiRequest('/my-enrollments');enrolled=(m.enrollments||[]).some(e=>String(e.courseId)===String(course.id));}catch{}
  const paid=Number(course.priceCents)>0,lessons=lmsLessons(course);
  body.innerHTML=`<section class="screen-panel"><p class="eyebrow">ABOUT THIS COURSE</p><p class="panel-copy">${safeText(course.description||'No description yet.')}</p><div class="lms-course-actions"><span class="price-badge${paid?'':' free'}">${paid?inr(course.priceCents):'Free'}</span>${enrolled?'<span class="pill purple-pill">ENROLLED</span>':paid?`<button class="primary-btn" data-buy-course="${safeText(course.id)}">Buy & Enroll \u00b7 ${inr(course.priceCents)}</button>`:`<button class="primary-btn" data-enroll-course="${safeText(course.id)}">Enroll now \u2192</button>`}</div></section>
  ${(course.learningObjectives&&course.learningObjectives.length)||(course.prerequisites&&course.prerequisites.length)?`<section class="screen-panel"><div class="lms-course-meta-grid">${course.learningObjectives&&course.learningObjectives.length?`<div><p class="eyebrow">LEARNING OBJECTIVES</p><ul class="lms-checklist">${course.learningObjectives.map(o=>`<li>${safeText(o)}</li>`).join('')}</ul></div>`:''}${course.prerequisites&&course.prerequisites.length?`<div><p class="eyebrow">PREREQUISITES</p><ul class="lms-checklist">${course.prerequisites.map(o=>`<li>${safeText(o)}</li>`).join('')}</ul></div>`:''}</div></section>`:''}
  <div class="lms-tabs" role="tablist" aria-label="Course sections"><button class="lms-tab active" data-lms-tab="lessons" role="tab" aria-selected="true">Lessons (${lessons.length})</button><button class="lms-tab" data-lms-tab="quizzes" role="tab" aria-selected="false">Quizzes</button><button class="lms-tab" data-lms-tab="forum" role="tab" aria-selected="false">Discussions</button></div>
  <section class="screen-panel" id="lmsTab-lessons">${lessons.length?lessons.map(l=>`<div class="lms-lesson-row"><button class="lms-lesson-play" data-lms-play data-course="${safeText(course.id)}" data-lesson="${safeText(l.id)}" ${enrolled?'':'disabled title="Enroll to watch"'} aria-label="Play ${safeText(l.title)}">\u25b6</button><div><b>${safeText(l.title)}</b><small>${safeText(l.moduleName)}${l.videoDurationSec?` \u00b7 ${fmtDur(l.videoDurationSec)}`:''}</small><div class="lms-lesson-tags">${lmsKindPill(l)}${l.videoUrl?'<span class="lms-kind lms-kind-video">\u25b6 video</span>':''}${l.transcript?'<span class="lms-kind">\u2630 transcript</span>':''}</div></div></div>`).join(''):'<p class="panel-copy">No lessons published yet.</p>'}</section>
  <section class="screen-panel" id="lmsTab-quizzes" hidden><div id="cdQuizzes"><p class="panel-copy">Loading quizzes\u2026</p></div></section>
  <section class="screen-panel" id="lmsTab-forum" hidden><div id="cdForum"><p class="panel-copy">Loading discussions\u2026</p></div><button class="filter-select" id="cdOpenForum">Open course forum \u2192</button></section>
  <section class="screen-panel" id="cdReadingLists" aria-label="Reading lists"></section>`;
  document.querySelector('#cdOpenForum').onclick=()=>{lmsState.discussionCourseId=course.id;lmsState.discussionId=null;navigate('discussions');};
  loadCourseQuizzes(course.id);loadCourseForum(course.id);loadCourseReadingLists(course.id);
 }catch(err){body.innerHTML=`<p class="panel-copy">Could not load course: ${safeText(err.message)}</p>`;}
}
async function loadCourseQuizzes(courseId){
 const box=document.querySelector('#cdQuizzes');if(!box)return;
 try{const {quizzes}=await apiRequest('/quizzes');const mine=(quizzes||[]).filter(q=>String(q.courseId)===String(courseId));
 const finals=mine.filter(q=>q.isFinalAssessment),rest=mine.filter(q=>!q.isFinalAssessment);
 const row=q=>`<div class="lms-lesson-row"><span class="lms-resume-play">?</span><div><b>${safeText(q.title)}${q.isFinalAssessment?' <span class="pill purple-pill">FINAL ASSESSMENT</span>':''}</b><small>${(q.questions||[]).length} questions${q.timeLimitMin?` \u00b7 ${q.timeLimitMin} min`:''} \u00b7 pass ${q.passingScore||0}%</small></div><button class="filter-select" data-lms-quiz="${safeText(q.id)}">Start \u2192</button></div>`;
 box.innerHTML=(mine.length?`${finals.length?`<p class="eyebrow">FINAL ASSESSMENT</p>${finals.map(row).join('')}`:''}${rest.length?`${finals.length?'<p class="eyebrow">QUIZZES</p>':''}${rest.map(row).join('')}`:''}`:'<p class="panel-copy">No quizzes in this course yet.</p>');
 }catch{box.innerHTML='<p class="panel-copy">Quizzes unavailable right now.</p>';}
}
async function loadCourseForum(courseId){
 const box=document.querySelector('#cdForum');if(!box)return;
 try{const {discussions}=await apiRequest(`/courses/${encodeURIComponent(courseId)}/discussions`);
 box.innerHTML=(discussions||[]).slice(0,5).map(d=>`<button class="lms-thread" data-lms-thread="${safeText(d.id)}">${d.pinned?'<span class="lms-pin">\ud83d\udccc</span>':''}<span><b>${safeText(d.title)}</b><small>by ${safeText(d.authorName)} \u00b7 ${d.replyCount||0} replies</small></span></button>`).join('')||'<p class="panel-copy">No discussions yet.</p>';
 }catch{box.innerHTML='<p class="panel-copy">Discussions unavailable right now.</p>';}
}

/* ---------- student quizzes ---------- */
async function loadQuizzes(){
 const root=document.querySelector('#quizList');if(!root)return;
 try{
  const {quizzes}=await apiRequest('/quizzes');const list=quizzes||[];
  const withAtt=await Promise.all(list.map(async q=>{try{const a=await apiRequest(`/quizzes/${encodeURIComponent(q.id)}/my-attempts`);q.myAttempts=a.attempts||[];}catch{q.myAttempts=[];}return q;}));
  root.innerHTML=withAtt.length?withAtt.map(q=>{const at=q.myAttempts;const best=at.reduce((m,a)=>Math.max(m,Number(a.finalScore)||0),0);const left=q.maxAttempts?Math.max(0,q.maxAttempts-at.length):null;
  return `<article class="lms-quiz-card"><div><p class="eyebrow">${safeText(q.courseTitle||'QUIZ')}</p><h3>${safeText(q.title)}</h3><p class="panel-copy">${safeText(q.description||'')}</p><div class="lms-quiz-meta"><span>\u2753 ${(q.questions||[]).length} questions</span>${q.timeLimitMin?`<span>\u25f7 ${q.timeLimitMin} min</span>`:''}<span>Pass ${q.passingScore||0}%</span><span>Best ${best}%</span>${left!==null?`<span>${left} attempts left</span>`:''}</div></div><button class="primary-btn" data-lms-quiz="${safeText(q.id)}"${left===0?' disabled':''}>${left===0?'No attempts left':'Start quiz \u2192'}</button></article>`;}).join(''):'<p class="panel-copy">No quizzes available yet. Enroll in a course to see its quizzes.</p>';
 }catch(err){root.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
async function loadQuizTake(){
 const root=document.querySelector('#quizTakeBody');if(!root)return;lmsStopQuizTimer();
 if(!lmsState.quizId){root.innerHTML='<p class="panel-copy">Choose a quiz to begin.</p><button class="filter-select" data-screen="quizzes">Back to quizzes \u2192</button>';return;}
 try{
  const {quiz}=await apiRequest(`/quizzes/${encodeURIComponent(lmsState.quizId)}`);lmsState.quiz=quiz;
  const att=await apiRequest(`/quizzes/${encodeURIComponent(quiz.id)}/my-attempts`).catch(()=>({attempts:[]}));
  const attempts=att.attempts||[];const left=quiz.maxAttempts?Math.max(0,quiz.maxAttempts-attempts.length):null;
  const best=attempts.reduce((m,a)=>Math.max(m,Number(a.finalScore)||0),0);
  root.innerHTML=`<p class="eyebrow">QUIZ</p><h2>${safeText(quiz.title)}</h2><p class="panel-copy">${safeText(quiz.description||'')}</p><div class="lms-quiz-meta"><span>\u2753 ${(quiz.questions||[]).length} questions</span>${quiz.timeLimitMin?`<span>\u25f7 ${quiz.timeLimitMin} min limit</span>`:''}<span>Pass mark ${quiz.passingScore||0}%</span><span>Best ${best}%</span></div>${left===0?'<p class="panel-copy"><b>No attempts left on this quiz.</b></p>':`<button class="primary-btn" id="quizStartBtn">Start attempt \u2192</button>`}${attempts.length?'<h3>Previous attempts</h3>'+staffTable(['Date','Score','Status'],attempts.map(a=>`<tr><td>${safeText(new Date(a.submittedAt||a.startedAt).toLocaleString())}</td><td>${a.finalScore??a.autoScore??'\u2014'}%</td><td>${safeText(a.status)}${a.passed?' \u00b7 passed':''}</td></tr>`)):''}`;
  const btn=document.querySelector('#quizStartBtn');if(btn)btn.onclick=()=>lmsStartAttempt(quiz);
 }catch(err){root.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
function lmsQuestionHtml(q,i){
 const neg=lmsState.quiz&&Number(lmsState.quiz.negativeMarking)>0;
 const head=`<fieldset class="lms-question"><legend><b>Q${i+1}.</b> ${safeText(q.prompt)} <small>(${q.points||1} pt${neg?' \u00b7 negative marking':''})</small></legend>`;
 if(q.type==='mcq')return head+(q.options||[]).map((o,oi)=>`<label class="lms-opt"><input type="radio" name="q_${safeText(q.id)}" value="${oi}" required> ${safeText(o)}</label>`).join('')+'</fieldset>';
 if(q.type==='multiselect')return head+`<p class="panel-copy"><small>Select all that apply.</small></p>`+(q.options||[]).map((o,oi)=>`<label class="lms-opt"><input type="checkbox" name="q_${safeText(q.id)}" value="${oi}"> ${safeText(o)}</label>`).join('')+'</fieldset>';
 if(q.type==='truefalse')return head+`<label class="lms-opt"><input type="radio" name="q_${safeText(q.id)}" value="true" required> True</label><label class="lms-opt"><input type="radio" name="q_${safeText(q.id)}" value="false"> False</label></fieldset>`;
 if(q.type==='fillblank'){const parts=String(q.template||'').split('___');let h=head+'<div class="lms-fillblank">';parts.forEach((part,pi)=>{h+=safeText(part);if(pi<parts.length-1)h+=`<input class="lms-blank-input" data-blank-q="${safeText(q.id)}" data-blank-i="${pi}" aria-label="Blank ${pi+1}">`;});return h+'</div></fieldset>';}
 if(q.type==='match'){const rights=q.rights||[];return head+(q.lefts||[]).map((l,li)=>`<div class="lms-match-row"><span>${safeText(l)}</span><span>\u2192</span><select data-match-q="${safeText(q.id)}" data-match-i="${li}" aria-label="Match for ${safeText(l)}"><option value="">Choose\u2026</option>${rights.map((r,ri)=>`<option value="${ri}">${safeText(r)}</option>`).join('')}</select></div>`).join('')+'</fieldset>';}
 if(q.type==='essay')return head+`<textarea name="q_${safeText(q.id)}" rows="6" placeholder="Write your answer\u2026" aria-label="Essay answer" data-essay-q="${safeText(q.id)}" data-maxwords="${q.maxWords||0}"></textarea><p class="panel-copy"><small>Words: <b data-wordcount="${safeText(q.id)}">0</b>${q.maxWords?` / ${q.maxWords}`:''}</small></p></fieldset>`;
 if(q.type==='code')return head+`<p class="panel-copy"><small>Define <b>solve(input)</b> \u2014 it is called with each test input${q.language&&q.language!=='javascript'?' (manual grading for '+safeText(q.language)+')':''}.</small></p><textarea name="q_${safeText(q.id)}" rows="8" class="lms-code" aria-label="Code answer">${safeText(q.starterCode||'')}</textarea><p class="panel-copy"><small>${q.testCaseCount||0} hidden test case(s)</small></p></fieldset>`;
 return head+`<textarea name="q_${safeText(q.id)}" rows="3" placeholder="Type your answer\u2026" aria-label="Answer"></textarea></fieldset>`;
}
function lmsCollectAnswer(q){
 const id=q.id;
 if(q.type==='multiselect')return [...document.querySelectorAll(`input[name="q_${CSS.escape(id)}"]:checked`)].map(e=>Number(e.value));
 if(q.type==='fillblank')return [...document.querySelectorAll(`[data-blank-q="${CSS.escape(id)}"]`)].map(e=>e.value);
 if(q.type==='match'){const rights=q.rights||[];return [...document.querySelectorAll(`select[data-match-q="${CSS.escape(id)}"]`)].map(e=>e.value===''?'':String(rights[Number(e.value)]??''));}
 const els=document.querySelectorAll(`[name="q_${CSS.escape(id)}"]`);if(!els.length)return undefined;
 if(q.type==='short'||q.type==='essay'||q.type==='code')return els[0].value;
 const sel=[...els].find(e=>e.checked);if(!sel)return undefined;
 return q.type==='truefalse'?sel.value==='true':Number(sel.value);
}
async function lmsStartAttempt(quiz){
 const root=document.querySelector('#quizTakeBody');
 if(quiz.proctoring&&quiz.proctoring.enabled){
  const ok=await lmsProctorConsent(quiz);
  if(!ok){root.innerHTML='<p class="panel-copy">You declined proctoring, so this exam cannot start. Contact your teacher if you need an alternative.</p><button class="filter-select" data-screen="quizzes">\u2190 Back to quizzes</button>';return;}
 }
 if(quiz.adaptive){lmsStartAdaptive(quiz);return;}
 try{
  const d=await apiRequest(`/quizzes/${encodeURIComponent(quiz.id)}/start`,{method:'POST',body:'{}'});
  lmsState.attemptId=d.attemptId;
  const qs=d.questions&&d.questions.length?d.questions:quiz.questions||[];
  lmsState.quiz=Object.assign({},quiz,{questions:qs});
  const proctored=!!(quiz.proctoring&&quiz.proctoring.enabled);
  root.innerHTML=`<div class="lms-quiz-head"><h2>${safeText(quiz.title)}</h2><div>${d.resumed?'<span class="pill purple-pill">RESUMED ATTEMPT</span> ':''}${proctored?'<span class="pill purple-pill">PROCTORED</span> ':''}${d.timeLimitMin||d.expiresAt?`<span class="lms-timer" id="quizTimer" role="timer" aria-live="polite">\u23f1</span>`:''}</div></div>${d.resumed?'<p class="panel-copy">Your in-progress attempt was resumed. Answer the questions below and submit.</p>':''}${proctored?'<div class="lms-proctor-note"><p class="panel-copy"><small>\u25cf Proctoring active \u2014 snapshots appear below as they are taken. <button type="button" class="filter-select" id="lmsProctorStop">Stop camera & finish later</button></small></p><div id="lmsFilmstrip" class="lms-filmstrip" aria-label="Your proctor snapshots"></div></div>':''}<form id="quizForm">${qs.map((q,i)=>lmsQuestionHtml(q,i)).join('')}<button class="primary-btn" type="submit">Submit answers \u2192</button></form>`;
  let limitSec=d.timeLimitMin?d.timeLimitMin*60:0;
  if(d.expiresAt)limitSec=Math.max(0,Math.round((new Date(d.expiresAt).getTime()-Date.now())/1000));
  if(limitSec>0)lmsStartTimer(limitSec,()=>lmsSubmitQuiz(true));
  document.querySelector('#quizForm').onsubmit=e=>{e.preventDefault();lmsSubmitQuiz(false);};
  lmsAntiCheatStart(quiz);
  if(proctored){lmsState.proctor=await lmsProctorStart(quiz);const sb=document.querySelector('#lmsProctorStop');if(sb)sb.onclick=()=>{lmsProctorStop();lmsState.proctor=null;const n=document.querySelector('.lms-proctor-note');if(n)n.innerHTML='<p class="panel-copy"><small>Camera stopped \u2014 remaining snapshots stay attached to this attempt.</small></p>';};}
 }catch(err){root.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
function lmsProctorConsent(quiz){
 return new Promise(res=>{
  const secs=(quiz.proctoring&&quiz.proctoring.snapshotIntervalSec)||60;
  const ov=document.createElement('div');ov.className='lms-modal-ov';
  ov.innerHTML=`<div class="screen-panel lms-modal" role="dialog" aria-label="Proctoring consent"><h3>Proctored exam</h3><p class="panel-copy">This exam uses <b>consent-based proctoring</b>. If you accept:</p><ul class="lms-checklist"><li>Your webcam takes a small still photo every ${secs} seconds.</li><li>Every photo is shown to you in a filmstrip \u2014 nothing is captured secretly.</li><li>Photos and a tab-switch count are attached to your attempt for your teacher to review.</li><li>No facial recognition or identity matching is used \u2014 photos are for human review only.</li></ul><p class="panel-copy"><small>You can decline, but then this proctored exam cannot start.</small></p><div class="lms-actions"><button class="primary-btn" id="lmsProctorYes">Accept & start</button><button class="filter-select" id="lmsProctorNo">Decline</button></div></div>`;
  document.body.appendChild(ov);
  ov.querySelector('#lmsProctorYes').onclick=()=>{ov.remove();res(true);};
  ov.querySelector('#lmsProctorNo').onclick=()=>{ov.remove();res(false);};
 });
}
async function lmsProctorStart(quiz){
 const st={consentedAt:new Date().toISOString(),snapshots:[],stream:null,timer:null,video:null,canvas:null};
 try{st.stream=await navigator.mediaDevices.getUserMedia({video:{width:{max:640}},audio:false});}
 catch(err){lmsToast('Camera unavailable \u2014 proctoring continues without snapshots.');return st;}
 st.video=document.createElement('video');st.video.muted=true;st.video.playsInline=true;st.video.srcObject=st.stream;
 try{await st.video.play();}catch{}
 st.canvas=document.createElement('canvas');
 const snap=()=>{try{
   const v=st.video;if(!v.videoWidth)return;
   const scale=Math.min(1,320/v.videoWidth);
   st.canvas.width=Math.round(v.videoWidth*scale);st.canvas.height=Math.round(v.videoHeight*scale);
   st.canvas.getContext('2d').drawImage(v,0,0,st.canvas.width,st.canvas.height);
   const img=st.canvas.toDataURL('image/jpeg',0.6);
   if(st.snapshots.length<20){st.snapshots.push({at:new Date().toISOString(),img});
    const film=document.querySelector('#lmsFilmstrip');if(film){const im=document.createElement('img');im.src=img;im.className='lms-snap';im.alt='Proctor snapshot';film.appendChild(im);}}
  }catch{}};
 snap();
 st.timer=setInterval(snap,((quiz.proctoring&&quiz.proctoring.snapshotIntervalSec)||60)*1000);
 return st;
}
function lmsProctorStop(){const st=lmsState.proctor;if(!st)return;if(st.timer)clearInterval(st.timer);if(st.stream)st.stream.getTracks().forEach(t=>t.stop());lmsState.proctor=null;}
function lmsAntiCheatStart(quiz){
 lmsAntiCheatStop();lmsState.tabSwitches=0;
 if(quiz.antiCheat&&quiz.antiCheat.detectTabSwitch){
  lmsState.tabSwitchHandler=()=>{if(document.hidden){lmsState.tabSwitches=(lmsState.tabSwitches||0)+1;lmsToast(`Tab switch detected (${lmsState.tabSwitches}). This is recorded with your attempt.`);}};
  document.addEventListener('visibilitychange',lmsState.tabSwitchHandler);
 }
 if(quiz.antiCheat&&quiz.antiCheat.disableCopy){
  const root=document.querySelector('#quizTakeBody');if(!root)return;
  lmsState.copyBlocker=e=>{e.preventDefault();};
  ['copy','paste','cut'].forEach(ev=>root.addEventListener(ev,lmsState.copyBlocker));
  lmsState.ctxBlocker=e=>e.preventDefault();
  root.addEventListener('contextmenu',lmsState.ctxBlocker);
 }
}
function lmsAntiCheatStop(){
 if(lmsState.tabSwitchHandler){document.removeEventListener('visibilitychange',lmsState.tabSwitchHandler);lmsState.tabSwitchHandler=null;}
 const root=document.querySelector('#quizTakeBody');
 if(root){if(lmsState.copyBlocker){['copy','paste','cut'].forEach(ev=>root.removeEventListener(ev,lmsState.copyBlocker));}if(lmsState.ctxBlocker)root.removeEventListener('contextmenu',lmsState.ctxBlocker);}
 lmsState.copyBlocker=null;lmsState.ctxBlocker=null;
}
function lmsToast(msg){let t=document.querySelector('#lmsToast');if(!t){t=document.createElement('div');t.id='lmsToast';t.className='lms-toast';t.setAttribute('role','alert');document.body.appendChild(t);}t.textContent=msg;t.classList.add('show');clearTimeout(lmsState.toastTimer);lmsState.toastTimer=setTimeout(()=>t.classList.remove('show'),3500);}
/* ---------- adaptive exam flow (one question at a time) ---------- */
async function lmsStartAdaptive(quiz){
 const root=document.querySelector('#quizTakeBody');
 try{
  const d=await apiRequest(`/quizzes/${encodeURIComponent(quiz.id)}/attempts`,{method:'POST',body:'{}'});
  lmsState.attemptId=d.attemptId;lmsState.quiz=quiz;lmsState.adaptiveTimerOn=false;
  lmsAntiCheatStart(quiz);
  lmsAdaptiveNext(quiz);
 }catch(err){root.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
async function lmsAdaptiveNext(quiz){
 const root=document.querySelector('#quizTakeBody');
 try{
  const d=await apiRequest(`/quizzes/${encodeURIComponent(quiz.id)}/attempts/${encodeURIComponent(lmsState.attemptId)}/next`);
  if(d.done||!d.question){lmsAdaptiveSubmit(quiz);return;}
  const q=d.question;
  root.innerHTML=`<div class="lms-quiz-head"><h2>${safeText(quiz.title)}</h2><div><span class="pill purple-pill">ADAPTIVE \u00b7 ${safeText(d.currentDifficulty||'medium')}</span>${quiz.timeLimitMin?`<span class="lms-timer" id="quizTimer" role="timer" aria-live="polite">\u23f1</span>`:''}</div></div><p class="panel-copy">Question ${(d.answeredCount||0)+1} \u00b7 difficulty adapts to your answers.</p><form id="quizForm">${lmsQuestionHtml(q,0)}<div class="lms-actions"><button class="primary-btn" type="submit">Answer & next \u2192</button><button type="button" class="filter-select" id="lmsAdaptFinish">Finish exam</button></div></form>`;
  if(quiz.timeLimitMin&&!lmsState.adaptiveTimerOn){lmsState.adaptiveTimerOn=true;lmsStartTimer(quiz.timeLimitMin*60,()=>lmsAdaptiveSubmit(quiz));}
  document.querySelector('#quizForm').onsubmit=async e=>{e.preventDefault();const ans=lmsCollectAnswer(q);try{await apiRequest(`/quizzes/${encodeURIComponent(quiz.id)}/attempts/${encodeURIComponent(lmsState.attemptId)}/answer`,{method:'POST',body:JSON.stringify({questionId:q.id,answer:ans===undefined?null:ans})});}catch(err){lmsToast(err.message);return;}lmsAdaptiveNext(quiz);};
  document.querySelector('#lmsAdaptFinish').onclick=()=>lmsAdaptiveSubmit(quiz);
 }catch(err){root.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
async function lmsAdaptiveSubmit(quiz){
 lmsStopQuizTimer();lmsAntiCheatStop();lmsProctorStop();const root=document.querySelector('#quizTakeBody');
 root.innerHTML='<p class="panel-copy">Submitting\u2026</p>';
 try{const {attempt}=await apiRequest(`/quizzes/${encodeURIComponent(quiz.id)}/attempts/${encodeURIComponent(lmsState.attemptId)}/submit`,{method:'POST',body:'{}'});lmsQuizResult(attempt||{},quiz,false);}catch(err){root.innerHTML=`<p class="panel-copy">Submit failed: ${safeText(err.message)}</p>`;}
}
function lmsStartTimer(sec,onExpire){lmsStopQuizTimer();const end=Date.now()+sec*1000;lmsState.quizTimer=setInterval(()=>{const left=Math.max(0,Math.round((end-Date.now())/1000));const t=document.querySelector('#quizTimer');if(t)t.textContent=`\u23f1 ${fmtDur(left)}`;if(left<=0){lmsStopQuizTimer();onExpire();}},1000);}
async function lmsSubmitQuiz(auto){
 lmsStopQuizTimer();lmsAntiCheatStop();const root=document.querySelector('#quizTakeBody');const quiz=lmsState.quiz;if(!quiz||!lmsState.attemptId)return;
 const answers={};(quiz.questions||[]).forEach(q=>{const a=lmsCollectAnswer(q);if(a!==undefined)answers[q.id]=a;});
 const payload={answers};
 if(lmsState.proctor)payload.proctor={consentedAt:lmsState.proctor.consentedAt,snapshots:lmsState.proctor.snapshots.map(x=>({at:x.at,img:x.img}))};
 if(lmsState.tabSwitches)payload.tabSwitches=lmsState.tabSwitches;
 lmsProctorStop();
 root.innerHTML='<p class="panel-copy">Submitting\u2026</p>';
 try{const {attempt}=await apiRequest(`/quizzes/${encodeURIComponent(quiz.id)}/attempts/${encodeURIComponent(lmsState.attemptId)}/submit`,{method:'POST',body:JSON.stringify(payload)});lmsQuizResult(attempt||{},quiz,auto);}catch(err){root.innerHTML=`<p class="panel-copy">Submit failed: ${safeText(err.message)}</p><button class="primary-btn" id="quizRetry2">Try again</button>`;document.querySelector('#quizRetry2').onclick=()=>loadQuizTake();}
}
function lmsQuizResult(attempt,quiz,auto){
 const qr=attempt.questionResults||attempt.results||{};
 const qg=attempt.questionGrades||{};
 const rows=(quiz.questions||[]).map((q,i)=>{const st=qr[q.id];const cls=st===true?'ok':st===false?'bad':'wait';const label=st===true?'\u2713 Correct':st===false?'\u2717 Incorrect':'\u25f7 Awaiting grading';
 const pts=qg[q.id]&&qg[q.id].points!==undefined&&qg[q.id].points!==null?` \u00b7 ${qg[q.id].points}/${q.points||1} pt`:'';
 return `<div class="lms-result-row"><b>Q${i+1}. ${safeText(q.prompt)}</b><span class="lms-result-${cls}">${label}${pts}</span></div>`;}).join('');
 const score=attempt.finalScore??attempt.autoScore??0;
 const nm=Number(attempt.negativeMarks)||0;
 document.querySelector('#quizTakeBody').innerHTML=`<p class="eyebrow">RESULT${auto?' \u00b7 AUTO-SUBMITTED':''}${attempt.attemptNumber?` \u00b7 ATTEMPT ${attempt.attemptNumber}`:''}</p><h2>${attempt.passed?'\ud83c\udf89 Passed!':'Quiz submitted'}</h2><div class="lms-score"><b>${score}%</b><span>${attempt.passed?`You passed${attempt.late?' (submitted after the time limit)':''}. Well done!`:'Keep practising \u2014 review the material and try again.'}</span></div>${nm?`<p class="panel-copy">Negative marking applied: <b>\u2212${nm} pt</b></p>`:''}${attempt.tabSwitches?`<p class="panel-copy"><small>Tab switches recorded: ${attempt.tabSwitches}</small></p>`:''}${rows}<div class="lms-actions"><button class="filter-select" data-screen="quizzes">\u2190 Back to quizzes</button><button class="filter-select" id="quizSolutions">View detailed solutions</button><button class="filter-select" id="quizRetry">Try again</button></div><div id="lmsSolutions"></div>`;
 document.querySelector('#quizRetry').onclick=()=>loadQuizTake();
 document.querySelector('#quizSolutions').onclick=()=>lmsShowSolutions(quiz,attempt);
}
async function lmsShowSolutions(quiz,attempt){
 const box=document.querySelector('#lmsSolutions');if(!box)return;box.innerHTML='<p class="panel-copy">Loading solutions\u2026</p>';
 try{
  const d=await apiRequest(`/quizzes/${encodeURIComponent(quiz.id)}/attempts/${encodeURIComponent(attempt.id||lmsState.attemptId)}/solutions`);
  const sols=d.solutions||[];
  box.innerHTML=sols.length?`<h3>Detailed solutions</h3>`+sols.map((sl,i)=>`<div class="lms-solution"><b>Q${i+1}. ${safeText(sl.prompt||'')}</b><p><span class="lms-result-${sl.correct?'ok':'bad'}">${sl.correct?'\u2713 Correct':'\u2717 Incorrect'}</span>${sl.pointsAwarded!==undefined?` \u00b7 ${sl.pointsAwarded} pt`:''}</p>${sl.explanation?`<p>${safeText(sl.explanation)}</p>`:'<p class="panel-copy">No explanation provided.</p>'}</div>`).join(''):'<p class="panel-copy">No solutions available.</p>';
 }catch(err){box.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}

/* ---------- teacher quiz builder ---------- */
async function loadTeacherQuizzes(){
 const root=document.querySelector('#staffPageBody');if(!root)return;
 lmsState.quizDraft={questions:[]};lmsState.editingQuizId=null;
 try{
  const [{quizzes},cd]=await Promise.all([apiRequest('/teacher/quizzes'),apiRequest('/teacher/courses').catch(()=>({courses:[]}))]);
  const courses=cd.courses||[];
  root.innerHTML=`<h3>Your quizzes</h3><div id="tqList">${tqListHtml(quizzes||[])}</div>
  <h3 id="tqFormTitle">Build a new quiz</h3>
  <form id="tqForm" class="teacher-form">
   <input name="title" placeholder="Quiz title" maxlength="120" required aria-label="Quiz title">
   <textarea name="description" placeholder="Description (optional)" maxlength="1000" aria-label="Quiz description"></textarea>
   <label>Course (optional)<select name="courseId"><option value="">No specific course</option>${courses.map(c=>`<option value="${safeText(c.id)}">${safeText(c.title)}</option>`).join('')}</select></label>
   <div class="lms-form-row"><label>Time limit (min, 0 = none)<input name="timeLimitMin" type="number" min="0" value="0"></label><label>Max attempts (0 = unlimited)<input name="maxAttempts" type="number" min="0" value="0"></label><label>Passing score %<input name="passingScore" type="number" min="0" max="100" value="50"></label></div>
   <div class="lms-form-row"><label><input name="shuffleQuestions" type="checkbox"> Shuffle questions</label><label><input name="shuffleOptions" type="checkbox"> Shuffle options</label><label>Status<select name="status"><option value="draft">Draft</option><option value="published">Published</option></select></label></div>
   <div class="lms-form-row"><label><input name="isFinalAssessment" type="checkbox"> Final assessment for the chosen course (only one per course; students must pass it for a certificate)</label></div>
   <h4>Exam settings</h4>
   <div class="lms-form-row"><label>Negative marking (0\u20131)<input name="negativeMarking" type="number" min="0" max="1" step="0.05" value="0"></label><label>Solutions shown<select name="showSolutions"><option value="after_pass">After passing</option><option value="immediate">Right after submit</option><option value="never">Never</option></select></label><label class="auth-check"><input name="adaptive" type="checkbox"> Adaptive exam</label></div>
   <div class="lms-form-row"><label>Random from bank (0=off)<input name="randomCount" type="number" min="0" value="0"></label><label>Topic filter<input name="randomTopic" maxlength="80" placeholder="optional"></label><label>Difficulty filter<select name="randomDifficulty"><option value="">Any</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label></div>
   <div class="lms-form-row"><label>Easy count<input name="mixEasy" type="number" min="0" value="0"></label><label>Medium count<input name="mixMedium" type="number" min="0" value="0"></label><label>Hard count<input name="mixHard" type="number" min="0" value="0"></label></div>
   <div class="lms-form-row"><label class="auth-check"><input name="proctorEnabled" type="checkbox"> Proctored exam (webcam snapshots, consent-based)</label><label>Snapshot every (sec)<input name="snapshotIntervalSec" type="number" min="10" max="300" value="60"></label><label class="auth-check"><input name="detectTabSwitch" type="checkbox"> Count tab switches</label><label class="auth-check"><input name="disableCopy" type="checkbox"> Disable copy/paste</label></div>
   <h4>Questions (<span id="tqQCount">0</span>)</h4><div id="tqQuestions" class="lms-qlist"></div>
   <div class="lms-actions"><button type="button" class="filter-select" id="tqBankPick">+ Add from question bank</button><button type="button" class="filter-select" id="tqBankSave">Save current to bank</button></div>
   <div class="lms-form-row"><label>Question type<select id="tqQType" aria-label="Question type"><option value="mcq">Multiple choice</option><option value="multiselect">Multiple select</option><option value="truefalse">True / False</option><option value="short">Short answer</option><option value="fillblank">Fill in the blanks</option><option value="match">Match the following</option><option value="essay">Essay</option><option value="code">Coding test</option></select></label></div>
   <textarea id="tqQPrompt" placeholder="Question prompt" maxlength="2000" aria-label="Question prompt"></textarea>
   <div id="tqQFields"></div>
   <button type="button" class="filter-select" id="tqAddQ">+ Add question</button>
   <div class="lms-actions"><button class="primary-btn" type="submit">Save quiz \u2192</button><button type="button" class="filter-select" id="tqReset">Clear form</button></div>
   <p id="tqStatus" class="panel-copy" role="status"></p></form>
  <div id="tqAttempts"></div>`;
  document.querySelector('#tqQType').onchange=renderTqQFields;renderTqQFields();renderTqQuestions();
  document.querySelector('#tqAddQ').onclick=tqAddQuestion;
  document.querySelector('#tqBankPick').onclick=tqOpenBankPicker;
  document.querySelector('#tqBankSave').onclick=tqSaveCurrentToBank;
  document.querySelector('#tqReset').onclick=()=>{lmsState.quizDraft={questions:[]};lmsState.editingQuizId=null;document.querySelector('#tqForm').reset();document.querySelector('#tqFormTitle').textContent='Build a new quiz';renderTqQuestions();renderTqQFields();};
  document.querySelector('#tqForm').onsubmit=tqSaveQuiz;
 }catch(err){root.innerHTML=`<p class="staff-empty">${safeText(err.message)}</p>`;}
}
function tqListHtml(quizzes){
 return staffTable(['Title','Course','Status','Questions','Actions'],quizzes.map(q=>`<tr><td>${safeText(q.title)}</td><td>${safeText(q.courseTitle||'\u2014')}</td><td>${safeText(q.status)}</td><td>${(q.questions||[]).length}</td><td><button data-tq="edit" data-id="${safeText(q.id)}">Edit</button> <button data-tq="${q.status==='published'?'unpublish':'publish'}" data-id="${safeText(q.id)}">${q.status==='published'?'Unpublish':'Publish'}</button> <button data-tq="attempts" data-id="${safeText(q.id)}">Attempts</button> <button data-tq="analytics" data-id="${safeText(q.id)}">Analytics</button> <button data-tq="delete" data-id="${safeText(q.id)}">Delete</button></td></tr>`),'No quizzes yet \u2014 build your first one below.');
}
/* ---------- exam question editor (shared by quiz builder + question bank) ---------- */
const TQ_TYPES={mcq:'Multiple choice',truefalse:'True / False',short:'Short answer',multiselect:'Multiple select',fillblank:'Fill in the blanks',match:'Match the following',essay:'Essay',code:'Coding test'};
function tqCommonFields(p){
 return `<div class="lms-form-row"><label>Difficulty<select id="${p}Difficulty"><option value="easy">Easy</option><option value="medium" selected>Medium</option><option value="hard">Hard</option></select></label><label>Topic<input id="${p}Topic" maxlength="80" placeholder="e.g. Algebra"></label><label>Points<input id="${p}Points" type="number" min="1" max="100" value="1"></label></div><textarea id="${p}Explanation" maxlength="2000" placeholder="Detailed solution \u2014 shown to students per the quiz solutions policy" aria-label="Explanation"></textarea>`;
}
function tqMatchRow(p,left='',right=''){const box=document.querySelector('#'+p+'MatchRows');if(!box)return;const d=document.createElement('div');d.className='lms-match-row';d.innerHTML=`<input placeholder="Left item" maxlength="200" value="${safeText(left)}" aria-label="Left item"><span>\u2194</span><input placeholder="Matching right item" maxlength="200" value="${safeText(right)}" aria-label="Right item"><button type="button" class="filter-select" aria-label="Remove pair">\u00d7</button>`;d.querySelector('button').onclick=()=>d.remove();box.appendChild(d);}
function tqRubricRow(p,criterion='',maxPoints=5){const box=document.querySelector('#'+p+'RubricRows');if(!box)return;const d=document.createElement('div');d.className='lms-rubric-row';d.innerHTML=`<input placeholder="Criterion, e.g. Clarity of argument" maxlength="120" value="${safeText(criterion)}" aria-label="Criterion"><input type="number" min="1" max="100" value="${maxPoints}" aria-label="Max points"><button type="button" class="filter-select" aria-label="Remove criterion">\u00d7</button>`;d.querySelector('button').onclick=()=>d.remove();box.appendChild(d);}
function tqTestRow(p,input='',expected='',points=1){const box=document.querySelector('#'+p+'TestRows');if(!box)return;const d=document.createElement('div');d.className='lms-tc-row';d.innerHTML=`<input placeholder="Input" maxlength="500" value="${safeText(input)}" aria-label="Test input"><input placeholder="Expected output" maxlength="500" value="${safeText(expected)}" aria-label="Expected output"><input type="number" min="1" max="100" value="${points}" aria-label="Points"><button type="button" class="filter-select" aria-label="Remove test case">\u00d7</button>`;d.querySelector('button').onclick=()=>d.remove();box.appendChild(d);}
function tqRenderFields(p){
 const t=document.querySelector('#'+p+'QType').value,box=document.querySelector('#'+p+'QFields');if(!box)return;
 let h='';
 if(t==='mcq')h=`<div>${[0,1,2,3].map(i=>`<input data-${p}-opt placeholder="Option ${i+1}" maxlength="300" aria-label="Option ${i+1}">`).join('')}</div><div class="lms-form-row"><label>Correct option<select id="${p}Correct"><option value="0">Option 1</option><option value="1">Option 2</option><option value="2">Option 3</option><option value="3">Option 4</option></select></label></div>`;
 else if(t==='multiselect')h=`<div>${[0,1,2,3].map(i=>`<div class="lms-ms-row"><input data-${p}-msopt placeholder="Option ${i+1}" maxlength="300" aria-label="Option ${i+1}"><label class="auth-check"><input type="checkbox" data-${p}-mscorrect> Correct</label></div>`).join('')}</div><p class="panel-copy"><small>Tick every correct option. Partial credit is awarded.</small></p>`;
 else if(t==='truefalse')h=`<div class="lms-form-row"><label>Correct answer<select id="${p}Bool"><option value="true">True</option><option value="false">False</option></select></label></div>`;
 else if(t==='short')h=`<textarea id="${p}Accepted" placeholder="Accepted answers, one per line (leave blank for manual grading only)" aria-label="Accepted answers"></textarea>`;
 else if(t==='fillblank')h=`<textarea id="${p}Template" rows="2" maxlength="2000" placeholder="Sentence with ___ for each blank, e.g. The capital of France is ___." aria-label="Template"></textarea><textarea id="${p}BlankLines" rows="3" placeholder="Accepted answers per blank \u2014 one blank per line, alternatives separated by |" aria-label="Blank answers"></textarea><p class="panel-copy"><small>Blanks detected: <b id="${p}BlankCount">0</b></small></p>`;
 else if(t==='match')h=`<div id="${p}MatchRows"></div><button type="button" class="filter-select" id="${p}MatchAdd">+ Add pair</button><p class="panel-copy"><small>Students see the right column shuffled and match each left item.</small></p>`;
 else if(t==='essay')h=`<div class="lms-form-row"><label>Max words (0 = no limit)<input id="${p}MaxWords" type="number" min="0" max="10000" value="0"></label></div><div id="${p}RubricRows"></div><button type="button" class="filter-select" id="${p}RubricAdd">+ Add rubric criterion</button><p class="panel-copy"><small>Essays are graded manually. A rubric splits the marks per criterion.</small></p>`;
 else if(t==='code')h=`<div class="lms-form-row"><label>Language<select id="${p}Lang"><option value="javascript">JavaScript (auto-graded)</option><option value="python">Python (manual grading)</option><option value="other">Other (manual grading)</option></select></label></div><textarea id="${p}Starter" rows="4" class="lms-code" placeholder="Starter code \u2014 students must define function solve(input)" aria-label="Starter code"></textarea><div id="${p}TestRows"></div><button type="button" class="filter-select" id="${p}TestAdd">+ Add test case</button><p class="panel-copy"><small>Each test case calls <b>solve(input)</b> and compares the returned value.</small></p>`;
 box.innerHTML=h+tqCommonFields(p);
 const madd=document.querySelector('#'+p+'MatchAdd');if(madd){madd.onclick=()=>tqMatchRow(p);for(let i=0;i<3;i++)tqMatchRow(p);}
 const radd=document.querySelector('#'+p+'RubricAdd');if(radd)radd.onclick=()=>tqRubricRow(p);
 const tadd=document.querySelector('#'+p+'TestAdd');if(tadd){tadd.onclick=()=>tqTestRow(p);tqTestRow(p);}
 const tpl=document.querySelector('#'+p+'Template');if(tpl)tpl.oninput=()=>{const c=document.querySelector('#'+p+'BlankCount');if(c)c.textContent=(tpl.value.match(/___/g)||[]).length;};
}
function tqNewId(prefix){return prefix+Date.now().toString(36)+Math.floor(Math.random()*9999);}
function tqCollect(p){
 const type=document.querySelector('#'+p+'QType').value;
 const prompt=document.querySelector('#'+p+'QPrompt').value.trim();
 if(prompt.length<3)return {error:'Write the question prompt first (min 3 characters).'};
 const points=Math.max(1,Math.min(100,Number(document.querySelector('#'+p+'Points').value)||1));
 const q={id:tqNewId('q'),type,prompt,points,difficulty:document.querySelector('#'+p+'Difficulty').value,topic:document.querySelector('#'+p+'Topic').value.trim().slice(0,80),explanation:document.querySelector('#'+p+'Explanation').value.trim().slice(0,2000)};
 const val=id=>{const el=document.querySelector('#'+p+id);return el?el.value:'';};
 if(type==='mcq'){const opts=[...document.querySelectorAll(`[data-${p}-opt]`)].map(i=>i.value.trim()).filter(Boolean);if(opts.length<2)return {error:'Multiple choice needs at least 2 options.'};q.options=opts;q.correctIndex=Math.min(opts.length-1,Number(val('Correct')));}
 else if(type==='multiselect'){const inps=[...document.querySelectorAll(`[data-${p}-msopt]`)],chks=[...document.querySelectorAll(`[data-${p}-mscorrect]`)];const rows=inps.map((inp,i)=>({text:inp.value.trim(),correct:!!(chks[i]&&chks[i].checked)})).filter(r=>r.text);if(rows.length<2)return {error:'Multiple select needs at least 2 options.'};const ci=rows.map((r,i)=>r.correct?i:-1).filter(i=>i>=0);if(!ci.length)return {error:'Tick at least one correct option.'};q.options=rows.map(r=>r.text);q.correctIndices=ci;}
 else if(type==='truefalse'){q.correctBoolean=val('Bool')==='true';}
 else if(type==='short'){q.acceptedAnswers=val('Accepted').split('\n').map(s=>s.trim()).filter(Boolean).slice(0,20);}
 else if(type==='fillblank'){const tpl=val('Template');const blanks=(tpl.match(/___/g)||[]).length;if(!blanks)return {error:'Use ___ to mark at least one blank in the template.'};if(blanks>8)return {error:'At most 8 blanks per question.'};const lines=val('BlankLines').split('\n');if(lines.length<blanks||lines.slice(0,blanks).some(l=>!l.trim()))return {error:`Provide accepted answers for all ${blanks} blank(s), one per line.`};q.template=tpl;q.blankAnswers=lines.slice(0,blanks).map(l=>l.split('|').map(s=>s.trim()).filter(Boolean));}
 else if(type==='match'){const box=document.querySelector('#'+p+'MatchRows');const rows=box?[...box.querySelectorAll('.lms-match-row')].map(r=>{const ins=r.querySelectorAll('input');return {left:ins[0].value.trim(),right:ins[1].value.trim()};}).filter(x=>x.left&&x.right):[];if(rows.length<2)return {error:'Matching needs at least 2 pairs.'};if(rows.length>8)return {error:'At most 8 pairs.'};q.pairs=rows;}
 else if(type==='essay'){q.maxWords=Math.max(0,Math.min(10000,Number(val('MaxWords'))||0));const box=document.querySelector('#'+p+'RubricRows');q.rubric=box?[...box.querySelectorAll('.lms-rubric-row')].map(r=>{const ins=r.querySelectorAll('input');return {id:tqNewId('rc'),criterion:ins[0].value.trim(),maxPoints:Math.max(1,Math.min(100,Number(ins[1].value)||1))};}).filter(x=>x.criterion):[];if(q.rubric.length>10)return {error:'At most 10 rubric criteria.'};}
 else if(type==='code'){q.language=val('Lang')||'javascript';q.starterCode=document.querySelector('#'+p+'Starter').value.slice(0,10000);const box=document.querySelector('#'+p+'TestRows');q.testCases=box?[...box.querySelectorAll('.lms-tc-row')].map(r=>{const ins=r.querySelectorAll('input');return {id:tqNewId('tc'),input:ins[0].value,expectedOutput:ins[1].value,points:Math.max(1,Math.min(100,Number(ins[2].value)||1))};}).filter(x=>x.input!==''||x.expectedOutput!==''):[];}
 return {question:q};
}
function renderTqQFields(){tqRenderFields('tq');}
function renderTqQuestions(){
 const box=document.querySelector('#tqQuestions');if(!box)return;const qs=lmsState.quizDraft.questions;
 document.querySelector('#tqQCount').textContent=qs.length;
 box.innerHTML=qs.length?qs.map((q,i)=>{
  let detail='';
  if(q.type==='mcq')detail=`Options: ${q.options.map(safeText).join(' | ')} \u2014 correct: ${safeText(q.options[q.correctIndex])}`;
  else if(q.type==='multiselect')detail=`Options: ${q.options.map(safeText).join(' | ')} \u2014 correct: ${(q.correctIndices||[]).map(ix=>safeText(q.options[ix])).join(', ')}`;
  else if(q.type==='truefalse')detail=`Answer: ${q.correctBoolean?'True':'False'}`;
  else if(q.type==='short')detail=`Accepted: ${q.acceptedAnswers.length?q.acceptedAnswers.map(safeText).join(' | '):'manual grading'}`;
  else if(q.type==='fillblank')detail=`${(q.template.match(/___/g)||[]).length} blank(s)`;
  else if(q.type==='match')detail=`${(q.pairs||[]).length} pairs`;
  else if(q.type==='essay')detail=`Essay${q.maxWords?` \u00b7 max ${q.maxWords} words`:''}${q.rubric&&q.rubric.length?` \u00b7 rubric (${q.rubric.length})`:''} \u00b7 manual grading`;
  else if(q.type==='code')detail=`${safeText(q.language||'javascript')} \u00b7 ${(q.testCases||[]).length} test case(s)`;
  return `<div class="lms-qitem"><div><b>Q${i+1} \u00b7 ${safeText(TQ_TYPES[q.type]||q.type)}</b> <span class="lms-kind">${safeText(q.difficulty||'medium')}</span>${q.topic?`<span class="lms-kind">${safeText(q.topic)}</span>`:''}<p>${safeText(q.prompt)}</p><small>${detail}</small></div><div class="lms-qitem-actions"><button type="button" class="filter-select" data-tq-bankq="${i}">Save to bank</button><button type="button" class="filter-select" data-tq-rm="${i}">Remove</button></div></div>`;
 }).join(''):'<p class="panel-copy">No questions yet.</p>';
}
function tqAddQuestion(){
 const r=tqCollect('tq');
 if(r.error){alert(r.error);return;}
 lmsState.quizDraft.questions.push(r.question);
 document.querySelector('#tqQPrompt').value='';tqRenderFields('tq');renderTqQuestions();
}
async function tqSaveQuestionToBank(i){
 const q=lmsState.quizDraft.questions[i];if(!q)return;
 try{await apiRequest('/teacher/question-bank',{method:'POST',body:JSON.stringify(q)});alert('Saved to question bank.');}catch(err){alert(err.message);}
}
async function tqSaveCurrentToBank(){
 const r=tqCollect('tq');
 if(r.error){alert(r.error);return;}
 try{await apiRequest('/teacher/question-bank',{method:'POST',body:JSON.stringify(r.question)});alert('Saved to question bank.');}catch(err){alert(err.message);}
}
async function tqOpenBankPicker(){
 let bank=[];try{const d=await apiRequest('/teacher/question-bank');bank=d.questions||d.bank||[];}catch(err){alert(err.message);return;}
 const ov=document.createElement('div');ov.className='lms-modal-ov';ov.id='tqBankModal';
 ov.innerHTML=`<div class="screen-panel lms-modal" role="dialog" aria-label="Add from question bank"><h3>Add from question bank</h3><div class="lms-bank-pick">${bank.length?bank.map(q=>`<label class="lms-bank-pickrow"><input type="checkbox" data-bankpick="${safeText(q.id)}"><span><b>${safeText(TQ_TYPES[q.type]||q.type)}</b> \u00b7 ${safeText(q.difficulty||'')} \u00b7 ${safeText(q.topic||'no topic')}<br>${safeText(q.prompt)}</span></label>`).join(''):'<p class="panel-copy">Your bank is empty. Save questions to it from the editor.</p>'}</div><div class="lms-actions"><button class="primary-btn" id="tqBankAdd">Add selected \u2192</button><button class="filter-select" id="tqBankClose">Close</button></div></div>`;
 document.body.appendChild(ov);
 ov.querySelector('#tqBankClose').onclick=()=>ov.remove();
 ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
 ov.querySelector('#tqBankAdd').onclick=()=>{[...ov.querySelectorAll('[data-bankpick]:checked')].forEach(c=>{const q=bank.find(x=>String(x.id)===String(c.dataset.bankpick));if(q){const cp=Object.assign({},q);cp.id=tqNewId('q');lmsState.quizDraft.questions.push(cp);}});ov.remove();renderTqQuestions();};
}
async function tqSaveQuiz(e){
 e.preventDefault();const f=e.target,st=document.querySelector('#tqStatus');const qs=lmsState.quizDraft.questions;
 if(!qs.length){st.textContent='Add at least one question.';return;}
 const rc=Math.max(0,Math.floor(Number(f.randomCount.value)||0));
 const body={title:f.title.value.trim(),description:f.description.value.trim(),courseId:f.courseId.value||undefined,timeLimitMin:Number(f.timeLimitMin.value)||0,maxAttempts:Number(f.maxAttempts.value)||0,passingScore:Number(f.passingScore.value)||0,shuffleQuestions:f.shuffleQuestions.checked,shuffleOptions:f.shuffleOptions.checked,status:f.status.value,isFinalAssessment:!!(f.isFinalAssessment&&f.isFinalAssessment.checked),questions:qs,
 negativeMarking:Math.max(0,Math.min(1,Number(f.negativeMarking.value)||0)),showSolutions:f.showSolutions.value,adaptive:!!f.adaptive.checked,
 randomSelect:{count:rc,difficulty:f.randomDifficulty.value||undefined,topic:f.randomTopic.value.trim()||undefined},
 difficultyMix:{easy:Math.max(0,Math.floor(Number(f.mixEasy.value)||0)),medium:Math.max(0,Math.floor(Number(f.mixMedium.value)||0)),hard:Math.max(0,Math.floor(Number(f.mixHard.value)||0))},
 proctoring:{enabled:!!f.proctorEnabled.checked,snapshotIntervalSec:Math.max(10,Math.min(300,Number(f.snapshotIntervalSec.value)||60))},
 antiCheat:{detectTabSwitch:!!f.detectTabSwitch.checked,disableCopy:!!f.disableCopy.checked}};
 if(body.title.length<3){st.textContent='Title needs at least 3 characters.';return;}
 try{st.textContent='Saving\u2026';
  if(lmsState.editingQuizId){await apiRequest(`/teacher/quizzes/${encodeURIComponent(lmsState.editingQuizId)}`,{method:'PATCH',body:JSON.stringify(body)});st.textContent='Quiz updated.';}
  else{await apiRequest('/teacher/quizzes',{method:'POST',body:JSON.stringify(body)});st.textContent='Quiz saved.';}
  loadTeacherQuizzes();
 }catch(err){st.textContent=err.message;}
}
async function lmsTeacherQuizAction(el){
 const id=el.dataset.id,act=el.dataset.tq;
 try{
  if(act==='delete'){if(!confirm('Delete this quiz and all its attempts?'))return;await apiRequest(`/teacher/quizzes/${encodeURIComponent(id)}`,{method:'DELETE'});loadTeacherQuizzes();}
  else if(act==='publish'||act==='unpublish'){await apiRequest(`/teacher/quizzes/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({status:act==='publish'?'published':'draft'})});loadTeacherQuizzes();}
  else if(act==='edit'){const {quiz}=await apiRequest(`/teacher/quizzes/${encodeURIComponent(id)}`);lmsState.editingQuizId=id;lmsState.quizDraft={questions:(quiz.questions||[]).map(q=>Object.assign({},q))};const f=document.querySelector('#tqForm');f.title.value=quiz.title||'';f.description.value=quiz.description||'';f.courseId.value=quiz.courseId||'';f.timeLimitMin.value=quiz.timeLimitMin||0;f.maxAttempts.value=quiz.maxAttempts||0;f.passingScore.value=quiz.passingScore||0;f.shuffleQuestions.checked=!!quiz.shuffleQuestions;f.shuffleOptions.checked=!!quiz.shuffleOptions;f.status.value=quiz.status||'draft';if(f.isFinalAssessment)f.isFinalAssessment.checked=!!quiz.isFinalAssessment;
f.negativeMarking.value=quiz.negativeMarking||0;f.showSolutions.value=quiz.showSolutions||'after_pass';f.adaptive.checked=!!quiz.adaptive;
f.randomCount.value=(quiz.randomSelect&&quiz.randomSelect.count)||0;f.randomDifficulty.value=(quiz.randomSelect&&quiz.randomSelect.difficulty)||'';f.randomTopic.value=(quiz.randomSelect&&quiz.randomSelect.topic)||'';
f.mixEasy.value=(quiz.difficultyMix&&quiz.difficultyMix.easy)||0;f.mixMedium.value=(quiz.difficultyMix&&quiz.difficultyMix.medium)||0;f.mixHard.value=(quiz.difficultyMix&&quiz.difficultyMix.hard)||0;
f.proctorEnabled.checked=!!(quiz.proctoring&&quiz.proctoring.enabled);f.snapshotIntervalSec.value=(quiz.proctoring&&quiz.proctoring.snapshotIntervalSec)||60;
f.detectTabSwitch.checked=!!(quiz.antiCheat&&quiz.antiCheat.detectTabSwitch);f.disableCopy.checked=!!(quiz.antiCheat&&quiz.antiCheat.disableCopy);
document.querySelector('#tqFormTitle').textContent='Edit quiz';renderTqQuestions();window.scrollTo({top:0,behavior:'smooth'});}
  else if(act==='attempts'){renderTqAttempts(id);}
  else if(act==='analytics'){tqShowAnalytics(id);}
 }catch(err){alert(err.message);}
}
async function renderTqAttempts(quizId){
 const box=document.querySelector('#tqAttempts');if(!box)return;lmsState.gradingQuizId=quizId;box.innerHTML='<p class="panel-copy">Loading attempts\u2026</p>';
 try{
  const [{quiz},{attempts}]=await Promise.all([apiRequest(`/teacher/quizzes/${encodeURIComponent(quizId)}`),apiRequest(`/teacher/quizzes/${encodeURIComponent(quizId)}/attempts`)]);
  const promptOf={};(quiz.questions||[]).forEach(q=>{promptOf[q.id]=q.prompt;});
  box.innerHTML=`<h3>Attempts \u00b7 ${safeText(quiz.title)}</h3>`+(((attempts||[]).map(a=>{const grades=a.questionGrades||{};
   const rows=Object.entries(a.answers||{}).map(([qid,ans])=>{const g=grades[qid]||{};return `<div class="lms-grade-row"><div><b>${safeText(promptOf[qid]||qid)}</b><p>A: ${safeText(String(ans)).slice(0,400)}</p></div><label>Points<input type="number" min="0" data-grade-q="${safeText(qid)}" data-grade-a="${safeText(a.id)}" value="${g.points??''}" aria-label="Points"></label><label>Feedback<input data-grade-f="${safeText(qid)}" data-grade-a="${safeText(a.id)}" value="${safeText(g.feedback||'')}" placeholder="Feedback (optional)" aria-label="Feedback"></label></div>`;}).join('');
   const pro=a.proctor||{};const snaps=pro.snapshots||[];
   const proHtml=(pro.consentedAt||snaps.length||a.tabSwitches)?`<div class="lms-proctor-review"><p class="panel-copy"><small>\u25cf Proctored${pro.consentedAt?` \u00b7 consented ${safeText(new Date(pro.consentedAt).toLocaleString())}`:''}${a.tabSwitches?` \u00b7 ${a.tabSwitches} tab switch(es)`:''}${a.autoSubmitted?' \u00b7 auto-submitted':''}</small></p>${snaps.length?`<div class="lms-filmstrip">${snaps.slice(0,20).map(x=>`<img src="${safeText(x.img||'')}" class="lms-snap" alt="Proctor snapshot" loading="lazy">`).join('')}</div>`:'<p class="panel-copy"><small>No snapshots captured.</small></p>'}</div>`:'';
   return `<article class="screen-panel"><p class="eyebrow">ATTEMPT</p><h4>${safeText(a.studentName||a.studentId)} <small>${safeText(new Date(a.submittedAt||a.startedAt).toLocaleString())}</small></h4><p class="panel-copy">Score: ${a.finalScore??a.autoScore??'\u2014'}% \u00b7 ${safeText(a.status)}${a.late?' \u00b7 late':''}${a.passed?' \u00b7 passed':''}${a.negativeMarks?` \u00b7 \u2212${a.negativeMarks} pt negative marking`:''}</p>${proHtml}${rows||'<p class="panel-copy">No answers recorded.</p>'}<button class="primary-btn" data-grade-save="${safeText(a.id)}">Save grades \u2192</button> <button class="filter-select" data-grade-del="${safeText(a.id)}">Delete attempt</button></article>`;}).join(''))||'<p class="panel-copy">No attempts yet.</p>');
 }catch(err){box.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
async function tqShowAnalytics(id){
 const box=document.querySelector('#tqAttempts');if(!box)return;box.innerHTML='<p class="panel-copy">Loading analytics\u2026</p>';
 try{
  const {quiz}=await apiRequest(`/teacher/quizzes/${encodeURIComponent(id)}`);
  const a=await apiRequest(`/teacher/quizzes/${encodeURIComponent(id)}/analytics`);
  const distArr=a.scoreDistribution||[];
  const max=Math.max(1,...distArr);
  const dist=distArr.map((n,i)=>`<div class="lms-dist-row"><span>${i*10}\u2013${i*10+10}%</span><div class="lms-dist-track"><i style="width:${Math.round(n/max*100)}%"></i></div><b>${n}</b></div>`).join('');
  const pct=v=>(v===undefined||v===null)?'\u2014':Math.round(v*100)+'%';
  box.innerHTML=`<h3>Exam analytics \u00b7 ${safeText(quiz.title)}</h3><div class="admin-metrics"><article class="admin-metric"><small>ATTEMPTS</small><b>${a.attempts??0}</b></article><article class="admin-metric"><small>AVG SCORE</small><b>${a.avgScore??'\u2014'}${a.avgScore!==undefined&&a.avgScore!==null?'%':''}</b></article><article class="admin-metric"><small>PASS RATE</small><b>${a.passRate??'\u2014'}${a.passRate!==undefined&&a.passRate!==null?'%':''}</b></article><article class="admin-metric"><small>AVG DURATION</small><b>${a.avgDurationSec!==undefined&&a.avgDurationSec!==null?fmtDur(a.avgDurationSec):'\u2014'}</b></article></div><h4>Score distribution</h4><div class="lms-dist">${dist||'<p class="panel-copy">No attempts yet.</p>'}</div><h4>Per-question performance</h4>`+staffTable(['Question','Type','Difficulty','Correct rate','Avg points','Avg time'],(a.perQuestion||[]).map(q=>`<tr><td>${safeText(q.prompt)}</td><td>${safeText(TQ_TYPES[q.type]||q.type)}</td><td>${safeText(q.difficulty||'\u2014')}</td><td>${q.correctRate!==undefined&&q.correctRate!==null?pct(q.correctRate):'\u2014'}</td><td>${q.avgPoints??'\u2014'}</td><td>${q.avgSec!==undefined&&q.avgSec!==null?fmtDur(q.avgSec):'\u2014'}</td></tr>`),'No question data yet.');
 }catch(err){box.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
async function lmsSaveGrades(attemptId){
 const grades={};document.querySelectorAll(`[data-grade-a="${CSS.escape(attemptId)}"]`).forEach(el=>{const q=el.dataset.gradeQ||el.getAttribute('data-grade-q');if(!grades[q])grades[q]={};if(el.hasAttribute('data-grade-q')&&el.type==='number'&&el.value!=='')grades[q].points=Number(el.value);if(el.hasAttribute('data-grade-f'))grades[q].feedback=el.value;});
 try{await apiRequest(`/teacher/quiz-attempts/${encodeURIComponent(attemptId)}/grade`,{method:'POST',body:JSON.stringify({grades})});alert('Grades saved.');if(lmsState.gradingQuizId)renderTqAttempts(lmsState.gradingQuizId);}catch(err){alert(err.message);}
}

/* ---------- question bank ---------- */
async function loadQuestionBank(){
 const root=document.querySelector('#staffPageBody');if(!root)return;
 root.classList.add('question-bank-body');
 lmsState.bankFilter=lmsState.bankFilter||{topic:'',difficulty:'',type:''};lmsState.editingBankId=null;
 root.innerHTML=`<div class="lms-form-row"><label>Topic<input id="bkFilterTopic" placeholder="Filter by topic" value="${safeText(lmsState.bankFilter.topic)}"></label><label>Difficulty<select id="bkFilterDiff"><option value="">All</option>${['easy','medium','hard'].map(d=>`<option value="${d}"${lmsState.bankFilter.difficulty===d?' selected':''}>${d}</option>`).join('')}</select></label><label>Type<select id="bkFilterType"><option value="">All</option>${Object.entries(TQ_TYPES).map(([v,l])=>`<option value="${v}"${lmsState.bankFilter.type===v?' selected':''}>${l}</option>`).join('')}</select></label><button class="filter-select" id="bkFilterBtn" type="button">Filter</button></div><div id="bkList"><p class="panel-copy">Loading\u2026</p></div>
 <h3 id="bkFormTitle">Add a question</h3><div class="lms-form-row"><label>Question type<select id="bkQType" aria-label="Question type">${Object.entries(TQ_TYPES).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label><label>Tags (comma separated)<input id="bkTags" maxlength="200" placeholder="e.g. algebra, midterm"></label></div><textarea id="bkQPrompt" placeholder="Question prompt" maxlength="2000" aria-label="Question prompt"></textarea><div id="bkQFields"></div><div class="lms-actions"><button class="primary-btn" id="bkAdd" type="button">Save to bank \u2192</button><button class="filter-select" id="bkCancelEdit" type="button" hidden>Cancel edit</button></div><p id="bkStatus" class="panel-copy" role="status"></p>`;
 document.querySelector('#bkQType').onchange=()=>tqRenderFields('bk');tqRenderFields('bk');
 document.querySelector('#bkFilterBtn').onclick=()=>{lmsState.bankFilter={topic:document.querySelector('#bkFilterTopic').value.trim(),difficulty:document.querySelector('#bkFilterDiff').value,type:document.querySelector('#bkFilterType').value};bkRefresh();};
 document.querySelector('#bkCancelEdit').onclick=()=>{lmsState.editingBankId=null;document.querySelector('#bkFormTitle').textContent='Add a question';document.querySelector('#bkAdd').textContent='Save to bank \u2192';document.querySelector('#bkCancelEdit').hidden=true;document.querySelector('#bkQPrompt').value='';document.querySelector('#bkTags').value='';tqRenderFields('bk');};
 document.querySelector('#bkAdd').onclick=bkSaveQuestion;
 bkRefresh();
}
async function bkSaveQuestion(){
 const r=tqCollect('bk');const st=document.querySelector('#bkStatus');
 if(r.error){st.textContent=r.error;return;}
 r.question.tags=document.querySelector('#bkTags').value.split(',').map(x=>x.trim()).filter(Boolean).slice(0,10);
 try{
  if(lmsState.editingBankId){await apiRequest(`/teacher/question-bank/${encodeURIComponent(lmsState.editingBankId)}`,{method:'PATCH',body:JSON.stringify(r.question)});st.textContent='Bank question updated.';}
  else{await apiRequest('/teacher/question-bank',{method:'POST',body:JSON.stringify(r.question)});st.textContent='Saved to bank.';}
  lmsState.editingBankId=null;document.querySelector('#bkFormTitle').textContent='Add a question';document.querySelector('#bkAdd').textContent='Save to bank \u2192';document.querySelector('#bkCancelEdit').hidden=true;
  document.querySelector('#bkQPrompt').value='';document.querySelector('#bkTags').value='';tqRenderFields('bk');bkRefresh();
 }catch(err){st.textContent=err.message;}
}
async function bkRefresh(){
 const box=document.querySelector('#bkList');if(!box)return;box.innerHTML='<p class="panel-copy">Loading\u2026</p>';
 const f=lmsState.bankFilter||{};
 try{
  const qs=new URLSearchParams();if(f.topic)qs.set('topic',f.topic);if(f.difficulty)qs.set('difficulty',f.difficulty);if(f.type)qs.set('type',f.type);
  const d=await apiRequest('/teacher/question-bank'+(qs.toString()?'?'+qs.toString():''));
  const bank=d.questions||d.bank||[];
  box.innerHTML=staffTable(['Type','Prompt','Difficulty','Topic','Points','Actions'],bank.map(q=>`<tr><td>${safeText(TQ_TYPES[q.type]||q.type)}</td><td>${safeText(q.prompt)}${(q.tags||[]).length?`<small>${safeText(q.tags.join(', '))}</small>`:''}</td><td>${safeText(q.difficulty||'\u2014')}</td><td>${safeText(q.topic||'\u2014')}</td><td>${q.points||1}</td><td><button data-bank-edit="${safeText(q.id)}">Edit</button> <button data-bank-del="${safeText(q.id)}">Delete</button></td></tr>`),'No questions in the bank yet. Add your first one below.');
 }catch(err){box.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
async function bkEditQuestion(id){
 try{
  const d=await apiRequest('/teacher/question-bank');
  const bank=d.questions||d.bank||[];
  const q=bank.find(x=>String(x.id)===String(id));if(!q){alert('Question not found.');return;}
  lmsState.editingBankId=id;
  document.querySelector('#bkFormTitle').textContent='Edit bank question';
  document.querySelector('#bkAdd').textContent='Update question \u2192';
  document.querySelector('#bkCancelEdit').hidden=false;
  document.querySelector('#bkQType').value=q.type;tqRenderFields('bk');
  document.querySelector('#bkQPrompt').value=q.prompt||'';
  document.querySelector('#bkTags').value=(q.tags||[]).join(', ');
  document.querySelector('#bkDifficulty').value=q.difficulty||'medium';
  document.querySelector('#bkTopic').value=q.topic||'';
  document.querySelector('#bkPoints').value=q.points||1;
  document.querySelector('#bkExplanation').value=q.explanation||'';
  if(q.type==='mcq'){const inps=document.querySelectorAll('[data-bk-opt]');(q.options||[]).forEach((o,i)=>{if(inps[i])inps[i].value=o;});document.querySelector('#bkCorrect').value=q.correctIndex||0;}
  else if(q.type==='multiselect'){const inps=[...document.querySelectorAll('[data-bk-msopt]')],chks=[...document.querySelectorAll('[data-bk-mscorrect]')];(q.options||[]).forEach((o,i)=>{if(inps[i])inps[i].value=o;if(chks[i])chks[i].checked=(q.correctIndices||[]).includes(i);});}
  else if(q.type==='truefalse'){document.querySelector('#bkBool').value=String(!!q.correctBoolean);}
  else if(q.type==='short'){document.querySelector('#bkAccepted').value=(q.acceptedAnswers||[]).join('\n');}
  else if(q.type==='fillblank'){document.querySelector('#bkTemplate').value=q.template||'';document.querySelector('#bkBlankLines').value=(q.blankAnswers||[]).map(a=>a.join(' | ')).join('\n');const c=document.querySelector('#bkBlankCount');if(c)c.textContent=(q.template.match(/___/g)||[]).length;}
  else if(q.type==='match'){document.querySelector('#bkMatchRows').innerHTML='';(q.pairs||[]).forEach(pr=>tqMatchRow('bk',pr.left,pr.right));}
  else if(q.type==='essay'){document.querySelector('#bkMaxWords').value=q.maxWords||0;document.querySelector('#bkRubricRows').innerHTML='';(q.rubric||[]).forEach(r=>tqRubricRow('bk',r.criterion,r.maxPoints));}
  else if(q.type==='code'){document.querySelector('#bkLang').value=q.language||'javascript';document.querySelector('#bkStarter').value=q.starterCode||'';document.querySelector('#bkTestRows').innerHTML='';(q.testCases||[]).forEach(t=>tqTestRow('bk',t.input,t.expectedOutput,t.points));}
  document.querySelector('#bkFormTitle').scrollIntoView({behavior:'smooth',block:'start'});
 }catch(err){alert(err.message);}
}

/* ---------- certificates ---------- */
async function loadCertificates(){
 const root=document.querySelector('#certList');
 try{const {certificates}=await apiRequest('/certificates');lmsState.certs=certificates||[];
 if(root)root.innerHTML=lmsState.certs.length?lmsState.certs.map(c=>`<article class="lms-cert-card"><div class="lms-cert-inner"><p class="eyebrow">CERTIFICATE OF COMPLETION</p><h3>${safeText(c.courseTitle)}</h3><p>Awarded to <b>${safeText(c.userName)}</b></p><div class="lms-cert-meta"><span>Issued ${safeText(new Date(c.issuedAt).toLocaleDateString())}</span><span>Avg score ${c.scoreAvg??'\u2014'}%</span></div><p class="lms-cert-code">Verify code: <b>${safeText(c.code)}</b></p><button class="filter-select" data-lms-print-cert="${safeText(c.id)}">\ud83d\udda8 Print certificate</button></div></article>`).join(''):'<p class="panel-copy">No certificates yet \u2014 complete a course to earn one.</p>';
 }catch(err){if(root)root.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
 const is=document.querySelector('#certIssue');
 if(is){try{const {enrollments}=await apiRequest('/my-enrollments');
  is.innerHTML=`<div class="lms-form-row"><label>Course<select id="certCourse" aria-label="Course">${(enrollments||[]).map(e=>`<option value="${safeText(e.courseId)}">${safeText(e.course?.title||e.courseId)}</option>`).join('')}</select></label><button class="primary-btn" id="certIssueBtn" type="button">Check & issue \u2192</button></div><p id="certIssueStatus" class="panel-copy" role="status"></p>`;
  document.querySelector('#certIssueBtn').onclick=async()=>{const st=document.querySelector('#certIssueStatus');st.textContent='Checking eligibility\u2026';try{const d=await apiRequest('/certificates/issue',{method:'POST',body:JSON.stringify({courseId:document.querySelector('#certCourse').value})});let certMsg=d.duplicate?`Certificate already issued. Code: ${d.certificate.code}`:`Certificate issued! Code: ${d.certificate.code}`;await loadCertificates();const st2=document.querySelector('#certIssueStatus');if(st2)st2.textContent=certMsg;}catch(err){st.textContent=err.message;}};
 }catch{is.innerHTML='<p class="panel-copy">Enroll in a course first.</p>';}}
 const vf=document.querySelector('#certVerifyForm');
 if(vf)vf.onsubmit=async e=>{e.preventDefault();const code=document.querySelector('#certVerifyCode').value.trim();const out=document.querySelector('#certVerifyOut');out.innerHTML='<p class="panel-copy">Verifying\u2026</p>';try{const d=await apiRequest(`/certificates/verify/${encodeURIComponent(code)}`);out.innerHTML=d.valid&&d.certificate?`<p class="lms-valid">\u2713 Valid certificate \u2014 ${safeText(d.certificate.userName)}, \u201c${safeText(d.certificate.courseTitle)}\u201d, issued ${safeText(new Date(d.certificate.issuedAt).toLocaleDateString())}.</p>`:'<p class="lms-invalid">\u2717 This code does not match any certificate.</p>';}catch(err){out.innerHTML=`<p class="lms-invalid">${safeText(err.message)}</p>`;}};
}
function lmsPrintCert(id){
 const c=(lmsState.certs||[]).find(x=>String(x.id)===String(id));if(!c)return;
 let pa=document.querySelector('#lmsPrintArea');if(!pa){pa=document.createElement('div');pa.id='lmsPrintArea';pa.className='lms-print-area';document.body.appendChild(pa);}
 pa.innerHTML=`<div class="lms-cert-print"><p class="eyebrow">EDUVERSE 3D \u00b7 LEARNING LAB</p><h1>Certificate of Completion</h1><p>This certifies that</p><h2>${safeText(c.userName)}</h2><p>has successfully completed</p><h3>${safeText(c.courseTitle)}</h3><p>Issued ${safeText(new Date(c.issuedAt).toLocaleDateString())} \u00b7 Average score ${c.scoreAvg??'\u2014'}%</p><p class="lms-cert-code">Verify at Course discussions \u2192 Certificates with code <b>${safeText(c.code)}</b></p></div>`;
 document.body.classList.add('printing-cert');window.print();setTimeout(()=>document.body.classList.remove('printing-cert'),600);
}

/* ---------- billing & checkout ---------- */
async function startCheckout(kind,refId){
 try{const body=kind==='plan'?{kind,planId:refId}:{kind,courseId:refId};
 const d=await apiRequest('/checkout',{method:'POST',body:JSON.stringify(body)});
 lmsState.checkoutOrder=d.order;lmsState.checkoutKind=kind;lmsState.checkoutRef=refId;navigate('checkout');
 }catch(err){alert(err.message);}
}
function loadCheckout(){
 const root=document.querySelector('#checkoutBody');if(!root)return;const o=lmsState.checkoutOrder;
 if(!o){root.innerHTML='<p class="panel-copy">No pending order. Start from the catalog or the billing page.</p><button class="filter-select" data-screen="catalog">Browse courses \u2192</button>';return;}
 root.innerHTML=`<div class="test-mode-banner" role="alert"><b>TEST MODE</b><span> No real money moves here \u2014 confirming simulates a successful payment. A real gateway is a future step.</span></div><section class="screen-panel"><h3>Order summary</h3>${staffTable(['Item','Amount'],[[`${safeText(o.kind==='plan'?'Subscription plan':'Course')}: ${safeText(o.refName||o.refId)}`,inr(o.amountCents)]])}<p class="panel-copy">Order <b>${safeText(o.id)}</b> \u00b7 ${safeText(o.status)}</p><div class="lms-actions"><button class="primary-btn" id="coConfirm">Confirm payment (test) \u2192</button><button class="filter-select" id="coCancel">Cancel order</button></div><p id="coStatus" class="panel-copy" role="status"></p></section>`;
 document.querySelector('#coConfirm').onclick=async()=>{const st=document.querySelector('#coStatus');st.textContent='Processing test payment\u2026';try{await apiRequest(`/checkout/${encodeURIComponent(o.id)}/confirm`,{method:'POST',body:'{}'});const kind=lmsState.checkoutKind,ref=lmsState.checkoutRef;lmsState.checkoutOrder=null;if(kind==='course'){lmsState.courseId=ref;navigate('course-detail');}else navigate('billing');}catch(err){st.textContent=err.message;}};
 document.querySelector('#coCancel').onclick=async()=>{try{await apiRequest(`/checkout/${encodeURIComponent(o.id)}/cancel`,{method:'POST',body:'{}'});}catch{}lmsState.checkoutOrder=null;navigate(lmsState.checkoutKind==='course'?'catalog':'billing');};
}
async function loadBilling(){
 const root=document.querySelector('#billingBody');if(!root)return;
 try{
  const [plansData,bill]=await Promise.all([apiRequest('/plans'),apiRequest('/billing').catch(()=>({subscription:null,orders:[]}))]);
  const plans=plansData.plans||plansData||[];const sub=bill.subscription;const orders=bill.orders||[];
  root.innerHTML=`<h3>Plans</h3><div class="lms-plans">${plans.filter(p=>p.active!==false).map(p=>{const current=sub&&String(sub.planId)===String(p.id)&&sub.status==='active';return `<article class="lms-plan-card${current?' current':''}"><h4>${safeText(p.name)}</h4><p class="lms-plan-price">${p.priceCents?inr(p.priceCents):'Free'}<small> ${safeText(p.interval||'')}</small></p><ul>${(p.features||[]).map(f=>`<li>${safeText(f)}</li>`).join('')}</ul>${current?'<span class="pill purple-pill">CURRENT PLAN</span>':p.priceCents?`<button class="primary-btn" data-lms-subscribe="${safeText(p.id)}">Subscribe \u2192</button>`:'<span class="panel-copy">Included with your account</span>'}</article>`;}).join('')||'<p class="panel-copy">No plans available.</p>'}</div>
  <h3>Subscription</h3>${sub?`<section class="screen-panel"><p><b>${safeText(sub.planName||'Plan')}</b> \u00b7 status <b>${safeText(sub.status)}</b>${sub.endsAt?` \u00b7 valid till ${safeText(new Date(sub.endsAt).toLocaleDateString())}`:''}</p>${sub.status==='active'?'<button class="filter-select" id="billCancel">Cancel subscription</button><p class="panel-copy"><small>Cancelling keeps your access until the end of the billing period.</small></p>':''}</section>`:'<p class="panel-copy">No active subscription.</p>'}
  <h3>Order history</h3>${staffTable(['Date','Item','Amount','Status'],orders.map(o=>`<tr><td>${safeText(new Date(o.createdAt).toLocaleString())}</td><td>${safeText(o.kind)}: ${safeText(o.refName||o.refId)}</td><td>${inr(o.amountCents)}</td><td>${safeText(o.status)}${o.testMode?' (test)':''}</td></tr>`),'No orders yet.')}`;
  const bc=document.querySelector('#billCancel');if(bc)bc.onclick=async()=>{if(!confirm('Cancel your subscription? It stays valid until the end of the billing period.'))return;try{await apiRequest('/billing/cancel',{method:'POST',body:'{}'});loadBilling();}catch(err){alert(err.message);}};
 }catch(err){root.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}

/* ---------- discussions ---------- */
async function loadDiscussions(){
 const root=document.querySelector('#discussBody');if(!root)return;
 if(lmsState.discussionId){await renderThread(root);return;}
 let courseId=lmsState.discussionCourseId;
 if(!courseId){try{const {enrollments}=await apiRequest('/my-enrollments');const cs=enrollments||[];if(!cs.length){root.innerHTML='<p class="panel-copy">Enroll in a course to join its forum.</p><button class="filter-select" data-screen="catalog">Browse courses \u2192</button>';return;}courseId=cs[0].courseId;lmsState.discussionCourseId=courseId;}catch(err){root.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;return;}}
 try{
  const course=await lmsCourseById(courseId).catch(()=>null);
  const {discussions}=await apiRequest(`/courses/${encodeURIComponent(courseId)}/discussions`);
  root.innerHTML=`<p class="eyebrow">${safeText(course?course.title:'Course forum')}</p><form id="newThread" class="lms-thread-form"><input name="title" placeholder="Start a discussion\u2026" maxlength="120" required aria-label="Thread title"><textarea name="body" placeholder="Write your question or idea\u2026" maxlength="5000" required aria-label="Thread body"></textarea><button class="primary-btn" type="submit">Post thread \u2192</button></form><div class="lms-threads">${(discussions||[]).map(d=>`<button class="lms-thread" data-lms-thread="${safeText(d.id)}">${d.pinned?'<span class="lms-pin">\ud83d\udccc</span>':''}<span><b>${safeText(d.title)}</b><small>by ${safeText(d.authorName)} \u00b7 ${safeText(new Date(d.createdAt).toLocaleString())} \u00b7 ${d.replyCount||0} replies</small></span></button>`).join('')||'<p class="panel-copy">No threads yet \u2014 start the first one.</p>'}</div>`;
  document.querySelector('#newThread').onsubmit=async e=>{e.preventDefault();const f=e.target;try{await apiRequest(`/courses/${encodeURIComponent(courseId)}/discussions`,{method:'POST',body:JSON.stringify({title:f.title.value,body:f.body.value})});loadDiscussions();}catch(err){alert(err.message);}};
 }catch(err){root.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
async function renderThread(root){
 const id=lmsState.discussionId;
 const back=()=>{lmsState.discussionId=null;loadDiscussions();};
 try{
  const {discussion,replies}=await apiRequest(`/discussions/${encodeURIComponent(id)}`);
  const me=currentUser||{};const canMod=me&&(me.role==='teacher'||me.role==='admin'||String(discussion.authorId)===String(me.id));
  root.innerHTML=`<button class="filter-select" id="threadBack">\u2190 All threads</button><article class="screen-panel"><p class="eyebrow">${discussion.pinned?'\ud83d\udccc PINNED \u00b7 ':''}THREAD</p><h2>${safeText(discussion.title)}</h2><p class="panel-copy">by ${safeText(discussion.authorName)} \u00b7 ${safeText(new Date(discussion.createdAt).toLocaleString())}</p><p>${safeText(discussion.body)}</p>${canMod?`<div class="lms-actions">${me.role!=='student'?`<button class="filter-select" id="threadPin">${discussion.pinned?'Unpin':'Pin thread'}</button>`:''}<button class="filter-select" id="threadDel">Delete thread</button></div>`:''}</article><div class="lms-replies">${(replies||[]).map(r=>`<div class="lms-reply"><div class="person-dot">${safeText((r.authorName||'?').trim().slice(0,2).toUpperCase())}</div><div><b>${safeText(r.authorName)}</b><small> \u00b7 ${safeText(new Date(r.createdAt).toLocaleString())}</small><p>${safeText(r.body)}</p></div></div>`).join('')||'<p class="panel-copy">No replies yet \u2014 be the first to help.</p>'}</div><form id="replyForm" class="lms-thread-form"><textarea name="body" placeholder="Write a reply\u2026" maxlength="5000" required aria-label="Reply"></textarea><button class="primary-btn" type="submit">Reply \u2192</button></form>`;
  document.querySelector('#threadBack').onclick=back;
  document.querySelector('#replyForm').onsubmit=async e=>{e.preventDefault();try{await apiRequest(`/discussions/${encodeURIComponent(id)}/replies`,{method:'POST',body:JSON.stringify({body:e.target.body.value})});renderThread(root);}catch(err){alert(err.message);}};
  const pin=document.querySelector('#threadPin');if(pin)pin.onclick=async()=>{try{await apiRequest(`/discussions/${encodeURIComponent(id)}/pin`,{method:'POST',body:'{}'});renderThread(root);}catch(err){alert(err.message);}};
  const del=document.querySelector('#threadDel');if(del)del.onclick=async()=>{if(!confirm('Delete this thread and all its replies?'))return;try{await apiRequest(`/discussions/${encodeURIComponent(id)}`,{method:'DELETE'});back();}catch(err){alert(err.message);}};
 }catch(err){root.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p><button class="filter-select" id="threadBack2">\u2190 All threads</button>`;document.querySelector('#threadBack2').onclick=back;}
}

/* ---------- live classes ---------- */
async function lcFetchAttendanceMap(list){
  const attMap={};
  await Promise.all((list||[]).map(async sess=>{
    try{const d=await apiRequest(`/teacher/live-sessions/${encodeURIComponent(sess.id)}/attendance`);
      const present=(d.present??d.attendance?.present??null),total=(d.total??d.attendance?.total??null);
      if(present!==null&&total!==null)attMap[sess.id]={present,total};
    }catch(e){/* endpoint not available yet — fall back to join count */}
  }));
  return attMap;
}
async function loadLiveClasses(){
 const root=document.querySelector('#liveBody');if(!root)return;
 const isTeacher=currentUser&&currentUser.role==='teacher';
 try{
  const {sessions}=await apiRequest('/live-sessions');const list=sessions||[];
  // Teachers see present/total attendance per session (new endpoint; falls back
  // to the join count when the endpoint is unavailable).
  const attMap=isTeacher?await lcFetchAttendanceMap(list):{};
  root.innerHTML=`${isTeacher?`<section class="screen-panel"><h3>Schedule a live class</h3><form id="liveForm" class="teacher-form"><label>Course<select name="courseId" id="liveCourse"><option value="">No specific course</option></select></label><input name="title" placeholder="Session title" maxlength="120" required aria-label="Session title"><textarea name="description" placeholder="What will you cover?" maxlength="1000" aria-label="Description"></textarea><label>Starts at<input name="startsAt" type="datetime-local" required></label><label>Duration (minutes)<input name="durationMin" type="number" min="15" max="480" value="60" required></label><label class="auth-check"><input name="useClassroom" type="checkbox" checked> Use EduVerse classroom (built-in video, whiteboard & chat)</label><input name="meetingUrl" placeholder="Meeting link (https://\u2026) — optional with classroom" maxlength="2000" aria-label="Meeting link"><button class="primary-btn" type="submit">Schedule session \u2192</button><p id="liveStatus" class="panel-copy" role="status"></p></form></section>`:''}<h3>Upcoming & live</h3><div class="lms-live-list">${list.length?list.map(s=>{const live=s.status==='live';return `<article class="lms-live-card${live?' is-live':''}"><div><p class="eyebrow">${live?'\u25cf LIVE NOW':safeText(new Date(s.startsAt).toLocaleString())}</p><h4>${safeText(s.title)}</h4><p class="panel-copy">${safeText(s.description||'')}</p><small>${s.durationMin} min${attMap[s.id]?` \u00b7 Attendance ${attMap[s.id].present}/${attMap[s.id].total}`:s.attendees&&s.attendees.length?` \u00b7 ${s.attendees.length} joined`:''}</small></div><button class="primary-btn" data-lms-join-live="${safeText(s.id)}">${s.useClassroom?'Join classroom \u2192':(live?'Join now \u2192':'Join')}</button></article>`;}).join(''):'<p class="panel-copy">No live classes scheduled yet.</p>'}</div>`;
  if(isTeacher){
   try{const cd=await apiRequest('/teacher/courses').catch(()=>({courses:[]}));const sel=document.querySelector('#liveCourse');if(sel)sel.innerHTML='<option value="">No specific course</option>'+(cd.courses||[]).map(c=>`<option value="${safeText(c.id)}">${safeText(c.title)}</option>`).join('');}catch{}
   document.querySelector('#liveForm').onsubmit=async e=>{e.preventDefault();const f=e.target,st=document.querySelector('#liveStatus');try{await apiRequest('/teacher/live-sessions',{method:'POST',body:JSON.stringify({courseId:f.courseId.value||undefined,title:f.title.value,description:f.description.value,startsAt:new Date(f.startsAt.value).toISOString(),durationMin:Number(f.durationMin.value),meetingUrl:f.meetingUrl.value.trim()||undefined,useClassroom:f.useClassroom.checked})});st.textContent='Live class scheduled.';f.reset();loadLiveClasses();}catch(err){st.textContent=err.message;}};
  }
 }catch(err){root.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
async function lmsJoinLive(id,btn){try{if(btn)btn.disabled=true;const d=await apiRequest(`/live-sessions/${encodeURIComponent(id)}/join`,{method:'POST',body:'{}'});
 // Prefer the built-in EduVerse classroom when the backend offers it; fall back to the external meeting URL.
 try{const c=await apiRequest(`/live-sessions/${encodeURIComponent(id)}/classroom`);if(c&&c.roomId&&c.wsUrl){lmsState.classroomSessionId=id;lmsState.classroomCreds=c;navigate('live-classroom');return;}}catch(e){/* classroom not enabled -> use meetingUrl */}
 if(d.meetingUrl)window.open(d.meetingUrl,'_blank','noopener');if(btn)btn.textContent='Joined \u2713';}catch(err){alert(err.message);if(btn)btn.disabled=false;}}

/* ---------- leaderboard ---------- */
async function loadLeaderboard(){
 const root=document.querySelector('#leaderBody');if(!root)return;
 try{const d=await apiRequest('/leaderboard');const rows=d.leaders||d||[];
  const myIdx=rows.findIndex(l=>currentUser&&l.name===currentUser.name);
  root.innerHTML=`${myIdx>=0?`<p class="panel-copy">Your rank: <b>#${myIdx+1}</b> \u00b7 ${Number(rows[myIdx].xp).toLocaleString('en-IN')} XP</p>`:'<p class="panel-copy">Earn XP by completing lessons, passing quizzes, and joining live classes.</p>'}`+staffTable(['Rank','Learner','Level','XP'],rows.map((l,i)=>`<tr${i===myIdx?' class="lms-me"':''}><td>${i+1}</td><td>${safeText(l.name)}</td><td>${l.level}</td><td>${Number(l.xp).toLocaleString('en-IN')}</td></tr>`),'No learners on the board yet.');
 }catch(err){root.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}

/* ---------- student dashboard widgets ---------- */
/* Overview welcome: real date + name on every visit (navigate() restores the
   dashboard from a snapshot, so one-time login overwrites don't survive).
   The streak and learning-twin panels are personal to students; for other
   roles they are hidden instead of showing demo numbers. */
function renderOverviewWelcome(){
 const eyebrow=document.querySelector('.welcome .eyebrow');
 if(eyebrow)eyebrow.innerHTML='<span class="sun">✳</span> '+new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}).toUpperCase();
 if(currentUser){const name=document.querySelector('.welcome h1');if(name)name.innerHTML=`A little progress adds up,<br><span>${safeText(currentUser.name.split(/\s+/)[0])}.</span>`;}
 if(!currentUser||currentUser.role!=='student'){
   const streak=document.querySelector('.welcome .streak');if(streak)streak.hidden=true;
   const twin=document.querySelector('#learning-twin');if(twin)twin.hidden=true;
 }
}
async function loadOverviewLms(){
 const strip=document.querySelector('#lmsDashStrip');if(!strip||!currentUser||currentUser.role!=='student')return;
 strip.hidden=false;
 loadSoonBanner('lmsSoonBanner');
 try{const g=await apiRequest('/gamification');const pct=Math.min(100,Math.round(Number(g.xp||0)/Math.max(1,Number(g.nextLevelXp)||1)*100));
  document.querySelector('#lmsXp').innerHTML=`<div class="lms-xp-top"><span class="lms-level">Lv ${g.level||1}</span><b>${Number(g.xp||0).toLocaleString('en-IN')} XP</b></div><div class="progress-track"><i style="width:${pct}%"></i></div><small>${g.streakDays||0} day streak${g.nextLevelXp?` \u00b7 ${Math.max(0,g.nextLevelXp-g.xp)} XP to next level`:''} \u00b7 ${(g.badges||[]).length} badges</small>`;
  const streakEl=document.querySelector('.welcome .streak');
  if(streakEl){const d=Math.min(7,Number(g.streakDays)||0);const b=streakEl.querySelector('b');if(b)b.textContent=`${g.streakDays||0} day streak`;streakEl.querySelectorAll('.streak-dots i').forEach((dot,i)=>dot.classList.toggle('done',i<d));}
 }catch{const _xp=document.querySelector('#lmsXp');if(_xp)_xp.innerHTML='<p class="panel-copy">Gamification unavailable.</p>';}
 try{const progress=await apiRequest('/progress');const list=document.querySelector('#overviewConceptList');
  if(list){const concepts=progress.concepts||{};const labels={'sorted-arrays':'Sorted arrays','search-boundaries':'Search boundaries','time-complexity':'Time complexity'};const icons={'sorted-arrays':['green-icon','✓',''],'search-boundaries':['amber-icon','↗','amber-bar'],'time-complexity':['blue-icon','◌','blue-bar']};const keys=Object.keys(labels).filter(k=>concepts[k]);const evidence=keys.reduce((n,k)=>n+Number(concepts[k].evidenceCount||0),0);
   list.innerHTML=(!keys.length||evidence===0)?'<p class="panel-copy">Complete practice to see your skill map.</p>':keys.map(k=>{const c=concepts[k],pct=Math.max(0,Math.min(100,Number(c.mastery)||0)),checks=Number(c.evidenceCount||0);return `<div class="concept"><div class="concept-icon ${icons[k][0]}">${icons[k][1]}</div><div class="concept-text"><b>${labels[k]}</b><small>Evidence from ${checks} practice check${checks===1?'':'s'}</small></div><div class="mastery"><span class="${icons[k][2]}" style="width:${pct}%"></span></div><strong>${pct}%</strong></div>`;}).join('');}
 }catch{}
 try{const {enrollments}=await apiRequest('/my-enrollments');const items=[];
  for(const e of (enrollments||[]).slice(0,4)){try{const d=await apiRequest(`/video/progress?courseId=${encodeURIComponent(e.courseId)}`);const prog=d.progress||d||{};const course=e.course||await lmsCourseById(e.courseId).catch(()=>null);if(!course)continue;lmsLessons(course).forEach(l=>{const p=prog[l.id];if(p&&(Number(p.positionSec)>0||Number(p.watchedSec)>0)&&!p.completed)items.push({course,lesson:l,p});});}catch{}}
  document.querySelector('#lmsContinue').innerHTML=items.length?items.slice(0,3).map(it=>`<button class="lms-resume-row" data-lms-play data-course="${safeText(it.course.id)}" data-lesson="${safeText(it.lesson.id)}"><span class="lms-resume-play">\u25b6</span><span><b>${safeText(it.lesson.title)}</b><small>${fmtDur(it.p.positionSec)} watched</small></span></button>`).join(''):'<p class="panel-copy">Nothing in progress.</p><button class="filter-select" data-screen="catalog">Browse courses \u2192</button>';
 }catch{}
 try{const {sessions}=await apiRequest('/live-sessions');const up=(sessions||[]).filter(s=>s.status!=='ended').slice(0,2);
  document.querySelector('#lmsLive').innerHTML=up.length?up.map(s=>`<div class="lms-mini-row"><div><b>${safeText(s.title)}</b><small>${safeText(new Date(s.startsAt).toLocaleString())}</small></div><button class="filter-select" data-screen="live-classes">View \u2192</button></div>`).join(''):'<p class="panel-copy">No upcoming live classes.</p>';
 }catch{}
 try{const {certificates}=await apiRequest('/certificates');
  document.querySelector('#lmsCerts').innerHTML=`<p class="lms-big-num">${(certificates||[]).length}</p><button class="filter-select" data-screen="certificates">View certificates \u2192</button>`;
 }catch{}
}

/* ---------- admin: plans & orders ---------- */
async function loadAdminPlans(){
 const root=document.querySelector('#staffPageBody');if(!root)return;
 try{const d=await apiRequest('/plans');const plans=d.plans||d||[];
 root.innerHTML=`<h3>Subscription plans</h3>${staffTable(['Plan','Price','Interval','Status','Actions'],plans.map(p=>`<tr><td>${safeText(p.name)}</td><td>${p.priceCents?inr(p.priceCents):'Free'}</td><td>${safeText(p.interval||'')}</td><td>${p.active===false?'Disabled':'Active'}</td><td><button data-plan-toggle="${safeText(p.id)}" data-active="${p.active===false?0:1}">${p.active===false?'Enable':'Disable'}</button> <button data-plan-del="${safeText(p.id)}">Delete</button></td></tr>`),'No plans yet.')}
 <h3>Create plan</h3><form id="planForm" class="teacher-form"><input name="name" placeholder="Plan name" maxlength="80" required aria-label="Plan name"><label>Price (\u20b9)<input name="price" type="number" min="0" step="1" value="0" required></label><label>Interval<select name="interval"><option value="one-time">One-time</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label><textarea name="features" placeholder="Features, one per line" aria-label="Features"></textarea><button class="primary-btn" type="submit">Create plan \u2192</button><p id="planStatus" class="panel-copy" role="status"></p></form>`;
 document.querySelector('#planForm').onsubmit=async e=>{e.preventDefault();const f=e.target,st=document.querySelector('#planStatus');try{await apiRequest('/admin/plans',{method:'POST',body:JSON.stringify({name:f.name.value.trim(),priceCents:Math.max(0,Math.round(Number(f.price.value)*100)),currency:'INR',interval:f.interval.value,features:f.features.value.split('\n').map(s=>s.trim()).filter(Boolean),active:true})});loadAdminPlans();}catch(err){st.textContent=err.message;}};
 }catch(err){root.innerHTML=`<p class="staff-empty">${safeText(err.message)}</p>`;}
}
async function lmsPlanToggle(id,active){try{await apiRequest(`/admin/plans/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({active:!active})});loadAdminPlans();}catch(err){alert(err.message);}}
async function lmsPlanDelete(id){try{await apiRequest(`/admin/plans/${encodeURIComponent(id)}`,{method:'DELETE'});loadAdminPlans();}catch(err){alert(err.message);}}
async function loadAdminOrders(){
 const root=document.querySelector('#staffPageBody');if(!root)return;
 try{const [{orders},subs]=await Promise.all([apiRequest('/admin/orders'),apiRequest('/admin/subscriptions').catch(()=>({subscriptions:[]}))]);
 const subList=subs.subscriptions||subs||[];
 root.innerHTML=`<h3>Orders</h3>${staffTable(['Date','User','Kind','Amount','Status'],(orders||[]).map(o=>`<tr><td>${safeText(new Date(o.createdAt).toLocaleString())}</td><td>${safeText(o.userName||o.userId)}</td><td>${safeText(o.kind)}: ${safeText(o.refName||o.refId)}</td><td>${inr(o.amountCents)}</td><td>${safeText(o.status)}${o.testMode?' (test)':''}</td></tr>`),'No orders yet.')}
 <h3>Subscriptions</h3>${staffTable(['User','Plan','Status','Valid till'],subList.map(s=>`<tr><td>${safeText(s.userName||s.userId)}</td><td>${safeText(s.planName||s.planId)}</td><td>${safeText(s.status)}</td><td>${s.endsAt?safeText(new Date(s.endsAt).toLocaleDateString()):'\u2014'}</td></tr>`),'No subscriptions yet.')}`;
 }catch(err){root.innerHTML=`<p class="staff-empty">${safeText(err.message)}</p>`;}
}

document.addEventListener('input',e=>{
 const rq=e.target.closest('[data-rubric-q]');
 if(rq){const form=rq.closest('form');let tot=0;form.querySelectorAll('[data-rubric-q]').forEach(x=>{tot+=Math.max(0,Math.min(Number(x.dataset.rubricMax),Number(x.value)||0));});const t=form.querySelector('[data-rubric-total]');if(t)t.textContent=tot;}
 const w=e.target.closest('[data-essay-q]');if(w){const c=document.querySelector(`[data-wordcount="${CSS.escape(w.dataset.essayQ)}"]`);if(c){const n=w.value.trim()?w.value.trim().split(/\s+/).length:0;c.textContent=n;const max=Number(w.dataset.maxwords)||0;c.style.color=max&&n>max?'#d33f3f':'';}}
});
/* ---------- LMS event delegation ---------- */
document.addEventListener('click',async e=>{
 const buy=e.target.closest('[data-buy-course]');if(buy){e.preventDefault();startCheckout('course',buy.dataset.buyCourse);return;}
 const lc=e.target.closest('[data-lms-course]');if(lc){lmsState.courseId=lc.dataset.lmsCourse;lmsState.discussionCourseId=lc.dataset.lmsCourse;lmsState.discussionId=null;navigate('course-detail');return;}
 const lp=e.target.closest('[data-lms-play]');if(lp&&!lp.disabled){lmsState.courseId=lp.dataset.course;lmsState.lessonId=lp.dataset.lesson;navigate('video-player');window.scrollTo({top:0});return;}
 const sk=e.target.closest('[data-seek]');if(sk){lmsSeekTo(Number(sk.dataset.seek)||0);return;}
 const qs=e.target.closest('[data-lms-quiz]');if(qs){lmsState.quizId=qs.dataset.lmsQuiz;navigate('quiz-take');window.scrollTo({top:0});return;}
 const sub=e.target.closest('[data-lms-subscribe]');if(sub){startCheckout('plan',sub.dataset.lmsSubscribe);return;}
 const th=e.target.closest('[data-lms-thread]');if(th){lmsState.discussionId=th.dataset.lmsThread;navigate('discussions');window.scrollTo({top:0});return;}
 const jl=e.target.closest('[data-lms-join-live]');if(jl){lmsJoinLive(jl.dataset.lmsJoinLive,jl);return;}
 const pc=e.target.closest('[data-lms-print-cert]');if(pc){lmsPrintCert(pc.dataset.lmsPrintCert);return;}
 const tab=e.target.closest('[data-lms-tab]');if(tab){document.querySelectorAll('.lms-tab').forEach(t=>{t.classList.toggle('active',t===tab);t.setAttribute('aria-selected',String(t===tab));});['lessons','quizzes','forum'].forEach(k=>{const s=document.querySelector('#lmsTab-'+k);if(s)s.hidden=k!==tab.dataset.lmsTab;});return;}
 const pt=e.target.closest('[data-plan-toggle]');if(pt){e.preventDefault();lmsPlanToggle(pt.dataset.planToggle,pt.dataset.active==='1');return;}
 const pd=e.target.closest('[data-plan-del]');if(pd){e.preventDefault();if(confirm('Delete this plan? Existing subscriptions are unaffected.'))lmsPlanDelete(pd.dataset.planDel);return;}
 const tqrm=e.target.closest('[data-tq-rm]');if(tqrm){lmsState.quizDraft.questions.splice(Number(tqrm.dataset.tqRm),1);renderTqQuestions();return;}
 const tqbq=e.target.closest('[data-tq-bankq]');if(tqbq){tqSaveQuestionToBank(Number(tqbq.dataset.tqBankq));return;}
 const bed=e.target.closest('[data-bank-edit]');if(bed){bkEditQuestion(bed.dataset.bankEdit);return;}
 const bdel=e.target.closest('[data-bank-del]');if(bdel){if(confirm('Delete this bank question?')){try{await apiRequest(`/teacher/question-bank/${encodeURIComponent(bdel.dataset.bankDel)}`,{method:'DELETE'});bkRefresh();}catch(err){alert(err.message);}}return;}
 const tq=e.target.closest('[data-tq]');if(tq){if(tq.hasAttribute('data-tq-rm')){lmsState.quizDraft.questions.splice(Number(tq.dataset.tqRm),1);renderTqQuestions();return;}lmsTeacherQuizAction(tq);return;}
 const gs=e.target.closest('[data-grade-save]');if(gs){lmsSaveGrades(gs.dataset.gradeSave);return;}
 const gd=e.target.closest('[data-grade-del]');if(gd){if(confirm('Delete this attempt?')){try{await apiRequest(`/teacher/quiz-attempts/${encodeURIComponent(gd.dataset.gradeDel)}`,{method:'DELETE'});const box=document.querySelector('#tqAttempts');if(box)box.innerHTML='<p class="panel-copy">Attempt deleted. Reopen Attempts to refresh.</p>';}catch(err){alert(err.message);}}return;}
});

/* ---------- LMS navigate wiring ---------- */
const lmsPrevNavigate=navigate;
navigate=function(name,options){lmsStopVideo();lmsStopQuizTimer();lmsPrevNavigate(name,options);
 if(name==='video-player')loadVideoPlayer();
 else if(name==='course-detail')loadCourseDetail();
 else if(name==='quizzes')loadQuizzes();
 else if(name==='quiz-take')loadQuizTake();
 else if(name==='certificates')loadCertificates();
 else if(name==='billing')loadBilling();
 else if(name==='checkout')loadCheckout();
 else if(name==='discussions')loadDiscussions();
 else if(name==='live-classes')loadLiveClasses();
 else if(name==='live-classroom')loadLiveClassroom();
 else if(name==='leaderboard')loadLeaderboard();
 else if(name==='overview'){renderOverviewWelcome();if(currentUser&&currentUser.role==='student')loadOverviewLms();}
};

/* ---------- teacher: edit lesson video URL (PATCH lesson route) ---------- */
function fillLessonVideoModules(courseId){
 const sel=document.querySelector('#staffLessonVideoModule');if(!sel)return;
 const course=(teacherCourseCache||[]).find(c=>c.id===courseId);const mods=course?.modules||[];
 sel.innerHTML=mods.map(m=>`<option value="${safeText(m.id)}">${safeText(m.name||'')}</option>`).join('')||'<option value="">Add a module first</option>';
 fillLessonVideoLessons(courseId,sel.value);
}
function fillLessonVideoLessons(courseId,moduleId){
 const sel=document.querySelector('#staffLessonVideoLesson');if(!sel)return;
 const course=(teacherCourseCache||[]).find(c=>c.id===courseId);
 const mod=(course?.modules||[]).find(m=>m.id===moduleId);const lessons=mod?.lessons||[];
 sel.innerHTML=lessons.map(l=>`<option value="${safeText(l.id)}">${safeText(l.title)}${l.videoUrl?' \u00b7 has video':''}</option>`).join('')||'<option value="">Add a lesson first</option>';
 const cur=lessons.find(l=>l.id===sel.value);
 const inp=document.querySelector('#staffLessonVideoForm input[name="videoUrl"]');if(inp)inp.value=cur?.videoUrl||'';
}
document.addEventListener('change',e=>{
 if(e.target.id==='staffLessonVideoCourse')fillLessonVideoModules(e.target.value);
 else if(e.target.id==='staffLessonVideoModule')fillLessonVideoLessons(document.querySelector('#staffLessonVideoCourse')?.value,e.target.value);
 else if(e.target.id==='staffLessonVideoLesson'){const course=(teacherCourseCache||[]).find(c=>c.id===document.querySelector('#staffLessonVideoCourse')?.value);const mod=(course?.modules||[]).find(m=>m.id===document.querySelector('#staffLessonVideoModule')?.value);const l=(mod?.lessons||[]).find(x=>x.id===e.target.value);const inp=document.querySelector('#staffLessonVideoForm input[name="videoUrl"]');if(inp)inp.value=l?.videoUrl||'';}
});
document.addEventListener('submit',async e=>{
 if(e.target.id!=='staffLessonVideoForm')return;
 e.preventDefault();const f=e.target,st=document.querySelector('#staffLessonVideoStatus');
 if(!f.lessonId.value){st.textContent='Choose a lesson first.';return;}
 try{
  await apiRequest(`/teacher/courses/${encodeURIComponent(f.courseId.value)}/modules/${encodeURIComponent(f.moduleId.value)}/lessons/${encodeURIComponent(f.lessonId.value)}`,{method:'PATCH',body:JSON.stringify({videoUrl:f.videoUrl.value.trim()})});
  const course=(teacherCourseCache||[]).find(c=>c.id===f.courseId.value);const mod=(course?.modules||[]).find(m=>m.id===f.moduleId.value);const lx=(mod?.lessons||[]).find(x=>x.id===f.lessonId.value);if(lx)lx.videoUrl=f.videoUrl.value.trim();
  st.textContent='Video URL saved.';
  fillLessonVideoLessons(f.courseId.value,f.moduleId.value);
 }catch(err){st.textContent=err.message;}
});
/* ================= live classroom (WebRTC P2P mesh + WS signaling) ================= */
const lc = {
  ws:null, pcs:new Map(), peers:new Map(),
  localStream:null, screenStream:null, sharing:false,
  micOn:true, camOn:true, handRaised:false,
  roomId:null, mainRoomId:null, sessionId:null, creds:null, sessionTitle:'',
  isTeacher:false, myName:'', connected:false,
  recorder:null, recChunks:[],
  polls:new Map(), qas:[],
  startedAt:null, summaryPosted:false,
  chatCounts:new Map(), handCounts:new Map(), pollVoteCounts:new Map(),
  participants:new Map(), userIdByName:new Map(),
  slides:[], slideIndex:-1, presenting:false,
  boardColor:'#7257d9', boardSize:4, annotating:false, drawing:false, curStroke:null,
  breakouts:null, heartbeat:null, attendTimer:null, retryTimer:null,
  agoraMode:false, agoraClient:null, agoraUid:null,
  agoraAudioTrack:null, agoraVideoTrack:null, agoraScreenTrack:null,
  agoraRemotes:new Map(),
};
function lcReset(){
  lc.ws=null; lc.pcs=new Map(); lc.peers=new Map();
  lc.sharing=false; lc.handRaised=false;
  lc.recorder=null; lc.recChunks=[];
  lc.polls=new Map(); lc.qas=[];
  lc.startedAt=null;
  lc.chatCounts=new Map(); lc.handCounts=new Map(); lc.pollVoteCounts=new Map();
  lc.participants=new Map(); lc.userIdByName=new Map();
  lc.slides=[]; lc.slideIndex=-1; lc.presenting=false;
  lc.breakouts=null; lc.connected=false;
  lc.agoraMode=false; lc.agoraClient=null; lc.agoraUid=null;
  lc.agoraAudioTrack=null; lc.agoraVideoTrack=null; lc.agoraScreenTrack=null;
  lc.agoraRemotes=new Map();
}
function lcStatus(msg){ const el=document.querySelector('#lcSub'); if(el) el.textContent=msg; }
function lcSend(type,data){
  if(!lc.ws||lc.ws.readyState!==1) return false;
  lc.ws.send(JSON.stringify(Object.assign({type},data||{})));
  return true;
}
function lcWsUrl(raw){
  if(!raw) return '';
  if(/^wss?:\/\//i.test(raw)) return raw;
  const proto=location.protocol==='https:'?'wss':'ws';
  return proto+'://'+location.host+(raw.startsWith('/')?raw:'/'+raw);
}
function lcTokenParam(){
  try{
    const m=document.cookie.match(/(?:^|;\s*)eduverse_session=([^;]*)/);
    if(m&&m[1]) return '?token='+encodeURIComponent(decodeURIComponent(m[1]));
  }catch(e){}
  return '';
}

/* ---------- entry ---------- */
async function loadLiveClassroom(){
  const creds=lmsState.classroomCreds, sid=lmsState.classroomSessionId;
  const root=document.querySelector('#lcRoot');
  if(!root) return;
  if(!creds||!creds.roomId||!creds.wsUrl||!sid){
    root.innerHTML='<p class="panel-copy">Classroom credentials are missing. Please rejoin from the live class list.</p><button class="filter-select" data-screen="live-classes">\u2190 Back to live classes</button>';
    return;
  }
  lcReset();
  lc.summaryPosted=false;
  lc.creds=creds; lc.sessionId=sid; lc.roomId=creds.roomId; lc.mainRoomId=creds.roomId;
  lc.isTeacher=currentUser&&(currentUser.role==='teacher'||currentUser.role==='admin');
  lc.myName=(currentUser&&currentUser.name)||'Guest';
  lc.startedAt=new Date().toISOString();
  lcNoteParticipant('me',lc.myName);
  try{
    const s=await apiRequest('/live-sessions');
    const sess=(s.sessions||[]).find(x=>String(x.id)===String(sid));
    if(sess) lc.sessionTitle=sess.title||'';
  }catch(e){}
  document.querySelector('#lcTitle').textContent=lc.sessionTitle||'Live classroom';
  root.innerHTML=`
  <div class="lc-layout">
   <section class="screen-panel lc-main">
    <div id="lcRoomBanner" class="lc-room-banner" hidden></div>
    <div id="lcGrid" class="lc-grid" aria-label="Video grid"></div>
    <div class="lc-controls" role="toolbar" aria-label="Classroom controls">
      <button id="lcMic" class="filter-select lc-ctrl" aria-pressed="true" title="Mute/unmute microphone">\u{1F3A4} Mic on</button>
      <button id="lcCam" class="filter-select lc-ctrl" aria-pressed="true" title="Turn camera on/off">\u{1F4F7} Camera on</button>
      <button id="lcShare" class="filter-select lc-ctrl" aria-pressed="false" title="Share your screen">\u{1F5A5} Share</button>
      <button id="lcHand" class="filter-select lc-ctrl" aria-pressed="false" title="Raise/lower hand">\u270B Raise hand</button>
      <button id="lcBoardBtn" class="filter-select lc-ctrl" aria-pressed="false" title="Show shared whiteboard">\u270E Whiteboard</button>
      <button id="lcPresentBtn" class="filter-select lc-ctrl" aria-pressed="false" title="Present slides" ${lc.isTeacher?'':'hidden'}>\u{1F4CA} Present</button>
      <button id="lcRecordBtn" class="filter-select lc-ctrl" aria-pressed="false" title="Record on this device" ${lc.isTeacher?'':'hidden'}>\u23FA Record</button>
      <button id="lcLeave" class="filter-select lc-ctrl lc-danger" title="Leave the classroom">Leave</button>
    </div>
    <p class="panel-copy lc-privacy"><small>Video/audio goes directly between participants (P2P). The server only relays connection setup. Best with up to ~6 people \u2014 larger classes need a media server.</small></p>
    <div id="lcSlideWrap" class="lc-slide-wrap" hidden></div>
    <div id="lcBoardWrap" class="lc-board-wrap" hidden>
      <div class="lc-board-head"><b>Shared whiteboard</b>
        <label>Color <input id="lcBoardColor" type="color" value="#7257d9" aria-label="Pen color"></label>
        <label>Size <input id="lcBoardSize" type="range" min="2" max="16" value="4" aria-label="Pen size"></label>
        <button id="lcAnnotate" class="filter-select" aria-pressed="false" title="Draw over the video grid" ${lc.isTeacher?'':'hidden'}>Annotate video</button>
        <button id="lcBoardClear" class="filter-select" title="Clear the board for everyone" ${lc.isTeacher?'':'hidden'}>Clear</button>
      </div>
      <canvas id="lcBoardCanvas" width="960" height="540" aria-label="Shared whiteboard"></canvas>
      <p class="panel-copy"><small>Strokes are shared live with everyone in the room.</small></p>
    </div>
    <div id="lcPresentPanel" class="lc-present-panel" hidden>
      <div class="lc-board-head"><b>Present slides</b>
        <button id="lcSlidePrev" class="filter-select">\u2190 Prev</button>
        <span id="lcSlidePos" class="panel-copy"></span>
        <button id="lcSlideNext" class="filter-select">Next \u2192</button>
        <button id="lcSlideDone" class="filter-select">Stop presenting</button>
      </div>
      <div id="lcSlideEditor" class="lc-slide-editor">
        <input id="lcSlideTitle" class="search-field" placeholder="Slide title" maxlength="120" aria-label="Slide title">
        <textarea id="lcSlideBullets" class="search-field" placeholder="Bullet points, one per line" rows="3" aria-label="Bullet points"></textarea>
        <button id="lcSlideAdd" class="filter-select">+ Add slide</button>
        <div id="lcSlideList" class="lc-slide-list"></div>
      </div>
    </div>
   </section>
   <aside class="screen-panel lc-side">
    <div class="lms-tabs" role="tablist" aria-label="Classroom panels">
      <button class="lms-tab active" data-lc-tab="chat" role="tab" aria-selected="true">Chat</button>
      <button class="lms-tab" data-lc-tab="qa" role="tab" aria-selected="false">Q&amp;A</button>
      <button class="lms-tab" data-lc-tab="polls" role="tab" aria-selected="false">Polls</button>
      <button class="lms-tab" data-lc-tab="people" role="tab" aria-selected="false">People <span id="lcPeopleCount"></span></button>
    </div>
    <div id="lcTab-chat" role="tabpanel"><div id="lcChatList" class="lc-chat-list" aria-live="polite"></div><form id="lcChatForm" class="lc-chat-form"><input id="lcChatInput" class="search-field" placeholder="Message the room\u2026" maxlength="500" aria-label="Chat message" autocomplete="off"><button class="primary-btn" type="submit">Send</button></form></div>
    <div id="lcTab-qa" role="tabpanel" hidden><div id="lcQaList" class="lc-qa-list"></div><form id="lcQaForm" class="lc-chat-form"><input id="lcQaInput" class="search-field" placeholder="Ask a question\u2026" maxlength="500" aria-label="Ask a question" autocomplete="off"><button class="primary-btn" type="submit">Ask</button></form></div>
    <div id="lcTab-polls" role="tabpanel" hidden><div id="lcPollBox"></div>${lc.isTeacher?'<form id="lcPollForm" class="lc-poll-form"><b>New poll</b><input id="lcPollQ" class="search-field" placeholder="Poll question" maxlength="200" aria-label="Poll question"><textarea id="lcPollOpts" class="search-field" placeholder="Options, one per line" rows="3" aria-label="Poll options"></textarea><button class="primary-btn" type="submit">Start poll \u2192</button></form>':''}</div>
    <div id="lcTab-people" role="tabpanel" hidden><div id="lcPeopleList" class="lc-people-list"></div><div id="lcTeacherTools"></div></div>
   </aside>
  </div>`;
  lcWireShell();
  lcRenderTabs();
  // Provider-aware video: Agora when the institution configured it, otherwise the
  // built-in WebRTC mesh. Any Agora failure falls back to WebRTC with a notice.
  let agoraReady=false;
  const provider=await lcGetVideoProvider();
  if(provider.provider==='agora'){
    if(!provider.agoraConfigured){
      lcStatus('Agora video is selected but not configured — ask your administrator to set AGORA_APP_ID. Using built-in video.');
    }else{
      agoraReady=await lcStartAgora();
    }
  }
  if(agoraReady){
    lcConnectWs(); // ws stays for chat, Q&A, polls, whiteboard & slides
  }else{
    lcConnect();
  }
  window.addEventListener('beforeunload', lcBeforeUnload);
}

/* ---------- shell wiring ---------- */
function lcWireShell(){
  document.querySelectorAll('[data-lc-tab]').forEach(b=>{b.onclick=()=>lcSwitchTab(b.dataset.lcTab);});
  document.querySelector('#lcChatForm').onsubmit=e=>{e.preventDefault();const i=document.querySelector('#lcChatInput');const t=i.value.trim();if(!t)return;if(lcSend('chat',{text:t.slice(0,500)}))i.value='';};
  document.querySelector('#lcQaForm').onsubmit=e=>{e.preventDefault();const i=document.querySelector('#lcQaInput');const t=i.value.trim();if(!t)return;const qaId=(crypto.randomUUID?crypto.randomUUID():'q'+Date.now());if(lcSend('qa-ask',{qaId,text:t.slice(0,500)})){lc.qas.push({qaId,from:'me',name:lc.myName,text:t.slice(0,500),answer:null});lcRenderQA();i.value='';}};
  const pf=document.querySelector('#lcPollForm');if(pf)pf.onsubmit=e=>{e.preventDefault();lcStartPoll();};
  document.querySelector('#lcMic').onclick=()=>lcToggleMic();
  document.querySelector('#lcCam').onclick=()=>lcToggleCam();
  document.querySelector('#lcShare').onclick=()=>lcToggleShare();
  document.querySelector('#lcHand').onclick=()=>lcToggleHand();
  document.querySelector('#lcBoardBtn').onclick=()=>lcToggleBoard();
  document.querySelector('#lcLeave').onclick=()=>lcLeave();
  const pb=document.querySelector('#lcPresentBtn');if(pb)pb.onclick=()=>lcTogglePresentPanel();
  const rb=document.querySelector('#lcRecordBtn');if(rb)rb.onclick=()=>lcToggleRecord();
  const ab=document.querySelector('#lcAnnotate');if(ab)ab.onclick=()=>lcToggleAnnotate();
  const cb=document.querySelector('#lcBoardClear');if(cb)cb.onclick=()=>{lcClearBoard(true);};
  const cc=document.querySelector('#lcBoardColor');if(cc)cc.oninput=()=>{lc.boardColor=cc.value;};
  const cs=document.querySelector('#lcBoardSize');if(cs)cs.oninput=()=>{lc.boardSize=Number(cs.value)||4;};
  const sa=document.querySelector('#lcSlideAdd');if(sa)sa.onclick=()=>lcAddSlide();
  const sp=document.querySelector('#lcSlidePrev');if(sp)sp.onclick=()=>lcShowSlide(lc.slideIndex-1);
  const sn=document.querySelector('#lcSlideNext');if(sn)sn.onclick=()=>lcShowSlide(lc.slideIndex+1);
  const sd=document.querySelector('#lcSlideDone');if(sd)sd.onclick=()=>lcStopPresenting();
  lcWireBoard();
  if(lc.isTeacher){lcRenderTeacherTools();lcLoadAttendance();lc.attendTimer=setInterval(()=>{if(lc.connected)lcLoadAttendance();},20000);}
}
function lcSwitchTab(name){
  document.querySelectorAll('[data-lc-tab]').forEach(b=>{const on=b.dataset.lcTab===name;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));});
  ['chat','qa','polls','people'].forEach(t=>{const el=document.querySelector('#lcTab-'+t);if(el)el.hidden=t!==name;});
}
function lcRenderTabs(){lcRenderPeople();lcRenderPolls();lcRenderQA();}
function lcBeforeUnload(){try{if(lc.ws&&lc.ws.readyState===1)lc.ws.send(JSON.stringify({type:'bye'}));}catch(e){}try{if(lc.isTeacher)lcPostSessionSummary();}catch(e){}}

/* ---------- connection ---------- */
async function lcConnect(){
  lcStatus('Starting camera & microphone\u2026');
  try{
    lc.localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:{width:{ideal:640},height:{ideal:360}}});
  }catch(err){
    lcStatus('Camera/mic unavailable ('+(err.name||'error')+'). You can still watch, chat and use the whiteboard.');
    lc.localStream=null;
  }
  lcAddLocalTile();
  lcConnectWs();
}
function lcConnectWs(){
  const url=lcWsUrl(lc.creds.wsUrl)+lcTokenParam();
  lcStatus('Connecting to classroom\u2026');
  try{lc.ws=new WebSocket(url);}catch(err){lcStatus('Could not open the classroom connection.');return;}
  lc.ws.onopen=()=>{
    lc.connected=true;lcStatus(lc.sessionTitle?('Connected \u00b7 '+lc.sessionTitle):'Connected.');
    lcSend('hello',{roomId:lc.roomId,name:lc.myName,role:(currentUser&&currentUser.role)||'student'});
    lcRenderRoomBanner();
  };
  lc.ws.onmessage=e=>{let m;try{m=JSON.parse(e.data);}catch(err){return;}lcOnMessage(m);};
  lc.ws.onclose=()=>{lc.connected=false;if(document.querySelector('#lcRoot'))lcStatus('Disconnected. If the class ended, rejoin from Live classes.');};
  lc.ws.onerror=()=>{lcStatus('Connection error. Check your network, then rejoin from Live classes.');};
  if(lc.heartbeat)clearInterval(lc.heartbeat);
  lc.heartbeat=setInterval(()=>{if(lc.ws&&lc.ws.readyState===1)lcSend('ping',{});},25000);
}
function lcRenderRoomBanner(){
  const b=document.querySelector('#lcRoomBanner');if(!b)return;
  if(lc.roomId&&lc.roomId!==lc.mainRoomId){
    const n=lc.roomId.split(':b')[1]||'';
    b.hidden=false;
    b.innerHTML=`<span>You are in <b>Breakout room ${safeText(n)}</b>.</span> <button class="filter-select" id="lcBackMain">Return to main room</button>`;
    document.querySelector('#lcBackMain').onclick=()=>lcMoveToRoom(lc.mainRoomId);
  }else{b.hidden=true;b.innerHTML='';}
}

/* ---------- signaling message router ---------- */
function lcOnMessage(m){
  if(!m||!m.type)return;
  // Agora mode: video runs through the Agora SDK; the ws link stays for chat, Q&A,
  // polls, whiteboard and slides only — never start WebRTC peer connections.
  if(lc.agoraMode&&['peers','peer-joined','peer-left','signal'].includes(m.type))return;
  switch(m.type){
    case 'peers': (m.peers||[]).forEach(p=>{if(p.clientId)lcCallPeer(p);}); break;
    case 'peer-joined': if(m.clientId)lcCallPeer({clientId:m.clientId,name:m.name,role:m.role}); break;
    case 'peer-left': if(m.clientId)lcRemovePeer(m.clientId); break;
    case 'signal': lcOnSignal(m); break;
    case 'chat': lcAddChat(m); break;
    case 'hand': lcOnHand(m); break;
    case 'poll-start': lcOnPollStart(m); break;
    case 'poll-vote': lcOnPollVote(m); break;
    case 'poll-end': lcOnPollEnd(m); break;
    case 'qa-ask': lcOnQaAsk(m); break;
    case 'qa-answer': lcOnQaAnswer(m); break;
    case 'whiteboard': lcOnBoardStroke(m); break;
    case 'whiteboard-clear': lcClearBoard(false); break;
    case 'slide': lcOnSlide(m); break;
    case 'breakout': if(m.room)lcMoveToRoom(m.room); break;
    case 'moved': if(m.roomId)lcMoveToRoom(m.roomId,true); break;
    case 'mute-all': lcOnMuteAll(); break;
    case 'ping': lcSend('pong',{}); break;
    case 'error': lcStatus('Server: '+(m.message||m.error||'error')); break;
  }
}

/* ---------- WebRTC mesh ---------- */
function lcIceServers(){
  const s=lc.creds&&lc.creds.iceServers;
  if(Array.isArray(s)&&s.length)return s;
  return [{urls:'stun:stun.l.google.com:19302'}];
}
function lcNewPC(peer){
  const pc=new RTCPeerConnection({iceServers:lcIceServers()});
  if(lc.localStream)lc.localStream.getTracks().forEach(t=>{try{pc.addTrack(t,lc.localStream);}catch(e){}});
  pc.onicecandidate=e=>{if(e.candidate)lcSend('signal',{to:peer.clientId,kind:'ice',payload:e.candidate});};
  pc.ontrack=e=>{lcAttachRemote(peer,e.streams[0]||new MediaStream([e.track]));};
  pc.onconnectionstatechange=()=>{if(pc.state==='failed'||pc.state==='closed')lcRemovePeer(peer.clientId);};
  return pc;
}
async function lcCallPeer(peer){
  if(!peer||!peer.clientId||lc.pcs.has(peer.clientId))return;
  lc.peers.set(peer.clientId,{name:peer.name||'Guest',role:peer.role||'student',handRaised:false});
  lcNoteParticipant(peer.clientId,peer.name||'Guest');
  lcTileEl(peer.clientId,peer.name||'Guest',false);
  const pc=lcNewPC(peer);lc.pcs.set(peer.clientId,pc);
  try{
    const offer=await pc.createOffer();
    await pc.setLocalDescription(offer);
    lcSend('signal',{to:peer.clientId,kind:'offer',payload:offer});
  }catch(e){lcRemovePeer(peer.clientId);}
  lcRenderPeople();
}
async function lcOnSignal(m){
  if(m.to&&lc.clientId&&m.to!==lc.clientId)return; // not for us
  const from=m.from;if(!from)return;
  let pc=lc.pcs.get(from);
  if(m.kind==='offer'){
    if(!pc){const peer=lc.peers.get(from)||{clientId:from};const nm=(peer&&peer.name)||'Guest';lc.peers.set(from,{name:nm,role:(peer&&peer.role)||'student',handRaised:false});lcNoteParticipant(from,nm);lcTileEl(from,nm,false);pc=lcNewPC({clientId:from});lc.pcs.set(from,pc);}
    try{
      await pc.setRemoteDescription(new RTCSessionDescription(m.payload));
      const answer=await pc.createAnswer();
      await pc.setLocalDescription(answer);
      lcSend('signal',{to:from,kind:'answer',payload:answer});
    }catch(e){}
    lcRenderPeople();
  }else if(m.kind==='answer'){
    if(!pc)return;
    try{await pc.setRemoteDescription(new RTCSessionDescription(m.payload));}catch(e){}
  }else if(m.kind==='ice'){
    if(!pc||!m.payload)return;
    try{await pc.addIceCandidate(new RTCIceCandidate(m.payload));}catch(e){}
  }
}
function lcRemovePeer(clientId){
  lcNoteParticipantLeft(clientId);
  const pc=lc.pcs.get(clientId);if(pc){try{pc.close();}catch(e){}}
  lc.pcs.delete(clientId);lc.peers.delete(clientId);
  const tile=document.querySelector(`[data-lc-tile="${CSS.escape(clientId)}"]`);if(tile)tile.remove();
  lcRenderPeople();
}
function lcTileEl(clientId,name,isLocal){
  let tile=document.querySelector(`[data-lc-tile="${CSS.escape(clientId)}"]`);
  if(tile)return tile;
  const grid=document.querySelector('#lcGrid');if(!grid)return null;
  const ph=grid.querySelector('.panel-copy');if(ph)ph.remove();
  tile=document.createElement('div');tile.className='lc-tile';tile.dataset.lcTile=clientId;
  tile.innerHTML=`<video ${isLocal?'id="lcLocalVideo"':''} autoplay playsinline ${isLocal?'muted':''} aria-label="${safeText(name)}"></video><span class="lc-name">${safeText(name)}${isLocal?' (you)':''}</span><span class="lc-flags"></span>`;
  grid.appendChild(tile);
  return tile;
}
function lcAddLocalTile(){
  const tile=lcTileEl('local',lc.myName,true);if(!tile)return;
  const v=tile.querySelector('video');if(v&&lc.localStream)v.srcObject=lc.localStream;
  if(!lc.localStream){const f=tile.querySelector('.lc-flags');if(f)f.innerHTML='<span class="lc-flag">no camera</span>';}
}
function lcAttachRemote(peer,stream){
  const tile=lcTileEl(peer.clientId,peer.name||'Guest',false);if(!tile)return;
  const v=tile.querySelector('video');if(v)v.srcObject=stream;
}

/* ---------- media controls ---------- */
function lcTrack(kind){return lc.localStream?lc.localStream.getTracks().find(t=>t.kind===kind):null;}
function lcToggleMic(){
  const t=lcTrack('audio');if(!t){lcStatus('No microphone found.');return;}
  lc.micOn=!lc.micOn;t.enabled=lc.micOn;
  const b=document.querySelector('#lcMic');b.setAttribute('aria-pressed',String(lc.micOn));b.innerHTML=lc.micOn?'\u{1F3A4} Mic on':'\u{1F507} Muted';
}
function lcToggleCam(){
  const t=lcTrack('video');if(!t){lcStatus('No camera found.');return;}
  lc.camOn=!lc.camOn;t.enabled=lc.camOn;
  const b=document.querySelector('#lcCam');b.setAttribute('aria-pressed',String(lc.camOn));b.innerHTML=lc.camOn?'\u{1F4F7} Camera on':'\u{1F4F7} Camera off';
}
function lcSetVideoTrack(track){
  lc.pcs.forEach(pc=>{
    const sender=pc.getSenders().find(s=>s.track&&s.track.kind==='video');
    try{if(sender&&track)sender.replaceTrack(track);else if(track)pc.addTrack(track,lc.screenStream||lc.localStream);}catch(e){}
  });
  const v=document.querySelector('#lcLocalVideo');
  if(v)v.srcObject=lc.sharing&&lc.screenStream?lc.screenStream:lc.localStream;
}
async function lcToggleShare(){
  if(lc.agoraMode)return lcToggleAgoraShare();
  const b=document.querySelector('#lcShare');
  if(lc.sharing){
    try{
      const cam=lcTrack('video');if(cam)lcSetVideoTrack(cam);
      if(lc.screenStream)lc.screenStream.getTracks().forEach(t=>t.stop());
    }catch(e){}
    lc.screenStream=null;lc.sharing=false;
    b.setAttribute('aria-pressed','false');b.innerHTML='\u{1F5A5} Share';
    lcStatus('Stopped sharing.');
    return;
  }
  try{
    const s=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});
    lc.screenStream=s;lc.sharing=true;
    const vt=s.getVideoTracks()[0];
    if(vt){lcSetVideoTrack(vt);vt.onended=()=>{if(lc.sharing)lcToggleShare();};}
    b.setAttribute('aria-pressed','true');b.innerHTML='\u{1F5A5} Sharing\u2026';
    lcStatus('Sharing your screen with the room.');
  }catch(e){lcStatus('Screen share cancelled or unavailable.');}
}
function lcToggleHand(){
  lc.handRaised=!lc.handRaised;
  if(lc.handRaised){try{const k=lc.myName||'Guest';lc.handCounts.set(k,(lc.handCounts.get(k)||0)+1);}catch(e){}}
  lcSend('hand',{raised:lc.handRaised});
  const b=document.querySelector('#lcHand');b.setAttribute('aria-pressed',String(lc.handRaised));
  b.innerHTML=lc.handRaised?'\u270B Hand raised':'\u270B Raise hand';
  lcRenderPeople();
}
function lcOnHand(m){
  const p=lc.peers.get(m.from);
  if(p){p.handRaised=!!m.raised;if(m.raised){try{const k=m.name||p.name||'Guest';lc.handCounts.set(k,(lc.handCounts.get(k)||0)+1);}catch(e){}}lcRenderPeople();}
}
function lcOnMuteAll(){
  const t=lcTrack('audio');
  if(t&&lc.micOn){lc.micOn=false;t.enabled=false;const b=document.querySelector('#lcMic');if(b){b.setAttribute('aria-pressed','false');b.innerHTML='\u{1F507} Muted';}}
  lcStatus('The teacher muted everyone.');
}

/* ---------- chat ---------- */
function lcAddChat(m){
  try{const k=m.name||'Guest';lc.chatCounts.set(k,(lc.chatCounts.get(k)||0)+1);}catch(e){}
  const list=document.querySelector('#lcChatList');if(!list)return;
  const at=m.at?new Date(m.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'';
  const div=document.createElement('div');div.className='lc-msg';
  div.innerHTML=`<b>${safeText(m.name||'Guest')}</b><span>${at}</span><p>${safeText(m.text||'')}</p>`;
  list.appendChild(div);list.scrollTop=list.scrollHeight;
  while(list.children.length>200)list.firstChild.remove();
}

/* ---------- Q&A ---------- */
function lcOnQaAsk(m){
  if(!m.qaId)return;
  if(!lc.qas.some(q=>q.qaId===m.qaId))lc.qas.push({qaId:m.qaId,from:m.from,name:m.name||'Guest',text:String(m.text||'').slice(0,500),answer:null});
  lcRenderQA();
}
function lcOnQaAnswer(m){
  const q=lc.qas.find(x=>x.qaId===m.qaId);
  if(q){q.answer={text:String(m.text||'').slice(0,1000),name:m.name||'Teacher'};lcRenderQA();}
}
function lcRenderQA(){
  const box=document.querySelector('#lcQaList');if(!box)return;
  if(!lc.qas.length){box.innerHTML='<p class="panel-copy">No questions yet. Ask below \u2014 the teacher answers here.</p>';return;}
  box.innerHTML=lc.qas.map(q=>`<div class="lc-qa"><div class="lc-qa-q"><b>Q \u00b7 ${safeText(q.name)}</b><p>${safeText(q.text)}</p></div>${q.answer?`<div class="lc-qa-a"><b>A \u00b7 ${safeText(q.answer.name)}</b><p>${safeText(q.answer.text)}</p></div>`:lc.isTeacher?`<div class="lc-qa-form"><input class="search-field" data-lc-answer="${safeText(q.qaId)}" placeholder="Type an answer\u2026" maxlength="1000" aria-label="Answer"><button class="filter-select" data-lc-answer-btn="${safeText(q.qaId)}">Answer</button></div>`:'<p class="panel-copy"><small>Waiting for the teacher\u2019s answer.</small></p>'}</div>`).join('');
  box.querySelectorAll('[data-lc-answer-btn]').forEach(b=>{b.onclick=()=>{
    const inp=box.querySelector(`[data-lc-answer="${CSS.escape(b.dataset.lcAnswerBtn)}"]`);
    const t=inp&&inp.value.trim();if(!t)return;
    if(lcSend('qa-answer',{qaId:b.dataset.lcAnswerBtn,text:t.slice(0,1000)})){
      const q=lc.qas.find(x=>x.qaId===b.dataset.lcAnswerBtn);
      if(q)q.answer={text:t.slice(0,1000),name:lc.myName};
      lcRenderQA();
    }
  };});
}

/* ---------- polls ---------- */
function lcStartPoll(){
  const q=document.querySelector('#lcPollQ').value.trim();
  const opts=document.querySelector('#lcPollOpts').value.split('\n').map(s=>s.trim()).filter(Boolean).slice(0,8);
  if(!q||opts.length<2){lcStatus('A poll needs a question and at least 2 options.');return;}
  const pollId='p'+Date.now().toString(36);
  if(lcSend('poll-start',{pollId,question:q.slice(0,200),options:opts})){
    lc.polls.set(pollId,{question:q.slice(0,200),options:opts,votes:new Map(),ended:false,mine:true});
    lcRenderPolls();
    document.querySelector('#lcPollQ').value='';document.querySelector('#lcPollOpts').value='';
  }
}
function lcOnPollStart(m){
  if(!m.pollId||!Array.isArray(m.options))return;
  lc.polls.set(m.pollId,{question:String(m.question||'Poll').slice(0,200),options:m.options.map(o=>String(o).slice(0,100)).slice(0,8),votes:new Map(),ended:false,mine:false,from:m.from});
  lcRenderPolls();lcSwitchTab('polls');
}
function lcOnPollVote(m){
  const p=lc.polls.get(m.pollId);if(!p||p.ended)return;
  const idx=Number(m.option);
  if(Number.isInteger(idx)&&idx>=0&&idx<p.options.length)p.votes.set(m.from||'anon',idx);
  try{const k=m.name||'Guest';lc.pollVoteCounts.set(k,(lc.pollVoteCounts.get(k)||0)+1);}catch(e){}
  lcRenderPolls();
}
function lcOnPollEnd(m){
  const p=lc.polls.get(m.pollId);if(!p)return;
  p.ended=true;lcRenderPolls();
}
function lcRenderPolls(){
  const box=document.querySelector('#lcPollBox');if(!box)return;
  const polls=[...lc.polls.entries()].reverse();
  if(!polls.length){box.innerHTML='<p class="panel-copy">No polls yet. The teacher can start one any time.</p>';return;}
  box.innerHTML=polls.map(([id,p])=>{
    const counts=p.options.map((_,i)=>[...p.votes.values()].filter(v=>v===i).length);
    const total=p.votes.size;
    const bars=p.options.map((o,i)=>{const c=counts[i],pct=total?Math.round(c/total*100):0;
      return `<div class="lc-poll-bar"><span>${safeText(o)}</span><div class="lc-poll-track"><i style="width:${pct}%"></i></div><b>${c} (${pct}%)</b></div>`;}).join('');
    const canVote=!lc.isTeacher&&!p.ended&&![...p.votes.keys()].some(k=>k==='me');
    const voteBtns=canVote?`<div class="lc-poll-vote">${p.options.map((o,i)=>`<button class="filter-select" data-lc-vote="${safeText(id)}" data-lc-opt="${i}">${safeText(o)}</button>`).join('')}</div>`:'';
    const endBtn=(lc.isTeacher&&!p.ended)?`<button class="filter-select" data-lc-poll-end="${safeText(id)}">End poll</button>`:'';
    const endedTag=p.ended?'<span class="pill">ENDED</span>':'<span class="pill purple-pill">LIVE</span>';
    return `<div class="lc-poll"><div class="lc-poll-head"><b>${safeText(p.question)}</b>${endedTag}</div>${bars}${voteBtns}<div class="lc-poll-foot"><small>${total} vote${total===1?'':'s'}</small>${endBtn}</div></div>`;
  }).join('');
  box.querySelectorAll('[data-lc-vote]').forEach(b=>{b.onclick=()=>{
    const id=b.dataset.lcVote,opt=Number(b.dataset.lcOpt);
    const p=lc.polls.get(id);if(!p||p.ended)return;
    if(lcSend('poll-vote',{pollId:id,option:opt})){p.votes.set('me',opt);try{const k=lc.myName||'Guest';lc.pollVoteCounts.set(k,(lc.pollVoteCounts.get(k)||0)+1);}catch(e){}lcRenderPolls();}
  };});
  box.querySelectorAll('[data-lc-poll-end]').forEach(b=>{b.onclick=()=>{
    const p=lc.polls.get(b.dataset.lcPollEnd);if(!p)return;
    if(lcSend('poll-end',{pollId:b.dataset.lcPollEnd})){p.ended=true;lcRenderPolls();}
  };});
}

/* ---------- people ---------- */
function lcRenderPeople(){
  const list=document.querySelector('#lcPeopleList');if(!list)return;
  const count=document.querySelector('#lcPeopleCount');if(count)count.textContent=`(${lc.peers.size+1})`;
  const rows=[{id:'local',name:lc.myName+' (you)',role:(currentUser&&currentUser.role)||'student',handRaised:lc.handRaised}];
  lc.peers.forEach((p,id)=>rows.push({id,name:p.name,role:p.role,handRaised:p.handRaised}));
  list.innerHTML=rows.map(r=>`<div class="lc-person"><span class="person-dot${r.role==='teacher'?' teacher-dot':''}">${safeText(r.name.slice(0,2).toUpperCase())}</span><div><b>${safeText(r.name)}</b><small>${safeText(r.role)}</small></div>${r.handRaised?'<span class="lc-hand-flag" title="Hand raised">\u270B</span>':''}</div>`).join('');
}
function lcRenderTeacherTools(){
  const box=document.querySelector('#lcTeacherTools');if(!box||!lc.isTeacher)return;
  box.innerHTML=`
   <div class="lc-teacher-tools">
    <b>Teacher controls</b>
    <div class="lc-tool-row"><button id="lcMuteAll" class="filter-select">\u{1F507} Mute everyone</button><button id="lcEndClass" class="filter-select lc-danger-text">End class for all</button></div>
    <div class="lc-breakouts"><b>Breakout rooms</b>
      <div class="lc-tool-row"><label>Rooms <input id="lcBreakN" type="number" min="2" max="8" value="2" class="search-field lc-small-input" aria-label="Number of rooms"></label><button id="lcBreakGo" class="filter-select">Create &amp; assign</button></div>
      <div id="lcBreakList"></div>
      <div class="lc-tool-row"><button id="lcBreakBack" class="filter-select" hidden>Bring everyone back</button></div>
    </div>
    <div class="lc-attendance"><b>Attendance</b> <button id="lcAttendRefresh" class="filter-select">Refresh</button><div id="lcAttendList"><p class="panel-copy"><small>Loading\u2026</small></p></div></div>
   </div>`;
  document.querySelector('#lcMuteAll').onclick=()=>{if(lcSend('mute-all',{}))lcStatus('Mute request sent to everyone.');};
  document.querySelector('#lcEndClass').onclick=()=>lcEndClass();
  document.querySelector('#lcBreakGo').onclick=()=>lcCreateBreakouts();
  document.querySelector('#lcBreakBack').onclick=()=>lcEndBreakouts();
  document.querySelector('#lcAttendRefresh').onclick=()=>lcLoadAttendance();
}
async function lcEndClass(){
  if(!confirm('End this class for everyone?'))return;
  await lcRefreshUserIds();
  try{await apiRequest(`/live-sessions/${encodeURIComponent(lc.sessionId)}/classroom/end`,{method:'POST',body:'{}'});}catch(e){}
  lcSend('bye',{});lcLeave(true);
}

/* ---------- breakout rooms ---------- */
function lcCreateBreakouts(){
  const n=Math.max(2,Math.min(8,Number(document.querySelector('#lcBreakN').value)||2));
  const ids=[...lc.peers.keys()];
  const assign=new Map();
  ids.forEach((id,i)=>assign.set(id,lc.mainRoomId+':b'+((i%n)+1)));
  lc.breakouts={n,assign};
  assign.forEach((room,to)=>lcSend('breakout',{room,to}));
  lcRenderBreakouts();
  lcStatus(`Breakout rooms started: ${ids.length} participant${ids.length===1?'':'s'} assigned across ${n} rooms.`);
}
function lcRenderBreakouts(){
  const box=document.querySelector('#lcBreakList');if(!box)return;
  const back=document.querySelector('#lcBreakBack');
  if(!lc.breakouts){box.innerHTML='<p class="panel-copy"><small>Split the class into small discussion groups. Everyone returns on your signal.</small></p>';if(back)back.hidden=true;return;}
  if(back)back.hidden=false;
  const rooms={};
  lc.breakouts.assign.forEach((room,id)=>{const n=room.split(':b')[1]||'?';(rooms[n]=rooms[n]||[]).push(id);});
  box.innerHTML=Object.keys(rooms).sort().map(n=>`<div class="lc-break-room"><b>Room ${safeText(n)}</b>${rooms[n].map(id=>{const p=lc.peers.get(id);return `<div class="lc-tool-row"><span>${safeText(p?p.name:id)}</span><button class="filter-select" data-lc-recall="${safeText(id)}">Bring back</button></div>`;}).join('')}</div>`).join('')
   +`<div class="lc-tool-row"><label>Join room <select id="lcJoinRoom" class="search-field" aria-label="Join a breakout room"><option value="">Stay in main room</option>${Object.keys(rooms).sort().map(n=>`<option value="${safeText(n)}">Room ${safeText(n)}</option>`).join('')}</select></label></div>`;
  box.querySelectorAll('[data-lc-recall]').forEach(b=>{b.onclick=()=>{
    lcSend('breakout',{room:lc.mainRoomId,to:b.dataset.lcRecall});
    lc.breakouts.assign.delete(b.dataset.lcRecall);lcRenderBreakouts();
  };});
  const jr=document.querySelector('#lcJoinRoom');
  if(jr)jr.onchange=()=>{if(jr.value)lcMoveToRoom(lc.mainRoomId+':b'+jr.value);};
}
function lcEndBreakouts(){
  if(!lc.breakouts)return;
  lc.breakouts.assign.forEach((room,to)=>lcSend('breakout',{room:lc.mainRoomId,to}));
  lc.breakouts=null;lcRenderBreakouts();lcStatus('Everyone is returning to the main room.');
}
function lcMoveToRoom(room,skipBye){
  if(room===lc.roomId)return;
  if(!skipBye)lcSend('bye',{});
  lc.pcs.forEach(pc=>{try{pc.close();}catch(e){}});
  lc.pcs.clear();lc.peers.clear();
  document.querySelectorAll('#lcGrid .lc-tile:not([data-lc-tile="local"])').forEach(t=>t.remove());
  try{if(lc.ws)lc.ws.close();}catch(e){}
  lc.connected=false;lc.roomId=room;
  lcRenderRoomBanner();lcRenderPeople();
  lcStatus(room===lc.mainRoomId?'Back in the main room. Reconnecting\u2026':'Moving rooms. Reconnecting\u2026');
  setTimeout(()=>{if(document.querySelector('#lcRoot'))lcConnectWs();},400);
}

/* ---------- attendance ---------- */
async function lcLoadAttendance(){
  const box=document.querySelector('#lcAttendList');if(!box||!lc.isTeacher)return;
  try{
    const d=await apiRequest('/teacher/live-sessions');
    const s=(d.sessions||[]).find(x=>String(x.id)===String(lc.sessionId));
    const att=(s&&s.attendees)||[];
    if(!att.length){box.innerHTML='<p class="panel-copy"><small>No attendance records yet.</small></p>';return;}
    box.innerHTML=att.map(a=>{
      const id=typeof a==='string'?a:(a.userId||a.id||a.studentId||'?');
      const at=typeof a==='object'&&a.joinedAt?new Date(a.joinedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'';
      return `<div class="lc-attend-row"><span>${safeText(String(id).slice(0,8))}</span><small>${at?'joined '+safeText(at):'joined'}</small></div>`;
    }).join('');
  }catch(e){box.innerHTML='<p class="panel-copy"><small>Attendance unavailable.</small></p>';}
  lcRefreshUserIds();
}
/* Resolve display names to user ids for the end-of-class summary: the server
 * merges client-reported activity by userId, so the teacher's client keeps a
 * name → userId map from the attendance endpoint (refreshed with the list). */
async function lcRefreshUserIds(){
  if(!lc.isTeacher||!lc.sessionId)return;
  try{
    const d=await apiRequest('/teacher/live-sessions/'+encodeURIComponent(lc.sessionId)+'/attendance');
    if(!lc.userIdByName)lc.userIdByName=new Map();
    (d.attendees||[]).forEach(a=>{if(a&&a.name&&a.userId)lc.userIdByName.set(a.name,a.userId);});
  }catch(e){}
}

/* ---------- shared whiteboard ---------- */
function lcBoardCtx(){const c=document.querySelector('#lcBoardCanvas');return c?c.getContext('2d'):null;}
function lcToggleBoard(){
  const w=document.querySelector('#lcBoardWrap');if(!w)return;
  w.hidden=!w.hidden;
  const b=document.querySelector('#lcBoardBtn');b.setAttribute('aria-pressed',String(!w.hidden));
}
function lcToggleAnnotate(){
  lc.annotating=!lc.annotating;
  const w=document.querySelector('#lcBoardWrap');if(!w)return;
  w.hidden=false;
  w.classList.toggle('lc-annotate-mode',lc.annotating);
  const b=document.querySelector('#lcAnnotate');if(b)b.setAttribute('aria-pressed',String(lc.annotating));
  lcStatus(lc.annotating?'Annotation mode: the board now floats over the video grid.':'Annotation off: board is docked below.');
}
function lcClearBoard(broadcast){
  const ctx=lcBoardCtx();if(ctx)ctx.clearRect(0,0,960,540);
  if(broadcast)lcSend('whiteboard-clear',{});
}
function lcDrawStroke(stroke){
  const ctx=lcBoardCtx();if(!ctx||!stroke||!Array.isArray(stroke.points)||stroke.points.length<1)return;
  ctx.strokeStyle=stroke.color||'#7257d9';ctx.lineWidth=stroke.size||4;ctx.lineCap='round';ctx.lineJoin='round';
  ctx.beginPath();
  stroke.points.forEach((p,i)=>{const x=Math.max(0,Math.min(1,Number(p[0])||0))*960,y=Math.max(0,Math.min(1,Number(p[1])||0))*540;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});
  if(stroke.points.length===1)ctx.lineTo(stroke.points[0][0]*960+0.5,stroke.points[0][1]*540+0.5);
  ctx.stroke();
}
function lcOnBoardStroke(m){if(m.stroke)lcDrawStroke(m.stroke);}
function lcWireBoard(){
  const c=document.querySelector('#lcBoardCanvas');if(!c)return;
  const pos=e=>{const r=c.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];};
  c.addEventListener('pointerdown',e=>{e.preventDefault();c.setPointerCapture(e.pointerId);lc.drawing=true;lc.curStroke={color:lc.boardColor,size:lc.boardSize,points:[pos(e)]};lcDrawStroke({color:lc.boardColor,size:lc.boardSize,points:[pos(e),pos(e)]});});
  c.addEventListener('pointermove',e=>{if(!lc.drawing||!lc.curStroke)return;const p=pos(e);const pts=lc.curStroke.points;const last=pts[pts.length-1];pts.push(p);const ctx=lcBoardCtx();if(ctx){ctx.strokeStyle=lc.curStroke.color;ctx.lineWidth=lc.curStroke.size;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(last[0]*960,last[1]*540);ctx.lineTo(p[0]*960,p[1]*540);ctx.stroke();}});
  const up=()=>{if(!lc.drawing)return;lc.drawing=false;if(lc.curStroke&&lc.curStroke.points.length>1)lcSend('whiteboard',{stroke:lc.curStroke});lc.curStroke=null;};
  c.addEventListener('pointerup',up);c.addEventListener('pointercancel',up);
}

/* ---------- slides ---------- */
function lcTogglePresentPanel(){
  const p=document.querySelector('#lcPresentPanel');if(!p)return;
  p.hidden=!p.hidden;
  const b=document.querySelector('#lcPresentBtn');b.setAttribute('aria-pressed',String(!p.hidden));
  if(!p.hidden)lcRenderSlideList();
}
function lcAddSlide(){
  const t=document.querySelector('#lcSlideTitle').value.trim()||'Untitled';
  const bullets=document.querySelector('#lcSlideBullets').value.split('\n').map(s=>s.trim()).filter(Boolean).slice(0,8);
  lc.slides.push({title:t.slice(0,120),bullets});
  document.querySelector('#lcSlideTitle').value='';document.querySelector('#lcSlideBullets').value='';
  lcRenderSlideList();
  if(lc.slides.length===1)lcShowSlide(0);
}
function lcRenderSlideList(){
  const box=document.querySelector('#lcSlideList');if(!box)return;
  box.innerHTML=lc.slides.length?lc.slides.map((s,i)=>`<button class="filter-select${i===lc.slideIndex?' lc-current':''}" data-lc-goto-slide="${i}">${i+1}. ${safeText(s.title)}</button>`).join(''):'<p class="panel-copy"><small>Add slides above, then step through them \u2014 students follow along automatically.</small></p>';
  box.querySelectorAll('[data-lc-goto-slide]').forEach(b=>{b.onclick=()=>lcShowSlide(Number(b.dataset.lcGotoSlide));});
}
function lcShowSlide(i){
  if(!lc.slides.length)return;
  lc.slideIndex=Math.max(0,Math.min(lc.slides.length-1,i));
  lc.presenting=true;
  const s=lc.slides[lc.slideIndex];
  lcSend('slide',{index:lc.slideIndex,total:lc.slides.length,slide:s});
  lcRenderSlideView(s,lc.slideIndex,lc.slides.length);
  lcRenderSlideList();
}
function lcStopPresenting(){
  lc.presenting=false;lc.slideIndex=-1;
  lcSend('slide',{index:-1,total:lc.slides.length});
  const w=document.querySelector('#lcSlideWrap');if(w){w.hidden=true;w.innerHTML='';}
  const p=document.querySelector('#lcPresentPanel');if(p)p.hidden=true;
  const b=document.querySelector('#lcPresentBtn');if(b)b.setAttribute('aria-pressed','false');
}
function lcRenderSlideView(s,index,total){
  const w=document.querySelector('#lcSlideWrap');if(!w)return;
  w.hidden=false;
  w.innerHTML=`<div class="lc-slide-view"><p class="eyebrow">SLIDES \u00b7 ${index+1}/${total}</p><h3>${safeText(s.title)}</h3>${(s.bullets||[]).length?`<ul>${s.bullets.map(b=>`<li>${safeText(b)}</li>`).join('')}</ul>`:'<p class="panel-copy"><small>No bullet points.</small></p>'}</div>`;
  const pos=document.querySelector('#lcSlidePos');if(pos)pos.textContent=`${index+1} / ${total}`;
}
function lcOnSlide(m){
  if(m.index<0){const w=document.querySelector('#lcSlideWrap');if(w){w.hidden=true;w.innerHTML='';}return;}
  const s=m.slide||{title:'Slide '+(m.index+1),bullets:[]};
  lcRenderSlideView(s,m.index,m.total||1);
}

/* ---------- recording (teacher, this device only) ---------- */
function lcToggleRecord(){
  const b=document.querySelector('#lcRecordBtn');
  if(lc.recorder){try{lc.recorder.stop();}catch(e){}return;}
  let stream=null;
  try{
    if(lc.sharing&&lc.screenStream){
      const audio=lc.localStream?lc.localStream.getAudioTracks():[];
      stream=new MediaStream([...lc.screenStream.getVideoTracks(),...audio]);
    }else if(lc.localStream){stream=lc.localStream;}
  }catch(e){}
  if(!stream){lcStatus('Nothing to record yet \u2014 allow camera/mic or share your screen first.');return;}
  if(typeof MediaRecorder==='undefined'){lcStatus('Recording is not supported in this browser.');return;}
  lc.recChunks=[];
  try{lc.recorder=new MediaRecorder(stream,{mimeType:'video/webm'});}catch(e){lcStatus('Could not start the recorder.');return;}
  lc.recorder.ondataavailable=e=>{if(e.data&&e.data.size)lc.recChunks.push(e.data);};
  lc.recorder.onstop=()=>{
    try{
      const blob=new Blob(lc.recChunks,{type:'video/webm'});
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);
      a.download=`eduverse-class-${lc.sessionId||'session'}.webm`;document.body.appendChild(a);a.click();
      setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},4000);
      lcStatus('Recording saved to this device.');
    }catch(e){lcStatus('Could not save the recording.');}
    lc.recorder=null;
    if(b){b.setAttribute('aria-pressed','false');b.innerHTML='\u23FA Record';}
  };
  lc.recorder.start();
  b.setAttribute('aria-pressed','true');b.innerHTML='\u23FA Recording\u2026 (tap to stop)';
  lcStatus('Recording on this device only. The file stays with you unless you share it.');
}

/* ---------- leave & cleanup ---------- */
function lcLeave(silent){
  lmsCleanupClassroom();
  if(!silent)lcStatus('');
  navigate('live-classes');
}
function lmsCleanupClassroom(){
  try{
  if(typeof lc==='undefined')return false;
  try{if(typeof lcLeaveAgora==='function')lcLeaveAgora();}catch(e){}
  try{if(lc.ws&&lc.ws.readyState===1)lc.ws.send(JSON.stringify({type:'bye'}));}catch(e){}
  try{if(lc.ws)lc.ws.close();}catch(e){}
  lc.pcs.forEach(pc=>{try{pc.close();}catch(e){}});
  [lc.localStream,lc.screenStream].forEach(s=>{if(s)s.getTracks().forEach(t=>{try{t.stop();}catch(e){}});});
  try{if(lc.recorder&&lc.recorder.state!=='inactive')lc.recorder.stop();}catch(e){}
  [lc.heartbeat,lc.attendTimer,lc.retryTimer].forEach(t=>{if(t)clearInterval(t);});
  window.removeEventListener('beforeunload',lcBeforeUnload);
  const had=!!(lc.ws||lc.pcs.size||lc.localStream);
  if(had&&lc.isTeacher&&lc.sessionId&&!lc.summaryPosted)lcPostSessionSummary();
  lcReset();
  lc.localStream=null;lc.screenStream=null;
  return had;
  }catch(e){return false;}
}

/* ---------- Operations (slice B): fees, subscriptions, marketplace, reports, import, analytics ---------- */
const opsState={feeStructures:[],feeRecords:[],subPlans:[],institutions:[],mktCourses:[],reportTab:'overview'};

function opsMoney(n){const v=Number(n)||0;return '₹'+v.toLocaleString('en-IN');}
function opsStatusPill(s){return `<span class="account-status ${safeText(s)}">${safeText(s)}</span>`;}
async function opsInstitutions(){
  if(opsState.institutions.length)return opsState.institutions;
  try{const d=await apiRequest('/admin/institutions');opsState.institutions=d.institutions||[];}catch{opsState.institutions=[];}
  return opsState.institutions;
}
async function opsFillInstitutionSelects(){
  const list=await opsInstitutions();
  const opts=list.length?list.map(i=>`<option value="${safeText(i.id)}">${safeText(i.name)}</option>`).join(''):'<option value="">No institution available</option>';
  document.querySelectorAll('.admin-fee-institution,.admin-sub-institution').forEach(sel=>{sel.innerHTML=opts;sel.dataset.opsFilled='1';});
}

/* ----- Student: My fees ----- */
async function loadMyFees(){
  const box=document.querySelector('#opsMyFees');if(!box)return;
  try{
    const d=await apiRequest('/fees/mine');
    const recs=d.records||d.feeRecords||[];
    if(!recs.length){box.innerHTML='<p class="staff-empty">No fee records yet. Your institution will assign fees when they are due.</p>';return;}
    const totalDue=recs.reduce((n,r)=>n+(Number(r.amountDue)-Number(r.amountPaid||0)),0);
    box.innerHTML=`<div class="admin-metrics"><article class="admin-metric"><small>TOTAL OUTSTANDING</small><b>${opsMoney(totalDue)}</b></article><article class="admin-metric"><small>RECORDS</small><b>${recs.length}</b></article><article class="admin-metric"><small>PAID IN FULL</small><b>${recs.filter(r=>r.status==='paid').length}</b></article></div>`+
    staffTable(['Fee','Due date','Amount','Paid','Balance','Status','Payments'],recs.map(r=>{
      const bal=Number(r.amountDue)-Number(r.amountPaid||0);
      const pays=(r.payments||[]).map(p=>`${opsMoney(p.amount)} · ${safeText(p.method||'')}<small>${new Date(p.at).toLocaleDateString()}</small>`).join('<br>')||'—';
      return `<tr><td><b>${safeText(r.structureName||r.feeName||'Fee')}</b></td><td>${r.dueDate?new Date(r.dueDate).toLocaleDateString():'—'}</td><td>${opsMoney(r.amountDue)}</td><td>${opsMoney(r.amountPaid||0)}</td><td><b>${opsMoney(bal)}</b></td><td>${opsStatusPill(r.status)}</td><td><small>${pays}</small></td></tr>`;
    }),'No fee records.');
  }catch(err){box.innerHTML=`<p class="staff-empty">${safeText(err.message)}</p>`;}
}

/* ----- Public marketplace ----- */
let opsMktCache=[];
async function loadMarketplace(){
  const grid=document.querySelector('#opsMarketplaceGrid');if(!grid)return;
  try{
    const d=await apiRequest('/marketplace/courses');
    opsMktCache=d.courses||d.listings||[];
    opsRenderMarketplace('');
  }catch(err){grid.innerHTML=`<p class="staff-empty">${safeText(err.message)}</p>`;}
}
function opsRenderMarketplace(q){
  const grid=document.querySelector('#opsMarketplaceGrid');if(!grid)return;
  const query=(q||'').toLowerCase();
  const list=opsMktCache.filter(c=>!query||`${c.title||''} ${c.institutionName||''}`.toLowerCase().includes(query));
  grid.innerHTML=list.length?list.map(c=>`<article class="course-tile"><div><p class="eyebrow">${safeText(c.institutionName||'Institution')}</p><h3>${safeText(c.title||'Course')}</h3><p class="panel-copy">${safeText(c.description||'')}</p><p><b>${Number(c.price)>0?opsMoney(c.price):'Free'}</b></p></div><button class="primary-btn" data-ops-mkt-enroll="${safeText(c.id||c.courseId)}">Enroll →</button></article>`).join(''):'<p class="staff-empty">No courses listed yet.</p>';
}

/* ----- Admin: fees ----- */
async function loadOpsFees(){
  await opsFillInstitutionSelects();
  await Promise.all([opsLoadFeeStructures(),opsLoadFeeRecords()]);
  // fill academic years when institution changes
  const instSel=document.querySelector('.admin-fee-institution');
  if(instSel&&!instSel.dataset.opsYearWired){instSel.dataset.opsYearWired='1';instSel.addEventListener('change',async()=>{
    const ysel=document.querySelector('.admin-fee-year');if(!ysel)return;
    try{const d=await apiRequest(`/admin/academic-years?institutionId=${encodeURIComponent(instSel.value)}`);const yrs=d.academicYears||d.years||[];ysel.innerHTML='<option value="">None</option>'+yrs.map(y=>`<option value="${safeText(y.id)}">${safeText(y.name)}</option>`).join('');}catch{ysel.innerHTML='<option value="">None</option>';}
  });instSel.dispatchEvent(new Event('change'));}
}
async function opsLoadFeeStructures(){
  const box=document.querySelector('#opsFeeStructures');if(!box)return;
  try{
    const d=await apiRequest('/admin/fee-structures');
    const list=opsState.feeStructures=d.feeStructures||d.structures||[];
    box.innerHTML=staffTable(['Name','Amount','Due date','Grade','Action'],list.map(s=>`<tr><td><b>${safeText(s.name)}</b></td><td>${opsMoney(s.amount)}</td><td>${s.dueDate?new Date(s.dueDate).toLocaleDateString():'—'}</td><td>${safeText(s.grade||'All')}</td><td><button class="filter-select" data-ops-fee-assign="${safeText(s.id)}">Assign</button> <button class="filter-select" data-ops-fee-delete="${safeText(s.id)}">Delete</button></td></tr>`),'No fee structures yet. Create one above.');
  }catch(err){box.innerHTML=`<p class="staff-empty">${safeText(err.message)}</p>`;}
}
async function opsLoadFeeRecords(){
  const box=document.querySelector('#opsFeeRecords');if(!box)return;
  const status=document.querySelector('#opsFeeStatusFilter')?.value||'';
  const overdue=document.querySelector('#opsFeeOverdueOnly')?.checked?'&overdue=1':'';
  try{
    const d=await apiRequest(`/admin/fee-records?${status?`status=${encodeURIComponent(status)}`:''}${overdue}`);
    const list=opsState.feeRecords=d.records||d.feeRecords||[];
    box.innerHTML=staffTable(['Student','Fee','Due','Paid','Balance','Status','Action'],list.map(r=>{
      const bal=Number(r.amountDue)-Number(r.amountPaid||0);
      return `<tr><td><b>${safeText(r.studentName||r.studentId)}</b></td><td>${safeText(r.structureName||r.feeName||'')}</td><td>${opsMoney(r.amountDue)}</td><td>${opsMoney(r.amountPaid||0)}</td><td><b>${opsMoney(bal)}</b></td><td>${opsStatusPill(r.status)}</td><td>${r.status!=='paid'?`<button class="filter-select" data-ops-fee-pay="${safeText(r.id)}" data-ops-balance="${bal}">Record payment</button>`:'<small>Settled</small>'}</td></tr>`;
    }),'No fee records match.');
  }catch(err){box.innerHTML=`<p class="staff-empty">${safeText(err.message)}</p>`;}
}

/* ----- Admin: subscriptions ----- */
async function loadOpsSubscriptions(){
  await opsFillInstitutionSelects();
  const isSuper=currentUser?.role==='super_admin';
  const planForm=document.querySelector('#adminSubPlanForm');
  if(planForm&&!isSuper)planForm.innerHTML='<p class="panel-copy">Only super administrators can create plans.</p>';
  try{
    const d=await apiRequest('/admin/subscription-plans');
    const plans=opsState.subPlans=d.plans||d.subscriptionPlans||[];
    document.querySelector('#opsSubPlans').innerHTML=staffTable(['Plan','Price','Cycle','Max students','Max teachers','Features'],plans.map(p=>`<tr><td><b>${safeText(p.name)}</b></td><td>${opsMoney(p.price)}</td><td>${safeText(p.billingCycle)}</td><td>${p.maxStudents}</td><td>${p.maxTeachers}</td><td><small>${safeText((p.features||[]).join(', '))}</small></td></tr>`),'No plans yet.');
    document.querySelectorAll('.admin-sub-plan').forEach(sel=>{sel.innerHTML=plans.map(p=>`<option value="${safeText(p.id)}">${safeText(p.name)} · ${opsMoney(p.price)}</option>`).join('');});
  }catch(err){const b=document.querySelector('#opsSubPlans');if(b)b.innerHTML=`<p class="staff-empty">${safeText(err.message)}</p>`;}
  await opsLoadInstitutionSubs();
}
async function opsLoadInstitutionSubs(){
  const box=document.querySelector('#opsInstitutionSubs');if(!box)return;
  const list=await opsInstitutions();
  const rows=[];
  for(const inst of list){
    try{
      const d=await apiRequest(`/admin/institutions/${encodeURIComponent(inst.id)}/subscription`);
      const sub=d.subscription||d;
      if(sub&&sub.id)rows.push({inst,sub});
    }catch{}
  }
  box.innerHTML=rows.length?staffTable(['Institution','Plan','Status','Period','Action'],rows.map(({inst,sub})=>`<tr><td><b>${safeText(inst.name)}</b></td><td>${safeText(sub.planName||sub.planId)}</td><td>${opsStatusPill(sub.status)}</td><td><small>${sub.startsAt?new Date(sub.startsAt).toLocaleDateString():''} → ${sub.endsAt?new Date(sub.endsAt).toLocaleDateString():''}</small></td><td>${sub.status==='active'?`<button class="filter-select" data-ops-sub-cancel="${safeText(inst.id)}">Cancel</button>`:''}</td></tr>`),'No subscriptions assigned yet.'):'<p class="staff-empty">No subscriptions assigned yet.</p>';
}

/* ----- Admin: marketplace ----- */
async function loadOpsMarketplaceAdmin(){
  try{
    const {courses}=await apiRequest('/admin/courses');
    const mine=(courses||[]).filter(c=>c.status==='published');
    document.querySelectorAll('.admin-mkt-course').forEach(sel=>{sel.innerHTML=mine.map(c=>`<option value="${safeText(c.id)}">${safeText(c.title)}</option>`).join('')||'<option value="">No published courses</option>';});
  }catch{}
  await opsLoadMyListings();
}
async function opsLoadMyListings(){
  const box=document.querySelector('#opsMarketplaceListings');if(!box)return;
  try{
    const d=await apiRequest('/marketplace/courses');
    const all=d.courses||d.listings||[];
    const mine=all.filter(l=>(l.institutionId&&currentUser?.institutionId&&l.institutionId===currentUser.institutionId)||l.mine);
    const list=mine.length?mine:all;
    box.innerHTML=staffTable(['Course','Institution','Price','Status','Action'],list.map(l=>`<tr><td><b>${safeText(l.title||l.courseTitle||'')}</b></td><td>${safeText(l.institutionName||'')}</td><td>${Number(l.price)>0?opsMoney(l.price):'Free'}</td><td>${opsStatusPill(l.status||'listed')}</td><td><button class="filter-select" data-ops-listing-delete="${safeText(l.id)}">Unlist</button></td></tr>`),'No listings yet. List a course above.');
  }catch(err){box.innerHTML=`<p class="staff-empty">${safeText(err.message)}</p>`;}
}

/* ----- Admin: reports with tabs ----- */
async function loadOpsReports(tab){
  opsState.reportTab=tab||'overview';
  const root=document.querySelector('#staffPageBody');if(!root)return;
  const tabs=[['overview','Overview'],['workload','Teacher workload'],['enrollments','Enrollments']];
  root.innerHTML=`<div class="path-tabs" role="tablist">${tabs.map(([k,label])=>`<button class="path-tab ${opsState.reportTab===k?'selected':''}" data-ops-report-tab="${k}" role="tab">${label}</button>`).join('')}</div><div id="opsReportBody"><p class="panel-copy">Loading…</p></div>`;
  await opsRenderReportTab();
}
async function opsRenderReportTab(){
  const body=document.querySelector('#opsReportBody');if(!body)return;
  const tab=opsState.reportTab;
  try{
    if(tab==='overview'){
      const [overview,rep]=await Promise.all([apiRequest('/admin/overview'),apiRequest('/admin/reports')]);
      const m=overview.metrics;
      body.innerHTML=`<div class="admin-metrics">${[['REGISTERED USERS',m.totalUsers],['STUDENTS',m.students],['TEACHERS',m.teachers],['PENDING TEACHERS',m.pendingTeachers],['COURSES',m.activeCourses],['CLASSES',m.classes],['ENROLLMENTS',m.enrollments],['SUBMISSIONS',m.submissions],['VISION EVENTS',m.visionEvents]].map(([label,val])=>`<article class="admin-metric"><small>${label}</small><b>${val}</b></article>`).join('')}</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0"><button class="primary-btn" data-export-type="users">Export users CSV</button><button class="primary-btn" data-export-type="enrollments">Export enrollments CSV</button><button class="primary-btn" data-export-type="completion">Export completion CSV</button></div><h3>Course completion</h3>${staffTable(['Student','Course','Completion'],rep.completion.map(r=>`<tr><td>${safeText(r.studentName)}</td><td>${safeText(r.courseTitle)}</td><td>${r.completion}%</td></tr>`),'No course enrollments yet.')}<h3>Assignments</h3>${staffTable(['Assignment','Assigned','Submitted','Graded'],rep.assignments.map(a=>`<tr><td>${safeText(a.title)}</td><td>${a.assigned}</td><td>${a.submitted}</td><td>${a.graded}</td></tr>`),'No assignments yet.')}<h3>Attendance</h3><p class="panel-copy">Recorded: ${rep.attendance.total} · Present: ${rep.attendance.present} · Absent: ${rep.attendance.absent} · Late: ${rep.attendance.late}</p>`;
    }else if(tab==='workload'){
      const d=await apiRequest('/admin/reports/teacher-workload');
      const rows=d.workload||d.teachers||[];
      body.innerHTML=`<p class="panel-copy">Hours combine live-session time with a 2-hour assumption per owned course.</p>`+staffTable(['Teacher','Courses owned','Live sessions','Students','Hours'],rows.map(w=>`<tr><td><b>${safeText(w.teacherName||w.name)}</b></td><td>${w.coursesOwned??w.courses??0}</td><td>${w.liveSessions??0}</td><td>${w.totalStudents??w.students??0}</td><td>${w.hours??0}</td></tr>`),'No workload data yet.');
    }else{
      const d=await apiRequest('/admin/reports/enrollments');
      const rows=d.enrollments||d.rows||[];
      const csvUrl=`${API_BASE}/admin/reports/enrollments?format=csv`;
      const pdfUrl=`${API_BASE}/reports/enrollments.pdf`,xlsUrl=`${API_BASE}/reports/enrollments.xls`;
      body.innerHTML=`<div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px"><a class="primary-btn" href="${csvUrl}" download style="text-decoration:none">Export CSV ↓</a><a class="primary-btn" href="${pdfUrl}" download style="text-decoration:none">Export PDF ↓</a><a class="primary-btn" href="${xlsUrl}" download style="text-decoration:none">Export Excel ↓</a></div>`+staffTable(['Student','Course','Enrolled on','Status'],rows.map(r=>`<tr><td><b>${safeText(r.studentName||r.studentId)}</b></td><td>${safeText(r.courseTitle||r.courseId)}</td><td>${r.enrolledAt?new Date(r.enrolledAt).toLocaleDateString():'—'}</td><td>${safeText(r.status||'active')}</td></tr>`),'No enrollments yet.');
    }
  }catch(err){body.innerHTML=`<p class="staff-empty">${safeText(err.message)}</p>`;}
}

/* ----- Admin: analytics ----- */
async function loadOpsAnalytics(){
  const days=document.querySelector('#opsAnalyticsDays')?.value||'30';
  const cards=document.querySelector('#opsAnalyticsCards'),bars=document.querySelector('#opsAnalyticsBars');
  try{
    const d=await apiRequest(`/admin/analytics/usage?days=${encodeURIComponent(days)}`);
    const items=[['LOGINS',d.logins||0],['ACTIVE USERS',d.activeUsers||0],['ENROLLMENTS',d.enrollments||0],['QUIZ ATTEMPTS',d.quizAttempts||0],['LIVE SESSIONS',d.liveSessions||0],['NOVA CALLS',d.novaCalls||0]];
    cards.innerHTML=items.map(([label,val])=>`<article class="admin-metric"><small>${label}</small><b>${Number(val).toLocaleString('en-IN')}</b></article>`).join('');
    const max=Math.max(1,...items.map(([,v])=>Number(v)||0));
    bars.innerHTML=`<div class="ops-bars">${items.map(([label,val])=>{const pct=Math.round((Number(val)||0)/max*100);return `<div class="ops-bar-row"><span>${label}</span><div class="ops-bar-track"><div class="ops-bar-fill" style="width:${pct}%"></div></div><b>${Number(val).toLocaleString('en-IN')}</b></div>`;}).join('')}</div>`;
  }catch(err){if(cards)cards.innerHTML=`<p class="staff-empty">${safeText(err.message)}</p>`;}
}

/* ----- Admin: import ----- */
async function opsRunImport(kind){
  const isStudents=kind==='students';
  const form=document.querySelector(isStudents?'#adminImportStudentsForm':'#adminImportTeachersForm');
  const statusEl=document.querySelector(isStudents?'#adminImportStudentsStatus':'#adminImportTeachersStatus');
  const resultEl=document.querySelector(isStudents?'#opsImportStudentsResult':'#opsImportTeachersResult');
  const csv=form.elements.namedItem('csv').value.trim();
  if(!csv){if(statusEl)statusEl.textContent='Paste CSV content or choose a file first.';return;}
  if(statusEl)statusEl.textContent='Importing…';
  try{
    const d=await apiRequest(`/admin/import/${kind}`,{method:'POST',body:JSON.stringify({csv})});
    const skipped=d.skipped||[];
    if(statusEl)statusEl.textContent=`Imported ${d.created||0} account${(d.created||0)===1?'':'s'}${skipped.length?`, ${skipped.length} skipped`:''}.`;
    if(resultEl)resultEl.innerHTML=skipped.length?staffTable(['Row','Error'],skipped.map(s=>`<tr><td><small>${safeText(String(s.row).slice(0,80))}</small></td><td>${safeText(s.error)}</td></tr>`),''):'';
    form.reset();
  }catch(err){if(statusEl)statusEl.textContent=err.message;}
}
function opsWireImportFile(inputId,formId){
  const input=document.querySelector('#'+inputId);if(!input||input.dataset.opsWired)return;input.dataset.opsWired='1';
  input.addEventListener('change',()=>{
    const f=input.files&&input.files[0];if(!f)return;
    const reader=new FileReader();
    reader.onload=()=>{const ta=document.querySelector('#'+formId+' textarea[name="csv"]');if(ta)ta.value=String(reader.result||'');};
    reader.readAsText(f);
  });
}

/* ----- Delegated clicks & submits ----- */
document.addEventListener('click',async e=>{
  const tab=e.target.closest('[data-ops-report-tab]');
  if(tab){e.preventDefault();opsState.reportTab=tab.dataset.opsReportTab;document.querySelectorAll('[data-ops-report-tab]').forEach(b=>b.classList.toggle('selected',b===tab));opsRenderReportTab();return;}
  const payBtn=e.target.closest('[data-ops-fee-pay]');
  if(payBtn){
    const id=payBtn.dataset.opsFeePay,balance=Number(payBtn.dataset.opsBalance)||0;
    const amount=prompt(`Record payment (balance ${opsMoney(balance)}):`,'');
    if(amount===null)return;
    const method=prompt('Payment method (cash/upi/card/bank):','cash')||'cash';
    try{await apiRequest(`/admin/fee-records/${encodeURIComponent(id)}/pay`,{method:'POST',body:JSON.stringify({amount:Number(amount),method})});opsLoadFeeRecords();}catch(err){alert(err.message);}
    return;
  }
  const assignBtn=e.target.closest('[data-ops-fee-assign]');
  if(assignBtn){
    const id=assignBtn.dataset.opsFeeAssign;
    const grade=prompt('Assign to grade (leave blank for all students):','')||'';
    try{const d=await apiRequest(`/admin/fee-structures/${encodeURIComponent(id)}/assign`,{method:'POST',body:JSON.stringify(grade?{grade}:{})});alert(`Assigned to ${d.assigned||d.created||0} student(s).`);opsLoadFeeRecords();}catch(err){alert(err.message);}
    return;
  }
  const delFee=e.target.closest('[data-ops-fee-delete]');
  if(delFee){if(!confirm('Delete this fee structure?'))return;try{await apiRequest(`/admin/fee-structures/${encodeURIComponent(delFee.dataset.opsFeeDelete)}`,{method:'DELETE'});opsLoadFeeStructures();}catch(err){alert(err.message);}return;}
  const subCancel=e.target.closest('[data-ops-sub-cancel]');
  if(subCancel){if(!confirm('Cancel this subscription?'))return;try{await apiRequest(`/admin/institutions/${encodeURIComponent(subCancel.dataset.opsSubCancel)}/subscription`,{method:'PATCH',body:JSON.stringify({status:'cancelled'})});opsLoadInstitutionSubs();}catch(err){alert(err.message);}return;}
  const listDel=e.target.closest('[data-ops-listing-delete]');
  if(listDel){if(!confirm('Remove this listing from the marketplace?'))return;try{await apiRequest(`/admin/marketplace/listings/${encodeURIComponent(listDel.dataset.opsListingDelete)}`,{method:'DELETE'});opsLoadMyListings();}catch(err){alert(err.message);}return;}
  const enroll=e.target.closest('[data-ops-mkt-enroll]');
  if(enroll){try{await apiRequest(`/marketplace/courses/${encodeURIComponent(enroll.dataset.opsMktEnroll)}/enroll`,{method:'POST',body:'{}'});alert('Enrolled. Check the course catalog to start learning.');}catch(err){alert(err.message);}return;}
  const feeRefresh=e.target.closest('#opsFeeRefresh');
  if(feeRefresh){opsLoadFeeRecords();return;}
});
document.addEventListener('change',e=>{
  if(e.target.id==='opsFeeStatusFilter'||e.target.id==='opsFeeOverdueOnly')opsLoadFeeRecords();
  if(e.target.id==='opsAnalyticsDays')loadOpsAnalytics();
  if(e.target.id==='opsMktSearch')return;
});
document.addEventListener('input',e=>{
  if(e.target.id==='opsMktSearch')opsRenderMarketplace(e.target.value);
});
document.addEventListener('submit',async e=>{
  if(e.target.id==='adminFeeStructureForm'){e.preventDefault();const f=e.target,body=Object.fromEntries(new FormData(f));if(!body.academicYearId)delete body.academicYearId;if(!body.grade)delete body.grade;body.amount=Number(body.amount);const st=document.querySelector('#adminFeeStructureStatus');try{await apiRequest('/admin/fee-structures',{method:'POST',body:JSON.stringify(body)});if(st)st.textContent='Fee structure created.';f.reset();opsLoadFeeStructures();}catch(err){if(st)st.textContent=err.message;}return;}
  if(e.target.id==='adminSubPlanForm'){e.preventDefault();const f=e.target,body=Object.fromEntries(new FormData(f));body.price=Number(body.price);body.maxStudents=Number(body.maxStudents);body.maxTeachers=Number(body.maxTeachers);body.features=String(body.features||'').split(',').map(s=>s.trim()).filter(Boolean);const st=document.querySelector('#adminSubPlanStatus');try{await apiRequest('/admin/subscription-plans',{method:'POST',body:JSON.stringify(body)});if(st)st.textContent='Plan created.';f.reset();loadOpsSubscriptions();}catch(err){if(st)st.textContent=err.message;}return;}
  if(e.target.id==='adminSubAssignForm'){e.preventDefault();const f=e.target,body=Object.fromEntries(new FormData(f));const st=document.querySelector('#adminSubAssignStatus');try{await apiRequest(`/admin/institutions/${encodeURIComponent(body.institutionId)}/subscription`,{method:'POST',body:JSON.stringify({planId:body.planId})});if(st)st.textContent='Plan assigned.';f.reset();opsLoadInstitutionSubs();}catch(err){if(st)st.textContent=err.message;}return;}
  if(e.target.id==='adminMarketplaceForm'){e.preventDefault();const f=e.target,body=Object.fromEntries(new FormData(f));body.price=Number(body.price);const st=document.querySelector('#adminMarketplaceStatus');try{await apiRequest('/admin/marketplace/listings',{method:'POST',body:JSON.stringify(body)});if(st)st.textContent='Course listed.';f.reset();opsLoadMyListings();}catch(err){if(st)st.textContent=err.message;}return;}
  if(e.target.id==='adminImportStudentsForm'){e.preventDefault();opsWireImportFile('opsImportStudentsFile','adminImportStudentsForm');await opsRunImport('students');return;}
  if(e.target.id==='adminImportTeachersForm'){e.preventDefault();opsWireImportFile('opsImportTeachersFile','adminImportTeachersForm');await opsRunImport('teachers');return;}
});

/* ---------- Library catalog + loans + reading lists + offline (slice 2) ---------- */
Object.assign(screenNames,{'admin-library':'Library','reading-lists':'Reading lists'});
Object.assign(screenRole,{'library':['student','teacher','parent'],'admin-library':['admin'],'reading-lists':['teacher']});
expandAdminRoles();
Object.assign(staffPageTitles,{'admin-library':'Library catalog','reading-lists':'Reading lists'});
Object.assign(staffPageMarkup,{
'admin-library':`<div class="screen-title"><p class="eyebrow">LIBRARY MANAGEMENT</p><h1>Library</h1><p>Manage the catalog, track loans, and review library stats.</p></div><div id="libAdminStats" class="lms-stat-cards"><p class="panel-copy">Loading stats\u2026</p></div><section class="screen-panel"><h3>Add catalog item</h3><form id="libAdminForm" class="teacher-form"><div class="lms-form-row"><label>Kind<select name="kind" id="libAdminKind"><option value="book">Book</option><option value="ebook">E-book</option><option value="journal">Journal</option></select></label><label>Title<input name="title" maxlength="200" required></label></div><div class="lms-form-row"><label>Author<input name="author" maxlength="120"></label><label>ISBN<input name="isbn" maxlength="30"></label></div><div class="lms-form-row"><label>Subject<input name="subject" maxlength="80"></label><label>Copies (books)<input name="totalCopies" type="number" min="1" value="1"></label></div><label>Description<textarea name="description" rows="2" maxlength="2000"></textarea></label><div class="lms-form-row"><label>Cover URL<input name="coverUrl" maxlength="500" placeholder="https://\u2026"></label><label>E-book file<input type="file" id="libEbookFile" accept=".pdf,.epub,.txt"></label></div><input type="hidden" name="fileUrl" id="libEbookUrl"><p class="panel-copy" id="libEbookStatus" role="status"></p><div><button class="primary-btn" id="libAdminSubmit">Add item \u2192</button> <button class="filter-select" type="button" id="libAdminCancel" hidden>Cancel edit</button></div><p id="libAdminFormStatus" class="panel-copy" role="status"></p></form></section><section class="screen-panel"><h3>Catalog</h3><div class="screen-toolbar"><input aria-label="Search catalog" id="libAdminSearch" class="search-field" placeholder="\u2315  Search catalog"><select aria-label="Filter by kind" id="libAdminKindFilter" class="filter-select"><option value="">All kinds</option><option value="book">Books</option><option value="ebook">E-books</option><option value="journal">Journals</option></select></div><div id="libAdminCatalog"><p class="panel-copy">Loading catalog\u2026</p></div></section><section class="screen-panel"><h3>Loans</h3><div id="libAdminLoans"><p class="panel-copy">Loading loans\u2026</p></div></section>`,
'reading-lists':`<div class="screen-title"><p class="eyebrow">TEACHING RESOURCES</p><h1>Reading lists</h1><p>Curate books, e-books, and journals for your courses.</p></div><section class="screen-panel"><h3>New reading list</h3><form id="rlForm" class="teacher-form"><label>Title<input name="title" maxlength="200" required></label><label>Course (optional)<select name="courseId" id="rlCourse"><option value="">Institution-wide</option></select></label><label>Items<select name="itemIds" id="rlItems" multiple size="6" aria-label="Library items"></select></label><p class="panel-copy"><small>Hold Ctrl/Cmd to pick several items.</small></p><button class="primary-btn">Create list \u2192</button><p id="rlFormStatus" class="panel-copy" role="status"></p></form></section><section class="screen-panel"><h3>My reading lists</h3><div id="rlMine"><p class="panel-copy">Loading\u2026</p></div></section>`});
portalScreens.admin[0][1].push(['admin-library','\u25a4','Library']);
portalScreens.teacher[0][1].push(['reading-lists','\u25a4','Reading lists']);
portalScreens.parent[0][1].push(['library','\u25a5','Library']);

const libState={tab:'browse',items:[],loans:[],lists:[],editingId:null};
function libKindIcon(k){return k==='ebook'?'\u25c8':k==='journal'?'\u25a6':'\u25a4';}
function libKindLabel(k){return k==='ebook'?'E-book':k==='journal'?'Journal':'Book';}
function libSetTab(t){
 libState.tab=t;
 document.querySelectorAll('[data-lib-tab]').forEach(b=>{const on=b.dataset.libTab===t;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));});
 ['browse','loans','lists'].forEach(k=>{const el=document.querySelector('#libTab-'+k);if(el)el.hidden=k!==t;});
}
async function loadLibraryCatalog(){
 if(!document.querySelector('#libCatalogSection'))return;
 if(currentUser&&currentUser.role!=='student'){const lt=document.querySelector('#libLoansTab');if(lt)lt.style.display='none';}
 await Promise.all([libLoadBrowse(),libLoadLoans(),libLoadLists()]);
}
async function libLoadBrowse(){
 const box=document.querySelector('#libBrowse');if(!box)return;
 const q=document.querySelector('#libSearch')?.value||'',kind=document.querySelector('#libKind')?.value||'',subject=document.querySelector('#libSubject')?.value||'';
 try{
  const d=await apiRequest(`/library?q=${encodeURIComponent(q)}${kind?`&kind=${encodeURIComponent(kind)}`:''}${subject?`&subject=${encodeURIComponent(subject)}`:''}`);
  const items=libState.items=d.items||d.library||[];
  const borrowedIds=new Set((libState.loans||[]).filter(l=>!l.returnedAt).map(l=>String(l.itemId)));
  box.innerHTML=items.length?`<div class="lms-quiz-list">${items.map(it=>{
   const id=String(it.id),isBorrowed=borrowedIds.has(id);
   const avail=it.kind==='book'?`<small>${Number(it.availableCopies||0)} of ${Number(it.totalCopies||0)} copies available</small>`:`<small>${libKindLabel(it.kind)}</small>`;
   let action='';
   if(currentUser&&currentUser.role==='student'&&it.kind==='book')action=isBorrowed?`<button class="filter-select" data-lib-return-item="${safeText(id)}">Return</button>`:`<button class="primary-btn" data-lib-borrow="${safeText(id)}" ${Number(it.availableCopies||0)>0?'':'disabled'}>Borrow</button>`;
   else if(it.kind==='ebook'&&it.fileUrl)action=`<a class="filter-select" href="${safeText(it.fileUrl)}" target="_blank" rel="noopener">Read \u2192</a>`;
   return `<div class="lms-lesson-row">${it.coverUrl?`<img src="${safeText(it.coverUrl)}" alt="" class="lib-cover" loading="lazy">`:`<span class="lms-resume-play">${libKindIcon(it.kind)}</span>`}<div><b>${safeText(it.title)}</b><small>${safeText(it.author||'Unknown author')}${it.subject?` \u00b7 ${safeText(it.subject)}`:''}${it.isbn?` \u00b7 ISBN ${safeText(it.isbn)}`:''}</small>${avail}${it.description?`<small>${safeText(String(it.description).slice(0,160))}</small>`:''}</div><div class="lms-row-actions">${action}</div></div>`;
  }).join('')}</div>`:'<p class="panel-copy">No catalog items match your search.</p>';
 }catch(err){box.innerHTML=`<p class="panel-copy">Catalog unavailable: ${safeText(err.message)}</p>`;}
}
async function libLoadLoans(){
 const box=document.querySelector('#libLoans');if(!box)return;
 if(!currentUser||currentUser.role!=='student'){box.innerHTML='<p class="panel-copy">Borrowing is available for student accounts.</p>';return;}
 try{
  const d=await apiRequest('/library/loans/mine');
  const loans=libState.loans=d.loans||[];
  const active=loans.filter(l=>!l.returnedAt),hist=loans.filter(l=>l.returnedAt);
  const row=l=>`<tr><td><b>${safeText(l.title||l.itemId)}</b></td><td>${l.borrowedAt?new Date(l.borrowedAt).toLocaleDateString():'\u2014'}</td><td>${l.dueAt?new Date(l.dueAt).toLocaleDateString():'\u2014'}</td><td>${l.returnedAt?new Date(l.returnedAt).toLocaleDateString():'<span class="pill purple-pill">ACTIVE</span>'}</td><td>${l.returnedAt?'':`<button class="filter-select" data-lib-return="${safeText(l.id)}">Return</button>`}</td></tr>`;
  box.innerHTML=`<h4>Active loans (${active.length})</h4>`+staffTable(['Item','Borrowed','Due','Status','Action'],active.map(row),'No active loans.')+`<h4 style="margin-top:16px">History</h4>`+staffTable(['Item','Borrowed','Due','Returned',''],hist.map(row),'No loan history yet.');
 }catch(err){box.innerHTML=`<p class="panel-copy">Loans unavailable: ${safeText(err.message)}</p>`;}
}
async function libLoadLists(){
 const box=document.querySelector('#libLists');if(!box)return;
 try{
  const d=await apiRequest('/reading-lists');
  const lists=libState.lists=d.readingLists||d.lists||[];
  box.innerHTML=lists.length?lists.map(l=>`<section class="screen-panel" style="margin-bottom:12px"><h4>${safeText(l.title)}</h4><p class="panel-copy"><small>${l.courseTitle?`For ${safeText(l.courseTitle)} \u00b7 `:''}${(l.itemIds||[]).length} item(s)</small></p>${(l.items||[]).length?`<ul class="lms-checklist">${l.items.map(it=>`<li>${libKindIcon(it.kind)} ${safeText(it.title)}${it.author?` \u2014 ${safeText(it.author)}`:''}</li>`).join('')}</ul>`:''}</section>`).join(''):'<p class="panel-copy">No reading lists yet. Teachers can create them for courses.</p>';
 }catch(err){box.innerHTML=`<p class="panel-copy">Reading lists unavailable: ${safeText(err.message)}</p>`;}
}
/* admin library */
async function loadAdminLibrary(){
 await Promise.all([libAdminStats(),libAdminCatalog(),libAdminLoans()]);
}
async function libAdminStats(){
 const box=document.querySelector('#libAdminStats');if(!box)return;
 try{
  const d=await apiRequest('/library/stats');
  const s=d.stats||d||{};
  box.innerHTML=[['Items',s.totalItems||0],['Books',s.totalBooks||0],['E-books',s.totalEbooks||0],['Active loans',s.activeLoans||0],['Overdue',s.overdueLoans||0]].map(([k,v])=>`<article class="stat-card"><small>${k.toUpperCase()}</small><b>${v}</b></article>`).join('');
 }catch(err){box.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
async function libAdminCatalog(){
 const box=document.querySelector('#libAdminCatalog');if(!box)return;
 const q=document.querySelector('#libAdminSearch')?.value||'',kind=document.querySelector('#libAdminKindFilter')?.value||'';
 try{
  const d=await apiRequest(`/admin/library?q=${encodeURIComponent(q)}${kind?`&kind=${encodeURIComponent(kind)}`:''}`);
  const items=d.items||d.library||[];
  box.innerHTML=staffTable(['Title','Kind','Author','Copies','Available','Actions'],items.map(it=>`<tr><td><b>${safeText(it.title)}</b>${it.subject?`<br><small>${safeText(it.subject)}</small>`:''}</td><td>${libKindLabel(it.kind)}</td><td>${safeText(it.author||'\u2014')}</td><td>${it.kind==='book'?Number(it.totalCopies||0):'\u2014'}</td><td>${it.kind==='book'?Number(it.availableCopies||0):'\u2014'}</td><td><button class="filter-select" data-lib-edit="${safeText(it.id)}">Edit</button> <button class="filter-select" data-lib-delete="${safeText(it.id)}">Delete</button></td></tr>`),'No catalog items yet. Add one above.');
  box._libItems=items;
 }catch(err){box.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
async function libAdminLoans(){
 const box=document.querySelector('#libAdminLoans');if(!box)return;
 try{
  const d=await apiRequest('/admin/library/loans');
  const loans=d.loans||[];
  const pill=l=>l.returnedAt?'Returned':(l.overdue?'<span class="pill" style="background:#fee;color:#a00">OVERDUE</span>':'<span class="pill purple-pill">ACTIVE</span>');
  box.innerHTML=staffTable(['Item','Student','Borrowed','Due','Status'],loans.map(l=>`<tr><td><b>${safeText(l.title||l.itemId)}</b></td><td>${safeText(l.studentName||l.studentId)}</td><td>${l.borrowedAt?new Date(l.borrowedAt).toLocaleDateString():'\u2014'}</td><td>${l.dueAt?new Date(l.dueAt).toLocaleDateString():'\u2014'}</td><td>${pill(l)}</td></tr>`),'No loans recorded.');
 }catch(err){box.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
function libAdminFillForm(it){
 const f=document.querySelector('#libAdminForm');if(!f)return;
 f.kind.value=it.kind||'book';f.title.value=it.title||'';f.author.value=it.author||'';f.isbn.value=it.isbn||'';f.subject.value=it.subject||'';f.description.value=it.description||'';f.totalCopies.value=it.totalCopies||1;f.coverUrl.value=it.coverUrl||'';
 document.querySelector('#libEbookUrl').value=it.fileUrl||'';
 libState.editingId=it.id;
 document.querySelector('#libAdminSubmit').textContent='Save changes \u2192';
 document.querySelector('#libAdminCancel').hidden=false;
 f.scrollIntoView({behavior:'smooth',block:'start'});
}
function libAdminResetForm(){
 const f=document.querySelector('#libAdminForm');if(f)f.reset();
 document.querySelector('#libEbookUrl').value='';document.querySelector('#libEbookStatus').textContent='';
 libState.editingId=null;
 document.querySelector('#libAdminSubmit').textContent='Add item \u2192';
 document.querySelector('#libAdminCancel').hidden=true;
}
/* teacher reading lists */
async function loadReadingLists(){
 const mine=document.querySelector('#rlMine');if(!mine)return;
 try{
  const [courses,items]=await Promise.all([apiRequest('/teacher/courses').catch(()=>({courses:[]})),apiRequest('/library').catch(()=>({items:[]} ))]);
  const csel=document.querySelector('#rlCourse');
  if(csel){const cs=courses.courses||[];csel.innerHTML='<option value="">Institution-wide</option>'+cs.map(c=>`<option value="${safeText(c.id)}">${safeText(c.title)}</option>`).join('');}
  const isel=document.querySelector('#rlItems');
  if(isel){const list=items.items||items.library||[];isel.innerHTML=list.map(it=>`<option value="${safeText(it.id)}">${libKindLabel(it.kind)} \u00b7 ${safeText(it.title)}${it.author?` \u2014 ${safeText(it.author)}`:''}</option>`).join('');}
 }catch{}
 try{
  const d=await apiRequest('/teacher/reading-lists');
  const lists=d.readingLists||d.lists||[];
  const rows=lists.map(l=>{const tds=['<b>'+safeText(l.title)+'</b>',safeText(l.courseTitle||'Institution-wide'),String((l.itemIds||[]).length),l.createdAt?new Date(l.createdAt).toLocaleDateString():'\u2014'];return '<tr>'+tds.map(t=>'<td>'+t+'</td>').join('')+'<td><button class="filter-select" data-rl-delete="'+safeText(l.id)+'">Delete</button></td></tr>';});
  mine.innerHTML=lists.length?staffTable(['Title','Course','Items','Created',''],rows,'No reading lists yet. Create one above.'):staffTable(['Title','Course','Items','Created',''],[],'No reading lists yet. Create one above.');
 }catch(err){mine.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
async function loadCourseReadingLists(courseId){
 const box=document.querySelector('#cdReadingLists');if(!box||!courseId)return;
 try{
  const d=await apiRequest('/reading-lists');
  const lists=(d.readingLists||d.lists||[]).filter(l=>String(l.courseId||'')===String(courseId));
  if(!lists.length){box.innerHTML='';return;}
  box.innerHTML=`<p class="eyebrow">READING LISTS</p>`+lists.map(l=>`<div class="lms-lesson-row"><span class="lms-resume-play">\u25a4</span><div><b>${safeText(l.title)}</b><small>${(l.items||[]).slice(0,4).map(it=>safeText(it.title)).join(' \u00b7 ')}${(l.items||[]).length>4?` \u00b7 +${(l.items||[]).length-4} more`:''}</small></div><button class="filter-select" data-screen="library">Open library \u2192</button></div>`).join('');
 }catch{box.innerHTML='';}
}
/* offline: per-lesson downloads + progress sync */
function libQueueGet(){try{return Object.assign({progress:[],downloads:[]},JSON.parse(localStorage.getItem('eduverse.offlineQueue')||'{}'));}catch{return{progress:[],downloads:[]};}}
function libQueueSave(q){try{localStorage.setItem('eduverse.offlineQueue',JSON.stringify(q));}catch{}}
function libQueueProgress(lessonId,positionSec,completed){
 if(!lessonId)return;const q=libQueueGet();
 const rec={lessonId:String(lessonId),positionSec:Math.round(positionSec||0),completed:!!completed,at:new Date().toISOString()};
 const i=q.progress.findIndex(p=>String(p.lessonId)===String(lessonId));
 if(i>=0)q.progress[i]=rec;else q.progress.push(rec);
 if(q.progress.length>200)q.progress=q.progress.slice(-200);
 libQueueSave(q);
}
function libQueueDownload(lessonId){
 if(!lessonId)return;const q=libQueueGet();const id=String(lessonId);
 if(!q.downloads.includes(id))q.downloads.push(id);
 libQueueSave(q);
}
async function libDownloadLesson(){
 const lesson=lmsState.lesson;
 if(!lesson){lmsSetStatus('#vpStatus','Open a lesson first.');return;}
 const title=String(lesson.title||'Lesson');
 const transcript=String(lesson.transcript||'').replace(/\[(\d{1,3}):([0-5]\d)(?::([0-5]\d))?\]/g,'[$1:$2$3]');
 const doc=`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeText(title)} \u2014 EduVerse offline</title><style>body{font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;line-height:1.6;color:#1a1a2e}h1{font-size:1.4em}pre{white-space:pre-wrap;background:#f4f4f8;padding:12px;border-radius:8px}</style></head><body><h1>${safeText(title)}</h1><p><small>Downloaded from EduVerse \u00b7 ${new Date().toLocaleString()}</small></p>${lesson.content?`<h2>Lesson notes</h2><p>${safeText(lesson.content)}</p>`:''}${transcript?`<h2>Transcript</h2><pre>${safeText(transcript)}</pre>`:''}${lesson.videoUrl?`<p><small>Video: <a href="${safeText(lesson.videoUrl)}">${safeText(lesson.videoUrl)}</a> (needs connection)</small></p>`:''}<p><small>Your progress on this lesson syncs back when you press Sync offline.</small></p></body></html>`;
 try{
  const blob=new Blob([doc],{type:'text/html'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=(title.replace(/[^\w\-]+/g,'_').slice(0,60)||'lesson')+'.html';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),8000);
  libQueueDownload(lesson.id);
  lmsSetStatus('#vpStatus','Lesson downloaded. Use \u21ea Sync offline to record it.');
 }catch(err){lmsSetStatus('#vpStatus','Download failed: '+err.message);}
}
async function libSyncOffline(){
 const q=libQueueGet();
 if(!q.progress.length&&!q.downloads.length){lmsSetStatus('#vpStatus','Nothing queued \u2014 you are up to date.');return;}
 lmsSetStatus('#vpStatus','Syncing\u2026');
 try{
  const d=await apiRequest('/offline/sync',{method:'POST',body:JSON.stringify({progress:q.progress,downloads:q.downloads})});
  libQueueSave({progress:[],downloads:[]});
  lmsSetStatus('#vpStatus',`Synced ${d.applied||0} update(s)${d.conflicts?`, ${d.conflicts} conflict(s) \u2014 server copy kept`:''}.`);
 }catch(err){lmsSetStatus('#vpStatus','Sync failed: '+err.message+' \u2014 queued items are kept.');}
}
function libWireOffline(){
 const dl=document.querySelector('#vpDownload'),sy=document.querySelector('#vpSync');
 if(dl&&!dl.dataset.libWired){dl.dataset.libWired='1';dl.onclick=libDownloadLesson;}
 if(sy&&!sy.dataset.libWired){sy.dataset.libWired='1';sy.onclick=libSyncOffline;}
}

/* library + offline event wiring */
document.addEventListener('click',async e=>{
 const tab=e.target.closest('[data-lib-tab]');if(tab){libSetTab(tab.dataset.libTab);return;}
 const borrow=e.target.closest('[data-lib-borrow]');
 if(borrow){const id=borrow.dataset.libBorrow;borrow.disabled=true;try{await apiRequest(`/library/${encodeURIComponent(id)}/borrow`,{method:'POST',body:'{}'});await Promise.all([libLoadBrowse(),libLoadLoans()]);}catch(err){alert(err.message);borrow.disabled=false;}return;}
 const ret=e.target.closest('[data-lib-return]');
 if(ret){const id=ret.dataset.libReturn;ret.disabled=true;try{await apiRequest(`/library/loans/${encodeURIComponent(id)}/return`,{method:'POST',body:'{}'});await Promise.all([libLoadBrowse(),libLoadLoans()]);}catch(err){alert(err.message);ret.disabled=false;}return;}
 const retItem=e.target.closest('[data-lib-return-item]');
 if(retItem){const itemId=retItem.dataset.libReturnItem;const loan=(libState.loans||[]).find(l=>!l.returnedAt&&String(l.itemId)===String(itemId));if(!loan){alert('No active loan found for this item.');return;}retItem.disabled=true;try{await apiRequest(`/library/loans/${encodeURIComponent(loan.id)}/return`,{method:'POST',body:'{}'});await Promise.all([libLoadBrowse(),libLoadLoans()]);}catch(err){alert(err.message);retItem.disabled=false;}return;}
 const edit=e.target.closest('[data-lib-edit]');
 if(edit){const box=document.querySelector('#libAdminCatalog');const it=(box&&box._libItems||[]).find(x=>String(x.id)===String(edit.dataset.libEdit));if(it)libAdminFillForm(it);return;}
 const del=e.target.closest('[data-lib-delete]');
 if(del){if(!confirm('Delete this catalog item? Active loans stay on record.'))return;try{await apiRequest(`/admin/library/${encodeURIComponent(del.dataset.libDelete)}`,{method:'DELETE'});libAdminResetForm();await Promise.all([libAdminStats(),libAdminCatalog(),libAdminLoans()]);}catch(err){alert(err.message);}return;}
 const rlDel=e.target.closest('[data-rl-delete]');
 if(rlDel){if(!confirm('Delete this reading list?'))return;try{await apiRequest(`/teacher/reading-lists/${encodeURIComponent(rlDel.dataset.rlDelete)}`,{method:'DELETE'});await loadReadingLists();}catch(err){alert(err.message);}return;}
 if(e.target.id==='libAdminCancel'){libAdminResetForm();return;}
});
let libSearchTimer=null;
document.addEventListener('input',e=>{
 if(e.target.id==='libSearch'){clearTimeout(libSearchTimer);libSearchTimer=setTimeout(libLoadBrowse,280);return;}
 if(e.target.id==='libSubject'){clearTimeout(libSearchTimer);libSearchTimer=setTimeout(libLoadBrowse,280);return;}
 if(e.target.id==='libAdminSearch'){clearTimeout(libSearchTimer);libSearchTimer=setTimeout(libAdminCatalog,280);return;}
});
document.addEventListener('change',e=>{
 if(e.target.id==='libKind'){libLoadBrowse();return;}
 if(e.target.id==='libAdminKindFilter'){libAdminCatalog();return;}
 if(e.target.id==='libEbookFile'){
  const f=e.target.files&&e.target.files[0];const st=document.querySelector('#libEbookStatus');
  if(!f)return;if(f.size>5*1024*1024){if(st)st.textContent='File must be under 5MB.';e.target.value='';return;}
  if(st)st.textContent='Uploading\u2026';
  const rd=new FileReader();
  rd.onload=async()=>{try{
   const dataUrl=String(rd.result||'');const base64=dataUrl.split(',')[1]||'';
   const d=await apiRequest('/upload',{method:'POST',body:JSON.stringify({filename:f.name,mimeType:f.type||'application/pdf',data:base64,folder:'library'})});
   const url=d.url||(d.file&&d.file.url);
   document.querySelector('#libEbookUrl').value=url||'';
   if(st)st.textContent=url?'E-book uploaded.':'Upload finished but no URL was returned.';
  }catch(err){if(st)st.textContent='Upload failed: '+err.message;}};
  rd.onerror=()=>{if(st)st.textContent='Could not read the file.';};
  rd.readAsDataURL(f);return;
 }
 if(e.target.id==='assignFileInput'){
  const f=e.target.files&&e.target.files[0];const st=document.querySelector('#assignFileStatus');
  if(!f)return;
  const ext=String(f.name||'').split('.').pop().toLowerCase();
  if(!['pdf','doc','docx','txt'].includes(ext)){if(st)st.textContent='Only PDF, DOC, DOCX or TXT files are accepted.';e.target.value='';return;}
  if(f.size>5*1024*1024){if(st)st.textContent='File must be under 5MB.';e.target.value='';return;}
  if(st)st.textContent='Uploading…';
  const rd=new FileReader();
  rd.onload=async()=>{try{
   const dataUrl=String(rd.result||'');const base64=dataUrl.split(',')[1]||'';
   const d=await apiRequest('/upload',{method:'POST',body:JSON.stringify({filename:f.name,mimeType:f.type||'application/pdf',data:base64,folder:'assignments'})});
   const url=d.url||(d.file&&d.file.url);
   if(!url)throw new Error('Upload finished but no URL was returned.');
   assignUpload={fileUrl:url,fileName:f.name,fileData:'',mimeType:f.type||''};
   if(st)st.innerHTML=`📎 ${safeText(f.name)} — attached. <button type="button" class="filter-select" id="assignFileRemove">Remove</button>`;
  }catch(err){
   assignUpload={fileUrl:'',fileName:'',fileData:'',mimeType:''};
   e.target.value='';
   if(st)st.textContent='Upload failed: '+(err.message||'could not upload')+'. Please try again — the file was not attached.';
  }};
  rd.onerror=()=>{if(st)st.textContent='Could not read the file.';};
  rd.readAsDataURL(f);return;
 }
});
document.addEventListener('submit',async e=>{
 if(e.target.id==='libAdminForm'){
  e.preventDefault();const f=e.target,st=document.querySelector('#libAdminFormStatus');
  const body={kind:f.kind.value,title:f.title.value.trim(),author:f.author.value.trim(),isbn:f.isbn.value.trim(),subject:f.subject.value.trim(),description:f.description.value.trim(),coverUrl:f.coverUrl.value.trim(),fileUrl:document.querySelector('#libEbookUrl').value.trim()};
  if(body.kind==='book')body.totalCopies=Math.max(1,Number(f.totalCopies.value)||1);
  Object.keys(body).forEach(k=>{if(body[k]===''||body[k]==null)delete body[k];});
  try{
   if(libState.editingId){await apiRequest(`/admin/library/${encodeURIComponent(libState.editingId)}`,{method:'PATCH',body:JSON.stringify(body)});if(st)st.textContent='Item updated.';}
   else{await apiRequest('/admin/library',{method:'POST',body:JSON.stringify(body)});if(st)st.textContent='Item added to the catalog.';}
   libAdminResetForm();await Promise.all([libAdminStats(),libAdminCatalog()]);
  }catch(err){if(st)st.textContent=err.message;}
  return;
 }
 if(e.target.id==='rlForm'){
  e.preventDefault();const f=e.target,st=document.querySelector('#rlFormStatus');
  const itemIds=[...f.querySelector('#rlItems').selectedOptions].map(o=>o.value);
  if(!itemIds.length){if(st)st.textContent='Pick at least one library item.';return;}
  const body={title:f.title.value.trim(),itemIds};
  const courseId=f.querySelector('#rlCourse').value;if(courseId)body.courseId=courseId;
  try{await apiRequest('/teacher/reading-lists',{method:'POST',body:JSON.stringify(body)});if(st)st.textContent='Reading list created.';f.reset();await loadReadingLists();}catch(err){if(st)st.textContent=err.message;}
  return;
 }
});

/* ---------- Calendar + career center + placement prep (slice 3) ---------- */
Object.assign(screenNames,{calendar:'Calendar',careers:'Career center',placement:'Placement prep','admin-events':'Calendar events','admin-careers':'Careers','teacher-placement':'Placement prep'});
Object.assign(screenRole,{calendar:['student','teacher','parent','admin'],careers:['student','teacher','parent','admin'],placement:['student'],'admin-events':['admin'],'admin-careers':['admin'],'teacher-placement':['teacher']});
expandAdminRoles();
Object.assign(staffPageTitles,{'admin-events':'Calendar events','admin-careers':'Career paths & internships','teacher-placement':'Placement prep'});
Object.assign(staffPageMarkup,{
'admin-events':`<div class="screen-title"><p class="eyebrow">CALENDAR MANAGEMENT</p><h1>Calendar events</h1><p>Add holidays, exam dates, and deadlines to the institution calendar.</p></div><section class="screen-panel"><h3>New event</h3><form id="calEventForm" class="teacher-form"><div class="lms-form-row"><label>Title<input name="title" maxlength="200" required></label><label>Kind<select name="kind"><option value="event">Event</option><option value="holiday">Holiday</option><option value="exam">Exam</option><option value="deadline">Deadline</option></select></label></div><div class="lms-form-row"><label>Starts<input name="startsAt" type="datetime-local" required></label><label>Ends (optional)<input name="endsAt" type="datetime-local"></label></div><label>Description<textarea name="description" rows="2" maxlength="2000"></textarea></label><input type="hidden" name="id" id="calEventId"><div><button class="primary-btn" id="calEventSubmit">Add event \u2192</button> <button class="filter-select" type="button" id="calEventCancel" hidden>Cancel edit</button></div><p id="calEventStatus" class="panel-copy" role="status"></p></form></section><section class="screen-panel"><h3>Scheduled events</h3><div id="calAdminList"><p class="panel-copy">Loading\u2026</p></div></section>`,
'admin-careers':`<div class="screen-title"><p class="eyebrow">CAREER MANAGEMENT</p><h1>Careers</h1><p>Publish career paths and internship listings for your learners.</p></div><section class="screen-panel"><h3>New career path</h3><form id="careerPathForm" class="teacher-form"><label>Title<input name="title" maxlength="200" required></label><label>Description<textarea name="description" rows="2" maxlength="2000"></textarea></label><div class="lms-form-row"><label>Skills (comma separated)<input name="skills" maxlength="500" placeholder="Python, Data analysis, Communication"></label><label>Linked courses<select name="courses" id="careerPathCourses" multiple size="5" aria-label="Linked courses"></select></label></div><input type="hidden" name="id" id="careerPathId"><div><button class="primary-btn">Save path \u2192</button> <button class="filter-select" type="button" id="careerPathCancel" hidden>Cancel edit</button></div><p id="careerPathStatus" class="panel-copy" role="status"></p></form></section><section class="screen-panel"><h3>Career paths</h3><div id="careerPathList"><p class="panel-copy">Loading\u2026</p></div></section><section class="screen-panel"><h3>New internship</h3><form id="internshipForm" class="teacher-form"><div class="lms-form-row"><label>Company<input name="company" maxlength="160" required></label><label>Role<input name="role" maxlength="160" required></label></div><label>Description<textarea name="description" rows="2" maxlength="2000"></textarea></label><div class="lms-form-row"><label>Location<input name="location" maxlength="120"></label><label>Stipend<input name="stipend" maxlength="80" placeholder="\u20B9 10,000/month"></label></div><div class="lms-form-row"><label>Application URL<input name="applyUrl" maxlength="500" placeholder="https://\u2026"></label><label>Deadline<input name="deadline" type="date"></label></div><input type="hidden" name="id" id="internshipId"><div><button class="primary-btn">Save internship \u2192</button> <button class="filter-select" type="button" id="internshipCancel" hidden>Cancel edit</button></div><p id="internshipStatus" class="panel-copy" role="status"></p></form></section><section class="screen-panel"><h3>Internships</h3><div id="internshipList"><p class="panel-copy">Loading\u2026</p></div></section>`,
'teacher-placement':`<div class="screen-title"><p class="eyebrow">PLACEMENT PREP</p><h1>Placement prep</h1><p>Build aptitude tests and run mock interviews for your learners.</p></div><section class="screen-panel"><h3>New aptitude test</h3><form id="aptTestForm" class="teacher-form"><div class="lms-form-row"><label>Title<input name="title" maxlength="200" required></label><label>Time (minutes)<input name="timeMin" type="number" min="1" max="300" value="30"></label></div><label>Questions (one per line)<textarea name="questions" rows="5" maxlength="20000" placeholder="What is 12 \u00D7 8? || 84 | 96 | 108 | 120 || 2"></textarea></label><p class="panel-copy"><small>Format per line: <b>question || choice 1 | choice 2 | choice 3 || correct choice number</b> (1-based). Answers are never shown to students.</small></p><button class="primary-btn">Create test \u2192</button><p id="aptTestStatus" class="panel-copy" role="status"></p></form></section><section class="screen-panel"><h3>Aptitude tests</h3><div id="aptTestList"><p class="panel-copy">Loading\u2026</p></div></section><section class="screen-panel"><h3>New mock interview</h3><form id="mockInterviewForm" class="teacher-form"><div class="lms-form-row"><label>Title<input name="title" maxlength="200" required></label><label>Type<select name="kind"><option value="hr">HR</option><option value="technical">Technical</option></select></label></div><label>Scheduled for (optional)<input name="scheduledFor" type="datetime-local"></label><label>Questions (one per line)<textarea name="questions" rows="4" maxlength="10000" placeholder="Tell me about yourself."></textarea></label><button class="primary-btn">Create interview \u2192</button><p id="mockInterviewStatus" class="panel-copy" role="status"></p></form></section><section class="screen-panel"><h3>Mock interviews</h3><div id="mockInterviewList"><p class="panel-copy">Loading\u2026</p></div></section>`});
Object.assign(screens,{
calendar:`<div class="screen-title"><p class="eyebrow">PLAN AHEAD</p><h1>Calendar</h1><p>Holidays, exams, deadlines, and events \u2014 including your exams, quizzes, and live classes.</p></div><div class="screen-toolbar"><button class="filter-select" id="calPrev" aria-label="Previous month">\u2190</button><b id="calMonthLabel"></b><button class="filter-select" id="calNext" aria-label="Next month">\u2192</button><button class="filter-select" id="calToday">Today</button><select id="calKind" class="filter-select" aria-label="Filter by kind"><option value="">All kinds</option><option value="holiday">Holidays</option><option value="exam">Exams</option><option value="deadline">Deadlines</option><option value="event">Events</option></select></div><div class="cal-layout"><div class="cal-grid" id="calGrid" role="grid" aria-label="Month calendar"></div><section class="screen-panel cal-detail"><h3 id="calDetailTitle">Pick a day</h3><div id="calDetailBody"><p class="panel-copy">Select a day to see what\u2019s on.</p></div></section></div>`,
careers:`<div class="screen-title"><p class="eyebrow">YOUR FUTURE</p><h1>Career center</h1><p>Explore career paths, build the right skills, and find internships.</p></div><section class="screen-panel"><h3>Career paths</h3><div id="careerPaths"><p class="panel-copy">Loading\u2026</p></div></section><section class="screen-panel"><h3>Internships</h3><div id="internships"><p class="panel-copy">Loading\u2026</p></div></section>`,
placement:`<div class="screen-title"><p class="eyebrow">GET PLACEMENT-READY</p><h1>Placement prep</h1><p>Timed aptitude tests and mock interviews to sharpen your edge.</p></div><section class="screen-panel"><h3>Aptitude tests</h3><div id="aptList"><p class="panel-copy">Loading\u2026</p></div><div id="aptTake"></div></section><section class="screen-panel"><h3>Mock interviews</h3><div id="mockList"><p class="panel-copy">Loading\u2026</p></div></section>`});
portalScreens.student[0][1].push(['calendar','\u25e6','Calendar']);
portalScreens.student[1][1].push(['careers','\u2691','Career center'],['placement','\u25c8','Placement prep']);
portalScreens.teacher[0][1].push(['teacher-placement','\u25c8','Placement prep']);
portalScreens.teacher[1][1].push(['calendar','\u25e6','Calendar']);
portalScreens.parent[0][1].push(['calendar','\u25e6','Calendar'],['careers','\u2691','Career center']);
portalScreens.admin[0][1].push(['admin-events','\u25e6','Calendar events'],['admin-careers','\u2691','Careers']);

const calKindLabel={holiday:'Holiday',exam:'Exam',deadline:'Deadline',event:'Event'};
const calKindColor={holiday:'#b98a2f',exam:'#c0392b',deadline:'#e67e22',event:'#2a9d8f'};
const calState={y:0,m:0,events:[],loginDays:[],kind:'',selected:null};
function calStatus(id,msg){const el=document.querySelector(id);if(el)el.textContent=msg;}
function calLocalDay(iso){try{const d=new Date(iso);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}catch{return '';}}
function calTime(iso){try{return new Date(iso).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});}catch{return '';}}
function calEventsOn(day){return calState.events.filter(e=>(!calState.kind||e.kind===calState.kind)&&calLocalDay(e.startsAt)===day);}
async function loadCalendar(){
  const grid=document.querySelector('#calGrid');if(!grid)return;
  const now=new Date();calState.y=now.getFullYear();calState.m=now.getMonth();calState.selected=null;calState.kind='';
  const kindSel=document.querySelector('#calKind');
  if(kindSel&&!kindSel.dataset.wired){kindSel.dataset.wired='1';kindSel.addEventListener('change',()=>{calState.kind=kindSel.value;renderCalGrid();});}
  const wire=(id,fn)=>{const el=document.querySelector(id);if(el&&!el.dataset.wired){el.dataset.wired='1';el.addEventListener('click',fn);}};
  wire('#calPrev',()=>{calState.m--;if(calState.m<0){calState.m=11;calState.y--;}refreshCalendar();});
  wire('#calNext',()=>{calState.m++;if(calState.m>11){calState.m=0;calState.y++;}refreshCalendar();});
  wire('#calToday',()=>{const n=new Date();calState.y=n.getFullYear();calState.m=n.getMonth();refreshCalendar();});
  await refreshCalendar();
}
async function refreshCalendar(){await fetchCalEvents();renderCalGrid();}
async function fetchCalEvents(){
  const from=new Date(calState.y,calState.m,1).toISOString(),to=new Date(calState.y,calState.m+1,0,23,59,59).toISOString();
  try{const d=await apiRequest(`/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);calState.events=d.events||d.calendar||[];calState.loginDays=d.loginDays||[];}
  catch{calState.events=[];calState.loginDays=[];}
}
function renderCalGrid(){
  const grid=document.querySelector('#calGrid');if(!grid)return;
  const label=document.querySelector('#calMonthLabel');
  if(label)label.textContent=new Date(calState.y,calState.m,1).toLocaleDateString(undefined,{month:'long',year:'numeric'});
  const first=new Date(calState.y,calState.m,1).getDay(),days=new Date(calState.y,calState.m+1,0).getDate();
  const today=calLocalDay(new Date().toISOString());
  let html=['Su','Mo','Tu','We','Th','Fr','Sa'].map(w=>`<span class="cal-dow">${w}</span>`).join('');
  for(let i=0;i<first;i++)html+='<span class="cal-cell cal-blank"></span>';
  for(let d=1;d<=days;d++){
    const day=`${calState.y}-${String(calState.m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const evs=calEventsOn(day),pastOrToday=day<=today,presence=pastOrToday?`<i class="presence-dot ${calState.loginDays.includes(day)?'online':'offline'}" title="${calState.loginDays.includes(day)?'Signed in':'No sign-in recorded'}" aria-label="${calState.loginDays.includes(day)?'Signed in':'No sign-in recorded'}"></i>`:'',dots=presence+evs.slice(0,4).map(e=>`<i style="background:${calKindColor[e.kind]||calKindColor.event}"></i>`).join('');
    html+=`<button class="cal-cell${day===today?' cal-today':''}${day===calState.selected?' cal-selected':''}" data-cal-day="${day}" role="gridcell" aria-label="${day}, ${evs.length} events"><b>${d}</b><span class="cal-dots">${dots}${evs.length>4?'<i class="cal-more"></i>':''}</span></button>`;
  }
  grid.innerHTML=html;
  grid.querySelectorAll('[data-cal-day]').forEach(b=>b.addEventListener('click',()=>selectCalDay(b.dataset.calDay)));
  if(calState.selected)selectCalDay(calState.selected,true);
}
function selectCalDay(day,keep){
  calState.selected=day;
  document.querySelectorAll('[data-cal-day]').forEach(b=>b.classList.toggle('cal-selected',b.dataset.calDay===day));
  const title=document.querySelector('#calDetailTitle'),body=document.querySelector('#calDetailBody');
  if(!body)return;
  const evs=calEventsOn(day).sort((a,b)=>String(a.startsAt).localeCompare(String(b.startsAt)));
  if(title)title.textContent=new Date(day+'T12:00:00').toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
  body.innerHTML=evs.length?evs.map(e=>`<div class="cal-event"><span class="cal-pill" style="background:${calKindColor[e.kind]||calKindColor.event}">${safeText(calKindLabel[e.kind]||'Event')}</span><b>${safeText(e.title)}</b><small>${safeText(calTime(e.startsAt))}${e.endsAt?' \u2013 '+safeText(calTime(e.endsAt)):''}${e.source&&e.source!=='stored'?' · auto':''}</small>${e.description?`<p>${safeText(e.description)}</p>`:''}</div>`).join(''):'<p class="panel-copy">Nothing scheduled this day.</p>';
}
/* --- admin calendar events --- */
async function loadAdminEvents(){
  const list=document.querySelector('#calAdminList');if(!list)return;
  await renderCalAdminList();
  const cancel=document.querySelector('#calEventCancel');
  if(cancel&&!cancel.dataset.wired){cancel.dataset.wired='1';cancel.addEventListener('click',()=>{const f=document.querySelector('#calEventForm');if(f)f.reset();const hid=document.querySelector('#calEventId');if(hid)hid.value='';const sb=document.querySelector('#calEventSubmit');if(sb)sb.textContent='Add event \u2192';cancel.hidden=true;});}
}
async function renderCalAdminList(){
  const list=document.querySelector('#calAdminList');if(!list)return;
  try{
    const d=await apiRequest('/admin/calendar');
    const evs=(d.events||d.calendar||[]).slice().sort((a,b)=>String(a.startsAt).localeCompare(String(b.startsAt)));
    list.innerHTML=evs.length?evs.map(e=>`<div class="teacher-record"><b>${safeText(e.title)}</b><small><span class="cal-pill" style="background:${calKindColor[e.kind]||calKindColor.event}">${safeText(calKindLabel[e.kind]||'Event')}</span> ${safeText(calTime(e.startsAt))}</small><span class="lms-row-actions"><button class="filter-select" data-cal-edit="${safeText(e.id)}">Edit</button> <button class="filter-select" data-cal-del="${safeText(e.id)}">Delete</button></span></div>`).join(''):'<p class="panel-copy">No events yet. Add the first one above.</p>';
  }catch(err){list.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
/* --- careers --- */
let careerCourseMap=new Map();
async function loadCareers(){
  const p=document.querySelector('#careerPaths');if(!p)return;
  try{const c=await apiRequest('/courses');careerCourseMap=new Map((c.courses||[]).map(x=>[x.id,x]));}catch{careerCourseMap=new Map();}
  try{
    const d=await apiRequest('/career-paths');
    const paths=d.careerPaths||d.paths||[];
    p.innerHTML=paths.length?`<div class="career-grid">`+paths.map(pt=>`<article class="career-card"><p class="eyebrow">${safeText((pt.skills||[]).slice(0,3).join(' \u00B7 ')||'CAREER PATH')}</p><h3>${safeText(pt.title)}</h3><p>${safeText(pt.description||'')}</p><div class="chip-row">${(pt.skills||[]).map(s=>`<span class="chip">${safeText(s)}</span>`).join('')}</div><div class="career-courses">${(pt.courses||[]).map(cid=>{const c=careerCourseMap.get(cid);return c?`<button class="chip chip-link" data-career-course="${safeText(cid)}">${safeText(c.title)} \u2192</button>`:'';}).join('')||'<small class="panel-copy">No linked courses yet.</small>'}</div></article>`).join('')+`</div>`:'<p class="panel-copy">No career paths published yet.</p>';
  }catch(err){p.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
  const box=document.querySelector('#internships');
  try{
    const d=await apiRequest('/internships');
    const items=d.internships||[];
    const isStudent=currentUser&&currentUser.role==='student';
    box.innerHTML=items.length?`<div class="career-grid">`+items.map(it=>{
      const applied=it.applied||(it.applications||[]).some(a=>String(a.studentId||a.id||a)===String(currentUser&&currentUser.id));
      return `<article class="career-card"><p class="eyebrow">${safeText(it.company||'INTERNSHIP')}</p><h3>${safeText(it.role||'')}</h3><p>${safeText(it.description||'')}</p><div class="chip-row">${it.location?`<span class="chip">${safeText(it.location)}</span>`:''}${it.stipend?`<span class="chip">\u20B9 ${safeText(String(it.stipend))}</span>`:''}${it.deadline?`<span class="chip">Apply by ${safeText(new Date(it.deadline).toLocaleDateString())}</span>`:''}</div><div class="career-actions">${isStudent&&!applied?`<button class="primary-btn" data-intern-apply="${safeText(it.id)}">Apply \u2192</button>`:''}${isStudent&&applied?`<span class="chip chip-done">\u2713 Applied</span>`:''}${it.applyUrl?`<a class="filter-select" href="${safeText(it.applyUrl)}" target="_blank" rel="noopener">External application \u2197</a>`:''}</div></article>`;
    }).join('')+`</div>`:'<p class="panel-copy">No internships posted yet.</p>';
  }catch(err){box.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
/* --- admin careers --- */
async function loadAdminCareers(){
  if(!document.querySelector('#careerPathList'))return;
  try{const c=await apiRequest('/courses');const sel=document.querySelector('#careerPathCourses');if(sel)sel.innerHTML=(c.courses||[]).map(x=>`<option value="${safeText(x.id)}">${safeText(x.title)}</option>`).join('');}catch{}
  await Promise.all([renderCareerPathList(),renderInternshipList()]);
  const wireCancel=(id,hid,sb,txt)=>{const c=document.querySelector(id);if(c&&!c.dataset.wired){c.dataset.wired='1';c.addEventListener('click',()=>{const h=document.querySelector(hid);if(h)h.value='';const s=document.querySelector(sb);if(s)s.textContent=txt;c.hidden=true;});}};
  wireCancel('#careerPathCancel','#careerPathId','#careerPathForm .primary-btn','Save path \u2192');
  wireCancel('#internshipCancel','#internshipId','#internshipForm .primary-btn','Save internship \u2192');
}
async function renderCareerPathList(){
  const box=document.querySelector('#careerPathList');if(!box)return;
  try{const d=await apiRequest('/admin/career-paths');const paths=d.careerPaths||d.paths||[];
    box.innerHTML=paths.length?paths.map(pt=>`<div class="teacher-record"><b>${safeText(pt.title)}</b><small>${(pt.skills||[]).join(', ')||'No skills listed'} · ${(pt.courses||[]).length} linked course${(pt.courses||[]).length===1?'':'s'}</small><span class="lms-row-actions"><button class="filter-select" data-path-edit="${safeText(pt.id)}">Edit</button> <button class="filter-select" data-path-del="${safeText(pt.id)}">Delete</button></span></div>`).join(''):'<p class="panel-copy">No career paths yet.</p>';
  }catch(err){box.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
async function renderInternshipList(){
  const box=document.querySelector('#internshipList');if(!box)return;
  try{const d=await apiRequest('/admin/internships');const items=d.internships||[];
    box.innerHTML=items.length?items.map(it=>`<div class="teacher-record"><b>${safeText(it.company)} \u2014 ${safeText(it.role)}</b><small>${(it.applications||[]).length} application${(it.applications||[]).length===1?'':'s'}${it.deadline?' · Apply by '+safeText(new Date(it.deadline).toLocaleDateString()):''}</small><span class="lms-row-actions"><button class="filter-select" data-int-edit="${safeText(it.id)}">Edit</button> <button class="filter-select" data-int-del="${safeText(it.id)}">Delete</button></span></div>`).join(''):'<p class="panel-copy">No internships yet.</p>';
  }catch(err){box.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
/* --- placement (student) --- */
const aptState={attemptId:null,questions:[],timer:null,testId:null,timeMin:0};
function aptClearTimer(){if(aptState.timer){clearInterval(aptState.timer);aptState.timer=null;}}
async function loadPlacement(){
  const box=document.querySelector('#aptList');if(!box)return;
  aptClearTimer();
  await Promise.all([loadAptList(),loadMockList()]);
}
async function loadAptList(){
  const box=document.querySelector('#aptList');if(!box)return;
  let d={};
  try{d=await apiRequest('/aptitude');}catch(e){try{d=await apiRequest('/teacher/aptitude');}catch{d={};}}
  const tests=d.aptitudeTests||d.tests||[];
  aptState._tests=tests;
  box.innerHTML=tests.length?tests.map(t=>`<div class="teacher-record"><b>${safeText(t.title)}</b><small>${(t.questions||[]).length} questions · ${t.timeMin||'\u2014'} min</small><span class="lms-row-actions"><button class="filter-select" data-apt-start="${safeText(t.id)}">Start \u2192</button></span></div>`).join(''):'<p class="panel-copy">No aptitude tests yet.</p>';
}
async function aptStart(id){
  const box=document.querySelector('#aptTake');if(!box)return;
  aptClearTimer();box.innerHTML='<p class="panel-copy">Loading test\u2026</p>';
  try{
    const d=await apiRequest(`/aptitude/${encodeURIComponent(id)}/start`,{method:'POST'});
    const qs=d.questions||[];
    if(!qs.length){box.innerHTML='<p class="panel-copy">This test has no questions.</p>';return;}
    aptState.attemptId=d.attemptId||d.attempt_id||null;aptState.questions=qs;aptState.testId=id;
    const meta=(aptState._tests||[]).find(t=>String(t.id)===String(id));
    aptState.timeMin=d.timeMin||meta&&meta.timeMin||30;
    const endsAt=Date.now()+aptState.timeMin*60000;
    box.innerHTML=`<div class="apt-take"><div class="apt-timer" role="timer" aria-live="polite">\u23F1 <b id="aptClock"></b></div>${qs.map((q,i)=>`<div class="apt-q"><p><b>Q${i+1}.</b> ${safeText(q.q||q.question||'')}</p>${(q.choices||[]).map((c,j)=>`<label class="auth-check"><input type="radio" name="aptq${i}" value="${j}"> ${safeText(c)}</label>`).join('')}</div>`).join('')}<button class="primary-btn" data-apt-submit>Submit answers \u2192</button><p class="panel-copy" id="aptTakeStatus" role="status"></p></div>`;
    const clock=document.querySelector('#aptClock');
    const tick=()=>{const left=Math.max(0,endsAt-Date.now());const mm=Math.floor(left/60000),ss=Math.floor(left%60000/1000);if(clock)clock.textContent=`${mm}:${String(ss).padStart(2,'0')} left`;if(left<=0){aptClearTimer();aptSubmit(true);}};
    tick();aptState.timer=setInterval(tick,1000);
    box.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(err){box.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
async function aptSubmit(auto){
  const box=document.querySelector('#aptTake');if(!box)return;
  aptClearTimer();
  const answers=aptState.questions.map((_,i)=>{const sel=box.querySelector(`input[name="aptq${i}"]:checked`);return sel?Number(sel.value):-1;});
  try{
    const d=await apiRequest(`/aptitude/${encodeURIComponent(aptState.testId)}/submit`,{method:'POST',body:JSON.stringify({attemptId:aptState.attemptId,answers})});
    const score=d.score,total=d.total||aptState.questions.length;
    box.innerHTML=`<div class="apt-result"><p class="eyebrow">${auto?'TIME UP':'TEST SUBMITTED'}</p><h3>You scored ${safeText(String(score))} / ${safeText(String(total))}</h3><p class="panel-copy">${score===total?'Perfect \u2014 outstanding work.':score/total>=0.6?'Good attempt \u2014 review the ones you missed and try again.':'Keep practicing \u2014 every attempt makes you sharper.'}</p><button class="filter-select" data-apt-retry="${safeText(aptState.testId)}">Try again</button></div>`;
  }catch(err){const st=document.querySelector('#aptTakeStatus');if(st)st.textContent=err.message;else box.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
async function loadMockList(){
  const box=document.querySelector('#mockList');if(!box)return;
  let d={};try{d=await apiRequest('/mock-interviews');}catch{d={};}
  const all=d.mockInterviews||d.interviews||[];
  const me=currentUser&&currentUser.id;
  const open=all.filter(x=>x.status==='open'&&!x.studentId);
  const mine=all.filter(x=>String(x.studentId)===String(me));
  let html='';
  if(open.length)html+=`<h4>Open slots</h4>`+open.map(x=>`<div class="teacher-record"><b>${safeText(x.title)}</b><small>${safeText(x.kind||'')} interview · ${(x.questions||[]).length} questions${x.scheduledFor?' · '+safeText(calTime(x.scheduledFor)):''}</small><span class="lms-row-actions"><button class="filter-select" data-mock-book="${safeText(x.id)}">Book slot \u2192</button></span></div>`).join('');
  if(mine.length)html+=`<h4>My interviews</h4>`+mine.map(x=>`<div class="teacher-record"><b>${safeText(x.title)}</b><small>${safeText(x.status||'')}${x.scheduledFor?' · '+safeText(calTime(x.scheduledFor)):''}</small>${x.feedback?`<p class="panel-copy"><b>Feedback:</b> ${safeText(x.feedback)}</p>`:''}</div>`).join('');
  box.innerHTML=html||'<p class="panel-copy">No mock interviews scheduled yet.</p>';
}
/* --- teacher placement --- */
async function loadTeacherPlacement(){
  if(!document.querySelector('#aptTestList'))return;
  await Promise.all([renderAptTestList(),renderMockInterviewList()]);
}
async function renderAptTestList(){
  const box=document.querySelector('#aptTestList');if(!box)return;
  try{const d=await apiRequest('/teacher/aptitude');const tests=d.aptitudeTests||d.tests||[];
    box.innerHTML=tests.length?tests.map(t=>`<div class="teacher-record"><b>${safeText(t.title)}</b><small>${(t.questions||[]).length} questions · ${t.timeMin||'\u2014'} min</small><span class="lms-row-actions"><button class="filter-select" data-apt-del="${safeText(t.id)}">Delete</button></span></div>`).join(''):'<p class="panel-copy">No aptitude tests yet.</p>';
  }catch(err){box.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
async function renderMockInterviewList(){
  const box=document.querySelector('#mockInterviewList');if(!box)return;
  let d={};try{d=await apiRequest('/teacher/mock-interviews');}catch(e){try{d=await apiRequest('/mock-interviews');}catch{d={};}}
  const all=d.mockInterviews||d.interviews||[];
  box.innerHTML=all.length?all.map(x=>`<div class="teacher-record"><b>${safeText(x.title)}</b><small>${safeText(x.kind||'')} · ${safeText(x.status||'open')}${x.studentId?' · booked by '+safeText(x.studentName||x.studentId):''}${x.scheduledFor?' · '+safeText(calTime(x.scheduledFor)):''}</small>${x.status==='scheduled'&&!x.feedback?`<form class="teacher-form mock-feedback-form" data-mock-id="${safeText(x.id)}" style="margin-top:8px"><textarea aria-label="Feedback for the learner" name="feedback" rows="2" maxlength="3000" placeholder="Feedback for the learner" required></textarea><button class="primary-btn">Save feedback \u2192</button></form>`:''}${x.feedback?`<p class="panel-copy"><b>Feedback:</b> ${safeText(x.feedback)}</p>`:''}<span class="lms-row-actions"><button class="filter-select" data-mock-del="${safeText(x.id)}">Delete</button></span></div>`).join(''):'<p class="panel-copy">No mock interviews yet.</p>';
}
function parseAptQuestions(text){
  return String(text||'').split('\n').map(l=>l.trim()).filter(Boolean).map(line=>{
    const parts=line.split('||').map(s=>s.trim());
    if(parts.length<3)throw new Error('Each line needs: question || choices | separated | with | pipes || correct number');
    const choices=parts[1].split('|').map(s=>s.trim()).filter(Boolean);
    const answer=Number(parts[2])-1;
    if(!parts[0]||choices.length<2||!(answer>=0&&answer<choices.length))throw new Error('Bad line: "'+line.slice(0,60)+'" \u2014 check the correct choice number');
    return {q:parts[0],choices,answer};
  });
}
/* --- wiring: navigate hooks, clicks, submits --- */
document.addEventListener('click',async e=>{
  const t=e.target;
  const courseBtn=t.closest('[data-career-course]');if(courseBtn){navigate('catalog');return;}
  const applyBtn=t.closest('[data-intern-apply]');
  if(applyBtn){const b=applyBtn;b.disabled=true;try{await apiRequest(`/internships/${encodeURIComponent(applyBtn.dataset.internApply)}/apply`,{method:'POST'});await loadCareers();}catch(err){alert(err.message);b.disabled=false;}return;}
  const aptBtn=t.closest('[data-apt-start]');if(aptBtn){aptStart(aptBtn.dataset.aptStart);return;}
  const retryBtn=t.closest('[data-apt-retry]');if(retryBtn){aptStart(retryBtn.dataset.aptRetry);return;}
  if(t.closest('[data-apt-submit]')){aptSubmit(false);return;}
  const bookBtn=t.closest('[data-mock-book]');
  if(bookBtn){bookBtn.disabled=true;try{await apiRequest(`/mock-interviews/${encodeURIComponent(bookBtn.dataset.mockBook)}/book`,{method:'POST'});await loadMockList();}catch(err){alert(err.message);bookBtn.disabled=false;}return;}
  const calEdit=t.closest('[data-cal-edit]');
  if(calEdit){try{const d=await apiRequest('/admin/calendar');const ev=(d.events||d.calendar||[]).find(x=>String(x.id)===String(calEdit.dataset.calEdit));if(!ev)return;const f=document.querySelector('#calEventForm');if(!f)return;f.title.value=ev.title||'';f.kind.value=ev.kind||'event';f.startsAt.value=String(ev.startsAt||'').slice(0,16);f.endsAt.value=String(ev.endsAt||'').slice(0,16);f.description.value=ev.description||'';document.querySelector('#calEventId').value=ev.id;document.querySelector('#calEventSubmit').textContent='Save changes \u2192';document.querySelector('#calEventCancel').hidden=false;f.scrollIntoView({behavior:'smooth'});}catch(err){alert(err.message);}return;}
  const calDel=t.closest('[data-cal-del]');
  if(calDel){if(!confirm('Delete this event?'))return;try{await apiRequest(`/admin/calendar/${encodeURIComponent(calDel.dataset.calDel)}`,{method:'DELETE'});await renderCalAdminList();}catch(err){alert(err.message);}return;}
  const pathEdit=t.closest('[data-path-edit]');
  if(pathEdit){try{const d=await apiRequest('/admin/career-paths');const pt=(d.careerPaths||d.paths||[]).find(x=>String(x.id)===String(pathEdit.dataset.pathEdit));if(!pt)return;const f=document.querySelector('#careerPathForm');if(!f)return;f.title.value=pt.title||'';f.description.value=pt.description||'';f.skills.value=(pt.skills||[]).join(', ');const sel=document.querySelector('#careerPathCourses');if(sel)[...sel.options].forEach(o=>o.selected=(pt.courses||[]).includes(o.value));document.querySelector('#careerPathId').value=pt.id;f.querySelector('.primary-btn').textContent='Save changes \u2192';document.querySelector('#careerPathCancel').hidden=false;f.scrollIntoView({behavior:'smooth'});}catch(err){alert(err.message);}return;}
  const pathDel=t.closest('[data-path-del]');
  if(pathDel){if(!confirm('Delete this career path?'))return;try{await apiRequest(`/admin/career-paths/${encodeURIComponent(pathDel.dataset.pathDel)}`,{method:'DELETE'});await renderCareerPathList();}catch(err){alert(err.message);}return;}
  const intEdit=t.closest('[data-int-edit]');
  if(intEdit){try{const d=await apiRequest('/admin/internships');const it=(d.internships||[]).find(x=>String(x.id)===String(intEdit.dataset.intEdit));if(!it)return;const f=document.querySelector('#internshipForm');if(!f)return;f.company.value=it.company||'';f.role.value=it.role||'';f.description.value=it.description||'';f.location.value=it.location||'';f.stipend.value=it.stipend||'';f.applyUrl.value=it.applyUrl||'';f.deadline.value=String(it.deadline||'').slice(0,10);document.querySelector('#internshipId').value=it.id;f.querySelector('.primary-btn').textContent='Save changes \u2192';document.querySelector('#internshipCancel').hidden=false;f.scrollIntoView({behavior:'smooth'});}catch(err){alert(err.message);}return;}
  const intDel=t.closest('[data-int-del]');
  if(intDel){if(!confirm('Delete this internship?'))return;try{await apiRequest(`/admin/internships/${encodeURIComponent(intDel.dataset.intDel)}`,{method:'DELETE'});await renderInternshipList();}catch(err){alert(err.message);}return;}
  const aptDel=t.closest('[data-apt-del]');
  if(aptDel){if(!confirm('Delete this aptitude test?'))return;try{await apiRequest(`/teacher/aptitude/${encodeURIComponent(aptDel.dataset.aptDel)}`,{method:'DELETE'});await renderAptTestList();}catch(err){alert(err.message);}return;}
  const mockDel=t.closest('[data-mock-del]');
  if(mockDel){if(!confirm('Delete this mock interview?'))return;try{await apiRequest(`/teacher/mock-interviews/${encodeURIComponent(mockDel.dataset.mockDel)}`,{method:'DELETE'});await renderMockInterviewList();}catch(err){alert(err.message);}return;}
});
document.addEventListener('submit',async e=>{
  const careerSetStatus=(id,msg)=>{const el=document.querySelector(id);if(el)el.textContent=msg;};
  if(e.target.id==='calEventForm'){e.preventDefault();const f=e.target,body=Object.fromEntries(new FormData(f));if(!body.endsAt)delete body.endsAt;const id=body.id;delete body.id;try{if(id){await apiRequest(`/admin/calendar/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)});careerSetStatus('#calEventStatus','Event updated.');}else{await apiRequest('/admin/calendar',{method:'POST',body:JSON.stringify(body)});careerSetStatus('#calEventStatus','Event added to the calendar.');}f.reset();document.querySelector('#calEventId').value='';document.querySelector('#calEventSubmit').textContent='Add event \u2192';document.querySelector('#calEventCancel').hidden=true;await renderCalAdminList();}catch(err){careerSetStatus('#calEventStatus',err.message);}return;}
  if(e.target.id==='careerPathForm'){e.preventDefault();const f=e.target,fd=new FormData(f);const body={title:String(fd.get('title')||'').trim(),description:String(fd.get('description')||'').trim(),skills:String(fd.get('skills')||'').split(',').map(s=>s.trim()).filter(Boolean),courses:[...f.querySelector('#careerPathCourses').selectedOptions].map(o=>o.value)};const id=String(fd.get('id')||'');try{if(id){await apiRequest(`/admin/career-paths/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)});careerSetStatus('#careerPathStatus','Career path updated.');}else{await apiRequest('/admin/career-paths',{method:'POST',body:JSON.stringify(body)});careerSetStatus('#careerPathStatus','Career path published.');}f.reset();document.querySelector('#careerPathId').value='';f.querySelector('.primary-btn').textContent='Save path \u2192';document.querySelector('#careerPathCancel').hidden=true;await renderCareerPathList();}catch(err){careerSetStatus('#careerPathStatus',err.message);}return;}
  if(e.target.id==='internshipForm'){e.preventDefault();const f=e.target,body=Object.fromEntries(new FormData(f));['description','location','stipend','applyUrl','deadline'].forEach(k=>{if(!body[k])delete body[k];});const id=body.id;delete body.id;try{if(id){await apiRequest(`/admin/internships/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)});careerSetStatus('#internshipStatus','Internship updated.');}else{await apiRequest('/admin/internships',{method:'POST',body:JSON.stringify(body)});careerSetStatus('#internshipStatus','Internship posted.');}f.reset();document.querySelector('#internshipId').value='';f.querySelector('.primary-btn').textContent='Save internship \u2192';document.querySelector('#internshipCancel').hidden=true;await renderInternshipList();}catch(err){careerSetStatus('#internshipStatus',err.message);}return;}
  if(e.target.id==='aptTestForm'){e.preventDefault();const f=e.target;try{const questions=parseAptQuestions(f.questions.value);if(!questions.length)throw new Error('Add at least one question.');const body={title:f.title.value.trim(),timeMin:Math.max(1,Number(f.timeMin.value)||30),questions};await apiRequest('/teacher/aptitude',{method:'POST',body:JSON.stringify(body)});careerSetStatus('#aptTestStatus','Aptitude test created.');f.reset();await renderAptTestList();}catch(err){careerSetStatus('#aptTestStatus',err.message);}return;}
  if(e.target.id==='mockInterviewForm'){e.preventDefault();const f=e.target;try{const questions=String(f.questions.value||'').split('\n').map(s=>s.trim()).filter(Boolean);const body={title:f.title.value.trim(),kind:f.kind.value,questions};if(f.scheduledFor.value)body.scheduledFor=f.scheduledFor.value;await apiRequest('/teacher/mock-interviews',{method:'POST',body:JSON.stringify(body)});careerSetStatus('#mockInterviewStatus','Mock interview created.');f.reset();await renderMockInterviewList();}catch(err){careerSetStatus('#mockInterviewStatus',err.message);}return;}
  if(e.target.matches('.mock-feedback-form')){e.preventDefault();const f=e.target,id=f.dataset.mockId,body={feedback:f.feedback.value.trim()};try{try{await apiRequest(`/teacher/mock-interviews/${encodeURIComponent(id)}/feedback`,{method:'POST',body:JSON.stringify(body)});}catch(err){if(!/not found|404/i.test(err.message))throw err;await apiRequest(`/mock-interviews/${encodeURIComponent(id)}/feedback`,{method:'POST',body:JSON.stringify(body)});}await renderMockInterviewList();}catch(err){alert(err.message);}return;}
});
/* ---------- Slice 4: language learning + multi-language UI + accessibility ---------- */
const UI_LANGS=['en','hi','ta','bn','mr'];
const UI_LANG_NAMES={en:'English',hi:'हिन्दी',ta:'தமிழ்',bn:'বাংলা',mr:'मराठी'};
const UI_STRINGS={
en:{nav_overview:'Overview',nav_player:'My learning labs',nav_twin:'Learning twin',nav_community:'Community',nav_campus:'3D Campus',nav_classroom:'Classroom',nav_library:'Library',nav_library_teaching:'Teaching library',nav_notes:'My notes',nav_syllabus:'Coding paths',nav_calendar:'Calendar',nav_video_player:'My videos',nav_quizzes:'Quizzes',nav_certificates:'Certificates',nav_discussions:'Discussions',nav_live_classes:'Live classes',nav_billing:'Billing',nav_leaderboard:'Leaderboard',nav_catalog:'Course catalog',nav_marketplace:'Marketplace',nav_assignments:'Assignments',nav_fees:'My fees',nav_today:'My class today',nav_timetable:'Timetable',nav_profile:'Progress & profile',nav_notifications:'Notifications',nav_feedback:'Send feedback',nav_careers:'Career center',nav_placement:'Placement prep',nav_language_lab:'Language lab',nav_teacher:'Dashboard',nav_teacher_classes:'My classes',nav_teacher_students:'Students',nav_teacher_attendance:'Attendance',nav_teacher_courses:'Courses',nav_teacher_assignments:'Assignments',nav_teacher_grading:'Grading',nav_teacher_analytics:'Learning analytics',nav_teacher_timetable:'Timetable',nav_teacher_placement:'Placement prep',nav_teacher_language:'Language lab',nav_teacher_quizzes:'Quizzes',nav_question_bank:'Question bank',nav_drawing:'Webcam drawing',nav_vision_labs:'Vision & simulation lab',nav_teacher_announcements:'Announcements',nav_announcements:'Institution notices',nav_teacher_vision:'Vision lab assignments',nav_teacher_settings:'Account security',nav_reading_lists:'Reading lists',nav_parent_dashboard:'Dashboard',nav_admin:'Overview',nav_admin_users:'Users & approvals',nav_admin_teachers:'Teachers',nav_admin_students:'Students',nav_admin_classes:'Classes & enrollment',nav_admin_courses:'Courses',nav_admin_institutions:'Institutions & terms',nav_admin_calendar:'Academic calendar',nav_admin_enrollments:'Enrollments',nav_admin_fees:'Fees',nav_admin_subscriptions:'Subscriptions',nav_admin_marketplace:'Marketplace',nav_admin_events:'Calendar events',nav_admin_careers:'Careers',nav_admin_library:'Library',nav_admin_roles:'Roles & permissions',nav_admin_reports:'Reports',nav_admin_import:'Bulk import',nav_admin_analytics:'Usage analytics',nav_admin_audit:'Audit log',nav_admin_security:'Security & MFA',nav_admin_announcements:'Announcements',nav_admin_settings:'Platform settings',nav_admin_integrations:'Integrations',nav_admin_backup:'Backup & restore',
grp_learn:'LEARN',grp_your_space:'YOUR SPACE',grp_teaching:'TEACHING',grp_classroom_support:'CLASSROOM & SUPPORT',grp_family:'FAMILY',grp_account:'ACCOUNT',grp_control_center:'CONTROL CENTER',grp_governance_reports:'GOVERNANCE & REPORTS',
btn_save:'Save',btn_cancel:'Cancel',btn_delete:'Delete',btn_edit:'Edit',btn_create:'Create',btn_close:'Close',btn_back:'Back',btn_send:'Send',btn_signin:'Sign in',btn_signup:'Sign up',btn_submit:'Submit',btn_continue:'Continue',
hdr_search_ph:'Search courses, lessons, quizzes…',hdr_search_label:'Search courses, lessons, and quizzes',hdr_back:'Go back',hdr_notifications:'Notifications',hdr_language:'Interface language',
a11y_skip:'Skip to main content',
auth_welcome_kicker:'A WORLD OF LEARNING, BUILT FOR YOU',auth_welcome_title:'Learning beyond<br><span>boundaries.</span>',auth_welcome_sub:'Create an account to get started. After signup, sign in to open your own learning or teaching workspace.',auth_hl1:'◈ Immersive learning',auth_hl2:'▣ Virtual classrooms',auth_hl3:'✦ Vision lab',auth_signup_first:'Sign up first →',auth_signin_existing:'Already signed up? Sign in',auth_setup_admin:'Set up administrator account',auth_your_eduverse:'YOUR EDUVERSE',auth_choose_space:'Choose your learning space',auth_choose_space_sub:'Accounts use their assigned role after sign in.',role_student:'Student',role_student_copy:'Learn, explore, and track your progress.',role_teacher:'Teacher',role_teacher_copy:'Manage classes and guide learners.',role_parent:'Parent',role_parent_copy:'Follow your child’s progress, attendance and results.',role_admin:'Administrator',role_admin_copy:'Manage users and platform settings.',auth_roles_kicker:'GET STARTED',auth_roles_title:'Choose your role',auth_roles_sub:'Teacher accounts need approval. Administrator accounts are created through first-time setup, then by an existing administrator.',auth_roles_student_copy:'Learn, explore, complete assignments, and track progress.',auth_roles_teacher_copy:'Create learning experiences and guide students.',auth_roles_parent_copy:'Follow progress, attendance and results.',auth_continue:'Continue →',auth_back:'Back',auth_signin_kicker:'WELCOME BACK',auth_signin_title:'Sign in to EduVerse',auth_signin_sub:'Use your username and password. You can add your Gmail and mobile number after signing in.',auth_admin_nudge:'No administrator account yet? Create it here — no terminal steps needed. If an administrator already exists, ask them to create your account from Users & approvals. Administrator accounts can never be created through public registration.',auth_create_first_admin:'Create the first administrator account →',auth_field_user:'Username or email address',auth_field_password:'Password',auth_field_mfa:'Authenticator code (only if MFA is enabled)',auth_forgot:'Forgot password?',auth_signin_btn:'Sign in →',auth_new_here:'New to EduVerse?',auth_create_account:'Create an account',auth_signup_title:'Create your account',auth_account_word:'ACCOUNT',auth_signup_teacher_sub:'Teacher signup uses a demo OTP and requests administrator approval.',auth_signup_parent_sub:'Parent accounts need no approval. After signing in, link your child with their 8-character code.',auth_signup_student_sub:'Create your learner account with a username. Gmail and mobile details are added after sign-in.',auth_field_name:'Full name',auth_field_username:'Username',auth_field_password12:'Password (12+ characters)',auth_field_confirm:'Confirm password',auth_create_btn:'Create account →',auth_have_account:'Already have an account?',auth_signin_link:'Sign in',auth_setup_kicker:'ADMINISTRATOR SETUP',auth_setup_title:'Create the first administrator',auth_setup_sub:'Use your setup code and demo OTP. Add your Gmail and mobile number after signing in.',auth_field_setup_code:'Administrator setup code',auth_create_admin_btn:'Create administrator account →',auth_forgot_kicker:'ACCOUNT RECOVERY',auth_forgot_title:'Reset your password',auth_forgot_sub:'Email delivery is not configured in this local build. Ask an administrator to issue you a one-time recovery code, then enter it below with a new 12+ character password.',auth_field_email:'Email address',auth_request_recovery:'Request recovery →',auth_field_recovery_code:'Recovery code',auth_field_new_password:'New password (12+ characters)',auth_set_password:'Set new password →',auth_back_to_signin:'Back to sign in',auth_footer:'Camera access stays off until you choose a webcam activity.',auth_back_btn:'← Back'},
hi:{nav_overview:'अवलोकन',nav_player:'मेरे लर्निंग लैब',nav_twin:'लर्निंग ट्विन',nav_community:'समुदाय',nav_campus:'3D कैंपस',nav_classroom:'कक्षा',nav_library:'पुस्तकालय',nav_library_teaching:'शिक्षण पुस्तकालय',nav_notes:'मेरे नोट्स',nav_syllabus:'कोडिंग पथ',nav_calendar:'कैलेंडर',nav_video_player:'मेरे वीडियो',nav_quizzes:'क्विज़',nav_certificates:'प्रमाणपत्र',nav_discussions:'चर्चाएँ',nav_live_classes:'लाइव कक्षाएँ',nav_billing:'बिलिंग',nav_leaderboard:'लीडरबोर्ड',nav_catalog:'पाठ्यक्रम सूची',nav_marketplace:'मार्केटप्लेस',nav_assignments:'असाइनमेंट',nav_fees:'मेरी फीस',nav_today:'आज की कक्षा',nav_timetable:'समय-सारणी',nav_profile:'प्रगति और प्रोफ़ाइल',nav_notifications:'सूचनाएँ',nav_feedback:'प्रतिक्रिया भेजें',nav_careers:'करियर केंद्र',nav_placement:'प्लेसमेंट तैयारी',nav_language_lab:'भाषा प्रयोगशाला',nav_teacher:'डैशबोर्ड',nav_teacher_classes:'मेरी कक्षाएँ',nav_teacher_students:'छात्र',nav_teacher_attendance:'उपस्थिति',nav_teacher_courses:'पाठ्यक्रम',nav_teacher_assignments:'असाइनमेंट',nav_teacher_grading:'मूल्यांकन',nav_teacher_analytics:'लर्निंग एनालिटिक्स',nav_teacher_timetable:'समय-सारणी',nav_teacher_placement:'प्लेसमेंट तैयारी',nav_teacher_language:'भाषा प्रयोगशाला',nav_teacher_quizzes:'क्विज़',nav_question_bank:'प्रश्न बैंक',nav_drawing:'वेबकैम ड्राइंग',nav_vision_labs:'विज़न व सिमुलेशन लैब',nav_teacher_announcements:'घोषणाएँ',nav_announcements:'संस्थान सूचनाएँ',nav_teacher_vision:'विज़न लैब असाइनमेंट',nav_teacher_settings:'खाता सुरक्षा',nav_reading_lists:'पठन सूचियाँ',nav_parent_dashboard:'डैशबोर्ड',nav_admin:'अवलोकन',nav_admin_users:'उपयोगकर्ता व अनुमोदन',nav_admin_teachers:'शिक्षक',nav_admin_students:'छात्र',nav_admin_classes:'कक्षाएँ व नामांकन',nav_admin_courses:'पाठ्यक्रम',nav_admin_institutions:'संस्थान व सत्र',nav_admin_calendar:'शैक्षणिक कैलेंडर',nav_admin_enrollments:'नामांकन',nav_admin_fees:'फीस',nav_admin_subscriptions:'सदस्यताएँ',nav_admin_marketplace:'मार्केटप्लेस',nav_admin_events:'कैलेंडर कार्यक्रम',nav_admin_careers:'करियर',nav_admin_library:'पुस्तकालय',nav_admin_roles:'भूमिकाएँ व अनुमतियाँ',nav_admin_reports:'रिपोर्ट',nav_admin_import:'थोक आयात',nav_admin_analytics:'उपयोग विश्लेषण',nav_admin_audit:'ऑडिट लॉग',nav_admin_security:'सुरक्षा व MFA',nav_admin_announcements:'घोषणाएँ',nav_admin_settings:'प्लेटफ़ॉर्म सेटिंग्स',nav_admin_integrations:'एकीकरण',nav_admin_backup:'बैकअप व पुनर्स्थापना',
grp_learn:'सीखें',grp_your_space:'आपका स्थान',grp_teaching:'शिक्षण',grp_classroom_support:'कक्षा व सहायता',grp_family:'परिवार',grp_account:'खाता',grp_control_center:'नियंत्रण केंद्र',grp_governance_reports:'प्रशासन व रिपोर्ट',
btn_save:'सहेजें',btn_cancel:'रद्द करें',btn_delete:'हटाएँ',btn_edit:'संपादित करें',btn_create:'बनाएँ',btn_close:'बंद करें',btn_back:'पीछे',btn_send:'भेजें',btn_signin:'साइन इन',btn_signup:'साइन अप',btn_submit:'जमा करें',btn_continue:'जारी रखें',
hdr_search_ph:'पाठ्यक्रम, पाठ, क्विज़ खोजें…',hdr_search_label:'पाठ्यक्रम, पाठ और क्विज़ खोजें',hdr_back:'पीछे जाएँ',hdr_notifications:'सूचनाएँ',hdr_language:'इंटरफ़ेस भाषा',
a11y_skip:'मुख्य सामग्री पर जाएँ',
auth_welcome_kicker:'आपके लिए निर्मित सीखने की दुनिया',auth_welcome_title:'सीमाओं से परे<br><span>सीखना।</span>',auth_welcome_sub:'शुरू करने के लिए खाता बनाएँ। साइनअप के बाद, अपना लर्निंग या टीचिंग कार्यक्षेत्र खोलने के लिए साइन इन करें।',auth_hl1:'◈ इमर्सिव लर्निंग',auth_hl2:'▣ वर्चुअल कक्षाएँ',auth_hl3:'✦ विज़न लैब',auth_signup_first:'पहले साइन अप करें →',auth_signin_existing:'पहले से साइन अप किया है? साइन इन करें',auth_setup_admin:'प्रशासक खाता सेट करें',auth_your_eduverse:'आपका एडुवर्स',auth_choose_space:'अपना लर्निंग स्थान चुनें',auth_choose_space_sub:'साइन इन के बाद खाते अपनी निर्धारित भूमिका में उपयोग होंगे।',role_student:'छात्र',role_student_copy:'सीखें, खोजें और अपनी प्रगति ट्रैक करें।',role_teacher:'शिक्षक',role_teacher_copy:'कक्षाएँ प्रबंधित करें और शिक्षार्थियों का मार्गदर्शन करें।',role_parent:'अभिभावक',role_parent_copy:'अपने बच्चे की प्रगति, उपस्थिति और परिणाम देखें।',role_admin:'प्रशासक',role_admin_copy:'उपयोगकर्ता और प्लेटफ़ॉर्म सेटिंग्स प्रबंधित करें।',auth_roles_kicker:'शुरू करें',auth_roles_title:'अपनी भूमिका चुनें',auth_roles_sub:'शिक्षक खातों को अनुमोदन चाहिए। प्रशासक खाते पहली बार सेटअप से, फिर किसी मौजूदा प्रशासक द्वारा बनाए जाते हैं।',auth_roles_student_copy:'सीखें, खोजें, असाइनमेंट पूरे करें और प्रगति ट्रैक करें।',auth_roles_teacher_copy:'सीखने के अनुभव बनाएँ और छात्रों का मार्गदर्शन करें।',auth_roles_parent_copy:'प्रगति, उपस्थिति और परिणाम देखें।',auth_continue:'जारी रखें →',auth_back:'पीछे',auth_signin_kicker:'वापसी पर स्वागत',auth_signin_title:'एडुवर्स में साइन इन करें',auth_signin_sub:'अपना उपयोगकर्ता नाम और पासवर्ड उपयोग करें। साइन इन के बाद आप अपना Gmail और मोबाइल नंबर जोड़ सकते हैं।',auth_admin_nudge:'अभी तक प्रशासक खाता नहीं है? यहाँ बनाएँ — कोई टर्मिनल चरण नहीं। यदि प्रशासक पहले से मौजूद है, तो उनसे उपयोगकर्ता व अनुमोदन से अपना खाता बनवाएँ। प्रशासक खाते सार्वजनिक पंजीकरण से कभी नहीं बनाए जा सकते।',auth_create_first_admin:'पहला प्रशासक खाता बनाएँ →',auth_field_user:'उपयोगकर्ता नाम या ईमेल पता',auth_field_password:'पासवर्ड',auth_field_mfa:'प्रमाणक कोड (केवल यदि MFA सक्षम है)',auth_forgot:'पासवर्ड भूल गए?',auth_signin_btn:'साइन इन →',auth_new_here:'एडुवर्स पर नए हैं?',auth_create_account:'खाता बनाएँ',auth_signup_title:'अपना खाता बनाएँ',auth_account_word:'खाता',auth_signup_teacher_sub:'शिक्षक साइनअप में डेमो OTP उपयोग होता है और प्रशासक अनुमोदन का अनुरोध होता है।',auth_signup_parent_sub:'अभिभावक खातों को अनुमोदन की आवश्यकता नहीं। साइन इन के बाद, अपने बच्चे को उनके 8-अंकीय कोड से लिंक करें।',auth_signup_student_sub:'उपयोगकर्ता नाम से अपना शिक्षार्थी खाता बनाएँ। Gmail और मोबाइल विवरण साइन-इन के बाद जोड़े जाते हैं।',auth_field_name:'पूरा नाम',auth_field_username:'उपयोगकर्ता नाम',auth_field_password12:'पासवर्ड (12+ अक्षर)',auth_field_confirm:'पासवर्ड की पुष्टि करें',auth_create_btn:'खाता बनाएँ →',auth_have_account:'पहले से खाता है?',auth_signin_link:'साइन इन',auth_setup_kicker:'प्रशासक सेटअप',auth_setup_title:'पहला प्रशासक बनाएँ',auth_setup_sub:'अपना सेटअप कोड और डेमो OTP उपयोग करें। साइन इन के बाद अपना Gmail और मोबाइल नंबर जोड़ें।',auth_field_setup_code:'प्रशासक सेटअप कोड',auth_create_admin_btn:'प्रशासक खाता बनाएँ →',auth_forgot_kicker:'खाता पुनर्प्राप्ति',auth_forgot_title:'अपना पासवर्ड रीसेट करें',auth_forgot_sub:'इस स्थानीय बिल्ड में ईमेल डिलीवरी कॉन्फ़िगर नहीं है। प्रशासक से एकमुश्त पुनर्प्राप्ति कोड लें, फिर नीचे उसे नए 12+ अक्षरों के पासवर्ड के साथ दर्ज करें।',auth_field_email:'ईमेल पता',auth_request_recovery:'पुनर्प्राप्ति का अनुरोध →',auth_field_recovery_code:'पुनर्प्राप्ति कोड',auth_field_new_password:'नया पासवर्ड (12+ अक्षर)',auth_set_password:'नया पासवर्ड सेट करें →',auth_back_to_signin:'साइन इन पर वापस जाएँ',auth_footer:'वेबकैम गतिविधि चुनने तक कैमरा एक्सेस बंद रहता है।',auth_back_btn:'← पीछे'}};
Object.assign(UI_STRINGS,{ta:{nav_overview:'மேலோட்டம்',nav_player:'என் கற்றல் ஆய்வகங்கள்',nav_twin:'கற்றல் இரட்டை',nav_community:'சமூகம்',nav_campus:'3D வளாகம்',nav_classroom:'வகுப்பறை',nav_library:'நூலகம்',nav_library_teaching:'கற்பித்தல் நூலகம்',nav_notes:'என் குறிப்புகள்',nav_syllabus:'குறியீட்டு பாதைகள்',nav_calendar:'நாட்காட்டி',nav_video_player:'என் வீடியோக்கள்',nav_quizzes:'வினாடி வினாக்கள்',nav_certificates:'சான்றிதழ்கள்',nav_discussions:'விவாதங்கள்',nav_live_classes:'நேரடி வகுப்புகள்',nav_billing:'கட்டணம்',nav_leaderboard:'முன்னணி பட்டியல்',nav_catalog:'பாட பட்டியல்',nav_marketplace:'சந்தை',nav_assignments:'பணிகள்',nav_fees:'என் கட்டணங்கள்',nav_today:'இன்றைய வகுப்பு',nav_timetable:'அட்டவணை',nav_profile:'முன்னேற்றம் & சுயவிவரம்',nav_notifications:'அறிவிப்புகள்',nav_feedback:'கருத்து அனுப்புக',nav_careers:'தொழில் மையம்',nav_placement:'வேலைவாய்ப்பு பயிற்சி',nav_language_lab:'மொழி ஆய்வகம்',nav_teacher:'டாஷ்போர்டு',nav_teacher_classes:'என் வகுப்புகள்',nav_teacher_students:'மாணவர்கள்',nav_teacher_attendance:'வருகை',nav_teacher_courses:'பாடங்கள்',nav_teacher_assignments:'பணிகள்',nav_teacher_grading:'மதிப்பீடு',nav_teacher_analytics:'கற்றல் பகுப்பாய்வு',nav_teacher_timetable:'அட்டவணை',nav_teacher_placement:'வேலைவாய்ப்பு பயிற்சி',nav_teacher_language:'மொழி ஆய்வகம்',nav_teacher_quizzes:'வினாடி வினாக்கள்',nav_question_bank:'வினா வங்கி',nav_drawing:'வெப்கேம் வரைதல்',nav_vision_labs:'பார்வை & உருவக ஆய்வகம்',nav_teacher_announcements:'அறிவிப்புகள்',nav_announcements:'நிறுவன அறிவிப்புகள்',nav_teacher_vision:'பார்வை ஆய்வக பணிகள்',nav_teacher_settings:'கணக்கு பாதுகாப்பு',nav_reading_lists:'வாசிப்பு பட்டியல்கள்',nav_parent_dashboard:'டாஷ்போர்டு',nav_admin:'மேலோட்டம்',nav_admin_users:'பயனர்கள் & ஒப்புதல்கள்',nav_admin_teachers:'ஆசிரியர்கள்',nav_admin_students:'மாணவர்கள்',nav_admin_classes:'வகுப்புகள் & சேர்க்கை',nav_admin_courses:'பாடங்கள்',nav_admin_institutions:'நிறுவனங்கள் & பருவங்கள்',nav_admin_calendar:'கல்வி நாட்காட்டி',nav_admin_enrollments:'சேர்க்கைகள்',nav_admin_fees:'கட்டணங்கள்',nav_admin_subscriptions:'சந்தாக்கள்',nav_admin_marketplace:'சந்தை',nav_admin_events:'நாட்காட்டி நிகழ்வுகள்',nav_admin_careers:'தொழில்கள்',nav_admin_library:'நூலகம்',nav_admin_roles:'பாத்திரங்கள் & அனுமதிகள்',nav_admin_reports:'அறிக்கைகள்',nav_admin_import:'மொத்த இறக்குமதி',nav_admin_analytics:'பயன்பாட்டு பகுப்பாய்வு',nav_admin_audit:'தணிக்கை பதிவு',nav_admin_security:'பாதுகாப்பு & MFA',nav_admin_announcements:'அறிவிப்புகள்',nav_admin_settings:'தள அமைப்புகள்',nav_admin_integrations:'ஒருங்கிணைப்புகள்',nav_admin_backup:'காப்பு & மீட்பு',
grp_learn:'கற்க',grp_your_space:'உங்கள் இடம்',grp_teaching:'கற்பித்தல்',grp_classroom_support:'வகுப்பறை & ஆதரவு',grp_family:'குடும்பம்',grp_account:'கணக்கு',grp_control_center:'கட்டுப்பாட்டு மையம்',grp_governance_reports:'நிர்வாகம் & அறிக்கைகள்',
btn_save:'சேமி',btn_cancel:'ரத்து செய்',btn_delete:'நீக்கு',btn_edit:'திருத்து',btn_create:'உருவாக்கு',btn_close:'மூடு',btn_back:'பின்',btn_send:'அனுப்பு',btn_signin:'உள்நுழை',btn_signup:'பதிவு செய்',btn_submit:'சமர்ப்பி',btn_continue:'தொடர்',
hdr_search_ph:'பாடங்கள், பாடப்பகுதிகள், வினாடி வினாக்களைத் தேடுக…',hdr_search_label:'பாடங்கள், பாடப்பகுதிகள் மற்றும் வினாடி வினாக்களைத் தேடுக',hdr_back:'பின் செல்',hdr_notifications:'அறிவிப்புகள்',hdr_language:'இடைமுக மொழி',
a11y_skip:'முதன்மை உள்ளடக்கத்திற்குச் செல்',
auth_welcome_kicker:'உங்களுக்காக உருவாக்கப்பட்ட கற்றல் உலகம்',auth_welcome_title:'எல்லைகளுக்கு அப்பால்<br><span>கற்றல்.</span>',auth_welcome_sub:'தொடங்க ஒரு கணக்கை உருவாக்குங்கள். பதிவுக்குப் பிறகு, உங்கள் கற்றல் அல்லது கற்பித்தல் பணியிடத்தைத் திறக்க உள்நுழையுங்கள்.',auth_hl1:'◈ மூழ்கும் கற்றல்',auth_hl2:'▣ மெய்நிகர் வகுப்பறைகள்',auth_hl3:'✦ பார்வை ஆய்வகம்',auth_signup_first:'முதலில் பதிவு செய்க →',auth_signin_existing:'ஏற்கனவே பதிவு செய்துவிட்டீர்களா? உள்நுழையுங்கள்',auth_setup_admin:'நிர்வாகி கணக்கை அமைக்கவும்',auth_your_eduverse:'உங்கள் எடுவர்ஸ்',auth_choose_space:'உங்கள் கற்றல் இடத்தைத் தேர்வு செய்க',auth_choose_space_sub:'உள்நுழைவுக்குப் பிறகு கணக்குகள் ஒதுக்கப்பட்ட பாத்திரத்தில் செயல்படும்.',role_student:'மாணவர்',role_student_copy:'கற்று, ஆராய்ந்து, உங்கள் முன்னேற்றத்தைக் கண்காணியுங்கள்.',role_teacher:'ஆசிரியர்',role_teacher_copy:'வகுப்புகளை நிர்வகித்து கற்பவர்களுக்கு வழிகாட்டுங்கள்.',role_parent:'பெற்றோர்',role_parent_copy:'உங்கள் குழந்தையின் முன்னேற்றம், வருகை மற்றும் முடிவுகளைப் பின்தொடருங்கள்.',role_admin:'நிர்வாகி',role_admin_copy:'பயனர்கள் மற்றும் தள அமைப்புகளை நிர்வகிக்கவும்.',auth_roles_kicker:'தொடங்குங்கள்',auth_roles_title:'உங்கள் பாத்திரத்தைத் தேர்வு செய்க',auth_roles_sub:'ஆசிரியர் கணக்குகளுக்கு ஒப்புதல் தேவை. நிர்வாகி கணக்குகள் முதல் அமைப்பின் மூலம், பின்னர் தற்போதைய நிர்வாகியால் உருவாக்கப்படும்.',auth_roles_student_copy:'கற்று, ஆராய்ந்து, பணிகளை முடித்து, முன்னேற்றத்தைக் கண்காணியுங்கள்.',auth_roles_teacher_copy:'கற்றல் அனுபவங்களை உருவாக்கி மாணவர்களுக்கு வழிகாட்டுங்கள்.',auth_roles_parent_copy:'முன்னேற்றம், வருகை மற்றும் முடிவுகளைப் பின்தொடருங்கள்.',auth_continue:'தொடர்க →',auth_back:'பின்',auth_signin_kicker:'மீண்டும் வருக',auth_signin_title:'எடுவர்ஸில் உள்நுழையுங்கள்',auth_signin_sub:'உங்கள் பயனர்பெயர் மற்றும் கடவுச்சொல்லைப் பயன்படுத்துங்கள். உள்நுழைவுக்குப் பிறகு உங்கள் Gmail மற்றும் கைபேசி எண்ணைச் சேர்க்கலாம்.',auth_admin_nudge:'நிர்வாகி கணக்கு இன்னும் இல்லையா? இங்கே உருவாக்குங்கள் — முனைய படிகள் தேவையில்லை. நிர்வாகி ஏற்கனவே இருந்தால், பயனர்கள் & ஒப்புதல்கள் பகுதியிலிருந்து உங்கள் கணக்கை உருவாக்கச் சொல்லுங்கள். நிர்வாகி கணக்குகளை பொது பதிவு மூலம் உருவாக்க முடியாது.',auth_create_first_admin:'முதல் நிர்வாகி கணக்கை உருவாக்குங்கள் →',auth_field_user:'பயனர்பெயர் அல்லது மின்னஞ்சல்',auth_field_password:'கடவுச்சொல்',auth_field_mfa:'சரிபார்ப்பு குறியீடு (MFA இயக்கப்பட்டிருந்தால் மட்டும்)',auth_forgot:'கடவுச்சொல் மறந்துவிட்டதா?',auth_signin_btn:'உள்நுழை →',auth_new_here:'எடுவர்ஸில் புதியவரா?',auth_create_account:'கணக்கை உருவாக்குங்கள்',auth_signup_title:'உங்கள் கணக்கை உருவாக்குங்கள்',auth_account_word:'கணக்கு',auth_signup_teacher_sub:'ஆசிரியர் பதிவு டெமோ OTP ஐப் பயன்படுத்தி நிர்வாகி ஒப்புதலைக் கோருகிறது.',auth_signup_parent_sub:'பெற்றோர் கணக்குகளுக்கு ஒப்புதல் தேவையில்லை. உள்நுழைவுக்குப் பிறகு, உங்கள் குழந்தையை 8 எழுத்து குறியீட்டால் இணையுங்கள்.',auth_signup_student_sub:'பயனர்பெயரால் உங்கள் கற்பவர் கணக்கை உருவாக்குங்கள். Gmail மற்றும் கைபேசி விவரங்கள் உள்நுழைவுக்குப் பிறகு சேர்க்கப்படும்.',auth_field_name:'முழு பெயர்',auth_field_username:'பயனர்பெயர்',auth_field_password12:'கடவுச்சொல் (12+ எழுத்துகள்)',auth_field_confirm:'கடவுச்சொல்லை உறுதிப்படுத்துக',auth_create_btn:'கணக்கை உருவாக்கு →',auth_have_account:'ஏற்கனவே கணக்கு உள்ளதா?',auth_signin_link:'உள்நுழை',auth_setup_kicker:'நிர்வாகி அமைப்பு',auth_setup_title:'முதல் நிர்வாகியை உருவாக்குங்கள்',auth_setup_sub:'உங்கள் அமைப்பு குறியீடு மற்றும் டெமோ OTP ஐப் பயன்படுத்துங்கள். உள்நுழைவுக்குப் பிறகு Gmail மற்றும் கைபேசி எண்ணைச் சேருங்கள்.',auth_field_setup_code:'நிர்வாகி அமைப்பு குறியீடு',auth_create_admin_btn:'நிர்வாகி கணக்கை உருவாக்கு →',auth_forgot_kicker:'கணக்கு மீட்பு',auth_forgot_title:'உங்கள் கடவுச்சொல்லை மீட்டமையுங்கள்',auth_forgot_sub:'இந்த உள்ளூர் பதிப்பில் மின்னஞ்சல் அனுப்புதல் அமைக்கப்படவில்லை. நிர்வாகியிடம் ஒருமுறை மீட்பு குறியீட்டைப் பெற்று, புதிய 12+ எழுத்து கடவுச்சொல்லுடன் கீழே உள்ளிடுங்கள்.',auth_field_email:'மின்னஞ்சல் முகவரி',auth_request_recovery:'மீட்பைக் கோரு →',auth_field_recovery_code:'மீட்பு குறியீடு',auth_field_new_password:'புதிய கடவுச்சொல் (12+ எழுத்துகள்)',auth_set_password:'புதிய கடவுச்சொல்லை அமை →',auth_back_to_signin:'உள்நுழைவுக்குத் திரும்பு',auth_footer:'வெப்கேம் செயல்பாட்டைத் தேர்வு செய்யும் வரை கேமரா அணுகல் அணைக்கப்பட்டிருக்கும்.',auth_back_btn:'← பின்'}});
Object.assign(UI_STRINGS,{bn:{nav_overview:'সংক্ষিপ্ত বিবরণ',nav_player:'আমার লার্নিং ল্যাব',nav_twin:'লার্নিং টুইন',nav_community:'কমিউনিটি',nav_campus:'3D ক্যাম্পাস',nav_classroom:'শ্রেণীকক্ষ',nav_library:'গ্রন্থাগার',nav_library_teaching:'শিক্ষণ গ্রন্থাগার',nav_notes:'আমার নোট',nav_syllabus:'কোডিং পথ',nav_calendar:'ক্যালেন্ডার',nav_video_player:'আমার ভিডিও',nav_quizzes:'কুইজ',nav_certificates:'সার্টিফিকেট',nav_discussions:'আলোচনা',nav_live_classes:'লাইভ ক্লাস',nav_billing:'বিলিং',nav_leaderboard:'লিডারবোর্ড',nav_catalog:'কোর্স তালিকা',nav_marketplace:'মার্কেটপ্লেস',nav_assignments:'অ্যাসাইনমেন্ট',nav_fees:'আমার ফি',nav_today:'আজকের ক্লাস',nav_timetable:'সময়সূচি',nav_profile:'অগ্রগতি ও প্রোফাইল',nav_notifications:'বিজ্ঞপ্তি',nav_feedback:'মতামত পাঠান',nav_careers:'ক্যারিয়ার কেন্দ্র',nav_placement:'প্লেসমেন্ট প্রস্তুতি',nav_language_lab:'ভাষা ল্যাব',nav_teacher:'ড্যাশবোর্ড',nav_teacher_classes:'আমার ক্লাস',nav_teacher_students:'শিক্ষার্থী',nav_teacher_attendance:'উপস্থিতি',nav_teacher_courses:'কোর্স',nav_teacher_assignments:'অ্যাসাইনমেন্ট',nav_teacher_grading:'মূল্যায়ন',nav_teacher_analytics:'লার্নিং বিশ্লেষণ',nav_teacher_timetable:'সময়সূচি',nav_teacher_placement:'প্লেসমেন্ট প্রস্তুতি',nav_teacher_language:'ভাষা ল্যাব',nav_teacher_quizzes:'কুইজ',nav_question_bank:'প্রশ্ন ব্যাংক',nav_drawing:'ওয়েবক্যাম ড্রয়িং',nav_vision_labs:'ভিশন ও সিমুলেশন ল্যাব',nav_teacher_announcements:'ঘোষণা',nav_announcements:'প্রতিষ্ঠানের বিজ্ঞপ্তি',nav_teacher_vision:'ভিশন ল্যাব অ্যাসাইনমেন্ট',nav_teacher_settings:'অ্যাকাউন্ট নিরাপত্তা',nav_reading_lists:'পাঠ তালিকা',nav_parent_dashboard:'ড্যাশবোর্ড',nav_admin:'সংক্ষিপ্ত বিবরণ',nav_admin_users:'ব্যবহারকারী ও অনুমোদন',nav_admin_teachers:'শিক্ষক',nav_admin_students:'শিক্ষার্থী',nav_admin_classes:'ক্লাস ও ভর্তি',nav_admin_courses:'কোর্স',nav_admin_institutions:'প্রতিষ্ঠান ও সেশন',nav_admin_calendar:'একাডেমিক ক্যালেন্ডার',nav_admin_enrollments:'ভর্তি',nav_admin_fees:'ফি',nav_admin_subscriptions:'সাবস্ক্রিপশন',nav_admin_marketplace:'মার্কেটপ্লেস',nav_admin_events:'ক্যালেন্ডার ইভেন্ট',nav_admin_careers:'ক্যারিয়ার',nav_admin_library:'গ্রন্থাগার',nav_admin_roles:'ভূমিকা ও অনুমতি',nav_admin_reports:'রিপোর্ট',nav_admin_import:'বাল্ক আমদানি',nav_admin_analytics:'ব্যবহার বিশ্লেষণ',nav_admin_audit:'অডিট লগ',nav_admin_security:'নিরাপত্তা ও MFA',nav_admin_announcements:'ঘোষণা',nav_admin_settings:'প্ল্যাটফর্ম সেটিংস',nav_admin_integrations:'ইন্টিগ্রেশন',nav_admin_backup:'ব্যাকআপ ও পুনরুদ্ধার',
grp_learn:'শিখুন',grp_your_space:'আপনার স্থান',grp_teaching:'শিক্ষাদান',grp_classroom_support:'শ্রেণীকক্ষ ও সহায়তা',grp_family:'পরিবার',grp_account:'অ্যাকাউন্ট',grp_control_center:'নিয়ন্ত্রণ কেন্দ্র',grp_governance_reports:'প্রশাসন ও রিপোর্ট',
btn_save:'সংরক্ষণ',btn_cancel:'বাতিল',btn_delete:'মুছুন',btn_edit:'সম্পাদনা',btn_create:'তৈরি',btn_close:'বন্ধ',btn_back:'পেছনে',btn_send:'পাঠান',btn_signin:'সাইন ইন',btn_signup:'সাইন আপ',btn_submit:'জমা',btn_continue:'চালিয়ে যান',
hdr_search_ph:'কোর্স, পাঠ, কুইজ খুঁজুন…',hdr_search_label:'কোর্স, পাঠ এবং কুইজ খুঁজুন',hdr_back:'পেছনে যান',hdr_notifications:'বিজ্ঞপ্তি',hdr_language:'ইন্টারফেস ভাষা',
a11y_skip:'মূল বিষয়বস্তুতে যান',
auth_welcome_kicker:'আপনার জন্য তৈরি শেখার জগৎ',auth_welcome_title:'সীমানা পেরিয়ে<br><span>শেখা।</span>',auth_welcome_sub:'শুরু করতে একটি অ্যাকাউন্ট তৈরি করুন। সাইনআপের পর, নিজের লার্নিং বা টিচিং ওয়ার্কস্পেস খুলতে সাইন ইন করুন।',auth_hl1:'◈ ইমার্সিভ লার্নিং',auth_hl2:'▣ ভার্চুয়াল ক্লাসরুম',auth_hl3:'✦ ভিশন ল্যাব',auth_signup_first:'প্রথমে সাইন আপ করুন →',auth_signin_existing:'ইতিমধ্যে সাইন আপ করেছেন? সাইন ইন করুন',auth_setup_admin:'প্রশাসক অ্যাকাউন্ট সেট আপ করুন',auth_your_eduverse:'আপনার এডুভার্স',auth_choose_space:'আপনার লার্নিং স্পেস বেছে নিন',auth_choose_space_sub:'সাইন ইন-এর পর অ্যাকাউন্ট নির্ধারিত ভূমিকায় কাজ করবে।',role_student:'শিক্ষার্থী',role_student_copy:'শিখুন, অন্বেষণ করুন এবং অগ্রগতি ট্র্যাক করুন।',role_teacher:'শিক্ষক',role_teacher_copy:'ক্লাস পরিচালনা করুন এবং শিক্ষার্থীদের গাইড করুন।',role_parent:'অভিভাবক',role_parent_copy:'আপনার সন্তানের অগ্রগতি, উপস্থিতি ও ফলাফল অনুসরণ করুন।',role_admin:'প্রশাসক',role_admin_copy:'ব্যবহারকারী ও প্ল্যাটফর্ম সেটিংস পরিচালনা করুন।',auth_roles_kicker:'শুরু করুন',auth_roles_title:'আপনার ভূমিকা বেছে নিন',auth_roles_sub:'শিক্ষক অ্যাকাউন্টের অনুমোদন প্রয়োজন। প্রশাসক অ্যাকাউন্ট প্রথম সেটআপের মাধ্যমে, তারপর বিদ্যমান প্রশাসকের দ্বারা তৈরি হয়।',auth_roles_student_copy:'শিখুন, অন্বেষণ করুন, অ্যাসাইনমেন্ট সম্পূর্ণ করুন এবং অগ্রগতি ট্র্যাক করুন।',auth_roles_teacher_copy:'শেখার অভিজ্ঞতা তৈরি করুন এবং শিক্ষার্থীদের গাইড করুন।',auth_roles_parent_copy:'অগ্রগতি, উপস্থিতি ও ফলাফল অনুসরণ করুন।',auth_continue:'চালিয়ে যান →',auth_back:'পেছনে',auth_signin_kicker:'ফিরে আসায় স্বাগতম',auth_signin_title:'এডুভার্সে সাইন ইন করুন',auth_signin_sub:'আপনার ব্যবহারকারীর নাম ও পাসওয়ার্ড ব্যবহার করুন। সাইন ইন-এর পর Gmail ও মোবাইল নম্বর যোগ করতে পারবেন।',auth_admin_nudge:'এখনও প্রশাসক অ্যাকাউন্ট নেই? এখানে তৈরি করুন — কোনো টার্মিনাল ধাপ নেই। প্রশাসক ইতিমধ্যে থাকলে, ব্যবহারকারী ও অনুমোদন থেকে আপনার অ্যাকাউন্ট তৈরি করতে বলুন। পাবলিক রেজিস্ট্রেশনের মাধ্যমে প্রশাসক অ্যাকাউন্ট কখনোই তৈরি করা যায় না।',auth_create_first_admin:'প্রথম প্রশাসক অ্যাকাউন্ট তৈরি করুন →',auth_field_user:'ব্যবহারকারীর নাম বা ইমেল ঠিকানা',auth_field_password:'পাসওয়ার্ড',auth_field_mfa:'প্রমাণকারী কোড (শুধুমাত্র MFA চালু থাকলে)',auth_forgot:'পাসওয়ার্ড ভুলে গেছেন?',auth_signin_btn:'সাইন ইন →',auth_new_here:'এডুভার্সে নতুন?',auth_create_account:'অ্যাকাউন্ট তৈরি করুন',auth_signup_title:'আপনার অ্যাকাউন্ট তৈরি করুন',auth_account_word:'অ্যাকাউন্ট',auth_signup_teacher_sub:'শিক্ষক সাইনআপে ডেমো OTP ব্যবহৃত হয় এবং প্রশাসকের অনুমোদন চাওয়া হয়।',auth_signup_parent_sub:'অভিভাবক অ্যাকাউন্টে অনুমোদনের প্রয়োজন নেই। সাইন ইন-এর পর, আপনার সন্তানকে তাদের 8-অক্ষরের কোড দিয়ে লিঙ্ক করুন।',auth_signup_student_sub:'ব্যবহারকারীর নাম দিয়ে শিক্ষার্থী অ্যাকাউন্ট তৈরি করুন। Gmail ও মোবাইলের বিবরণ সাইন-ইনের পর যোগ করা হয়।',auth_field_name:'পুরো নাম',auth_field_username:'ব্যবহারকারীর নাম',auth_field_password12:'পাসওয়ার্ড (12+ অক্ষর)',auth_field_confirm:'পাসওয়ার্ড নিশ্চিত করুন',auth_create_btn:'অ্যাকাউন্ট তৈরি →',auth_have_account:'ইতিমধ্যে অ্যাকাউন্ট আছে?',auth_signin_link:'সাইন ইন',auth_setup_kicker:'প্রশাসক সেটআপ',auth_setup_title:'প্রথম প্রশাসক তৈরি করুন',auth_setup_sub:'আপনার সেটআপ কোড ও ডেমো OTP ব্যবহার করুন। সাইন ইন-এর পর Gmail ও মোবাইল নম্বর যোগ করুন।',auth_field_setup_code:'প্রশাসক সেটআপ কোড',auth_create_admin_btn:'প্রশাসক অ্যাকাউন্ট তৈরি →',auth_forgot_kicker:'অ্যাকাউন্ট পুনরুদ্ধার',auth_forgot_title:'আপনার পাসওয়ার্ড রিসেট করুন',auth_forgot_sub:'এই লোকাল বিল্ডে ইমেল ডেলিভারি কনফিগার করা নেই। প্রশাসকের কাছ থেকে একবারের পুনরুদ্ধার কোড নিন, তারপর নতুন 12+ অক্ষরের পাসওয়ার্ড সহ নিচে লিখুন।',auth_field_email:'ইমেল ঠিকানা',auth_request_recovery:'পুনরুদ্ধারের অনুরোধ →',auth_field_recovery_code:'পুনরুদ্ধার কোড',auth_field_new_password:'নতুন পাসওয়ার্ড (12+ অক্ষর)',auth_set_password:'নতুন পাসওয়ার্ড সেট করুন →',auth_back_to_signin:'সাইন ইনে ফিরে যান',auth_footer:'ওয়েবক্যাম কার্যকলাপ না বাছা পর্যন্ত ক্যামেরা অ্যাক্সেস বন্ধ থাকবে।',auth_back_btn:'← পেছনে'}});
Object.assign(UI_STRINGS,{mr:{nav_overview:'आढावा',nav_player:'माझे लर्निंग लॅब',nav_twin:'लर्निंग ट्विन',nav_community:'समुदाय',nav_campus:'3D कॅम्पस',nav_classroom:'वर्ग',nav_library:'ग्रंथालय',nav_library_teaching:'शिक्षण ग्रंथालय',nav_notes:'माझ्या नोट्स',nav_syllabus:'कोडिंग मार्ग',nav_calendar:'कॅलेंडर',nav_video_player:'माझे व्हिडिओ',nav_quizzes:'क्विझ',nav_certificates:'प्रमाणपत्रे',nav_discussions:'चर्चा',nav_live_classes:'लाइव्ह वर्ग',nav_billing:'बिलिंग',nav_leaderboard:'लीडरबोर्ड',nav_catalog:'अभ्यासक्रम यादी',nav_marketplace:'मार्केटप्लेस',nav_assignments:'असाइनमेंट',nav_fees:'माझी फी',nav_today:'आजचा वर्ग',nav_timetable:'वेळापत्रक',nav_profile:'प्रगती व प्रोफाइल',nav_notifications:'सूचना',nav_feedback:'अभिप्राय पाठवा',nav_careers:'करियर केंद्र',nav_placement:'प्लेसमेंट तयारी',nav_language_lab:'भाषा प्रयोगशाळा',nav_teacher:'डॅशबोर्ड',nav_teacher_classes:'माझे वर्ग',nav_teacher_students:'विद्यार्थी',nav_teacher_attendance:'उपस्थिती',nav_teacher_courses:'अभ्यासक्रम',nav_teacher_assignments:'असाइनमेंट',nav_teacher_grading:'मूल्यमापन',nav_teacher_analytics:'लर्निंग विश्लेषण',nav_teacher_timetable:'वेळापत्रक',nav_teacher_placement:'प्लेसमेंट तयारी',nav_teacher_language:'भाषा प्रयोगशाळा',nav_teacher_quizzes:'क्विझ',nav_question_bank:'प्रश्नपेढी',nav_drawing:'वेबकॅम ड्रॉइंग',nav_vision_labs:'व्हिजन व सिम्युलेशन लॅब',nav_teacher_announcements:'घोषणा',nav_announcements:'संस्था सूचना',nav_teacher_vision:'व्हिजन लॅब असाइनमेंट',nav_teacher_settings:'खाते सुरक्षा',nav_reading_lists:'वाचन याद्या',nav_parent_dashboard:'डॅशबोर्ड',nav_admin:'आढावा',nav_admin_users:'वापरकर्ते व मान्यता',nav_admin_teachers:'शिक्षक',nav_admin_students:'विद्यार्थी',nav_admin_classes:'वर्ग व प्रवेश',nav_admin_courses:'अभ्यासक्रम',nav_admin_institutions:'संस्था व सत्रे',nav_admin_calendar:'शैक्षणिक कॅलेंडर',nav_admin_enrollments:'प्रवेश',nav_admin_fees:'फी',nav_admin_subscriptions:'सदस्यता',nav_admin_marketplace:'मार्केटप्लेस',nav_admin_events:'कॅलेंडर कार्यक्रम',nav_admin_careers:'करियर',nav_admin_library:'ग्रंथालय',nav_admin_roles:'भूमिका व परवानग्या',nav_admin_reports:'अहवाल',nav_admin_import:'मोठी आयात',nav_admin_analytics:'वापर विश्लेषण',nav_admin_audit:'ऑडिट नोंद',nav_admin_security:'सुरक्षा व MFA',nav_admin_announcements:'घोषणा',nav_admin_settings:'प्लॅटफॉर्म सेटिंग्ज',nav_admin_integrations:'एकत्रीकरण',nav_admin_backup:'बॅकअप व पुनर्संचयित',
grp_learn:'शिका',grp_your_space:'तुमची जागा',grp_teaching:'शिकवणे',grp_classroom_support:'वर्ग व मदत',grp_family:'कुटुंब',grp_account:'खाते',grp_control_center:'नियंत्रण केंद्र',grp_governance_reports:'प्रशासन व अहवाल',
btn_save:'जतन करा',btn_cancel:'रद्द करा',btn_delete:'हटवा',btn_edit:'संपादित करा',btn_create:'तयार करा',btn_close:'बंद करा',btn_back:'मागे',btn_send:'पाठवा',btn_signin:'साइन इन',btn_signup:'साइन अप',btn_submit:'सादर करा',btn_continue:'पुढे जा',
hdr_search_ph:'अभ्यासक्रम, धडे, क्विझ शोधा…',hdr_search_label:'अभ्यासक्रम, धडे आणि क्विझ शोधा',hdr_back:'मागे जा',hdr_notifications:'सूचना',hdr_language:'इंटरफेस भाषा',
a11y_skip:'मुख्य मजकुराकडे जा',
auth_welcome_kicker:'तुमच्यासाठी तयार केलेले शिकण्याचे जग',auth_welcome_title:'सीमांच्या पलीकडे<br><span>शिक्षण।</span>',auth_welcome_sub:'सुरुवात करण्यासाठी खाते तयार करा. साइनअपनंतर, तुमचे लर्निंग किंवा टीचिंग कार्यक्षेत्र उघडण्यासाठी साइन इन करा.',auth_hl1:'◈ इमर्सिव्ह लर्निंग',auth_hl2:'▣ व्हर्च्युअल वर्ग',auth_hl3:'✦ व्हिजन लॅब',auth_signup_first:'प्रथम साइन अप करा →',auth_signin_existing:'आधीच साइन अप केले आहे? साइन इन करा',auth_setup_admin:'प्रशासक खाते सेट करा',auth_your_eduverse:'तुमचे एडुव्हर्स',auth_choose_space:'तुमची लर्निंग जागा निवडा',auth_choose_space_sub:'साइन इननंतर खाती नेमलेल्या भूमिकेत काम करतील.',role_student:'विद्यार्थी',role_student_copy:'शिका, शोधा आणि तुमची प्रगती ट्रॅक करा.',role_teacher:'शिक्षक',role_teacher_copy:'वर्ग व्यवस्थापित करा आणि शिकणाऱ्यांना मार्गदर्शन करा.',role_parent:'पालक',role_parent_copy:'तुमच्या मुलाची प्रगती, उपस्थिती व निकाल पहा.',role_admin:'प्रशासक',role_admin_copy:'वापरकर्ते आणि प्लॅटफॉर्म सेटिंग्ज व्यवस्थापित करा.',auth_roles_kicker:'सुरुवात करा',auth_roles_title:'तुमची भूमिका निवडा',auth_roles_sub:'शिक्षक खात्यांना मान्यता आवश्यक. प्रशासक खाती प्रथम सेटअपमधून, नंतर विद्यमान प्रशासकाकडून तयार होतात.',auth_roles_student_copy:'शिका, शोधा, असाइनमेंट पूर्ण करा आणि प्रगती ट्रॅक करा.',auth_roles_teacher_copy:'शिकण्याचे अनुभव तयार करा आणि विद्यार्थ्यांना मार्गदर्शन करा.',auth_roles_parent_copy:'प्रगती, उपस्थिती व निकाल पहा.',auth_continue:'पुढे जा →',auth_back:'मागे',auth_signin_kicker:'परत स्वागत आहे',auth_signin_title:'एडुव्हर्समध्ये साइन इन करा',auth_signin_sub:'तुमचे वापरकर्तानाव आणि पासवर्ड वापरा. साइन इननंतर तुम्ही Gmail आणि मोबाइल नंबर जोडू शकता.',auth_admin_nudge:'अद्याप प्रशासक खाते नाही? येथे तयार करा — कोणतीही टर्मिनल पायरी नाही. प्रशासक आधीच अस्तित्वात असल्यास, वापरकर्ते व मान्यता मधून तुमचे खाते तयार करण्यास सांगा. सार्वजनिक नोंदणीतून प्रशासक खाती कधीही तयार होऊ शकत नाहीत.',auth_create_first_admin:'पहिले प्रशासक खाते तयार करा →',auth_field_user:'वापरकर्तानाव किंवा ईमेल पत्ता',auth_field_password:'पासवर्ड',auth_field_mfa:'प्रमाणक कोड (फक्त MFA सक्षम असल्यास)',auth_forgot:'पासवर्ड विसरलात?',auth_signin_btn:'साइन इन →',auth_new_here:'एडुव्हर्सवर नवीन?',auth_create_account:'खाते तयार करा',auth_signup_title:'तुमचे खाते तयार करा',auth_account_word:'खाते',auth_signup_teacher_sub:'शिक्षक साइनअपमध्ये डेमो OTP वापरला जातो आणि प्रशासक मान्यतेची विनंती होते.',auth_signup_parent_sub:'पालक खात्यांना मान्यतेची गरज नाही. साइन इननंतर, तुमच्या मुलाला त्यांच्या 8-अक्षरी कोडने लिंक करा.',auth_signup_student_sub:'वापरकर्तानावाने तुमचे शिकणारे खाते तयार करा. Gmail आणि मोबाइल तपशील साइन-इननंतर जोडले जातात.',auth_field_name:'पूर्ण नाव',auth_field_username:'वापरकर्तानाव',auth_field_password12:'पासवर्ड (12+ अक्षरे)',auth_field_confirm:'पासवर्डची पुष्टी करा',auth_create_btn:'खाते तयार करा →',auth_have_account:'आधीच खाते आहे?',auth_signin_link:'साइन इन',auth_setup_kicker:'प्रशासक सेटअप',auth_setup_title:'पहिला प्रशासक तयार करा',auth_setup_sub:'तुमचा सेटअप कोड आणि डेमो OTP वापरा. साइन इननंतर Gmail आणि मोबाइल नंबर जोडा.',auth_field_setup_code:'प्रशासक सेटअप कोड',auth_create_admin_btn:'प्रशासक खाते तयार करा →',auth_forgot_kicker:'खाते पुनर्प्राप्ती',auth_forgot_title:'तुमचा पासवर्ड रीसेट करा',auth_forgot_sub:'या स्थानिक बिल्डमध्ये ईमेल वितरण कॉन्फिगर केलेले नाही. प्रशासकाकडून एकवेळचा पुनर्प्राप्ती कोड घ्या, नंतर नवीन 12+ अक्षरी पासवर्डसह खाली प्रविष्ट करा.',auth_field_email:'ईमेल पत्ता',auth_request_recovery:'पुनर्प्राप्तीची विनंती →',auth_field_recovery_code:'पुनर्प्राप्ती कोड',auth_field_new_password:'नवीन पासवर्ड (12+ अक्षरे)',auth_set_password:'नवीन पासवर्ड सेट करा →',auth_back_to_signin:'साइन इनवर परत जा',auth_footer:'वेबकॅम क्रियाकलाप निवडेपर्यंत कॅमेरा प्रवेश बंद राहतो.',auth_back_btn:'← मागे'}});

/* ---------- i18n engine ---------- */
let uiLang='en';
function tx(key,fallback){const d=UI_STRINGS[uiLang]||{};if(d[key]!==undefined)return d[key];const e=UI_STRINGS.en[key];return e!==undefined?e:(fallback!==undefined?fallback:key);}
function t(key){return tx(key,key);}
function grpKey(g){return 'grp_'+String(g||'').toLowerCase().replace(/[^a-z]+/g,'_').replace(/^_|_$/g,'');}
function renderSidebarNav(user){
  const sections=portalScreens[user.role]||portalScreens.student,navs=document.querySelectorAll('.sidebar nav');
  navs.forEach((n,i)=>{const group=sections[i];
    n.innerHTML=group?group[1].filter(([id])=>id!=='admin-roles'||user.role!=='institution_admin').map(([id,icon,label])=>{
      const key=id==='library'&&label==='Teaching library'?'nav_library_teaching':'nav_'+id;
      return `<a class="nav-item" href="#${id}" data-screen="${id}"><span aria-hidden="true">${icon}</span> ${safeText(tx(key,label))}</a>`;
    }).join(''):'';
    n.setAttribute('aria-label',group?tx(grpKey(group[0]),group[0]):('Navigation '+(i+1)));
    const lbl=document.querySelectorAll('.sidebar .nav-label')[i];
    if(lbl)lbl.textContent=group?tx(grpKey(group[0]),group[0]):'';
  });
}
const prevRenderPortalShell=renderPortalShell;
renderPortalShell=function(user){prevRenderPortalShell(user);renderSidebarNav(user);};
function applyUiLanguage(){
  document.documentElement.lang=uiLang;
  const skip=document.querySelector('.skip-link');if(skip)skip.textContent=t('a11y_skip');
  const gs=document.querySelector('#globalSearch');
  if(gs){gs.placeholder=t('hdr_search_ph');gs.setAttribute('aria-label',t('hdr_search_label'));}
  const pb=document.querySelector('#pageBack');if(pb)pb.setAttribute('aria-label',t('hdr_back'));
  const nb=document.querySelector('#notificationBtn');if(nb)nb.setAttribute('aria-label',t('hdr_notifications'));
  document.querySelectorAll('#langSwitch,#langSwitchAuth').forEach(ls=>{ls.setAttribute('aria-label',t('hdr_language'));ls.value=uiLang;});
  if(currentUser)renderSidebarNav(currentUser);
  if(typeof authRoot!=='undefined'&&authRoot&&!authRoot.hidden)authView(authRoot.dataset.mode||'welcome',authRoot.dataset.role||'student');
}
async function setUiLanguage(lang,persist=true){
  if(!UI_LANGS.includes(lang))lang='en';uiLang=lang;
  try{localStorage.setItem('eduverse.uiLang',lang);}catch{}
  applyUiLanguage();
  if(persist){try{await apiRequest('/profile/language',{method:'POST',body:JSON.stringify({lang})});}catch{}}
}
async function initLanguage(){
  let lang=null;
  try{const d=await apiRequest('/profile/language');if(d&&UI_LANGS.includes(d.lang))lang=d.lang;}catch{}
  if(!lang){try{const l=localStorage.getItem('eduverse.uiLang');if(l&&UI_LANGS.includes(l))lang=l;}catch{}}
  await setUiLanguage(lang||'en',false);
}
document.addEventListener('DOMContentLoaded',initLanguage);
document.addEventListener('change',e=>{if(e.target&&(e.target.id==='langSwitch'||e.target.id==='langSwitchAuth'))setUiLanguage(e.target.value);});

/* ---------- Language lab (student/parent) ---------- */
Object.assign(screenNames,{'language-lab':'Language lab','teacher-language':'Language lab'});
Object.assign(screenRole,{'language-lab':['student','parent'],'teacher-language':['teacher','admin']});
expandAdminRoles();
Object.assign(staffPageTitles,{'teacher-language':'Language lab'});
const prevNavigateLang=navigate;
navigate=function(name){prevNavigateLang(name);if(name==='language-lab')loadLanguageLab();};
portalScreens.student[0][1].push(['language-lab','◍','Language lab']);
portalScreens.teacher[0][1].push(['teacher-language','◍','Language lab']);
portalScreens.parent[0][1].push(['language-lab','◍','Language lab']);
portalScreens.admin[0][1].push(['teacher-language','◍','Language lab']);
Object.assign(screens,{'language-lab':`<div class="screen-title"><p class="eyebrow">SPEAK · READ · GROW</p><h1>Language lab</h1><p>Build vocabulary and practise speaking. UI translations cover navigation, common buttons, and sign-in screens — deeper pages stay in English for now.</p></div><div class="lang-tabs" role="tablist" aria-label="Language lab sections"><button class="filter-select lang-tab active" data-lang-tab="vocab" role="tab" aria-selected="true" type="button">Vocabulary</button><button class="filter-select lang-tab" data-lang-tab="speaking" role="tab" aria-selected="false" type="button">Speaking practice</button><button class="filter-select lang-tab" data-lang-tab="scores" role="tab" aria-selected="false" type="button">My scores</button></div><section class="screen-panel" id="langTabVocab"><h3>Vocabulary sets</h3><div id="vocabSets"><p class="panel-copy">Loading…</p></div><div id="vocabWork"></div></section><section class="screen-panel" id="langTabSpeaking" hidden><h3>Speaking exercises</h3><p class="panel-copy"><small>Speech recognition runs in your browser (Chrome/Edge). You can also type what you said — scoring is simple word overlap with the target phrase.</small></p><div id="speakingList"><p class="panel-copy">Loading…</p></div><div id="speakingWork"></div></section><section class="screen-panel" id="langTabScores" hidden><h3>My scores</h3><div id="langScores"><p class="panel-copy">No attempts yet.</p></div></section>`});
const langLab={sets:[],exercises:[],study:null,quiz:null,speaking:null,rec:null,recording:false};
function langStatus(id,msg){const el=document.querySelector(id);if(el)el.textContent=msg;}
async function loadLanguageLab(){
  try{const d=await apiRequest('/vocab');langLab.sets=d.vocabSets||d.sets||d.items||[];}catch{langLab.sets=[];}
  try{const d=await apiRequest('/speaking');langLab.exercises=d.speakingExercises||d.exercises||d.items||[];}catch{langLab.exercises=[];}
  renderVocabSets();renderSpeakingList();renderLangScores();
}
function renderVocabSets(){
  const box=document.querySelector('#vocabSets');if(!box)return;
  const canQuiz=currentUser&&currentUser.role==='student';
  box.innerHTML=langLab.sets.length?langLab.sets.map(s=>{
    const n=(s.words||[]).length||s.wordCount||0,best=(s.bestScore!==undefined&&s.bestScore!==null)?`<span class="lang-score-pill">Best ${safeText(String(s.bestScore))}</span>`:'';
    return `<div class="teacher-record"><div><b>${safeText(s.title||'Set')}</b><small>${safeText(s.language||'')}${n?` · ${n} words`:''}</small></div><div>${best}<button class="filter-select" data-vocab-study="${safeText(String(s.id))}">Study</button>${canQuiz?` <button class="primary-btn" data-vocab-quiz="${safeText(String(s.id))}">Quiz →</button>`:''}</div></div>`;
  }).join(''):'<p class="panel-copy">No vocabulary sets yet. Ask your teacher to add some.</p>';
}
function startVocabStudy(id){
  const set=langLab.sets.find(s=>String(s.id)===String(id));if(!set||!(set.words||[]).length)return;
  langLab.study={set,idx:0};renderVocabStudy();
  document.querySelector('#vocabWork').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function renderVocabStudy(){
  const st=langLab.study,box=document.querySelector('#vocabWork');if(!st||!box)return;
  const w=st.set.words[st.idx];
  box.innerHTML=`<div class="flash-card" id="flashCard" role="button" tabindex="0" aria-label="Flashcard: tap to reveal meaning"><b>${safeText(w.word||w.term||'')}</b><span class="flash-hint">Tap to reveal</span><span class="flash-back" hidden><i>${safeText(w.meaning||w.definition||'')}</i>${w.example?`<small>“${safeText(w.example)}”</small>`:''}</span></div><div class="lang-nav"><button class="filter-select" id="flashPrev">← Prev</button><span class="panel-copy">${st.idx+1} / ${st.set.words.length}</span><button class="filter-select" id="flashNext">Next →</button> <button class="filter-select" id="flashClose">Close</button></div>`;
  const card=document.querySelector('#flashCard');
  const flip=()=>{const b=card.querySelector('.flash-back'),h=card.querySelector('.flash-hint');const show=b.hidden;b.hidden=!show;h.hidden=show;};
  card.addEventListener('click',flip);card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();flip();}});
  document.querySelector('#flashPrev').addEventListener('click',()=>{st.idx=(st.idx-1+st.set.words.length)%st.set.words.length;renderVocabStudy();});
  document.querySelector('#flashNext').addEventListener('click',()=>{st.idx=(st.idx+1)%st.set.words.length;renderVocabStudy();});
  document.querySelector('#flashClose').addEventListener('click',()=>{langLab.study=null;box.innerHTML='';});
}
async function startVocabQuiz(id){
  const box=document.querySelector('#vocabWork');if(!box)return;
  box.innerHTML='<p class="panel-copy">Starting quiz…</p>';
  try{
    const d=await apiRequest(`/vocab/${encodeURIComponent(id)}/start`,{method:'POST'});
    const raw=(d.questions||d.words||[]);
    const pool=raw.map(w=>w.meaning||w.definition).filter(Boolean);
    const qs=raw.map((q,i)=>{
      const word=q.word||q.term||q.q||('Word '+(i+1)),meaning=q.meaning||q.definition||'';
      let choices=q.choices||q.options||null;
      if(!choices&&meaning&&pool.length>=2){
        const others=[...new Set(pool.filter(m=>m!==meaning))].sort(()=>Math.random()-0.5).slice(0,3);
        choices=[meaning,...others].sort(()=>Math.random()-0.5);
      }
      return {id:String(q.id!==undefined?q.id:(q.word||i)),word,meaning,choices};
    });
    if(!qs.length){box.innerHTML='<p class="panel-copy">This set has no quiz questions.</p>';return;}
    const set=langLab.sets.find(s=>String(s.id)===String(id));
    langLab.quiz={setId:id,attemptId:d.attemptId||d.id||null,questions:qs,title:(set&&set.title)||'Vocabulary quiz'};
    box.innerHTML=`<h3>${safeText(langLab.quiz.title)} — quiz</h3><form id="vocabQuizForm" class="teacher-form">${qs.map((q,i)=>`<fieldset class="lang-q"><legend><b>${i+1}.</b> ${safeText(q.word)}</legend>${q.choices?q.choices.map((c,ci)=>`<label class="lang-choice"><input type="radio" name="q_${i}" value="${ci}" required> ${safeText(c)}</label>`).join(''):`<input aria-label="Type the meaning" name="q_${i}" maxlength="200" placeholder="Type the meaning" required>`}</fieldset>`).join('')}<button class="primary-btn">Submit answers →</button><p id="vocabQuizStatus" class="panel-copy" role="status"></p></form>`;
    box.scrollIntoView({behavior:'smooth',block:'nearest'});
  }catch(err){box.innerHTML=`<p class="panel-copy">Could not start the quiz: ${safeText(err.message)}</p>`;}
}
async function submitVocabQuiz(form){
  const q=langLab.quiz;if(!q)return;const st=document.querySelector('#vocabQuizStatus');
  const fd=new FormData(form),answers={};
  q.questions.forEach((qq,i)=>{const v=fd.get('q_'+i);answers[qq.id]=qq.choices?((v===null||v==='')?'':String(qq.choices[Number(v)]||'')):String(v||'');});
  try{
    const d=await apiRequest(`/vocab/${encodeURIComponent(q.setId)}/submit`,{method:'POST',body:JSON.stringify({attemptId:q.attemptId,answers})});
    const score=d.score!==undefined?d.score:(d.correct!==undefined?d.correct:0),total=d.total||d.maxScore||q.questions.length;
    if(st)st.textContent=`Score: ${score} / ${total}`;
    langLogScore('vocab',q.title,score,total);
  }catch(err){if(st)st.textContent=err.message;}
}
function renderSpeakingList(){
  const box=document.querySelector('#speakingList');if(!box)return;
  box.innerHTML=langLab.exercises.length?langLab.exercises.map(x=>{
    const best=(x.bestScore!==undefined&&x.bestScore!==null)?`<span class="lang-score-pill">Best ${safeText(String(x.bestScore))}</span>`:'';
    return `<div class="teacher-record"><div><b>${safeText(x.title||'Exercise')}</b><small>${safeText(x.language||'')}${x.prompt?` · ${safeText(String(x.prompt).slice(0,80))}`:''}</small></div><div>${best}<button class="primary-btn" data-speak-practice="${safeText(String(x.id))}">Practise →</button></div></div>`;
  }).join(''):'<p class="panel-copy">No speaking exercises yet. Ask your teacher to add some.</p>';
}
function startSpeakingPractice(id){
  const ex=langLab.exercises.find(x=>String(x.id)===String(id));if(!ex)return;
  langLab.speaking=ex;stopRecording();
  const box=document.querySelector('#speakingWork');
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  const canSubmit=currentUser&&currentUser.role==='student';
  box.innerHTML=`<h3>${safeText(ex.title||'Speaking practice')}</h3><p class="panel-copy">${safeText(ex.prompt||'')}</p>${ex.targetPhrase?`<p class="panel-copy"><b>Target phrase:</b> <i>${safeText(ex.targetPhrase)}</i></p>`:''}<div class="lms-form-row"><button class="primary-btn" id="speakRecord" type="button">${SR?'🎤 Start recording':'🎤 Voice input not supported here'}</button><span class="panel-copy" id="speakRecStatus" role="status">${SR?'':'Type what you said below instead.'}</span></div><label class="auth-field">What you said<textarea id="speakTranscript" rows="3" maxlength="2000" placeholder="Speak or type your attempt…"></textarea></label><div>${canSubmit?'<button class="primary-btn" id="speakSubmit" type="button">Submit attempt →</button>':'<p class="panel-copy"><small>Attempt scoring is for student accounts — parents can still practise with the recorder above.</small></p>'} <button class="filter-select" id="speakClose" type="button">Close</button></div><p id="speakStatus" class="panel-copy" role="status"></p>`;
  document.querySelector('#speakRecord').addEventListener('click',toggleRecording);
  const subBtn=document.querySelector('#speakSubmit');if(subBtn)subBtn.addEventListener('click',submitSpeaking);
  document.querySelector('#speakClose').addEventListener('click',()=>{stopRecording();langLab.speaking=null;box.innerHTML='';});
  box.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function toggleRecording(){
  const ex=langLab.speaking;if(!ex)return;
  if(langLab.recording){stopRecording();return;}
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){langStatus('#speakRecStatus','Voice input is not supported in this browser — type your attempt instead.');return;}
  try{
    const rec=new SR();langLab.rec=rec;
    rec.lang=(ex.language||'en').slice(0,2);rec.interimResults=false;rec.maxAlternatives=1;
    rec.onresult=e=>{const txt=e.results[0][0].transcript;const ta=document.querySelector('#speakTranscript');if(ta)ta.value=(ta.value?ta.value+' ':'')+txt;};
    rec.onerror=()=>{langStatus('#speakRecStatus','Could not capture audio. Type your attempt instead.');};
    rec.onend=()=>{langLab.recording=false;const b=document.querySelector('#speakRecord');if(b)b.textContent='🎤 Start recording';};
    rec.start();langLab.recording=true;
    document.querySelector('#speakRecord').textContent='⏹ Stop recording';
    langStatus('#speakRecStatus','Listening… speak now.');
  }catch{langStatus('#speakRecStatus','Microphone unavailable — type your attempt instead.');}
}
function stopRecording(){try{if(langLab.rec)langLab.rec.stop();}catch{}langLab.rec=null;langLab.recording=false;}
async function submitSpeaking(){
  const ex=langLab.speaking;if(!ex)return;const st=document.querySelector('#speakStatus');
  const transcript=(document.querySelector('#speakTranscript')||{}).value||'';
  if(!transcript.trim()){if(st)st.textContent='Say or type something first.';return;}
  stopRecording();
  try{
    const d=await apiRequest(`/speaking/${encodeURIComponent(ex.id)}/submit`,{method:'POST',body:JSON.stringify({transcript:transcript.trim()})});
    const score=d.score!==undefined?d.score:0;
    if(st)st.textContent=`Score: ${score}% · matched ${d.matched||0} of ${d.total||0} target words`;
    langLogScore('speaking',ex.title||'Speaking',score,100);
  }catch(err){if(st)st.textContent=err.message;}
}
function langLogScore(kind,title,score,total){
  try{
    const log=JSON.parse(localStorage.getItem('eduverse.langScores')||'[]');
    log.unshift({kind,title,score,total,at:new Date().toISOString()});
    localStorage.setItem('eduverse.langScores',JSON.stringify(log.slice(0,50)));
  }catch{}
  renderLangScores();
}
function renderLangScores(){
  const box=document.querySelector('#langScores');if(!box)return;
  let log=[];try{log=JSON.parse(localStorage.getItem('eduverse.langScores')||'[]');}catch{}
  box.innerHTML=log.length?staffTable(['When','Activity','Score'],log.map(e=>`<tr><td>${safeText(new Date(e.at).toLocaleString())}</td><td>${safeText(e.kind==='vocab'?'Vocabulary':'Speaking')} · ${safeText(e.title||'')}</td><td>${safeText(String(e.score))} / ${safeText(String(e.total))}</td></tr>`),''):'<p class="panel-copy">No attempts yet. Try a vocabulary quiz or a speaking exercise.</p>';
}
document.addEventListener('click',e=>{
  const tab=e.target.closest('[data-lang-tab]');
  if(tab){const v=tab.dataset.langTab;document.querySelectorAll('.lang-tab').forEach(b=>{const on=b===tab;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));});[['vocab','#langTabVocab'],['speaking','#langTabSpeaking'],['scores','#langTabScores']].forEach(([k,sel])=>{const s=document.querySelector(sel);if(s)s.hidden=k!==v;});return;}
  const vs=e.target.closest('[data-vocab-study]');if(vs){startVocabStudy(vs.dataset.vocabStudy);return;}
  const vq=e.target.closest('[data-vocab-quiz]');if(vq){startVocabQuiz(vq.dataset.vocabQuiz);return;}
  const sp=e.target.closest('[data-speak-practice]');if(sp){startSpeakingPractice(sp.dataset.speakPractice);return;}
});
document.addEventListener('submit',e=>{
  if(e.target.id==='vocabQuizForm'){e.preventDefault();submitVocabQuiz(e.target);}
});

/* ---------- Teacher / admin: language lab management ---------- */
Object.assign(staffPageMarkup,{'teacher-language':`<div class="screen-title"><p class="eyebrow">LANGUAGE LAB</p><h1>Language lab</h1><p>Build vocabulary sets and speaking exercises for your learners.</p></div><section class="screen-panel"><h3>New vocabulary set</h3><form id="vocabSetForm" class="teacher-form"><div class="lms-form-row"><label>Title<input name="title" maxlength="160" required></label><label>Language<input name="language" maxlength="60" placeholder="e.g. Hindi, Spanish" required></label></div><label>Words (one per line)<textarea name="words" rows="5" maxlength="20000" placeholder="नमस्ते || hello || नमस्ते, आप कैसे हैं?"></textarea></label><p class="panel-copy"><small>Format per line: <b>word || meaning || example</b> (example optional).</small></p><input type="hidden" name="id" id="vocabSetId"><div><button class="primary-btn">Save set →</button> <button class="filter-select" type="button" id="vocabSetCancel" hidden>Cancel edit</button></div><p id="vocabSetStatus" class="panel-copy" role="status"></p></form></section><section class="screen-panel"><h3>Vocabulary sets</h3><div id="vocabSetList"><p class="panel-copy">Loading…</p></div></section><section class="screen-panel"><h3>New speaking exercise</h3><form id="speakingExForm" class="teacher-form"><div class="lms-form-row"><label>Title<input name="title" maxlength="160" required></label><label>Language<input name="language" maxlength="60" placeholder="e.g. Hindi, Spanish" required></label></div><label>Prompt<textarea name="prompt" rows="2" maxlength="2000" placeholder="Introduce yourself in Hindi."></textarea></label><label>Target phrase<input name="targetPhrase" maxlength="500" placeholder="मेरा नाम … है"></label><input type="hidden" name="id" id="speakingExId"><div><button class="primary-btn">Save exercise →</button> <button class="filter-select" type="button" id="speakingExCancel" hidden>Cancel edit</button></div><p id="speakingExStatus" class="panel-copy" role="status"></p></form></section><section class="screen-panel"><h3>Speaking exercises</h3><div id="speakingExList"><p class="panel-copy">Loading…</p></div></section>`});
const prevLoadStaffPageLang=loadStaffPage;
loadStaffPage=async function(name){if(name==='teacher-language'){await loadTeacherLanguage();return;}return prevLoadStaffPageLang(name);};
function parseLangWords(text){
  return String(text||'').split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{
    const parts=l.split('||').map(s=>s.trim());
    if(parts.length<2||!parts[0]||!parts[1])throw new Error('Each line needs "word || meaning" (example optional). Bad line: '+l.slice(0,60));
    return {word:parts[0],meaning:parts[1],example:parts[2]||''};
  });
}
async function loadTeacherLanguage(){
  await Promise.all([renderVocabSetList(),renderSpeakingExList()]);
}
async function renderVocabSetList(){
  const box=document.querySelector('#vocabSetList');if(!box)return;
  try{
    const d=await apiRequest('/admin/vocab');const sets=d.vocabSets||d.sets||d.items||[];
    box.innerHTML=sets.length?staffTable(['Title','Language','Words','Action'],sets.map(s=>`<tr><td>${safeText(s.title||'')}</td><td>${safeText(s.language||'')}</td><td>${(s.words||[]).length}</td><td><button data-vocab-edit="${safeText(String(s.id))}">Edit</button> <button data-vocab-del="${safeText(String(s.id))}">Delete</button></td></tr>`),''):'<p class="panel-copy">No vocabulary sets yet.</p>';
    box._langSets=sets;
  }catch(err){box.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
async function renderSpeakingExList(){
  const box=document.querySelector('#speakingExList');if(!box)return;
  try{
    const d=await apiRequest('/admin/speaking');const exs=d.speakingExercises||d.exercises||d.items||[];
    box.innerHTML=exs.length?staffTable(['Title','Language','Prompt','Action'],exs.map(x=>`<tr><td>${safeText(x.title||'')}</td><td>${safeText(x.language||'')}</td><td>${safeText(String(x.prompt||'').slice(0,80))}</td><td><button data-speak-edit="${safeText(String(x.id))}">Edit</button> <button data-speak-del="${safeText(String(x.id))}">Delete</button></td></tr>`),''):'<p class="panel-copy">No speaking exercises yet.</p>';
    box._langExs=exs;
  }catch(err){box.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
document.addEventListener('click',e=>{
  const ve=e.target.closest('[data-vocab-edit]');
  if(ve){const s=(document.querySelector('#vocabSetList')._langSets||[]).find(x=>String(x.id)===ve.dataset.vocabEdit);if(!s)return;const f=document.querySelector('#vocabSetForm');f.title.value=s.title||'';f.language.value=s.language||'';f.words.value=(s.words||[]).map(w=>`${w.word||''} || ${w.meaning||''}${w.example?' || '+w.example:''}`).join('\n');document.querySelector('#vocabSetId').value=s.id;document.querySelector('#vocabSetCancel').hidden=false;f.scrollIntoView({behavior:'smooth'});return;}
  const vd=e.target.closest('[data-vocab-del]');
  if(vd){if(!confirm('Delete this vocabulary set?'))return;(async()=>{try{await apiRequest(`/admin/vocab/${encodeURIComponent(vd.dataset.vocabDel)}`,{method:'DELETE'});await renderVocabSetList();}catch(err){alert(err.message);}})();return;}
  const se=e.target.closest('[data-speak-edit]');
  if(se){const x=(document.querySelector('#speakingExList')._langExs||[]).find(y=>String(y.id)===se.dataset.speakEdit);if(!x)return;const f=document.querySelector('#speakingExForm');f.title.value=x.title||'';f.language.value=x.language||'';f.prompt.value=x.prompt||'';f.targetPhrase.value=x.targetPhrase||'';document.querySelector('#speakingExId').value=x.id;document.querySelector('#speakingExCancel').hidden=false;f.scrollIntoView({behavior:'smooth'});return;}
  const sd=e.target.closest('[data-speak-del]');
  if(sd){if(!confirm('Delete this speaking exercise?'))return;(async()=>{try{await apiRequest(`/admin/speaking/${encodeURIComponent(sd.dataset.speakDel)}`,{method:'DELETE'});await renderSpeakingExList();}catch(err){alert(err.message);}})();return;}
  if(e.target.id==='vocabSetCancel'){const f=document.querySelector('#vocabSetForm');f.reset();document.querySelector('#vocabSetId').value='';e.target.hidden=true;return;}
  if(e.target.id==='speakingExCancel'){const f=document.querySelector('#speakingExForm');f.reset();document.querySelector('#speakingExId').value='';e.target.hidden=true;return;}
});
document.addEventListener('submit',async e=>{
  const setStatus=(id,msg)=>{const el=document.querySelector(id);if(el)el.textContent=msg;};
  if(e.target.id==='vocabSetForm'){e.preventDefault();const f=e.target;
    try{
      const words=parseLangWords(f.words.value);if(!words.length)throw new Error('Add at least one word.');
      const body={title:f.title.value.trim(),language:f.language.value.trim(),words};
      const id=document.querySelector('#vocabSetId').value;
      if(id){await apiRequest(`/admin/vocab/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)});setStatus('#vocabSetStatus','Set updated.');}
      else{await apiRequest('/admin/vocab',{method:'POST',body:JSON.stringify(body)});setStatus('#vocabSetStatus','Vocabulary set created.');}
      f.reset();document.querySelector('#vocabSetId').value='';document.querySelector('#vocabSetCancel').hidden=true;await renderVocabSetList();
    }catch(err){setStatus('#vocabSetStatus',err.message);}
    return;}
  if(e.target.id==='speakingExForm'){e.preventDefault();const f=e.target;
    try{
      const body={title:f.title.value.trim(),language:f.language.value.trim(),prompt:f.prompt.value.trim(),targetPhrase:f.targetPhrase.value.trim()};
      const id=document.querySelector('#speakingExId').value;
      if(id){await apiRequest(`/admin/speaking/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)});setStatus('#speakingExStatus','Exercise updated.');}
      else{await apiRequest('/admin/speaking',{method:'POST',body:JSON.stringify(body)});setStatus('#speakingExStatus','Speaking exercise created.');}
      f.reset();document.querySelector('#speakingExId').value='';document.querySelector('#speakingExCancel').hidden=true;await renderSpeakingExList();
    }catch(err){setStatus('#speakingExStatus',err.message);}
    return;}
});
/* Slice 4 self-checks (run in console as __langSelfCheck()) */
function __langSelfCheck(){
  const checks=[];
  const has=(n,c)=>checks.push([n,!!c]);
  has('UI_STRINGS 5 langs',UI_LANGS.every(l=>UI_STRINGS[l]&&Object.keys(UI_STRINGS[l]).length>100));
  has('lang keys parity',UI_LANGS.every(l=>{const a=Object.keys(UI_STRINGS.en).sort().join(',');return Object.keys(UI_STRINGS[l]).sort().join(',')===a;}));
  has('screenNames language-lab',screenNames['language-lab']==='Language lab');
  has('screenRole language-lab',Array.isArray(screenRole['language-lab']));
  has('screenRole teacher-language',Array.isArray(screenRole['teacher-language']));
  has('staffPage teacher-language',!!staffPageMarkup['teacher-language']);
  has('screens language-lab',typeof screens['language-lab']==='string');
  has('loadLanguageLab fn',typeof loadLanguageLab==='function');
  has('loadTeacherLanguage fn',typeof loadTeacherLanguage==='function');
  has('parseLangWords',(()=>{try{const w=parseLangWords('a || b || c\nd || e');return w.length===2&&w[0].example==='c';}catch{return false;}})());
  has('tx fallback',tx('nope_xyz','fb')==='fb'&&t('nav_overview')===UI_STRINGS[uiLang].nav_overview);
  return checks;
}

/* ---------- Slice 5: LMS integrations (LTI, SCORM, xAPI) + PDF/Excel export ---------- */
Object.assign(screenNames,{'admin-standards':'LMS integrations','scorm-player':'SCORM lessons'});
Object.assign(screenRole,{'admin-standards':['admin'],'scorm-player':['teacher','admin']});
Object.assign(staffPageTitles,{'admin-standards':'LMS integrations'});
Object.assign(staffPageMarkup,{'admin-standards':`<div class="screen-title"><p class="eyebrow">LMS INTEGRATIONS</p><h1>LMS integrations</h1><p>Connect external tools: LTI launches, SCORM packages, and xAPI learning records. Honest scope: LTI 1.1-compatible launch, SCORM import + launch + basic completion tracking, xAPI statement store.</p></div><section class="screen-panel"><h3>LTI tool consumers</h3><p class="panel-copy">Give these credentials to the external LMS (Canvas, Moodle, …). Launch URL: <code id="ltiLaunchUrl">/lti/launch</code>. The secret is shown <b>once</b> at creation and never returned again.</p><form id="ltiConsumerForm" class="teacher-form"><label>Linked course<select name="courseId" id="ltiCourseSel" required><option value="">Loading courses…</option></select></label><button class="primary-btn">Create consumer →</button><p id="ltiFormStatus" class="panel-copy" role="status"></p></form><div id="ltiSecretOnce"></div><div id="ltiConsumerList"><p class="panel-copy">Loading…</p></div></section><section class="screen-panel"><h3>SCORM packages</h3><p class="panel-copy">Upload a SCORM 1.2 / 2004 zip. The manifest is parsed into lessons that play in the SCORM player. Not a full SCORM runtime — import, launch, and completion tracking only.</p><form id="scormImportForm" class="teacher-form"><div class="lms-form-row"><label>Course<select name="courseId" id="scormCourseSel" required><option value="">Loading courses…</option></select></label><label>Package (.zip)<input type="file" id="scormZipFile" accept=".zip,application/zip" required></label></div><button class="primary-btn">Import package →</button><p id="scormImportStatus" class="panel-copy" role="status"></p></form><div id="scormPackageList"><p class="panel-copy">Loading…</p></div></section><section class="screen-panel"><h3>xAPI statements</h3><p class="panel-copy">Learning records stored by EduVerse. Lesson completions and quiz grades are recorded automatically; external tools can POST to <code>/api/xapi/statements</code>.</p><div class="screen-toolbar"><input aria-label="Filter by verb" id="xapiVerbFilter" class="search-field" placeholder="⌕ Filter by verb (e.g. completed)"><button class="filter-select" id="xapiFilterBtn" type="button">Filter</button></div><div id="xapiStatementList"><p class="panel-copy">Loading…</p></div></section><section class="screen-panel"><h3>Enrollment exports</h3><p class="panel-copy">The enrollment report in three formats. PDF opens a printable page; Excel uses SpreadsheetML (.xls, opens in Excel / Sheets).</p><div style="display:flex;gap:8px;flex-wrap:wrap"><a class="primary-btn" id="stdExportPdf" href="/api/reports/enrollments.pdf" style="text-decoration:none">Export PDF ↓</a><a class="primary-btn" id="stdExportXls" href="/api/reports/enrollments.xls" style="text-decoration:none">Export Excel ↓</a></div></section>`});
Object.assign(screens,{'scorm-player':`<div class="screen-title"><p class="eyebrow">EXTERNAL CONTENT</p><h1>SCORM lessons</h1><p>Launch imported SCORM modules. Marking complete records lesson completion back in EduVerse.</p></div><section class="screen-panel"><h3>Available modules</h3><div id="scormPlayerList"><p class="panel-copy">Loading…</p></div></section><section class="screen-panel" id="scormStageWrap" hidden><h3 id="scormStageTitle">Module</h3><iframe id="scormStage" class="scorm-frame" title="SCORM content" sandbox="allow-scripts allow-same-origin allow-forms"></iframe><div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button class="primary-btn" id="scormCompleteBtn" type="button">Mark complete ✓</button><button class="filter-select" id="scormOpenTab" type="button">Open in new tab ↗</button></div><p id="scormCommitStatus" class="panel-copy" role="status"></p></section>`});
portalScreens.admin[0][1].push(['admin-standards','⛓','LMS integrations']);
// SCORM player is intentionally available to staff only; students use standard course lessons.
const prevLoadStaffPageStd5=loadStaffPage;
loadStaffPage=async function(name){if(name==='admin-standards'){await loadAdminStandards();return;}return prevLoadStaffPageStd5(name);};
const prevNavigateStd5=navigate;
navigate=function(name){prevNavigateStd5(name);if(name==='scorm-player')loadScormPlayer();};

async function loadAdminStandards(){
  const pdf=document.querySelector('#stdExportPdf'),xls=document.querySelector('#stdExportXls');
  if(pdf)pdf.href=`${API_BASE}/reports/enrollments.pdf`;
  if(xls)xls.href=`${API_BASE}/reports/enrollments.xls`;
  const lu=document.querySelector('#ltiLaunchUrl');if(lu)lu.textContent=`${location.origin}/lti/launch`;
  try{
    const {courses}=await apiRequest('/admin/courses');
    const opts=(courses||[]).map(c=>`<option value="${safeText(c.id)}">${safeText(c.title)}</option>`).join('')||'<option value="">No courses yet</option>';
    document.querySelectorAll('#ltiCourseSel,#scormCourseSel').forEach(s=>{s.innerHTML=opts;});
  }catch{/* pickers stay on the loading option */}
  await Promise.all([renderLtiConsumers(),renderScormPackages(),renderXapiStatements()]);
}
async function renderLtiConsumers(){
  const box=document.querySelector('#ltiConsumerList');if(!box)return;
  try{
    const d=await apiRequest('/admin/lti/consumers');const list=d.consumers||d.items||[];
    box.innerHTML=list.length?staffTable(['Key','Course','Created','Action'],list.map(c=>`<tr><td><code>${safeText(c.key||'')}</code></td><td>${safeText(c.courseTitle||c.courseId||'—')}</td><td>${c.createdAt?new Date(c.createdAt).toLocaleDateString():'—'}</td><td><button data-lti-del="${safeText(String(c.id))}">Delete</button></td></tr>`),''):'<p class="panel-copy">No LTI consumers yet.</p>';
  }catch(err){box.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
async function renderScormPackages(){
  const box=document.querySelector('#scormPackageList');if(!box)return;
  try{
    const d=await apiRequest('/scorm/packages');const pkgs=d.packages||d.items||[];
    box.innerHTML=pkgs.length?pkgs.map(p=>`<article class="screen-panel" style="margin-top:10px"><p class="eyebrow">SCORM PACKAGE</p><h3>${safeText(p.title||'Untitled package')}</h3><p class="panel-copy">${(p.items||[]).length} learning object${(p.items||[]).length===1?'':'s'} · uploaded ${p.uploadedAt?new Date(p.uploadedAt).toLocaleDateString():'—'}</p>${(p.items||[]).map(it=>`<div class="teacher-record"><b>${safeText(it.title||it.identifier||'Item')}</b><small>${safeText(it.href||'')}</small></div>`).join('')}</article>`).join(''):'<p class="panel-copy">No SCORM packages imported yet.</p>';
  }catch(err){box.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
async function renderXapiStatements(){
  const box=document.querySelector('#xapiStatementList');if(!box)return;
  const verb=(document.querySelector('#xapiVerbFilter')||{}).value||'';
  try{
    const d=await apiRequest('/admin/xapi/statements'+(verb.trim()?`?verb=${encodeURIComponent(verb.trim())}`:''));const list=d.statements||d.items||[];
    box.innerHTML=list.length?staffTable(['Actor','Verb','Object','When'],list.slice(0,100).map(s=>{const v=s.verb||{};return `<tr><td>${safeText(s.actor?.name||s.actor?.account||'—')}</td><td>${safeText(v.display||v.id||'—')}</td><td>${safeText(s.object?.definition?.name||s.object?.id||'—')}</td><td>${s.stored?new Date(s.stored).toLocaleString():'—'}</td></tr>`;}),''):'<p class="panel-copy">No statements recorded yet.</p>';
  }catch(err){box.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
let scormPlayerLessonId=null;
async function loadScormPlayer(){
  const box=document.querySelector('#scormPlayerList');if(!box)return;
  try{
    const d=await apiRequest('/scorm/packages');const pkgs=d.packages||d.items||[];
    const items=[];pkgs.forEach(p=>(p.items||[]).forEach(it=>items.push({...it,pkgTitle:p.title})));
    box.innerHTML=items.length?items.map((it,i)=>`<div class="teacher-record"><b>${safeText(it.title||it.identifier||'Module')}</b><small>${safeText(it.pkgTitle||'')}</small><span style="margin-left:auto"><button class="filter-select" data-scorm-launch="${i}" type="button">Launch →</button></span></div>`).join(''):'<p class="panel-copy">No SCORM modules available yet. Ask your administrator to import a package.</p>';
    box._scormItems=items;
  }catch(err){box.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
document.addEventListener('click',e=>{
  const ltiDel=e.target.closest('[data-lti-del]');
  if(ltiDel){if(!confirm('Delete this LTI consumer? Launches using it will stop working.'))return;(async()=>{try{await apiRequest(`/admin/lti/consumers/${encodeURIComponent(ltiDel.dataset.ltiDel)}`,{method:'DELETE'});await renderLtiConsumers();}catch(err){alert(err.message);}})();return;}
  if(e.target.id==='xapiFilterBtn'){renderXapiStatements();return;}
  const sl=e.target.closest('[data-scorm-launch]');
  if(sl){const items=(document.querySelector('#scormPlayerList')||{})._scormItems||[];const it=items[Number(sl.dataset.scormLaunch)];if(!it)return;
    const src=it.url||it.href||'';if(!src){alert('This module has no launch URL.');return;}
    const frame=document.querySelector('#scormStage');if(frame)frame.src=src;
    const ttl=document.querySelector('#scormStageTitle');if(ttl)ttl.textContent=it.title||it.identifier||'Module';
    scormPlayerLessonId=it.lessonId||it.identifier||it.id||null;
    const wrap=document.querySelector('#scormStageWrap');if(wrap){wrap.hidden=false;wrap.scrollIntoView({behavior:'smooth'});}
    const st=document.querySelector('#scormCommitStatus');if(st)st.textContent='';
    return;}
  if(e.target.id==='scormCompleteBtn'){const st=document.querySelector('#scormCommitStatus');
    if(!scormPlayerLessonId){if(st)st.textContent='Launch a module first.';return;}
    (async()=>{try{await apiRequest(`/scorm/${encodeURIComponent(scormPlayerLessonId)}/commit`,{method:'POST',body:JSON.stringify({status:'completed'})});if(st)st.textContent='Completion recorded ✓';}catch(err){if(st)st.textContent='Could not record completion: '+err.message;}})();return;}
  if(e.target.id==='scormOpenTab'){const frame=document.querySelector('#scormStage');const st=document.querySelector('#scormCommitStatus');const src=frame&&frame.getAttribute('src');if(src){window.open(src,'_blank','noopener');}else if(st){st.textContent='Launch a module first.';}return;}
});
document.addEventListener('submit',async e=>{
  if(e.target.id==='ltiConsumerForm'){e.preventDefault();const f=e.target,st=document.querySelector('#ltiFormStatus');
    try{
      const d=await apiRequest('/admin/lti/consumers',{method:'POST',body:JSON.stringify({courseId:f.courseId.value})});
      const c=d.consumer||d;
      const once=document.querySelector('#ltiSecretOnce');
      if(once&&c.secret)once.innerHTML=`<div class="secret-once" role="status"><b>Consumer created — copy the secret now, it will not be shown again.</b><div>Key: <code>${safeText(c.key||'')}</code></div><div>Secret: <code>${safeText(c.secret||'')}</code></div><div>Launch URL: <code>${safeText(location.origin)}/lti/launch</code></div></div>`;
      if(st)st.textContent='Consumer created.';
      f.reset();await renderLtiConsumers();
    }catch(err){if(st)st.textContent=err.message;}
    return;}
  if(e.target.id==='scormImportForm'){e.preventDefault();const st=document.querySelector('#scormImportStatus');
    const file=(document.querySelector('#scormZipFile')||{}).files?.[0];
    if(!file){if(st)st.textContent='Choose a .zip package first.';return;}
    if(st)st.textContent='Uploading and parsing manifest…';
    try{
      const fd=new FormData();fd.append('package',file);fd.append('courseId',document.querySelector('#scormCourseSel').value);
      const res=await fetch(`${API_BASE}/admin/scorm/import`,{method:'POST',body:fd});
      const d=await res.json();if(!res.ok)throw new Error(d.error||'Import failed');
      const pkg=d.package||d;
      if(st)st.textContent=`Imported “${pkg.title||file.name}” (${(pkg.items||[]).length} learning objects).`;
      e.target.reset();await renderScormPackages();
    }catch(err){if(st)st.textContent='Import failed: '+err.message;}
    return;}
});
/* Slice 5 self-checks (run in console as __stdSelfCheck()) */
function __stdSelfCheck(){
  const checks=[];const has=(n,c)=>checks.push([n,!!c]);
  has('screenNames admin-standards',screenNames['admin-standards']==='LMS integrations');
  has('screenNames scorm-player',screenNames['scorm-player']==='SCORM lessons');
  has('screenRole admin-standards',Array.isArray(screenRole['admin-standards']));
  has('screenRole scorm-player',Array.isArray(screenRole['scorm-player']));
  has('staffPage admin-standards',!!staffPageMarkup['admin-standards']);
  has('screens scorm-player',typeof screens['scorm-player']==='string');
  has('admin nav has admin-standards',portalScreens.admin[0][1].some(x=>x[0]==='admin-standards'));
  has('student nav excludes scorm-player',!portalScreens.student.flatMap(g=>g[1]).some(x=>x[0]==='scorm-player'));
  has('loadAdminStandards fn',typeof loadAdminStandards==='function');
  has('loadScormPlayer fn',typeof loadScormPlayer==='function');
  has('renderLtiConsumers fn',typeof renderLtiConsumers==='function');
  has('renderScormPackages fn',typeof renderScormPackages==='function');
  has('renderXapiStatements fn',typeof renderXapiStatements==='function');
  return checks;
}

/* ---------- Online Coding Lab (code lab slice) ---------- */
const CODE_LANGUAGES=[['javascript','JavaScript'],['python','Python'],['java','Java'],['cpp','C++'],['c','C'],['go','Go'],['ruby','Ruby'],['rust','Rust']];
const CODE_LANG_LABELS=Object.fromEntries(CODE_LANGUAGES);
const CODE_STARTERS={
javascript:'// Write JavaScript below\nconsole.log("Hello, EduVerse!");\n',
python:'print("Hello, EduVerse!")\n',
java:'public class Main {\n  public static void main(String[] args) {\n    System.out.println("Hello, EduVerse!");\n  }\n}\n',
cpp:'#include <iostream>\nint main() {\n  std::cout << "Hello, EduVerse!" << std::endl;\n  return 0;\n}\n',
c:'#include <stdio.h>\nint main() {\n  printf("Hello, EduVerse!\\n");\n  return 0;\n}\n',
go:'package main\nimport "fmt"\nfunc main() {\n  fmt.Println("Hello, EduVerse!")\n}\n',
ruby:'puts "Hello, EduVerse!"\n',
rust:'fn main() {\n  println!("Hello, EduVerse!");\n}\n'};
Object.assign(screenNames,{'code-lab':'Coding lab','teacher-codelab':'Coding lab'});
Object.assign(screenRole,{'code-lab':['student','teacher'],'teacher-codelab':['teacher','admin']});
expandAdminRoles();
Object.assign(staffPageTitles,{'teacher-codelab':'Coding lab'});
const prevNavigateCodeLab=navigate;
navigate=function(name){prevNavigateCodeLab(name);if(name==='code-lab')loadCodeLab();};
portalScreens.student[0][1].push(['code-lab','⌨','Coding lab']);
portalScreens.teacher[0][1].push(['teacher-codelab','⌨','Coding lab']);
portalScreens.admin[0][1].push(['teacher-codelab','⌨','Coding lab']);
Object.assign(screens,{'code-lab':`<div class="screen-title"><p class="eyebrow">WRITE · RUN · SOLVE</p><h1>Online coding lab</h1><p>Write code, run it, and solve challenges. JavaScript runs locally right now — Python, Java, C++ and other languages need Judge0 configured by your administrator.</p></div><div class="lang-tabs" role="tablist" aria-label="Coding lab sections"><button class="filter-select lang-tab active" data-code-tab="editor" role="tab" aria-selected="true" type="button">Editor</button><button class="filter-select lang-tab" data-code-tab="challenges" role="tab" aria-selected="false" type="button">Challenges</button><button class="filter-select lang-tab" data-code-tab="projects" role="tab" aria-selected="false" type="button">My projects</button></div><section class="screen-panel" id="codeTabEditor"><div class="lms-form-row"><label>Language<select id="codeLang" aria-label="Programming language">${CODE_LANGUAGES.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label><label>Project title<input id="codeProjectTitle" maxlength="120" placeholder="Untitled project"></label></div><div class="code-editor-wrap"><div class="code-gutter" id="codeGutter" aria-hidden="true">1</div><textarea id="codeEditor" class="code-editor" spellcheck="false" wrap="off" rows="14" aria-label="Code editor"></textarea></div><label>Standard input (optional)<textarea id="codeStdin" class="code-stdin" rows="2" placeholder="Input for your program, one value per line"></textarea></label><p class="panel-copy"><small>JavaScript runs locally: define <code>function solve(input)</code> to read the input, and return or log the answer. Other languages need Judge0 configured.</small></p><div class="code-actions"><button class="primary-btn" id="codeRunBtn" type="button">Run ▶</button><button class="filter-select" id="codeSaveBtn" type="button">Save project</button><button class="filter-select" id="codeClearBtn" type="button">New file</button><span id="codeRunStatus" class="panel-copy" role="status"></span></div><div id="codeOutput" class="code-output" hidden><p><b>Status:</b> <span id="codeStatusText">—</span></p><div><p class="panel-copy"><b>Output</b></p><pre id="codeStdout" class="code-output-pre"></pre></div><div id="codeStderrWrap" hidden><p class="panel-copy"><b>Errors</b></p><pre id="codeStderr" class="code-output-pre code-output-err"></pre></div></div></section><section class="screen-panel" id="codeTabChallenges" hidden><h3>Coding challenges</h3><p class="panel-copy"><small>Test cases are visible by design — use them to check your solution before submitting.</small></p><div id="codeChallenges"><p class="panel-copy">Loading…</p></div><div id="codeChallengeDetail"></div></section><section class="screen-panel" id="codeTabProjects" hidden><h3>My projects</h3><div id="codeProjects"><p class="panel-copy">Loading…</p></div></section>`});
Object.assign(staffPageMarkup,{'teacher-codelab':`<div class="screen-title"><p class="eyebrow">CODING LAB</p><h1>Coding lab</h1><p>Create coding challenges for your learners. Test cases are visible to students by design.</p></div><section class="screen-panel"><h3>New challenge</h3><form id="codeChallengeForm" class="teacher-form"><div class="lms-form-row"><label>Title<input name="title" maxlength="160" required></label><label>Language<select name="language">${CODE_LANGUAGES.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label></div><label>Description<textarea name="description" rows="3" maxlength="4000" placeholder="What should the learner build?"></textarea></label><label>Starter code<textarea name="starterCode" rows="6" maxlength="20000" class="code-textarea" placeholder="Starter code shown in the student editor"></textarea></label><label>Test cases (one per line)<textarea name="testCases" rows="4" maxlength="20000" placeholder="2 3 || 5"></textarea></label><p class="panel-copy"><small>Format per line: <b>input || expected output</b>. Leave the input empty when the program reads no input: <b>|| expected</b>.</small></p><input type="hidden" name="id" id="codeChallengeId"><div><button class="primary-btn">Save challenge →</button> <button class="filter-select" type="button" id="codeChallengeCancel" hidden>Cancel edit</button></div><p id="codeChallengeStatus" class="panel-copy" role="status"></p></form></section><section class="screen-panel"><h3>Challenges</h3><div id="codeChallengeList"><p class="panel-copy">Loading…</p></div></section>`});
const prevLoadStaffPageCodeLab=loadStaffPage;
loadStaffPage=async function(name){if(name==='teacher-codelab'){await loadTeacherCodelab();return;}return prevLoadStaffPageCodeLab(name);};
const codeLab={projects:[],challenges:[],lang:'javascript',challenge:null,projectId:null,running:false};
function codeLangOptions(selected){return CODE_LANGUAGES.map(([v,l])=>`<option value="${v}"${v===selected?' selected':''}>${l}</option>`).join('');}
function codeStatus(id,msg){const el=document.querySelector(id);if(el)el.textContent=msg;}
function codeTabSwitch(tab){
  document.querySelectorAll('[data-code-tab]').forEach(b=>{const on=b.dataset.codeTab===tab;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));});
  for(const t of ['editor','challenges','projects']){const s=document.querySelector('#codeTab'+t[0].toUpperCase()+t.slice(1));if(s)s.hidden=t!==tab;}
}
function syncCodeGutter(){
  const ed=document.querySelector('#codeEditor'),g=document.querySelector('#codeGutter');if(!ed||!g)return;
  const lines=ed.value.split('\n').length;
  g.innerHTML=Array.from({length:lines},(_,i)=>i+1).join('\n');
  g.scrollTop=ed.scrollTop;
}
function setCodeEditor(code,lang){
  const ed=document.querySelector('#codeEditor');if(!ed)return;
  if(lang&&CODE_LANG_LABELS[lang]){codeLab.lang=lang;const sel=document.querySelector('#codeLang');if(sel)sel.value=lang;}
  ed.value=code||'';
  syncCodeGutter();
}
async function loadCodeLab(){
  try{const d=await apiRequest('/code/projects');codeLab.projects=d.projects||d.items||[];}catch{codeLab.projects=[];}
  try{const d=await apiRequest('/code/challenges');codeLab.challenges=d.challenges||d.items||[];}catch{codeLab.challenges=[];}
  const ed=document.querySelector('#codeEditor');
  if(ed&&!ed.value)setCodeEditor(CODE_STARTERS[codeLab.lang]||'',codeLab.lang);
  renderCodeProjects();renderCodeChallenges();
}
function renderCodeProjects(){
  const box=document.querySelector('#codeProjects');if(!box)return;
  box.innerHTML=codeLab.projects.length?codeLab.projects.map(p=>`<div class="teacher-record"><div><b>${safeText(p.title||'Untitled')}</b><small>${safeText(CODE_LANG_LABELS[p.language]||p.language||'')} · ${p.updatedAt?new Date(p.updatedAt).toLocaleDateString():'saved'}</small></div><div><button class="filter-select" data-code-project-open="${safeText(String(p.id))}">Open</button> <button class="filter-select" data-code-project-del="${safeText(String(p.id))}">Delete</button></div></div>`).join(''):'<p class="panel-copy">No saved projects yet. Write code in the editor and press “Save project”.</p>';
}
function renderCodeChallenges(){
  const box=document.querySelector('#codeChallenges');if(!box)return;
  box.innerHTML=codeLab.challenges.length?codeLab.challenges.map(c=>{
    const n=(c.testCases||[]).length, best=(c.bestScore!==undefined&&c.bestScore!==null)?`<span class="lang-score-pill">Best ${safeText(String(c.bestScore))}</span>`:'';
    return `<div class="teacher-record"><div><b>${safeText(c.title||'Challenge')}</b><small>${safeText(CODE_LANG_LABELS[c.language]||c.language||'')}${n?` · ${n} test case${n===1?'':'s'}`:''}</small></div><div>${best}<button class="primary-btn" data-code-challenge-open="${safeText(String(c.id))}">Open →</button></div></div>`;
  }).join(''):'<p class="panel-copy">No challenges yet. Ask your teacher to add some.</p>';
}
function openCodeChallenge(id){
  const c=codeLab.challenges.find(x=>String(x.id)===String(id));if(!c)return;
  codeLab.challenge=c;
  const box=document.querySelector('#codeChallengeDetail');if(!box)return;
  const cases=(c.testCases||[]);
  box.innerHTML=`<article class="screen-panel" style="margin-top:12px"><p class="eyebrow">CHALLENGE · ${safeText((CODE_LANG_LABELS[c.language]||c.language||'').toUpperCase())}</p><h3>${safeText(c.title||'Challenge')}</h3><p class="panel-copy">${safeText(c.description||'No description yet.')}</p><p class="panel-copy"><small>Tip: in JavaScript, define <code>function solve(input)</code> — the test input arrives as a string; return or log the answer.</small></p>${cases.length?staffTable(['#','Input','Expected output'],cases.map((t,i)=>`<tr><td>${i+1}</td><td><code>${safeText(t.input||'—')}</code></td><td><code>${safeText(t.expectedOutput||t.expected||'')}</code></td></tr>`),'No test cases.'):'<p class="panel-copy">No test cases for this challenge.</p>'}<div class="code-actions"><button class="primary-btn" data-code-challenge-load="${safeText(String(c.id))}">Load starter code</button> <button class="filter-select" data-code-challenge-submit="${safeText(String(c.id))}">Submit current editor code</button></div><div id="codeChallengeResult"></div></article>`;
  box.scrollIntoView({behavior:'smooth',block:'nearest'});
}
async function runCode(){
  const ed=document.querySelector('#codeEditor');if(!ed||codeLab.running)return;
  const lang=document.querySelector('#codeLang')?.value||codeLab.lang||'javascript';
  const stdin=document.querySelector('#codeStdin')?.value||'';
  const btn=document.querySelector('#codeRunBtn'),out=document.querySelector('#codeOutput');
  codeLab.running=true;if(btn)btn.disabled=true;
  codeStatus('#codeRunStatus','Running…');
  try{
    const d=await apiRequest('/code/run',{method:'POST',body:JSON.stringify({language:lang,code:ed.value,stdin})});
    if(out)out.hidden=false;
    const st=document.querySelector('#codeStatusText');if(st)st.textContent=String(d.status??'done');
    const so=document.querySelector('#codeStdout');if(so)so.textContent=d.stdout||'(no output)';
    const se=document.querySelector('#codeStderr'),sw=document.querySelector('#codeStderrWrap');
    if(se)se.textContent=d.stderr||'';
    if(sw)sw.hidden=!d.stderr;
    codeStatus('#codeRunStatus','');
  }catch(err){
    if(out)out.hidden=false;
    const st=document.querySelector('#codeStatusText');if(st)st.textContent='failed';
    const so=document.querySelector('#codeStdout');if(so)so.textContent='';
    const se=document.querySelector('#codeStderr'),sw=document.querySelector('#codeStderrWrap');
    if(se)se.textContent=err.message||'Run failed';
    if(sw)sw.hidden=false;
    codeStatus('#codeRunStatus',err.message||'Run failed');
  }finally{codeLab.running=false;if(btn)btn.disabled=false;}
}
async function saveCodeProject(){
  const ed=document.querySelector('#codeEditor');if(!ed)return;
  const title=(document.querySelector('#codeProjectTitle')?.value||'').trim()||'Untitled project';
  const lang=document.querySelector('#codeLang')?.value||codeLab.lang||'javascript';
  codeStatus('#codeRunStatus','Saving…');
  try{
    let d;
    if(codeLab.projectId)d=await apiRequest(`/code/projects/${encodeURIComponent(codeLab.projectId)}`,{method:'PATCH',body:JSON.stringify({title,language:lang,code:ed.value})});
    else d=await apiRequest('/code/projects',{method:'POST',body:JSON.stringify({title,language:lang,code:ed.value})});
    const p=d.project||d;if(p&&p.id)codeLab.projectId=p.id;
    codeStatus('#codeRunStatus','Project saved ✓');
    await loadCodeLab();
  }catch(err){codeStatus('#codeRunStatus',err.message||'Could not save project');}
}
function openCodeProject(id){
  const p=codeLab.projects.find(x=>String(x.id)===String(id));if(!p)return;
  codeLab.projectId=p.id;
  const t=document.querySelector('#codeProjectTitle');if(t)t.value=p.title||'';
  setCodeEditor(p.code||'',p.language||'javascript');
  codeTabSwitch('editor');
  codeStatus('#codeRunStatus',`Opened “${p.title||'Untitled'}”.`);
}
async function deleteCodeProject(id){
  if(!confirm('Delete this project?'))return;
  try{await apiRequest(`/code/projects/${encodeURIComponent(id)}`,{method:'DELETE'});
    if(String(codeLab.projectId)===String(id))codeLab.projectId=null;
    await loadCodeLab();
  }catch(err){alert(err.message);}
}
async function submitCodeChallenge(id){
  const c=codeLab.challenges.find(x=>String(x.id)===String(id));if(!c)return;
  const ed=document.querySelector('#codeEditor');if(!ed)return;
  const box=document.querySelector('#codeChallengeResult');if(box)box.innerHTML='<p class="panel-copy">Running your code against the test cases…</p>';
  try{
    const d=await apiRequest(`/code/challenges/${encodeURIComponent(id)}/submit`,{method:'POST',body:JSON.stringify({language:c.language||document.querySelector('#codeLang')?.value||'javascript',code:ed.value})});
    const results=d.results||[];
    if(box)box.innerHTML=`<p class="panel-copy" role="status"><b>${d.passed??0} / ${d.total??results.length} test cases passed</b></p>`+staffTable(['#','Input','Expected','Your output','Result'],results.map((r,i)=>`<tr><td>${i+1}</td><td><code>${safeText(r.input||'—')}</code></td><td><code>${safeText(r.expected||r.expectedOutput||'')}</code></td><td><code>${safeText(r.actual||'')}</code></td><td>${r.passed?'✓ Pass':'✗ Fail'}</td></tr>`),'No results returned.');
    await loadCodeLab();
  }catch(err){if(box)box.innerHTML=`<p class="panel-copy" role="alert">${safeText(err.message||'Submission failed')}</p>`;}
}
function parseCodeTestCases(text){
  return String(text||'').split('\n').map(l=>l.trim()).filter(Boolean).map(line=>{
    const parts=line.split('||');
    if(parts.length<2)return {input:'',expectedOutput:line};
    return {input:parts[0].trim(),expectedOutput:parts.slice(1).join('||').trim()};
  }).filter(t=>t.expectedOutput!==''||t.input!=='');
}
async function loadTeacherCodelab(){
  const box=document.querySelector('#codeChallengeList');if(!box)return;
  try{
    const d=await apiRequest('/teacher/challenges');
    const list=d.challenges||d.items||[];
    box.innerHTML=list.length?list.map(c=>{
      const n=(c.testCases||[]).length;
      return `<div class="teacher-record"><div><b>${safeText(c.title||'Challenge')}</b><small>${safeText(CODE_LANG_LABELS[c.language]||c.language||'')}${n?` · ${n} test case${n===1?'':'s'}`:''}</small></div><div><button class="filter-select" data-code-challenge-edit="${safeText(String(c.id))}">Edit</button> <button class="filter-select" data-code-challenge-del="${safeText(String(c.id))}">Delete</button></div></div>`;
    }).join(''):'<p class="panel-copy">No challenges yet. Use the form above to create one.</p>';
    box._codelabCache=list;
  }catch(err){box.innerHTML=`<p class="panel-copy" role="alert">${safeText(err.message||'Could not load challenges')}</p>`;}
}
document.addEventListener('click',async e=>{
  const tab=e.target.closest('[data-code-tab]');if(tab){codeTabSwitch(tab.dataset.codeTab);return;}
  if(e.target.id==='codeRunBtn'){runCode();return;}
  if(e.target.id==='codeSaveBtn'){saveCodeProject();return;}
  if(e.target.id==='codeClearBtn'){codeLab.projectId=null;const t=document.querySelector('#codeProjectTitle');if(t)t.value='';setCodeEditor(CODE_STARTERS[codeLab.lang]||'',codeLab.lang);codeStatus('#codeRunStatus','New file ready.');return;}
  const po=e.target.closest('[data-code-project-open]');if(po){openCodeProject(po.dataset.codeProjectOpen);return;}
  const pd=e.target.closest('[data-code-project-del]');if(pd){deleteCodeProject(pd.dataset.codeProjectDel);return;}
  const co=e.target.closest('[data-code-challenge-open]');if(co){openCodeChallenge(co.dataset.codeChallengeOpen);return;}
  const cl=e.target.closest('[data-code-challenge-load]');if(cl){const c=codeLab.challenges.find(x=>String(x.id)===String(cl.dataset.codeChallengeLoad));if(c){setCodeEditor(c.starterCode||CODE_STARTERS[c.language]||'',c.language||'javascript');codeTabSwitch('editor');codeStatus('#codeRunStatus','Starter code loaded.');}return;}
  const cs=e.target.closest('[data-code-challenge-submit]');if(cs){submitCodeChallenge(cs.dataset.codeChallengeSubmit);return;}
  const ce=e.target.closest('[data-code-challenge-edit]');if(ce){
    const list=(document.querySelector('#codeChallengeList')||{})._codelabCache||[];
    const c=list.find(x=>String(x.id)===String(ce.dataset.codeChallengeEdit));if(!c)return;
    const f=document.querySelector('#codeChallengeForm');if(!f)return;
    f.title.value=c.title||'';f.language.value=c.language||'javascript';
    f.description.value=c.description||'';f.starterCode.value=c.starterCode||'';
    f.testCases.value=(c.testCases||[]).map(t=>`${t.input||''} || ${t.expectedOutput||t.expected||''}`).join('\n');
    document.querySelector('#codeChallengeId').value=c.id;
    const cancel=document.querySelector('#codeChallengeCancel');if(cancel)cancel.hidden=false;
    f.scrollIntoView({behavior:'smooth',block:'nearest'});
    return;}
  const cd=e.target.closest('[data-code-challenge-del]');if(cd){
    if(!confirm('Delete this challenge? Student attempts are kept.'))return;
    try{await apiRequest(`/teacher/challenges/${encodeURIComponent(cd.dataset.codeChallengeDel)}`,{method:'DELETE'});loadTeacherCodelab();}catch(err){alert(err.message);}
    return;}
  if(e.target.id==='codeChallengeCancel'){const f=document.querySelector('#codeChallengeForm');if(f)f.reset();document.querySelector('#codeChallengeId').value='';e.target.hidden=true;codeStatus('#codeChallengeStatus','');return;}
});
document.addEventListener('submit',async e=>{
  if(e.target.id==='codeChallengeForm'){e.preventDefault();const f=e.target,st=document.querySelector('#codeChallengeStatus');
    const id=document.querySelector('#codeChallengeId').value;
    const body={title:f.title.value.trim(),language:f.language.value,description:f.description.value.trim(),starterCode:f.starterCode.value,testCases:parseCodeTestCases(f.testCases.value)};
    try{
      if(id)await apiRequest(`/teacher/challenges/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)});
      else await apiRequest('/teacher/challenges',{method:'POST',body:JSON.stringify(body)});
      if(st)st.textContent=id?'Challenge updated.':'Challenge created.';
      f.reset();document.querySelector('#codeChallengeId').value='';
      const cancel=document.querySelector('#codeChallengeCancel');if(cancel)cancel.hidden=true;
      loadTeacherCodelab();
    }catch(err){if(st)st.textContent=err.message;}
    return;}
});
document.addEventListener('keydown',e=>{
  if(e.target&&e.target.id==='codeEditor'&&e.key==='Tab'){
    e.preventDefault();
    const ed=e.target,start=ed.selectionStart,end=ed.selectionEnd;
    ed.value=ed.value.slice(0,start)+'  '+ed.value.slice(end);
    ed.selectionStart=ed.selectionEnd=start+2;
    syncCodeGutter();
  }
});
document.addEventListener('input',e=>{if(e.target&&e.target.id==='codeEditor')syncCodeGutter();});
document.addEventListener('scroll',e=>{if(e.target&&e.target.id==='codeEditor')syncCodeGutter();},true);
document.addEventListener('change',e=>{
  if(e.target&&e.target.id==='codeLang'){
    const ed=document.querySelector('#codeEditor'),next=e.target.value,prev=codeLab.lang;
    codeLab.lang=next;
    if(ed&&(!ed.value.trim()||ed.value===(CODE_STARTERS[prev]||'')))setCodeEditor(CODE_STARTERS[next]||'',next);
  }
});
/* Code lab self-checks (run in console as __codelabSelfCheck()) */
function __codelabSelfCheck(){
  const checks=[];const has=(n,c)=>checks.push([n,!!c]);
  has('screenNames code-lab',screenNames['code-lab']==='Coding lab');
  has('screenNames teacher-codelab',screenNames['teacher-codelab']==='Coding lab');
  has('screenRole code-lab',Array.isArray(screenRole['code-lab']));
  has('screenRole teacher-codelab',Array.isArray(screenRole['teacher-codelab']));
  has('staffPage teacher-codelab',!!staffPageMarkup['teacher-codelab']);
  has('screens code-lab',typeof screens['code-lab']==='string');
  has('student nav has code-lab',portalScreens.student[0][1].some(x=>x[0]==='code-lab'));
  has('teacher nav has teacher-codelab',portalScreens.teacher[0][1].some(x=>x[0]==='teacher-codelab'));
  has('admin nav has teacher-codelab',portalScreens.admin[0][1].some(x=>x[0]==='teacher-codelab'));
  has('loadCodeLab fn',typeof loadCodeLab==='function');
  has('runCode fn',typeof runCode==='function');
  has('loadTeacherCodelab fn',typeof loadTeacherCodelab==='function');
  has('parseCodeTestCases fn',typeof parseCodeTestCases==='function');
  has('parseCodeTestCases parses',(()=>{const t=parseCodeTestCases('2 3 || 5\n|| hello');return t.length===2&&t[0].input==='2 3'&&t[0].expectedOutput==='5'&&t[1].input===''&&t[1].expectedOutput==='hello';})());
  has('editor has tab support',typeof syncCodeGutter==='function');
  return checks;
}

/* ---------- virtual classroom gaps (slice 3): Agora provider + starting-soon banner ---------- */
const AGORA_SDK_URL='https://download.agora.io/sdk/release/AgoraRTC_N-4.23.0.js';
let lcProviderCache=null;
async function lcGetVideoProvider(){
  if(lcProviderCache)return lcProviderCache;
  try{
    const d=await apiRequest('/settings/video-provider');
    const p={provider:String(d.provider||d.videoProvider||'webrtc').toLowerCase(),agoraConfigured:!!(d.agoraConfigured||d.agora||d.configured)};
    lcProviderCache=p;return p;
  }catch(e){return {provider:'webrtc',agoraConfigured:false};}
}
function lcLoadAgoraSdk(){
  if(typeof window!=='undefined'&&window.AgoraRTC)return Promise.resolve(true);
  return new Promise(res=>{
    const s=document.createElement('script');
    s.src=AGORA_SDK_URL;s.async=true;
    let done=false;
    const finish=ok=>{if(done)return;done=true;clearTimeout(t);res(ok);};
    const t=setTimeout(()=>finish(false),15000);
    s.onload=()=>finish(!!window.AgoraRTC);
    s.onerror=()=>finish(false);
    document.head.appendChild(s);
  });
}
function lcAgoraAddRemote(user){
  const tile=lcTileEl('agora-'+String(user.uid),'Guest',false);if(!tile)return;
  const v=tile.querySelector('video');
  try{if(user.videoTrack&&v)user.videoTrack.play(v);}catch(e){}
  lc.agoraRemotes.set(String(user.uid),user);
  lcNoteParticipant('agora-'+String(user.uid),'Guest '+String(user.uid));
  lcRenderPeople();
}
function lcAgoraRemoveRemote(uid){
  const tile=document.querySelector(`[data-lc-tile="${CSS.escape('agora-'+String(uid))}"]`);if(tile)tile.remove();
  lc.agoraRemotes.delete(String(uid));
  lcNoteParticipantLeft('agora-'+String(uid));
  lcRenderPeople();
}
async function lcStartAgora(){
  lcStatus('Starting Agora video…');
  const sdkOk=await lcLoadAgoraSdk();
  if(!sdkOk){lcStatus('Agora video could not load (check your connection) — using built-in video instead.');return false;}
  let tok;
  try{tok=await apiRequest('/live/token',{method:'POST',body:JSON.stringify({channel:lc.roomId,role:'publisher'})});}
  catch(e){lcStatus('Agora token unavailable ('+(e.message||'error')+') — using built-in video instead.');return false;}
  const appId=tok.appId||tok.appID,token=tok.token||null,channel=tok.channel||lc.roomId,uid=(tok.uid===undefined||tok.uid===null)?null:tok.uid;
  if(!appId){lcStatus('Agora is not configured on this server — using built-in video instead.');return false;}
  try{
    const client=window.AgoraRTC.createClient({mode:'rtc',codec:'vp8'});
    lc.agoraClient=client;
    client.on('user-published',async(user,mediaType)=>{
      try{await client.subscribe(user,mediaType);}catch(e){return;}
      if(mediaType==='video')lcAgoraAddRemote(user);
      if(mediaType==='audio'){try{user.audioTrack.play();}catch(e){}}
    });
    client.on('user-unpublished',(user,mediaType)=>{if(mediaType==='video')lcAgoraRemoveRemote(user.uid);});
    client.on('user-left',user=>lcAgoraRemoveRemote(user.uid));
    const joinedUid=await client.join(appId,channel,token,uid);
    lc.agoraUid=joinedUid;
    let audioTrack=null,videoTrack=null;
    try{[audioTrack,videoTrack]=await window.AgoraRTC.createMicrophoneAndCameraTracks();}
    catch(e){try{audioTrack=await window.AgoraRTC.createMicrophoneAudioTrack();}catch(_){/* audio-only or none */}}
    lc.agoraAudioTrack=audioTrack;lc.agoraVideoTrack=videoTrack;
    const tile=lcTileEl('local',lc.myName,true);
    if(videoTrack&&tile){const v=tile.querySelector('video');if(v)videoTrack.play(v);}
    else if(tile){const f=tile.querySelector('.lc-flags');if(f)f.innerHTML='<span class="lc-flag">no camera</span>';}
    // Bridge Agora tracks into a plain MediaStream so the existing mic/cam toggle
    // and local-recording code paths keep working unchanged.
    const mst=[];if(audioTrack)mst.push(audioTrack.getMediaStreamTrack());if(videoTrack)mst.push(videoTrack.getMediaStreamTrack());
    lc.localStream=mst.length?new MediaStream(mst):null;
    const toPublish=[];if(audioTrack)toPublish.push(audioTrack);if(videoTrack)toPublish.push(videoTrack);
    if(toPublish.length)await client.publish(toPublish);
    lc.agoraMode=true;
    lcStatus('Connected · Agora video · '+(lc.sessionTitle||'Live classroom'));
    const priv=document.querySelector('.lc-privacy small');
    if(priv)priv.textContent='Video is relayed by Agora (configured by your administrator). Chat, whiteboard and slides still run through EduVerse.';
    return true;
  }catch(e){
    lcStatus('Agora video could not start ('+(e.message||'error')+') — using built-in video instead.');
    try{if(lc.agoraClient)await lc.agoraClient.leave();}catch(_){}
    lc.agoraClient=null;return false;
  }
}
async function lcToggleAgoraShare(){
  const b=document.querySelector('#lcShare');
  if(lc.sharing){
    try{
      if(lc.agoraScreenTrack){try{await lc.agoraClient.unpublish(lc.agoraScreenTrack);}catch(e){}lc.agoraScreenTrack.close();lc.agoraScreenTrack=null;}
      if(lc.agoraVideoTrack){try{await lc.agoraClient.publish(lc.agoraVideoTrack);}catch(e){}const v=document.querySelector('#lcLocalVideo');if(v)lc.agoraVideoTrack.play(v);}
    }catch(e){}
    lc.sharing=false;lc.screenStream=null;
    if(b){b.setAttribute('aria-pressed','false');b.innerHTML='\u{1F5A5} Share';}
    lcStatus('Stopped sharing.');
    return;
  }
  try{
    const screenTrack=await window.AgoraRTC.createScreenVideoTrack({encoderConfig:'1080p_1'});
    if(lc.agoraVideoTrack){try{await lc.agoraClient.unpublish(lc.agoraVideoTrack);}catch(e){}}
    await lc.agoraClient.publish(screenTrack);
    lc.agoraScreenTrack=screenTrack;lc.sharing=true;
    const v=document.querySelector('#lcLocalVideo');if(v)screenTrack.play(v);
    if(screenTrack.on)screenTrack.on('track-ended',()=>{if(lc.sharing)lcToggleAgoraShare();});
    if(b){b.setAttribute('aria-pressed','true');b.innerHTML='\u{1F5A5} Sharing\u2026';}
    lcStatus('Sharing your screen with the room.');
  }catch(e){lcStatus('Screen share cancelled or unavailable.');}
}
function lcLeaveAgora(){
  try{if(lc.agoraClient){try{const p=lc.agoraClient.leave();if(p&&p.catch)p.catch(()=>{});}catch(e){}}}catch(e){}
  [lc.agoraAudioTrack,lc.agoraVideoTrack,lc.agoraScreenTrack].forEach(t=>{try{if(t)t.close();}catch(e){}});
  lc.agoraClient=null;lc.agoraAudioTrack=null;lc.agoraVideoTrack=null;lc.agoraScreenTrack=null;lc.agoraMode=false;
}
function lcSoonMinutes(startsAt){
  const t=new Date(startsAt).getTime();if(Number.isNaN(t))return null;
  return Math.round((t-Date.now())/60000);
}
function lcSoonLabel(s){
  if(s.status==='live')return 'LIVE NOW';
  const m=lcSoonMinutes(s.startsAt);
  if(m===null)return new Date(s.startsAt).toLocaleString();
  if(m<=0)return 'Starting now';
  return 'Starts in '+m+' min · '+new Date(s.startsAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
}
async function loadSoonBanner(boxId){
  const box=document.getElementById(boxId);if(!box)return;
  let sessions=[];
  try{
    const d=await apiRequest('/live-sessions/upcoming');
    sessions=d.sessions||d.upcoming||[];
  }catch(e){
    // Backend endpoint not available yet — derive from the session list instead.
    try{const d=await apiRequest('/live-sessions');sessions=d.sessions||[];}catch(_){box.innerHTML='';box.hidden=true;return;}
  }
  const now=Date.now();
  const soon=(sessions||[]).filter(s=>{
    const t=new Date(s.startsAt).getTime();
    if(s.status==='live')return true;
    return !Number.isNaN(t)&&t>=now-5*60000&&t<=now+60*60000;
  }).sort((a,b)=>new Date(a.startsAt)-new Date(b.startsAt)).slice(0,3);
  if(!soon.length){box.innerHTML='';box.hidden=true;return;}
  box.hidden=false;
  box.innerHTML=`<div class="lms-soon-inner"><p class="eyebrow">● STARTING SOON</p>${soon.map(s=>`<div class="lms-mini-row"><div><b>${safeText(s.title||'Live class')}</b><small>${safeText(lcSoonLabel(s))}</small></div><button class="primary-btn" data-lms-join-live="${safeText(s.id)}">Join \u2192</button></div>`).join('')}</div>`;
}
function __classroomSelfCheck(){
  const checks=[];const has=(n,c)=>checks.push([n,!!c]);
  has('lcGetVideoProvider fn',typeof lcGetVideoProvider==='function');
  has('lcLoadAgoraSdk fn',typeof lcLoadAgoraSdk==='function');
  has('lcStartAgora fn',typeof lcStartAgora==='function');
  has('lcLeaveAgora fn',typeof lcLeaveAgora==='function');
  has('lcToggleAgoraShare fn',typeof lcToggleAgoraShare==='function');
  has('loadSoonBanner fn',typeof loadSoonBanner==='function');
  has('lcSoonLabel live',lcSoonLabel({status:'live',startsAt:new Date().toISOString()})==='LIVE NOW');
  has('lcSoonLabel future',lcSoonLabel({status:'scheduled',startsAt:new Date(Date.now()+30*60000).toISOString()}).startsWith('Starts in 30 min'));
  has('student soon banner slot',!!document.getElementById('lmsSoonBanner'));
  has('teacher soon banner slot',typeof screens!=='undefined'&&String(screens.teacher||'').includes('teacherSoonBanner'));
  return checks;
}

/* ---------- AI quiz generator (advanced-features slice 1) ---------- */
Object.assign(screenNames,{'quiz-generator':'Quiz generator'});
Object.assign(screenRole,{'quiz-generator':['teacher']});
const prevNavigateQuizGen=navigate;
navigate=function(name){prevNavigateQuizGen(name);if(name==='quiz-generator')loadQuizGenerator();};
portalScreens.teacher[0][1].push(['quiz-generator','✎','Quiz generator']);
Object.assign(screens,{'quiz-generator':`<div class="screen-title"><p class="eyebrow">NOTES IN · QUIZ OUT</p><h1>AI quiz generator</h1><p>Upload your notes or paste text, and get a quiz you can save and take. Generated with OpenAI when configured, otherwise from your notes locally. PDF text extraction reads the text layer only — scanned/image PDFs won't work.</p></div><section class="screen-panel"><h3>1 · Your notes</h3><label>Upload notes (TXT, MD or PDF, max 5MB)<input type="file" id="qgFileInput" accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"></label><p id="qgUploadStatus" class="panel-copy" role="status"></p><label>Or paste your notes<textarea id="qgNotesText" rows="8" maxlength="100000" placeholder="Paste the chapter, lecture notes or summary you want a quiz from…"></textarea></label><p class="panel-copy"><small id="qgCharCount">0 characters</small></p><div class="lms-form-row"><label>How many questions?<select id="qgCount" aria-label="Number of questions"><option value="3">3 questions</option><option value="5" selected>5 questions</option><option value="8">8 questions</option><option value="10">10 questions</option></select></label></div><div><button class="primary-btn" id="qgGenerateBtn" type="button">Generate quiz →</button> <span id="qgStatus" class="panel-copy" role="status"></span></div></section><section class="screen-panel" id="qgPreviewWrap" hidden><h3>2 · Review the questions</h3><p class="panel-copy"><small>Fix anything that looks wrong before saving — edit the prompt or options, pick the correct answer, or remove a question. <span id="qgProviderNote"></span></small></p><div id="qgPreview"></div><h3>3 · Save it</h3><div class="lms-form-row"><label>Quiz title<input id="qgTitle" maxlength="120" placeholder="e.g. Photosynthesis — Chapter 4 quiz"></label><span id="qgCourseWrap" hidden><label>Course<select id="qgCourse" aria-label="Course"><option value="">No specific course</option></select></label></span></div><div><button class="primary-btn" id="qgSaveBtn" type="button">Save quiz →</button> <span id="qgSaveStatus" class="panel-copy" role="status"></span></div></section><section class="screen-panel"><h3>Your generated quizzes</h3><div id="qgHistory"><p class="panel-copy">Loading…</p></div></section>`});
const quizGen={text:'',questions:[],provider:null,courses:[],generating:false,saving:false};
function qgStatus(msg){const el=document.querySelector('#qgStatus');if(el)el.textContent=msg||'';}
function qgSaveStatus(msg){const el=document.querySelector('#qgSaveStatus');if(el)el.textContent=msg||'';}
function qgUpdateCharCount(){const ta=document.querySelector('#qgNotesText');const n=ta?ta.value.length:0;const el=document.querySelector('#qgCharCount');if(el)el.textContent=n.toLocaleString('en-IN')+' characters';}
function qgValidQuestion(q){return q&&typeof q.prompt==='string'&&q.prompt.trim()&&Array.isArray(q.options)&&q.options.length===4&&q.options.every(o=>typeof o==='string'&&o.trim())&&Number.isInteger(q.correctIndex)&&q.correctIndex>=0&&q.correctIndex<=3;}
function qgRenderPreview(){
  const wrap=document.querySelector('#qgPreviewWrap'),box=document.querySelector('#qgPreview');
  if(!wrap||!box)return;
  wrap.hidden=!quizGen.questions.length;
  const note=document.querySelector('#qgProviderNote');
  if(note)note.textContent=quizGen.provider?('Generated by '+quizGen.provider+'.'):'';
  box.innerHTML=quizGen.questions.map((q,i)=>`<article class="qg-question" data-qg-q="${i}"><div class="qg-q-head"><b>Q${i+1}</b><button class="filter-select" type="button" data-qg-del="${i}">Remove</button></div><label>Question<input class="qg-prompt" data-qg-prompt="${i}" value="${safeText(q.prompt||'')}" maxlength="1000" aria-label="Question ${i+1}"></label>${(q.options||[]).map((o,j)=>`<label class="qg-option${j===q.correctIndex?' qg-correct':''}"><input type="radio" name="qg-correct-${i}" value="${j}"${j===q.correctIndex?' checked':''} aria-label="Mark option ${j+1} as correct"><input class="qg-opt" data-qg-opt="${i}:${j}" value="${safeText(o||'')}" maxlength="500" aria-label="Option ${j+1} for question ${i+1}"><span class="qg-correct-tag">${j===q.correctIndex?'✓ correct':''}</span></label>`).join('')}<label>Explanation (shown after answering)<input class="qg-expl" data-qg-expl="${i}" value="${safeText(q.explanation||'')}" maxlength="1000" aria-label="Explanation for question ${i+1}"></label></article>`).join('')||'<p class="panel-copy">No questions yet — generate some from your notes above.</p>';
}
function qgCollectQuestions(){
  return quizGen.questions.map((q,i)=>{
    const promptEl=document.querySelector(`[data-qg-prompt="${i}"]`);
    const explEl=document.querySelector(`[data-qg-expl="${i}"]`);
    const checked=document.querySelector(`input[name="qg-correct-${i}"]:checked`);
    const options=[0,1,2,3].map(j=>{const el=document.querySelector(`[data-qg-opt="${i}:${j}"]`);return el?el.value.trim():'';});
    return {prompt:promptEl?promptEl.value.trim():String(q.prompt||''),options,correctIndex:checked?Number(checked.value):Number(q.correctIndex)||0,explanation:explEl?explEl.value.trim():String(q.explanation||'')};
  });
}
async function qgLoadCourses(){
  const wrap=document.querySelector('#qgCourseWrap'),sel=document.querySelector('#qgCourse');
  if(!wrap||!sel)return;
  const isTeacher=currentUser&&currentUser.role==='teacher';
  wrap.hidden=!isTeacher;
  if(!isTeacher)return;
  try{
    const d=await apiRequest('/teacher/courses').catch(()=>null);
    const list=(d&&(d.courses||d))||[];
    quizGen.courses=Array.isArray(list)?list:[];
    if(!quizGen.courses.length){const c=await apiRequest('/courses').catch(()=>({}));quizGen.courses=c.courses||[];}
    sel.innerHTML='<option value="">No specific course</option>'+quizGen.courses.map(c=>`<option value="${safeText(c.id)}">${safeText(c.title||'Course')}</option>`).join('');
  }catch{sel.innerHTML='<option value="">No specific course</option>';}
}
async function qgLoadHistory(){
  const box=document.querySelector('#qgHistory');if(!box)return;
  try{
    const d=await apiRequest('/quizgen/history');
    const list=d.quizzes||d.history||d.items||[];
    box.innerHTML=list.length?list.map(q=>`<div class="teacher-record"><b>${safeText(q.title||'Generated quiz')}</b><small>${(q.questions||[]).length} questions${q.createdAt?' · '+new Date(q.createdAt).toLocaleDateString():''}${q.provider?' · '+safeText(q.provider):''}</small></div>`).join(''):'<p class="panel-copy">Nothing generated yet — your saved quizzes will show up here.</p>';
  }catch{box.innerHTML='<p class="panel-copy">History is unavailable right now.</p>';}
}
async function qgHandleFile(file){
  const st=document.querySelector('#qgUploadStatus');
  if(!file)return;
  const ext=String(file.name||'').split('.').pop().toLowerCase();
  if(!['txt','md','pdf'].includes(ext)){if(st)st.textContent='Only TXT, MD or PDF notes are accepted.';return;}
  if(file.size>5*1024*1024){if(st)st.textContent='File must be under 5MB.';return;}
  if(st)st.textContent='Reading '+file.name+'…';
  const rd=new FileReader();
  rd.onload=async()=>{
    try{
      const dataUrl=String(rd.result||'');const base64=dataUrl.split(',')[1]||'';
      const d=await apiRequest('/quizgen/upload',{method:'POST',body:JSON.stringify({filename:file.name,mimeType:file.type||'application/octet-stream',data:base64})});
      const text=d.text||d.notes||'';
      if(!text.trim())throw new Error('No readable text found in that file. Scanned/image PDFs have no text layer.');
      quizGen.text=text;
      const ta=document.querySelector('#qgNotesText');if(ta)ta.value=text;
      qgUpdateCharCount();
      if(st)st.textContent='✓ '+file.name+' — '+(d.charCount||text.length).toLocaleString('en-IN')+' characters ready.';
    }catch(err){
      // Backend endpoint not available yet — read plain text locally for TXT/MD.
      if(ext!=='pdf'&&rd.result){
        try{
          const text=await file.text();
          quizGen.text=text;
          const ta=document.querySelector('#qgNotesText');if(ta)ta.value=text;
          qgUpdateCharCount();
          if(st)st.textContent='✓ '+file.name+' read in this browser — '+(text.length).toLocaleString('en-IN')+' characters ready.';
          return;
        }catch(_){}
      }
      if(st)st.textContent='Could not read that file: '+(err.message||'upload failed')+'. You can paste the text instead.';
    }
  };
  rd.onerror=()=>{if(st)st.textContent='Could not read the file.';};
  rd.readAsDataURL(file);
}
async function qgGenerate(){
  if(quizGen.generating)return;
  const ta=document.querySelector('#qgNotesText');
  const text=(quizGen.text&&quizGen.text.trim())||(ta?ta.value.trim():'');
  if(text.length<100){qgStatus('Add at least a short paragraph of notes first — a few sentences is enough.');return;}
  const countEl=document.querySelector('#qgCount');
  const count=Math.max(1,Math.min(10,Number(countEl?countEl.value:5)||5));
  quizGen.generating=true;qgStatus('Generating questions…');
  try{
    const d=await apiRequest('/quizgen/generate',{method:'POST',body:JSON.stringify({text:text.slice(0,100000),count})});
    const list=d.questions||d.items||[];
    quizGen.questions=list.filter(qgValidQuestion).map(q=>({prompt:String(q.prompt).trim(),options:q.options.map(o=>String(o).trim()),correctIndex:q.correctIndex,explanation:String(q.explanation||'').trim()}));
    quizGen.provider=d.provider||null;
    if(!quizGen.questions.length)throw new Error('The generator returned no usable questions. Try longer notes or fewer questions.');
    quizGen.text=text;
    qgRenderPreview();
    qgStatus('✓ '+quizGen.questions.length+' questions ready — review them below, then save.');
    const wrap=document.querySelector('#qgPreviewWrap');if(wrap)wrap.scrollIntoView({behavior:'smooth',block:'center'});
  }catch(err){qgStatus(err.message||'Could not generate questions. Try again.');}
  finally{quizGen.generating=false;}
}
async function qgSave(){
  if(quizGen.saving)return;
  const titleEl=document.querySelector('#qgTitle');
  const title=titleEl?titleEl.value.trim():'';
  if(!title){qgSaveStatus('Give the quiz a title first.');return;}
  const questions=qgCollectQuestions().filter(qgValidQuestion);
  if(!questions.length){qgSaveStatus('No valid questions to save — each needs a prompt and four non-empty options.');return;}
  const isTeacher=currentUser&&currentUser.role==='teacher';
  const courseEl=document.querySelector('#qgCourse');
  quizGen.saving=true;qgSaveStatus('Saving…');
  try{
    let d;
    if(isTeacher){
      d=await apiRequest('/quizgen/save',{method:'POST',body:JSON.stringify({title,courseId:courseEl&&courseEl.value?courseEl.value:undefined,questions})});
    }else{
      d=await apiRequest('/quizgen/save-practice',{method:'POST',body:JSON.stringify({title,questions})});
    }
    const quiz=d.quiz||d;
    qgSaveStatus('✓ Saved “'+(quiz.title||title)+'”'+(isTeacher?' — find it in Quizzes.':' — find it in your practice quizzes.'));
    if(titleEl)titleEl.value='';
    qgLoadHistory();
  }catch(err){qgSaveStatus(err.message||'Could not save the quiz. Try again.');}
  finally{quizGen.saving=false;}
}
async function loadQuizGenerator(){
  qgRenderPreview();
  const ta=document.querySelector('#qgNotesText');
  if(ta){ta.value=quizGen.text||'';ta.addEventListener('input',()=>{quizGen.text=ta.value;qgUpdateCharCount();});qgUpdateCharCount();}
  const fileInput=document.querySelector('#qgFileInput');
  if(fileInput)fileInput.addEventListener('change',e=>{const f=e.target.files&&e.target.files[0];qgHandleFile(f);});
  const genBtn=document.querySelector('#qgGenerateBtn');
  if(genBtn)genBtn.addEventListener('click',qgGenerate);
  const saveBtn=document.querySelector('#qgSaveBtn');
  if(saveBtn)saveBtn.addEventListener('click',qgSave);
  const preview=document.querySelector('#qgPreview');
  if(preview){
    preview.addEventListener('click',e=>{
      const del=e.target.closest('[data-qg-del]');
      if(del){quizGen.questions.splice(Number(del.dataset.qgDel),1);qgRenderPreview();}
    });
    preview.addEventListener('change',e=>{
      if(e.target.matches('input[type="radio"][name^="qg-correct-"]')){
        const idx=Number(e.target.name.replace('qg-correct-',''));
        quizGen.questions[idx].correctIndex=Number(e.target.value);
        qgRenderPreview();
      }
    });
  }
  qgLoadCourses();
  qgLoadHistory();
}
/* Quiz generator self-checks (run in console as __quizGenSelfCheck()) */
function __quizGenSelfCheck(){
  const checks=[];const has=(n,c)=>checks.push([n,!!c]);
  has('screenNames quiz-generator',screenNames['quiz-generator']==='Quiz generator');
  has('screenRole quiz-generator',Array.isArray(screenRole['quiz-generator'])&&screenRole['quiz-generator'].length===1&&screenRole['quiz-generator'].includes('teacher'));
  has('screens quiz-generator',typeof screens['quiz-generator']==='string');
  has('student nav omits quiz-generator',!portalScreens.student[0][1].some(x=>x[0]==='quiz-generator'));
  has('teacher nav has quiz-generator',portalScreens.teacher[0][1].some(x=>x[0]==='quiz-generator'));
  has('loadQuizGenerator fn',typeof loadQuizGenerator==='function');
  has('qgGenerate fn',typeof qgGenerate==='function');
  has('qgSave fn',typeof qgSave==='function');
  has('qgValidQuestion accepts good',qgValidQuestion({prompt:'What is 2+2?',options:['1','2','3','4'],correctIndex:3,explanation:'x'}));
  has('qgValidQuestion rejects short options',!qgValidQuestion({prompt:'Q?',options:['a','b'],correctIndex:0}));
  has('qgValidQuestion rejects bad index',!qgValidQuestion({prompt:'Q?',options:['a','b','c','d'],correctIndex:4}));
  has('qgCollectQuestions reads DOM',(()=>{quizGen.questions=[{prompt:'Q?',options:['a','b','c','d'],correctIndex:1,explanation:''}];qgRenderPreview();const got=qgCollectQuestions();return got.length===1&&got[0].prompt==='Q?'&&got[0].correctIndex===1;})());
  return checks;
}

/* ---------- Slice 2 (advanced): classroom session records ---------- */
function lcNoteParticipant(key,name){
  try{
    if(!lc.participants)lc.participants=new Map();
    const now=new Date().toISOString();
    const ex=lc.participants.get(key);
    if(ex){ex.name=name||ex.name;if(ex.leftAt)ex.leftAt=null;}
    else lc.participants.set(key,{name:name||'Guest',joinedAt:now,leftAt:null});
  }catch(e){}
}
function lcNoteParticipantLeft(key){
  try{const ex=lc.participants&&lc.participants.get(key);if(ex&&!ex.leftAt)ex.leftAt=new Date().toISOString();}catch(e){}
}
function lcBuildSummary(){
  const parts=new Map();
  const add=(key,name)=>{if(!parts.has(key))parts.set(key,{userId:key==='me'?(currentUser&&currentUser.id)||null:((lc.userIdByName&&lc.userIdByName.get(name))||null),name:name||'Guest',joinedAt:lc.startedAt||null,leftAt:null,raisedHand:0,chatCount:0,qaCount:0,pollVotes:0});return parts.get(key);};
  (lc.participants||new Map()).forEach((p,key)=>{const e=add(key,p.name);e.joinedAt=p.joinedAt||e.joinedAt;e.leftAt=p.leftAt||null;});
  (lc.peers||new Map()).forEach((p,key)=>{add(key,p.name);});
  (lc.agoraRemotes||new Map()).forEach((u,key)=>{add('agora-'+String(key),'Guest '+String(key));});
  // Per-participant counts are keyed by display name (the client only knows names;
  // the server merges the summary with its join records to resolve user ids).
  const byName=new Map();
  parts.forEach(p=>{if(!byName.has(p.name))byName.set(p.name,[]);byName.get(p.name).push(p);});
  const spread=(map,field)=>{if(!map)return;map.forEach((n,name)=>{(byName.get(name)||[]).forEach(p=>{p[field]+=n;});});};
  spread(lc.chatCounts,'chatCount');
  spread(lc.handCounts,'raisedHand');
  spread(lc.pollVoteCounts,'pollVotes');
  (lc.qas||[]).forEach(q=>{(byName.get(q.name||'Guest')||[]).forEach(p=>{p.qaCount++;});});
  const participants=[...parts.values()];
  const polls=[...((lc.polls||new Map()).values())].map(p=>({question:p.question,options:p.options,votes:p.options.map((_,i)=>[...p.votes.values()].filter(v=>v===i).length)}));
  let chatCount=0;if(lc.chatCounts)lc.chatCounts.forEach(n=>{chatCount+=n;});
  return {startedAt:lc.startedAt||null,participants,chatCount,qaCount:(lc.qas||[]).length,polls};
}
function lcPostSessionSummary(){
  if(!lc.isTeacher||!lc.sessionId||lc.summaryPosted)return;
  lc.summaryPosted=true;
  let summary=null;
  try{summary=lcBuildSummary();}catch(e){return;}
  const url=API_BASE+'/live-sessions/'+encodeURIComponent(lc.sessionId)+'/end-classroom';
  const body=JSON.stringify({summary});
  try{
    if(typeof navigator!=='undefined'&&navigator.sendBeacon){
      if(navigator.sendBeacon(url,new Blob([body],{type:'application/json'})))return;
    }
  }catch(e){}
  try{fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body,keepalive:true}).catch(()=>{});}catch(e){}
}

/* ---------- Past sessions ---------- */
const srState={records:[]};
function srFmtDate(iso){try{return new Date(iso).toLocaleString();}catch(e){return String(iso||'');}}
function srFmtTime(iso){try{return new Date(iso).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});}catch(e){return '—';}}
function srDuration(r){
  if(Number(r.durationMin)>0)return r.durationMin+' min';
  if(r.startedAt&&r.endedAt){const m=Math.max(0,Math.round((new Date(r.endedAt)-new Date(r.startedAt))/60000));return m+' min';}
  return '—';
}
async function loadPastSessions(){
  const root=document.querySelector('#srBody');if(!root)return;
  const isTeacher=currentUser&&currentUser.role==='teacher';
  try{
    const d=await apiRequest(isTeacher?'/teacher/session-records':'/session-records');
    const recs=d.records||d.sessionRecords||d.items||[];
    srState.records=recs;
    if(!recs.length){root.innerHTML='<p class="panel-copy">No saved classroom sessions yet. When a teacher ends a live class, its record appears here.</p>';return;}
    root.innerHTML=`<div class="lms-live-list">${recs.map(r=>`<article class="lms-live-card"><div><p class="eyebrow">${safeText(srFmtDate(r.startedAt||r.endedAt||r.createdAt))}</p><h4>${safeText(r.title||'Live class')}</h4><p class="panel-copy">${safeText(r.courseTitle||r.courseId||'')}</p><small>${srDuration(r)} · ${(r.participants||[]).length} participant${(r.participants||[]).length===1?'':'s'} · ${Number(r.chatCount||0)} chat · ${Number(r.qaCount||0)} Q&amp;A</small></div><button class="primary-btn" data-sr-view="${safeText(r.id)}">View record →</button></article>`).join('')}</div>`;
    root.querySelectorAll('[data-sr-view]').forEach(b=>{b.onclick=()=>loadPastSessionDetail(b.dataset.srView);});
  }catch(err){root.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p>`;}
}
async function loadPastSessionDetail(id){
  const root=document.querySelector('#srBody');if(!root)return;
  try{
    const d=await apiRequest('/session-records/'+encodeURIComponent(id));
    const r=d.record||d.sessionRecord||d;
    const parts=r.participants||[];
    const polls=r.polls||[];
    root.innerHTML=`<button class="filter-select" id="srBack">← Back to past sessions</button>
    <div class="screen-title"><p class="eyebrow">CLASS RECORD</p><h1>${safeText(r.title||'Live class')}</h1><p>${safeText(srFmtDate(r.startedAt||r.endedAt))} · ${srDuration(r)} · ${parts.length} participant${parts.length===1?'':'s'} · ${Number(r.chatCount||0)} chat messages · ${Number(r.qaCount||0)} questions</p></div>
    <section class="screen-panel"><h3>Participation</h3>${staffTable(['Participant','Joined','Left','Hand raises','Chat','Q&A','Poll votes'],parts.map(p=>`<tr><td>${safeText(p.name||'Guest')}</td><td>${p.joinedAt?srFmtTime(p.joinedAt):'—'}</td><td>${p.leftAt?srFmtTime(p.leftAt):'—'}</td><td>${Number(p.raisedHand||0)}</td><td>${Number(p.chatCount||0)}</td><td>${Number(p.qaCount||0)}</td><td>${Number(p.pollVotes||0)}</td></tr>`),'No participants recorded.')}</section>
    <section class="screen-panel"><h3>Poll results</h3>${polls.length?polls.map(p=>{const total=(p.votes||[]).reduce((a,b)=>a+Number(b||0),0);return `<div class="lc-poll"><div class="lc-poll-head"><b>${safeText(p.question||'Poll')}</b><span class="pill">ENDED</span></div>${(p.options||[]).map((o,i)=>{const c=Number((p.votes||[])[i]||0),pct=total?Math.round(c/total*100):0;return `<div class="lc-poll-bar"><span>${safeText(o)}</span><div class="lc-poll-track"><i style="width:${pct}%"></i></div><b>${c} (${pct}%)</b></div>`;}).join('')}<div class="lc-poll-foot"><small>${total} vote${total===1?'':'s'}</small></div></div>`;}).join(''):'<p class="panel-copy">No polls were run in this session.</p>'}</section>
    <p class="api-notice">${safeText(r.recordingNote||'Browser recording (.webm) is saved locally by the teacher — not uploaded.')}</p>`;
    document.querySelector('#srBack').onclick=()=>loadPastSessions();
  }catch(err){root.innerHTML=`<p class="panel-copy">${safeText(err.message)}</p><button class="filter-select" id="srBack">← Back to past sessions</button>`;document.querySelector('#srBack').onclick=()=>loadPastSessions();}
}
Object.assign(screenNames,{'past-sessions':'Past sessions'});
Object.assign(screenRole,{'past-sessions':['student','teacher']});
Object.assign(screens,{'past-sessions':`<div class="screen-title"><p class="eyebrow">CLASS RECORDS</p><h1>Past sessions</h1><p>Saved classroom sessions and who took part.</p></div><div id="srBody"><p class="panel-copy">Loading past sessions…</p></div>`});
portalScreens.student[1][1].push(['past-sessions','◷','Past sessions']);
portalScreens.teacher[0][1].push(['past-sessions','◷','Past sessions']);
const prevNavigateSr=navigate;
navigate=function(name){prevNavigateSr(name);if(name==='past-sessions')loadPastSessions();};

/* Session records self-checks (run in console as __srSelfCheck()) */
function __srSelfCheck(){
  const checks=[];const has=(n,c)=>checks.push([n,!!c]);
  has('screenNames past-sessions',screenNames['past-sessions']==='Past sessions');
  has('screenRole past-sessions',Array.isArray(screenRole['past-sessions'])&&screenRole['past-sessions'].includes('student')&&screenRole['past-sessions'].includes('teacher'));
  has('screens past-sessions',typeof screens['past-sessions']==='string');
  has('student nav has past-sessions',portalScreens.student[1][1].some(x=>x[0]==='past-sessions'));
  has('teacher nav has past-sessions',portalScreens.teacher[0][1].some(x=>x[0]==='past-sessions'));
  has('loadPastSessions fn',typeof loadPastSessions==='function');
  has('loadPastSessionDetail fn',typeof loadPastSessionDetail==='function');
  has('lcBuildSummary fn',typeof lcBuildSummary==='function');
  has('lcPostSessionSummary fn',typeof lcPostSessionSummary==='function');
  has('lcRefreshUserIds fn',typeof lcRefreshUserIds==='function');
  has('lcNoteParticipant fn',typeof lcNoteParticipant==='function');
  has('summary builds from tracked state',(()=>{
    lc.participants=new Map();lc.chatCounts=new Map();lc.handCounts=new Map();lc.pollVoteCounts=new Map();lc.polls=new Map();lc.qas=[];
    lc.startedAt='2026-11-10T10:00:00.000Z';lc.myName='Teacher T';
    lcNoteParticipant('me','Teacher T');
    lcNoteParticipant('c1','Student S');
    lcNoteParticipantLeft('c1');
    lc.chatCounts.set('Student S',3);lc.chatCounts.set('Teacher T',1);
    lc.handCounts.set('Student S',2);
    lc.qas.push({qaId:'q1',from:'c1',name:'Student S',text:'?',answer:null});
    lc.polls.set('p1',{question:'Q?',options:['A','B'],votes:new Map([['c1',0],['me',1]]),ended:true});
    const s=lcBuildSummary();
    const stu=s.participants.find(p=>p.name==='Student S');
    const ok=s.participants.length===2&&s.chatCount===4&&s.qaCount===1&&stu&&stu.chatCount===3&&stu.raisedHand===2&&stu.qaCount===1&&!!stu.leftAt&&s.polls[0].votes[0]===1&&s.polls[0].votes[1]===1;
    lcReset();
    return ok;
  })());
  return checks;
}

/* ---------- Study groups (advanced-features slice 3) ---------- */
Object.assign(screenNames,{'study-groups':'Study groups'});
Object.assign(screenRole,{'study-groups':['student','teacher']});
Object.assign(screens,{'study-groups':`<div class="screen-title"><p class="eyebrow">LEARN TOGETHER</p><h1>Study groups</h1><p>Your own collaboration space — shared notes and group chat that live beyond a single live class. Notes are shared — last edit wins. Chat refreshes when you open the group.</p></div><section class="screen-panel"><h3>Create a study group</h3><form id="sgCreateForm" class="teacher-form"><div class="lms-form-row"><label>Group name<input name="name" maxlength="120" required placeholder="e.g. Algebra revision crew"></label><span id="sgCourseWrap" hidden><label>Course (teachers only)<select name="courseId" id="sgCourse" aria-label="Course"><option value="">No specific course</option></select></label></span></div><label>Description<textarea name="description" rows="2" maxlength="500" placeholder="What will this group work on?"></textarea></label><button class="primary-btn" type="submit">Create group →</button> <span id="sgCreateStatus" class="panel-copy" role="status"></span></form></section><section class="screen-panel"><h3>Join with an invite code</h3><form id="sgJoinForm" class="teacher-form"><div class="lms-form-row"><label>Invite code<input name="inviteCode" maxlength="32" required placeholder="Paste the code a group member shared"></label></div><button class="primary-btn" type="submit">Join group →</button> <span id="sgJoinStatus" class="panel-copy" role="status"></span></form></section><div id="sgBody"><p class="panel-copy">Loading your groups…</p></div>`});
portalScreens.student[1][1].push(['study-groups','◍','Study groups']);
portalScreens.teacher[0][1].push(['study-groups','◍','Study groups']);
const prevNavigateSg=navigate;
navigate=function(name){prevNavigateSg(name);if(name==='study-groups')loadStudyGroups();};
const sgState={groups:[],current:null,notes:[],messages:[],courses:[],editingNote:null,loading:false};
function sgFmt(iso){try{return new Date(iso).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});}catch(e){return String(iso||'');}}
function sgGroupCardHtml(g){
  const members=Array.isArray(g.members)?g.members:[];
  const course=g.courseTitle||g.courseName||'';
  return `<article class="lms-live-card"><div><p class="eyebrow">${members.length} member${members.length===1?'':'s'}${g.createdAt?' · '+sgFmt(g.createdAt):''}</p><h4>${safeText(g.name||'Study group')}</h4><p class="panel-copy">${safeText(g.description||'')}</p>${course?`<small>${safeText(course)}</small>`:''}</div><button class="primary-btn" data-sg-open="${safeText(g.id)}">Open →</button></article>`;
}
function sgNoteHtml(n){
  const body=sgState.editingNote===n.id
    ?`<label>Title<input class="sg-note-title" data-sg-note-title="${safeText(n.id)}" value="${safeText(n.title||'')}" maxlength="120"></label><label>Content<textarea class="sg-note-body" data-sg-note-body="${safeText(n.id)}" rows="5" maxlength="20000">${safeText(n.content||'')}</textarea></label><div><button class="primary-btn" type="button" data-sg-note-save="${safeText(n.id)}">Save note</button> <button class="filter-select" type="button" data-sg-note-cancel>Cancel</button></div>`
    :`<p class="sg-note-body-text">${safeText(n.content||'').replace(/\n/g,'<br>')}</p><div class="sg-note-actions"><button class="filter-select" type="button" data-sg-note-edit="${safeText(n.id)}">Edit</button><button class="filter-select" type="button" data-sg-note-del="${safeText(n.id)}">Delete</button></div>`;
  return `<article class="sg-note" data-sg-note="${safeText(n.id)}"><div class="sg-note-head"><b>${safeText(n.title||'Untitled note')}</b><small>${n.updatedAt?'Updated '+sgFmt(n.updatedAt):''}${n.authorName?' · '+safeText(n.authorName):''}</small></div>${body}</article>`;
}
function sgMsgHtml(m){
  return `<div class="sg-msg"><b>${safeText(m.authorName||m.author||'Member')}</b><span>${safeText(m.text||'')}</span><small>${m.createdAt?sgFmt(m.createdAt):''}</small></div>`;
}
async function sgLoadCourses(){
  const wrap=document.querySelector('#sgCourseWrap'),sel=document.querySelector('#sgCourse');
  if(!wrap||!sel)return;
  const isTeacher=currentUser&&currentUser.role==='teacher';
  wrap.hidden=!isTeacher;
  if(!isTeacher)return;
  try{
    const d=await apiRequest('/teacher/courses').catch(()=>null);
    const list=(d&&(d.courses||d))||[];
    sgState.courses=Array.isArray(list)?list:[];
    if(!sgState.courses.length){const c=await apiRequest('/courses').catch(()=>({}));sgState.courses=c.courses||[];}
    sel.innerHTML='<option value="">No specific course</option>'+sgState.courses.map(c=>`<option value="${safeText(c.id)}">${safeText(c.title||'Course')}</option>`).join('');
  }catch{sel.innerHTML='<option value="">No specific course</option>';}
}
async function loadStudyGroups(){
  const root=document.querySelector('#sgBody');if(!root)return;
  sgState.current=null;sgState.editingNote=null;
  sgLoadCourses();
  const createForm=document.querySelector('#sgCreateForm');
  if(createForm&&!createForm.dataset.sgWired){createForm.dataset.sgWired='1';createForm.addEventListener('submit',sgCreateGroup);}
  const joinForm=document.querySelector('#sgJoinForm');
  if(joinForm&&!joinForm.dataset.sgWired){joinForm.dataset.sgWired='1';joinForm.addEventListener('submit',sgJoinGroup);}
  root.innerHTML='<p class="panel-copy">Loading your groups…</p>';
  try{
    const d=await apiRequest('/study-groups');
    const list=d.groups||d.studyGroups||d.items||[];
    sgState.groups=Array.isArray(list)?list:[];
    if(!sgState.groups.length){root.innerHTML='<p class="panel-copy">You are not in any study group yet. Create one above, or join with an invite code.</p>';return;}
    root.innerHTML=`<div class="lms-live-list">${sgState.groups.map(sgGroupCardHtml).join('')}</div>`;
    root.querySelectorAll('[data-sg-open]').forEach(b=>{b.onclick=()=>loadStudyGroupDetail(b.dataset.sgOpen);});
  }catch(err){root.innerHTML=`<p class="panel-copy">${safeText(err.message||'Could not load your study groups.')}</p>`;}
}
async function sgCreateGroup(e){
  e.preventDefault();
  const form=e.target,st=document.querySelector('#sgCreateStatus');
  const name=form.elements.name.value.trim();
  if(name.length<3){if(st)st.textContent='Give the group a name (at least 3 characters).';return;}
  const isTeacher=currentUser&&currentUser.role==='teacher';
  const courseEl=document.querySelector('#sgCourse');
  if(st)st.textContent='Creating…';
  try{
    const d=await apiRequest('/study-groups',{method:'POST',body:JSON.stringify({name,description:form.elements.description.value.trim(),courseId:isTeacher&&courseEl&&courseEl.value?courseEl.value:undefined})});
    const g=d.group||d.studyGroup||d;
    form.reset();
    if(st)st.innerHTML=g&&g.inviteCode?`✓ Group created. Invite code: <b>${safeText(g.inviteCode)}</b> <button class="filter-select" type="button" id="sgCopyNewCode">Copy code</button>`:'✓ Group created.';
    const copyBtn=document.querySelector('#sgCopyNewCode');
    if(copyBtn&&g&&g.inviteCode)copyBtn.onclick=async()=>{try{await navigator.clipboard.writeText(g.inviteCode);copyBtn.textContent='Copied!';}catch{copyBtn.textContent='Copy this code: '+g.inviteCode;}};
    loadStudyGroups();
  }catch(err){if(st)st.textContent=err.message||'Could not create the group. Try again.';}
}
async function sgJoinGroup(e){
  e.preventDefault();
  const form=e.target,st=document.querySelector('#sgJoinStatus');
  const code=form.elements.inviteCode.value.trim();
  if(!code){if(st)st.textContent='Paste an invite code first.';return;}
  if(st)st.textContent='Joining…';
  try{
    const d=await apiRequest('/study-groups/join-by-code',{method:'POST',body:JSON.stringify({inviteCode:code})});
    const g=d.group||d.studyGroup||d;
    form.reset();
    if(st)st.textContent='✓ Joined “'+(g&&g.name?g.name:'the group')+'”.';
    loadStudyGroups();
  }catch(err){if(st)st.textContent=err.message||'No group found for that code — check it, or ask a group member to share it again.';}
}
async function loadStudyGroupDetail(id){
  const root=document.querySelector('#sgBody');if(!root)return;
  sgState.editingNote=null;
  root.innerHTML='<p class="panel-copy">Loading group…</p>';
  try{
    const [groupRes,notesRes,msgsRes]=await Promise.all([
      apiRequest('/study-groups/'+encodeURIComponent(id)),
      apiRequest('/study-groups/'+encodeURIComponent(id)+'/notes'),
      apiRequest('/study-groups/'+encodeURIComponent(id)+'/messages')
    ]);
    const g=groupRes.group||groupRes.studyGroup||groupRes;
    sgState.current=g&&g.id?g:(sgState.groups.find(x=>x.id===id)||{id});
    sgState.notes=notesRes.notes||notesRes.groupNotes||notesRes.items||[];
    sgState.messages=msgsRes.messages||msgsRes.groupMessages||msgsRes.items||[];
    sgRenderDetail();
  }catch(err){root.innerHTML=`<p class="panel-copy">${safeText(err.message||'Could not open this group.')}</p><button class="filter-select" id="sgBack">← Back to my groups</button>`;document.querySelector('#sgBack').onclick=()=>loadStudyGroups();}
}
function sgRenderDetail(){
  const root=document.querySelector('#sgBody');if(!root||!sgState.current)return;
  const g=sgState.current;
  const members=Array.isArray(g.members)?g.members:[];
  const isOwner=currentUser&&g.ownerId===currentUser.id;
  const isAdmin=currentUser&&(currentUser.role==='admin'||currentUser.role==='super_admin'||currentUser.role==='institution_admin');
  root.innerHTML=`<button class="filter-select" id="sgBack">← Back to my groups</button>
  <div class="screen-title"><p class="eyebrow">STUDY GROUP · ${members.length} MEMBER${members.length===1?'':'S'}</p><h1>${safeText(g.name||'Study group')}</h1><p>${safeText(g.description||'')}</p><p class="panel-copy">${members.length?members.map(m=>safeText(m.name||'Member')).join(', '):''}</p></div>
  ${g.inviteCode?`<section class="screen-panel sg-invite"><h3>Invite code</h3><p class="panel-copy">Share this code so classmates can join: <b>${safeText(g.inviteCode)}</b></p><button class="filter-select" type="button" id="sgCopyCode">Copy code</button></section>`:''}
  <section class="screen-panel"><h3>Shared notes</h3><p class="panel-copy"><small>Anyone in the group can add or edit a note — last edit wins.</small></p><div id="sgNotes">${sgState.notes.length?sgState.notes.map(sgNoteHtml).join(''):'<p class="panel-copy">No shared notes yet — start one below.</p>'}</div><form id="sgNoteForm" class="teacher-form"><label>Note title<input name="title" maxlength="120" required placeholder="e.g. Chapter 4 summary"></label><label>Note<textarea name="content" rows="4" maxlength="20000" required placeholder="Write the shared note…"></textarea></label><button class="primary-btn" type="submit">Add note →</button> <span id="sgNoteStatus" class="panel-copy" role="status"></span></form></section>
  <section class="screen-panel"><h3>Group chat</h3><p class="panel-copy"><small>Chat refreshes when you open the group — hit Refresh to see new messages.</small></p><div id="sgChat">${sgState.messages.length?sgState.messages.map(sgMsgHtml).join(''):'<p class="panel-copy">No messages yet — say hello.</p>'}</div><form id="sgChatForm" class="teacher-form"><label>Message<input name="text" maxlength="500" required placeholder="Message the group…"></label><div><button class="primary-btn" type="submit">Send</button> <button class="filter-select" type="button" id="sgChatRefresh">Refresh</button> <span id="sgChatStatus" class="panel-copy" role="status"></span></div></form></section>
  <div class="sg-group-actions"><button class="filter-select" type="button" id="sgLeave">Leave group</button>${isOwner||isAdmin?'<button class="filter-select" type="button" id="sgDelete">Delete group</button>':''}</div>`;
  document.querySelector('#sgBack').onclick=()=>loadStudyGroups();
  const copyBtn=document.querySelector('#sgCopyCode');
  if(copyBtn)copyBtn.onclick=async()=>{try{await navigator.clipboard.writeText(g.inviteCode);copyBtn.textContent='Copied!';}catch{copyBtn.textContent='Copy this code: '+g.inviteCode;}};
  const noteForm=document.querySelector('#sgNoteForm');
  if(noteForm)noteForm.addEventListener('submit',sgAddNote);
  const chatForm=document.querySelector('#sgChatForm');
  if(chatForm)chatForm.addEventListener('submit',sgSendMessage);
  const refreshBtn=document.querySelector('#sgChatRefresh');
  if(refreshBtn)refreshBtn.onclick=()=>sgRefreshMessages();
  const notesBox=document.querySelector('#sgNotes');
  if(notesBox)notesBox.addEventListener('click',sgNoteClick);
  const leaveBtn=document.querySelector('#sgLeave');
  if(leaveBtn)leaveBtn.onclick=()=>sgLeaveGroup();
  const delBtn=document.querySelector('#sgDelete');
  if(delBtn)delBtn.onclick=()=>sgDeleteGroup();
}
async function sgAddNote(e){
  e.preventDefault();
  const form=e.target,st=document.querySelector('#sgNoteStatus');
  const title=form.elements.title.value.trim(),content=form.elements.content.value.trim();
  if(!title||!content){if(st)st.textContent='Give the note a title and some content.';return;}
  if(st)st.textContent='Adding…';
  try{
    const d=await apiRequest('/study-groups/'+encodeURIComponent(sgState.current.id)+'/notes',{method:'POST',body:JSON.stringify({title,content})});
    const n=d.note||d.groupNote||d;
    if(n&&n.id)sgState.notes.unshift(n);else{const r=await apiRequest('/study-groups/'+encodeURIComponent(sgState.current.id)+'/notes');sgState.notes=r.notes||r.groupNotes||r.items||sgState.notes;}
    form.reset();sgRenderDetail();
  }catch(err){if(st)st.textContent=err.message||'Could not add the note. Try again.';}
}
async function sgNoteClick(e){
  const editBtn=e.target.closest('[data-sg-note-edit]');
  const delBtn=e.target.closest('[data-sg-note-del]');
  const saveBtn=e.target.closest('[data-sg-note-save]');
  const cancelBtn=e.target.closest('[data-sg-note-cancel]');
  if(editBtn){sgState.editingNote=editBtn.dataset.sgNoteEdit;sgRenderDetail();return;}
  if(cancelBtn){sgState.editingNote=null;sgRenderDetail();return;}
  if(delBtn){
    const id=delBtn.dataset.sgNoteDel;
    if(!window.confirm('Delete this shared note for everyone in the group?'))return;
    try{await apiRequest('/study-groups/'+encodeURIComponent(sgState.current.id)+'/notes/'+encodeURIComponent(id),{method:'DELETE'});sgState.notes=sgState.notes.filter(n=>n.id!==id);sgRenderDetail();}
    catch(err){const st=document.querySelector('#sgNoteStatus');if(st)st.textContent=err.message||'Could not delete the note.';}
    return;
  }
  if(saveBtn){
    const id=saveBtn.dataset.sgNoteSave;
    const titleEl=document.querySelector(`[data-sg-note-title="${id}"]`);
    const bodyEl=document.querySelector(`[data-sg-note-body="${id}"]`);
    const title=titleEl?titleEl.value.trim():'',content=bodyEl?bodyEl.value.trim():'';
    if(!title||!content)return;
    try{
      const d=await apiRequest('/study-groups/'+encodeURIComponent(sgState.current.id)+'/notes/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({title,content})});
      const n=d.note||d.groupNote||d;
      const idx=sgState.notes.findIndex(x=>x.id===id);
      if(idx>=0)sgState.notes[idx]=n&&n.id?n:{...sgState.notes[idx],title,content,updatedAt:new Date().toISOString()};
      sgState.editingNote=null;sgRenderDetail();
    }catch(err){const st=document.querySelector('#sgNoteStatus');if(st)st.textContent=err.message||'Could not save the note.';}
  }
}
async function sgSendMessage(e){
  e.preventDefault();
  const form=e.target,st=document.querySelector('#sgChatStatus');
  const text=form.elements.text.value.trim();
  if(!text){if(st)st.textContent='Write a message first.';return;}
  if(st)st.textContent='Sending…';
  try{
    const d=await apiRequest('/study-groups/'+encodeURIComponent(sgState.current.id)+'/messages',{method:'POST',body:JSON.stringify({text:text.slice(0,500)})});
    const m=d.message||d.groupMessage||d;
    if(m&&m.id)sgState.messages.push(m);else await sgRefreshMessages();
    form.reset();sgRenderDetail();
  }catch(err){if(st)st.textContent=err.message||'Could not send the message. Try again.';}
}
async function sgRefreshMessages(){
  const st=document.querySelector('#sgChatStatus');
  try{
    const d=await apiRequest('/study-groups/'+encodeURIComponent(sgState.current.id)+'/messages');
    sgState.messages=d.messages||d.groupMessages||d.items||[];
    sgRenderDetail();
  }catch(err){if(st)st.textContent=err.message||'Could not refresh the chat.';}
}
async function sgLeaveGroup(){
  if(!window.confirm('Leave this study group? You will lose access to its shared notes and chat.'))return;
  try{
    await apiRequest('/study-groups/'+encodeURIComponent(sgState.current.id)+'/leave',{method:'POST',body:JSON.stringify({})});
    loadStudyGroups();
  }catch(err){const root=document.querySelector('#sgBody');if(root)root.insertAdjacentHTML('beforeend',`<p class="panel-copy">${safeText(err.message||'Could not leave the group.')}</p>`);}
}
async function sgDeleteGroup(){
  if(!window.confirm('Delete this study group for everyone? Its shared notes and chat will be removed.'))return;
  try{
    await apiRequest('/study-groups/'+encodeURIComponent(sgState.current.id),{method:'DELETE'});
    loadStudyGroups();
  }catch(err){const root=document.querySelector('#sgBody');if(root)root.insertAdjacentHTML('beforeend',`<p class="panel-copy">${safeText(err.message||'Could not delete the group.')}</p>`);}
}

/* Study groups self-checks (run in console as __sgSelfCheck()) */
function __sgSelfCheck(){
  const checks=[];const has=(n,c)=>checks.push([n,!!c]);
  has('screenNames study-groups',screenNames['study-groups']==='Study groups');
  has('screenRole study-groups',Array.isArray(screenRole['study-groups'])&&screenRole['study-groups'].includes('student')&&screenRole['study-groups'].includes('teacher'));
  has('screens study-groups',typeof screens['study-groups']==='string');
  has('student nav has study-groups',portalScreens.student[1][1].some(x=>x[0]==='study-groups'));
  has('teacher nav has study-groups',portalScreens.teacher[0][1].some(x=>x[0]==='study-groups'));
  has('loadStudyGroups fn',typeof loadStudyGroups==='function');
  has('loadStudyGroupDetail fn',typeof loadStudyGroupDetail==='function');
  has('sgCreateGroup fn',typeof sgCreateGroup==='function');
  has('sgJoinGroup fn',typeof sgJoinGroup==='function');
  has('sgAddNote fn',typeof sgAddNote==='function');
  has('sgSendMessage fn',typeof sgSendMessage==='function');
  has('sgRenderDetail fn',typeof sgRenderDetail==='function');
  has('note html escapes user content',(()=>{
    sgState.editingNote=null;
    const h=sgNoteHtml({id:'n1',title:'<script>alert(1)</script>',content:'a<b>b</b>\nline2',authorName:'Eve <img>',updatedAt:'2026-11-10T10:00:00.000Z'});
    return h.includes('&lt;script&gt;')&&!h.includes('<script>')&&h.includes('a&lt;b&gt;b&lt;/b&gt;')&&h.includes('<br>');
  })());
  has('message html escapes user content',(()=>{
    const h=sgMsgHtml({authorName:'Mallory',text:'<img src=x onerror=alert(1)>',createdAt:'2026-11-10T10:00:00.000Z'});
    return h.includes('&lt;img')&&!h.includes('<img src');
  })());
  has('group card shows members + course',(()=>{
    const h=sgGroupCardHtml({id:'g1',name:'Algebra crew',description:'Revise ch 4',members:[{name:'A'},{name:'B'}],courseTitle:'Algebra 101',createdAt:'2026-11-10T10:00:00.000Z'});
    return h.includes('2 members')&&h.includes('Algebra 101')&&h.includes('data-sg-open="g1"');
  })());
  return checks;
}

/* Classroom PDF reading and local annotation layer. PDF bytes never leave this browser. */
(()=>{
 let pdfUrl='',pdfFileName='',pdfPage=1,pdfAnnotations={},pdfDrawing=false,pdfLast=null;
 const $=s=>document.querySelector(s);
const setPdfPage=(n,announce=true)=>{const frame=$('#classPdfFrame'),input=$('#classPdfPage'),status=$('#classPdfStatus');pdfPage=Math.max(1,Math.floor(Number(n)||1));if(input)input.value=String(pdfPage);if(frame&&pdfUrl)frame.src=`${pdfUrl}#page=${pdfPage}&toolbar=0&navpanes=0`;if(status&&announce)status.textContent=`${pdfFileName||'PDF'} · page ${pdfPage}. Use Annotate to write or highlight on this page.`;const c=$('#classPdfInk'),ctx=c?.getContext('2d');if(ctx){const dpr=window.devicePixelRatio||1;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,c.width,c.height);const image=pdfAnnotations[pdfPage];if(image){const im=new Image();im.onload=()=>{ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(im,0,0,c.width,c.height);ctx.setTransform(dpr,0,0,dpr,0,0);};im.src=image;}else ctx.setTransform(dpr,0,0,dpr,0,0);}};
 const fit=()=>{const c=$('#classPdfInk'),w=$('#classPdfView');if(!c||!w)return;const r=w.getBoundingClientRect(),dpr=window.devicePixelRatio||1;c.width=Math.max(1,Math.round(r.width*dpr));c.height=Math.max(1,Math.round(r.height*dpr));const ctx=c.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);setPdfPage(pdfPage,false);};
 const init=()=>{const panel=$('#classPdfPanel');if(!panel||panel.dataset.pdfWired)return;panel.dataset.pdfWired='1';const view=$('#classPdfView'),canvas=$('#classPdfInk');$('#classPdfPick')?.addEventListener('click',()=>$('#classPdfFile')?.click());if(pdfUrl){view.hidden=false;$('#classPdfFrame').src=`${pdfUrl}#page=${pdfPage}&toolbar=0&navpanes=0`;for(const id of ['classPdfPage','classPdfPrev','classPdfNext','classPdfAnnotate','classPdfClear'])$('#'+id).disabled=false;requestAnimationFrame(fit);}
 $('#classPdfFile')?.addEventListener('change',e=>{const file=e.target.files?.[0];if(!file)return;if(file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf')){ $('#classPdfStatus').textContent='Choose a PDF file.';e.target.value='';return;}if(file.size>30*1024*1024){$('#classPdfStatus').textContent='PDF must be 30 MB or smaller.';e.target.value='';return;}if(pdfUrl)URL.revokeObjectURL(pdfUrl);pdfUrl=URL.createObjectURL(file);pdfFileName=file.name;pdfPage=1;pdfAnnotations={};view.hidden=false;$('#classPdfFrame').src=`${pdfUrl}#page=1&toolbar=0&navpanes=0`;const openLink=$('#classPdfOpen');if(openLink){openLink.href=pdfUrl;openLink.hidden=false;}for(const id of ['classPdfPage','classPdfPrev','classPdfNext','classPdfAnnotate','classPdfClear'])$('#'+id).disabled=false;$('#classPdfStatus').textContent=`${file.name} · loaded locally. If the preview is blank in this browser, select “Open PDF separately”.`;requestAnimationFrame(fit);});
 $('#classPdfPrev')?.addEventListener('click',()=>setPdfPage(Math.max(1,pdfPage-1)));
 $('#classPdfNext')?.addEventListener('click',()=>setPdfPage(pdfPage+1));
 $('#classPdfPage')?.addEventListener('change',e=>setPdfPage(e.target.value));
 $('#classPdfAnnotate')?.addEventListener('click',e=>{const on=e.currentTarget.getAttribute('aria-pressed')!=='true';e.currentTarget.setAttribute('aria-pressed',String(on));e.currentTarget.classList.toggle('selected',on);canvas?.classList.toggle('annotating',on);$('#classPdfStatus').textContent=on?'Annotation enabled · drag over the visible page to write or highlight.':'Annotation paused.';});
 $('#classPdfClear')?.addEventListener('click',()=>{if(!canvas)return;canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);delete pdfAnnotations[pdfPage];$('#classPdfStatus').textContent=`Annotations cleared from page ${pdfPage}.`;});
 if(canvas){const point=e=>{const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};canvas.addEventListener('pointerdown',e=>{if(!canvas.classList.contains('annotating'))return;e.preventDefault();canvas.setPointerCapture(e.pointerId);pdfDrawing=true;pdfLast=point(e);});canvas.addEventListener('pointermove',e=>{if(!pdfDrawing)return;const p=point(e),ctx=canvas.getContext('2d'),highlight=$('#classPdfInkMode')?.value==='highlight';ctx.strokeStyle=highlight?'#f6c94d':($('#classPdfInkColor')?.value||'#7257d9');ctx.globalAlpha=highlight?.34:1;ctx.lineWidth=(Number($('#classPdfInkSize')?.value)||5)*(highlight?3:1);ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(pdfLast.x,pdfLast.y);ctx.lineTo(p.x,p.y);ctx.stroke();ctx.globalAlpha=1;pdfLast=p;});const end=()=>{if(!pdfDrawing)return;pdfDrawing=false;try{pdfAnnotations[pdfPage]=canvas.toDataURL('image/png');}catch{};};canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);}
 window.addEventListener('resize',fit);
 };
 const root=$('#mainContent');if(root)new MutationObserver(init).observe(root,{childList:true,subtree:true});init();
})();
