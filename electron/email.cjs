const nodemailer = require('nodemailer');
const {ImapFlow} = require('imapflow');
const cheerio = require('cheerio');
const Bottleneck = require('bottleneck');
const {randomUUID} = require('crypto');
const defaults = require('../email-defaults.json');
const dns = require('dns').promises;
const countryRules = require('../country-rules.json');
const {stripQuoted, extractPlainText} = require('./reply-text.cjs');

/** Reguły e-mail dla rynku wiersza; starsze wiersze bez pola to Polska. */
const marketOf = l => (l && countryRules.markets[l.market] ? l.market : 'PL');
const emailRules = market => countryRules.markets[market].email;

/** Stopka wymagana przez reguły kraju: firma, adres pocztowy, rezygnacja. */
function buildFooter(market, sender) {
  return emailRules(market).footer
    .map(line => line.replaceAll('{company}', sender.company || '').replaceAll('{address}', sender.address || '').replaceAll('{from}', sender.from || ''))
    .join('\n');
}

/** Czy teraz jest okno wysyłki w strefie czasowej odbiorcy (godziny pracy, dni robocze). */
function inSendWindow(market, timeZone, date = new Date()) {
  const w = emailRules(market).sendWindow;
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {timeZone: timeZone || 'Europe/Warsaw', hour: 'numeric', hourCycle: 'h23', weekday: 'short'}).formatToParts(date);
  } catch {
    return false;
  }
  const hour = Number(parts.find(p => p.type === 'hour')?.value);
  const day = parts.find(p => p.type === 'weekday')?.value;
  if (w.weekdaysOnly && (day === 'Sat' || day === 'Sun')) return false;
  return hour >= w.startHour && hour < w.endHour;
}

/** Odmowa albo nieufność w odpowiedzi — adres trafia na stałą listę blokad. */
function isRefusal(market, text) {
  const body = stripQuoted(text).toLowerCase();
  if (!body) return false;
  if (/(^|[^a-ząćęłńóśźż])(stop|unsubscribe|wypisz|nie kontaktuj|nie życzę|nie jestem zainteresowan|proszę nie pisać)(?=$|[^a-ząćęłńóśźż])/i.test(body)) return true;
  const extra = countryRules.markets[market].refusalKeywords || [];
  return extra.some(k => body.includes(k));
}

/** Stan DNS domeny nadawcy: bez SPF i DMARC zimne e-maile trafiają do spamu. */
async function checkSenderDomain(domain, selector, resolver = dns) {
  const host = String(domain || '').trim().toLowerCase().replace(/^.*@/, '');
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host)) throw new Error('Wpisz poprawną domenę, np. twojadomena.com.');
  const txt = async name => { try { return (await resolver.resolveTxt(name)).map(r => r.join('')); } catch { return []; } };
  const mx = await resolver.resolveMx(host).catch(() => []);
  const spf = (await txt(host)).find(r => /^v=spf1\b/i.test(r)) || null;
  const dmarc = (await txt(`_dmarc.${host}`)).find(r => /^v=DMARC1\b/i.test(r)) || null;
  const sel = String(selector || '').trim();
  const dkim = sel ? ((await txt(`${sel}._domainkey.${host}`)).find(r => /p=/.test(r)) ? true : false) : null;
  return {domain: host, mx: mx.length > 0, spf, dmarc, dkim, ready: mx.length > 0 && !!spf && !!dmarc && dkim !== false};
}
const FREE = new Set(['gmail.com','wp.pl','onet.pl','interia.pl','o2.pl','outlook.com','hotmail.com','yahoo.com']);
function normalizeEmail(value) {
  const s=String(value||'').trim().toLowerCase();
  return s.length<=254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(s)?s:null;
}
function domainType(email){return FREE.has(String(email).split('@')[1])?'FREE_MAILBOX':'CUSTOM_DOMAIN';}
function extractEmails(html) {
 const $=cheerio.load(html); const values=[];
 $('a[href^="mailto:"]').each((_,el)=>values.push(decodeURIComponent(($(el).attr('href')||'').slice(7).split('?')[0])));
 $('script[type="application/ld+json"]').each((_,el)=>values.push($(el).text()));
 $('script,style,noscript').remove();values.push($('body').text());
 return [...new Set(values.flatMap(v=>String(v).match(/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)||[]).map(normalizeEmail).filter(Boolean))].filter(e=>!/@(?:example\.|sentry\.)/.test(e));
}
function spin(template,vars={}) {
 let s=String(template).replace(/\{(\w+)\}/g,(_,k)=>String(vars[k]||'')); const chosen=[];
 for(let i=0;i<100&&/\{[^{}]*\|[^{}]*\}/.test(s);i++) s=s.replace(/\{([^{}]*\|[^{}]*)\}/g,(_,inner)=>{const a=inner.split('|'),v=a[Math.floor(Math.random()*a.length)];chosen.push(v);return v;});
 return {text:s,signature:chosen.map(v=>`[${v}]`).join(' + ')};
}
function dedupeEmail(rows,existing,blocked=[]) {
 const seen=new Set([...existing.map(r=>normalizeEmail(r.email)),...blocked.map(normalizeEmail)]);
 return rows.filter(r=>{const e=normalizeEmail(r.email);if(!e||seen.has(e))return false;seen.add(e);r.email=e;return true;});
}
const templateType=l=>l.email_source_portal==='CEIDG_EMAIL'?'CEIDG_START':['EXPIRED_OR_ERROR','NO_SSL'].includes(l.website_issue_type)?l.website_issue_type:'NO_WEBSITE';
function createEmailEngine(d) {
 // Zegar i połączenia są wstrzykiwane, żeby symulacja (electron/simulation.cjs) mogła podstawić wirtualny czas i wirtualną pocztę.
 const clock=()=>d.now?new Date(d.now()):new Date();
 const mkTransport=d.createTransport||(o=>nodemailer.createTransport(o));
 const mkImap=d.createImap||(o=>new ImapFlow(o));
 const file=d.file('email-leads.json'),configFile=d.file('email-settings.json');
 const list=()=>d.read(file,[]).filter(r=>r.channel_type==='EMAIL');
 const write=rows=>{d.write(file,rows);d.changed();};
 const db=()=>{const c=d.db();if(!c)throw new Error('Lista blokad e-mail jest niedostępna.');c.exec('CREATE TABLE IF NOT EXISTS email_blacklist (email TEXT PRIMARY KEY, added_at INTEGER NOT NULL)');return c;};
 const blocked=()=>db().prepare('SELECT email FROM email_blacklist').all().map(r=>r.email);
 const insert=rows=>{const fresh=dedupeEmail(rows,list(),blocked());write([...list(),...fresh.map(r=>({...r,id:r.id||randomUUID(),channel_type:'EMAIL',telefon:null,status:'nowy',created_at:clock().toISOString(),email_sent_at:null,email_domain_type:domainType(r.email),market:marketOf(r)}))]);return {added:fresh.length,skipped:rows.length-fresh.length};};
 const update=(id,patch)=>{const allowed=['status','notatki','deal_value','engaged_at','closed_at'];write(list().map(r=>r.id===id?{...r,...Object.fromEntries(allowed.filter(k=>k in patch).map(k=>[k,patch[k]]))}:r));};
 const settings=()=>{const s=d.read(configFile,{});const {encryptedPassword,encryptedImapPassword,...publicFields}=s;return {...publicFields,passwordConfigured:!!encryptedPassword,imapPasswordConfigured:!!encryptedImapPassword};};
 const configure=value=>{
  const s=d.read(configFile,{}),fields=['host','port','user','from','senderName','company','address','imapHost','imapPort','imapUser','dailyLimit','dkimSelector'];
  for(const k of fields)if(value[k]!==undefined)s[k]=String(value[k]).trim();
  for(const [k,v] of [['password','encryptedPassword'],['imapPassword','encryptedImapPassword']])if(value[k])s[v]=d.encrypt(value[k]);
  if(s.from&&!normalizeEmail(s.from))throw new Error('Niepoprawny adres nadawcy.');
  d.write(configFile,s);return settings();
 };
 const transport=()=>{
  const s=d.read(configFile,{}),port=Number(s.port||465);
  if(!s.host||!s.user||!s.encryptedPassword||!normalizeEmail(s.from)||!s.company||!s.address)throw new Error('Uzupełnij SMTP, nadawcę i dane firmy w ustawieniach.');
  if(![465,587].includes(port))throw new Error('Użyj SMTP TLS: port 465 lub 587.');
  return {s,t:mkTransport({host:s.host,port,secure:port===465,requireTLS:port!==465,auth:{user:s.user,pass:d.decrypt(s.encryptedPassword)},connectionTimeout:15000,socketTimeout:30000,logger:false,debug:false})};
 };
 function build(l) {
  // Treść przygotowana w Snajperze (np. e-mail po angielsku) idzie bez zmian: podgląd = wysyłka.
  if(l.email_prepared_subject&&l.email_prepared_body)return {subject:String(l.email_prepared_subject).replace(/[\r\n]+/g,' '),body:String(l.email_prepared_body),signature:l.email_prepared_signature||'[PRZYGOTOWANA]'};
  const prefs=d.templates(),type=templateType(l),vars={...l,branza:l.kategoria};
  const subject=spin(prefs.subject||defaults.subject,vars),body=spin(prefs.bodies?.[type]||defaults.bodies[type],vars);
  return {subject:subject.text.replace(/[\r\n]+/g,' '),body:body.text,signature:`[TYP: ${type}] ${subject.signature} ${body.signature}`};
 }
 let queue={running:false,paused:false,cancel:false,total:0,done:0,sent:0,error:null};
 const notify=()=>d.changed();
 const wait=async ms=>{const end=clock().getTime()+ms;while(clock().getTime()<end&&!queue.cancel){while(queue.paused&&!queue.cancel)await d.sleep(500);await d.sleep(Math.min(500,Math.max(0,end-clock().getTime())));}};
 async function sendBulk(ids,consent=false,prepared={}) {
  if(!consent)throw new Error('Potwierdź uprawnienie i wymaganą zgodę na kontakt marketingowy lub oświadczenie o zgodności dla danego rynku. Sama stopka nie zapewnia zgodności.');
  if(queue.running)throw new Error('Kolejka e-mail już działa.');
  if(!Array.isArray(ids)||ids.length>200)throw new Error('Niepoprawna paczka e-mail.');
  const {s,t}=transport();db();
  queue={running:true,paused:false,cancel:false,total:ids.length,done:0,sent:0,error:null};notify();
  const limiter=new Bottleneck({maxConcurrent:1});const results=[];
  try {
   for(const id of ids){
    while(queue.paused&&!queue.cancel)await d.sleep(500);if(queue.cancel)break;
    const l=list().find(r=>r.id===id),email=normalizeEmail(l?.email);
    if(!l||!email||l.website_issue_type==='UNKNOWN'||l.email_sent_at||l.email_reserved_at||blocked().includes(email)){results.push({id,ok:false,skipped:true});queue.done++;notify();continue;}
    const ledger=d.read(d.file('email-ledger.json'),{});
    if(ledger[email]){results.push({id,ok:false,skipped:true});queue.done++;notify();continue;}
    // Reguły kraju: godziny pracy w strefie odbiorcy i dzienny limit (rozgrzewanie domeny).
    const market=marketOf(l),rule=emailRules(market);
    if(!inSendWindow(market,l.timezone,clock())){results.push({id,ok:false,skipped:true,reason:'outside-window'});queue.done++;notify();continue;}
    const today=clock().toDateString(),limit=Number(s.dailyLimit)>0?Number(s.dailyLimit):rule.dailyLimit;
    if(list().filter(r=>marketOf(r)===market&&r.email_sent_at&&new Date(r.email_sent_at).toDateString()===today).length>=limit){results.push({id,ok:false,skipped:true,reason:'daily-limit'});queue.done++;notify();continue;}
    const message=prepared[id]||build(l);const at=clock().toISOString();
    ledger[email]=at;d.write(d.file('email-ledger.json'),ledger);
    write(list().map(r=>r.id===id?{...r,email_reserved_at:at,email_subject_used:message.subject,email_exact_text:message.body,email_combination_signature:message.signature}:r));
    try {
     const result=await limiter.schedule(()=>t.sendMail({from:{name:s.senderName||s.company,address:s.from},to:email,subject:message.subject,text:`${message.body}\n\n--\n${buildFooter(market,s)}`,headers:{'List-Unsubscribe':`<mailto:${s.from}?subject=${encodeURIComponent(rule.unsubscribeSubject)}>`}}));
     if(!result.accepted?.some(a=>normalizeEmail(a)===email))throw new Error('Serwer SMTP nie zaakceptował odbiorcy.');
     write(list().map(r=>r.id===id?{...r,email_sent_at:clock().toISOString(),email_message_id:result.messageId,status:'wyslano_wiadomosc',email_error:null}:r));results.push({id,ok:true});queue.sent++;
    }catch(e){queue.error=String(e.message||e);write(list().map(r=>r.id===id?{...r,status:'blad_wysylki',email_error:queue.error}:r));results.push({id,ok:false,error:queue.error});}
    queue.done++;notify();if(queue.done<queue.total&&!queue.cancel)await wait(60000+Math.floor((d.random||Math.random)()*60001));
   }
  }finally{t.close();queue.running=false;notify();}
  return results;
 }
 async function test(to){const email=normalizeEmail(to);if(!email)throw new Error('Wpisz poprawny adres do testu.');const {s,t}=transport();try{await t.verify();return await t.sendMail({from:s.from,to:email,subject:'LeadFinder • test połączenia SMTP',text:'Test połączenia z Twoją skrzynką zakończony.'});}finally{t.close();}}
 async function syncReplies(){
  const s=d.read(configFile,{});if(!s.imapHost||!s.imapUser)throw new Error('Uzupełnij opcjonalny IMAP w ustawieniach.');
  const secret=s.encryptedImapPassword||s.encryptedPassword;if(!secret)throw new Error('Brak hasła IMAP.');
  const client=mkImap({host:s.imapHost,port:Number(s.imapPort||993),secure:true,auth:{user:s.imapUser,pass:d.decrypt(secret)},logger:false,connectionTimeout:15000});let updated=0,blockedCount=0;const replies=[];
  try{await client.connect();const lock=await client.getMailboxLock('INBOX');try{
   const sent=list().filter(r=>r.email_sent_at);const since=new Date(Math.min(...sent.map(r=>Date.parse(r.email_sent_at)),clock().getTime()));
   const uids=await client.search({since},{uid:true});
   if(!uids?.length)return {updated,blocked:blockedCount};
   for await(const msg of client.fetch(uids.slice(-200),{envelope:true,bodyParts:['TEXT']},{uid:true})){
    const from=normalizeEmail(msg.envelope?.from?.[0]?.address);const lead=sent.find(l=>l.email===from&&new Date(msg.envelope.date)>new Date(l.email_sent_at));if(!lead)continue;
    const raw=msg.bodyParts?.get('TEXT')?.toString('utf8')||'';
    // Część TEXT bywa wieloczęściowa albo zakodowana quoted-printable — wyciągamy czysty tekst.
    const text=extractPlainText(raw,!/^--\S/m.test(raw)&&/=\r?\n|=[0-9A-F]{2}/.test(raw)?'quoted-printable':'');
    const reply=stripQuoted(text).slice(0,600);
    replies.push({lead,from,text,at:new Date(msg.envelope.date).getTime(),uid:msg.uid});
    if(isRefusal(marketOf(lead),text)){db().prepare('INSERT OR IGNORE INTO email_blacklist VALUES (?,?)').run(from,clock().getTime());write(list().map(r=>r.id===lead.id?{...r,status:'zablokowany',email_reply_text:reply}:r));blockedCount++;}
    else if(!lead.engaged_at){write(list().map(r=>r.id===lead.id?{...r,status:'odpisal',engaged_at:new Date(msg.envelope.date).toISOString(),email_reply_text:reply}:r));updated++;}
   }
  }finally{lock.release();}}finally{await client.logout().catch(()=>{});}
  // Skrzynka odpowiedzi klasyfikuje każdą wiadomość i przygotowuje szkic; błąd skrzynki nie psuje synchronizacji.
  for(const r of replies){try{await d.onReply?.(r);}catch(e){queue.error=String(e.message||e);}}
  return {updated,blocked:blockedCount,replies:replies.length};
 }
 async function harvest(params,progress=()=>{}) {
  const niche=String(params.niche||'').trim(),area=String(params.area||'').trim(),limit=Math.min(100,Math.max(1,Number(params.limit)||30));if(!niche||!area)throw new Error('Wpisz niszę i obszar.');
  const rows=[],warnings=[],portals=params.portals||[];if(!portals.length)throw new Error('Wybierz przynajmniej jedno źródło.');
  const add=async(l)=>{const email=normalizeEmail(l.email);if(!email)return;const verdict=await d.website(l.strona,email);if(verdict==='HEALTHY')return;rows.push({...l,id:randomUUID(),email,channel_type:'EMAIL',telefon:null,miasto:l.miasto||area,kategoria:niche,email_domain_type:domainType(email),website_issue_type:verdict==='UNKNOWN'?'UNKNOWN':verdict||'NO_WEBSITE',status:'nowy'});};
  const allowed=h=>/(^|\.)(panoramafirm\.pl|pkt\.pl|biznesfinder\.pl|facebook\.com|olx\.pl)$/.test(h);
  const queries=[];
  if(portals.includes('directories'))for(const host of ['panoramafirm.pl','pkt.pl','biznesfinder.pl'])queries.push({q:`site:${host} "${niche}" "${area}" email`,portal:'PANORAMA_PKT',label:host});
  if(portals.includes('osint'))queries.push({q:`"${niche}" "${area}" ("@gmail.com" OR "@wp.pl" OR "@onet.pl" OR "@interia.pl" OR "@o2.pl" OR "kontakt@")`,portal:'FACEBOOK_OSINT',label:'OSINT & Social'});
  for(const query of queries){
   progress({phase:'search',name:query.label,found:rows.length});const html=await d.fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query.q)}`);const $=cheerio.load(html);
   if(!html||/anomaly|captcha/i.test(html)){warnings.push(`${query.label}: wyszukiwarka odmówiła dostępu.`);continue;}
   const hits=[];$('.result').each((_,el)=>{let href=$(el).find('.result__a').attr('href')||'';try{const u=new URL(href,'https://duckduckgo.com');href=u.searchParams.get('uddg')||u.href;}catch{return;}hits.push({href,title:$(el).find('.result__a').text(),snippet:$(el).find('.result__snippet').text()});});
   for(const h of hits.slice(0,8)){
    let host;try{host=new URL(h.href).hostname;}catch{continue;}if(!allowed(host))continue;
    progress({phase:'profile',name:h.title,found:rows.length});await d.sleep(1200);
    const page=await d.fetch(h.href);if(!page){warnings.push(`${host}: profil niedostępny.`);continue;}
    const $$=cheerio.load(page);let site=null;
    $$('a[href^="http"]').each((_,el)=>{const href=$$(el).attr('href');try{const u=new URL(href);if(!allowed(u.hostname)&&!/google|youtube|instagram|twitter|linkedin|tiktok/.test(u.hostname)&&/strona|www|website/i.test($$(el).text()))site=u.href;}catch{}});
    for(const email of extractEmails(page))await add({nazwa:h.title.split('|')[0].trim(),email,email_source_portal:query.portal,portal_label:host,strona:site});
    if(rows.length>=limit)break;
   }
  }
  if(portals.includes('ceidg')){
   progress({phase:'ceidg',name:'CEIDG E-mail',found:rows.length});const key=d.ceidgKey();
   if(!key)warnings.push('CEIDG: brak klucza w ustawieniach.');
   else{
    const pkd=params.pkd||(/stolar|mebl/i.test(niche)?'3102Z,3109Z,1623Z':/rachunk/i.test(niche)?'6920Z':/fotograf/i.test(niche)?'7420Z':/klima|ciepł/i.test(niche)?'4322Z':'');
    if(!pkd)warnings.push('CEIDG: wpisz kody PKD dla wybranej niszy.');
    else{const result=await d.ceidg(`${d.ceidgBase}/firmy?${new URLSearchParams({pkd,wojewodztwo:params.voivodeship||area,status:'AKTYWNY',dataod:new Date(clock().getTime()-30*86400000).toISOString().slice(0,10),limit:'50'})}`,key);
     if(!result.ok)warnings.push(result.error);
     else for(const f of (result.json.firmy||[]).slice(0,50)){
      let firm=f;if(!firm.email&&!firm.adresDzialalnosciElektronicznej&&firm.id){await d.sleep(400);const detail=await d.ceidg(`${d.ceidgBase}/firma/${encodeURIComponent(firm.id)}`,key);if(detail.ok)firm={...firm,...(detail.json.firma?.[0]||detail.json)};}
      await add({nazwa:firm.nazwa,email:firm.email||firm.adresDzialalnosciElektronicznej,miasto:firm.adresDzialalnosci?.miasto,strona:firm.www||null,email_source_portal:'CEIDG_EMAIL',portal_label:'CEIDG'});
      if(rows.length>=limit)break;
     }
    }
   }
  }
  const leads=dedupeEmail(rows,list(),blocked()).slice(0,limit);progress({phase:'done',name:'Gotowe',found:leads.length});return {leads,warnings};
 }
 /** Odpowiedź w wątku na wiadomość klienta (po zatwierdzeniu w skrzynce). Blokada jest sprawdzana tuż przed wysyłką. */
 async function reply(id,body){
  const l=list().find(r=>r.id===id),email=normalizeEmail(l?.email),text=String(body||'').trim();
  if(!l||!email)throw new Error('Nie ma takiego kontaktu e-mail.');
  if(!text)throw new Error('Pusta odpowiedź.');
  if(blocked().includes(email))throw new Error('Adres jest na liście blokad.');
  const {s,t}=transport(),market=marketOf(l);
  try{
   const subject=`Re: ${String(l.email_subject_used||l.email_prepared_subject||l.nazwa||'').replace(/^(re:\s*)+/i,'').replace(/[\r\n]+/g,' ')}`;
   const result=await t.sendMail({from:{name:s.senderName||s.company,address:s.from},to:email,subject,text:`${text}\n\n--\n${buildFooter(market,s)}`,headers:{'List-Unsubscribe':`<mailto:${s.from}?subject=${encodeURIComponent(emailRules(market).unsubscribeSubject)}>`},...(l.email_message_id?{inReplyTo:l.email_message_id,references:l.email_message_id}:{})});
   if(!result.accepted?.some(a=>normalizeEmail(a)===email))throw new Error('Serwer SMTP nie zaakceptował odbiorcy.');
   write(list().map(r=>r.id===id?{...r,email_last_reply_at:clock().toISOString()}:r));
   return {messageId:result.messageId};
  }finally{t.close();}
 }
 const checkDomain=(domain,selector)=>checkSenderDomain(domain||String(d.read(configFile,{}).from||''),selector||d.read(configFile,{}).dkimSelector,d.dns||dns);
 return {reply,checkDomain,list,insert,update,remove:id=>write(list().filter(r=>r.id!==id)),settings,configure,harvest,sendBulk,test,syncReplies,build,blocked,blacklist:email=>{const e=normalizeEmail(email);if(!e)throw new Error('Niepoprawny e-mail.');db().prepare('INSERT OR IGNORE INTO email_blacklist VALUES (?,?)').run(e,clock().getTime());write(list().map(l=>l.email===e?{...l,status:'zablokowany'}:l));},status:()=>({...queue}),control:command=>{if(command==='pause')queue.paused=true;else if(command==='resume')queue.paused=false;else if(command==='cancel')queue.cancel=true;notify();return {...queue};}};
}
module.exports={buildFooter,inSendWindow,stripQuoted,isRefusal,checkSenderDomain,createEmailEngine,normalizeEmail,domainType,extractEmails,spin,dedupeEmail,templateType};
