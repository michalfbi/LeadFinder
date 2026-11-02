// Local-only weekly orchestration; no inbound HTTP endpoint is required.
const { randomUUID } = require('crypto');
const { normalizeSpeed } = require('./sms-speed.cjs');
const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const key = p => String(p || '').replace(/\D/g, '').slice(-9);
function eligible(rows, existing, blocked, history, limit) {
  const seen = new Set([...existing.filter(r => r.sms_sent_at || r.sms_reserved_at).map(r => key(r.telefon)), ...blocked.map(key)]);
  return rows.filter(r => {
    const p = key(r.telefon);
    if (p.length !== 9 || seen.has(p) || history(r.telefon) !== false) return false;
    seen.add(p); return true;
  }).slice(0, limit);
}

// ---------- Zdalne Centrum Dowodzenia (Telegram) ----------
const REGIONS = ['Dolnośląskie','Kujawsko-Pomorskie','Lubelskie','Lubuskie','Łódzkie','Małopolskie','Mazowieckie','Opolskie','Podkarpackie','Podlaskie','Pomorskie','Śląskie','Świętokrzyskie','Warmińsko-Mazurskie','Wielkopolskie','Zachodniopomorskie'];
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]/g, '');
const REGION_BY_NORM = Object.fromEntries(REGIONS.map(r => [norm(r), r]));
const SOURCE_ALIASES = { olx: 'OLX', maps: 'GOOGLE_MAPS', mapy: 'GOOGLE_MAPS', google: 'GOOGLE_MAPS', gmaps: 'GOOGLE_MAPS', ceidg: 'CEIDG' };
// Mega-słownik 40 nisz — współdzielony z interfejsem (ten sam plik JSON).
const NICHE_CATEGORIES = require('../niches-catalog.json').categories;
const ALL_NICHES = NICHE_CATEGORIES.flatMap(c => c.niches.map(n => ({ ...n, category: c.id })));
const findNiche = id => ALL_NICHES.find(n => n.id === id);
const nicheValueFor = (niche, source) => source === 'CEIDG' ? niche.pkd : niche.searchQuery;
const SOURCE_LABELS = { GOOGLE_MAPS: '🗺️ Google Maps', CEIDG: '🏢 CEIDG', OLX: '🟣 OLX' };

// "/skan <zrodlo> <nisza…> <region>" — region to ostatni wyraz, nisza wszystko pomiędzy.
function parseSkanCommand(text) {
  const parts = String(text || '').trim().split(/\s+/);
  if (parts.length < 3 || parts[0].toLowerCase() !== '/skan') return null;
  const source = SOURCE_ALIASES[parts[1].toLowerCase()];
  const region = REGION_BY_NORM[norm(parts[parts.length - 1])];
  const query = parts.slice(2, -1).join(' ').trim();
  if (!source || !region || !query) return null;
  return { source, query, region };
}

function createAutopilot(d) {
  const file = d.file('autopilot.json');
  let state = d.read(file, { weeklySchedule: ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(day=>({day,enabled:false,scanTime:'07:00',source:'GOOGLE_MAPS',queryOrPkd:'',voivodeship:'Mazowieckie',dailyTargetLimit:50})), batches: [], runs: {}, remote: {}, remoteLog: [], telegramOffset: 0, commandCursor: null, replyCursor: null });
  let busy = false, polling = false;
  const save = () => { d.write(file, state); d.changed(); };
  const snapshot = () => ({ ...state, busy, remote: { chatId: state.remote.chatId || '', selfPhone: state.remote.selfPhone || '', tokenConfigured: !!state.remote.encryptedToken, pendingScan: state.remote.pendingScan ? { source: state.remote.pendingScan.source, query: state.remote.pendingScan.query, region: state.remote.pendingScan.region, count: state.remote.pendingScan.leads.length } : null }, telegramOffset: undefined });
  const token = () => state.remote.encryptedToken ? d.decrypt(state.remote.encryptedToken) : '';
  async function telegram(method, body) {
    const t = token();
    if (!t || !state.remote.chatId) throw new Error('Skonfiguruj Telegram na Macu.');
    const r = await fetch(`https://api.telegram.org/bot${t}/${method}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(`Telegram ${r.status}: ${data.description || 'Błąd połączenia'}`);
    return data.result;
  }
  // Komunikaty do właściciela nie mogą wywrócić pętli poleceń — błąd sieci ląduje w logu.
  async function notify(method, body) {
    try { return await telegram(method, body); } catch (e) { state.error = e.message; save(); return null; }
  }
  function logRemote(text) {
    state.remoteLog = [{ at: new Date().toISOString(), text }, ...(state.remoteLog || [])].slice(0, 30);
    save();
  }
  const ownChat = id => String(id) === String(state.remote.chatId || '');

  // ---------- Menu i status ----------
  function queueStatus() {
    const q = d.bulkStatus ? d.bulkStatus() : null;
    if (!q) return d.isSending() ? 'wysyłka trwa' : 'kolejka pusta';
    if (q.running) return q.paused ? `pauza (wysłano ${q.sent}/${q.total})` : `wysyłka ${q.sent}/${q.total}`;
    return 'kolejka pusta';
  }
  function statusText() {
    const pending = state.batches.filter(b => ['pending','scheduled'].includes(b.status)).reduce((n, b) => n + b.leads.length, 0);
    return `📊 Status Maca mini\nLeady w bazie: ${d.leads().length}\nKolejka SMS: ${queueStatus()}\nPoczekalnia: ${pending} oczekujących${state.remote.pendingScan ? `\nNierozpatrzony skan: ${state.remote.pendingScan.leads.length} leadów (${state.remote.pendingScan.query})` : ''}`;
  }
  function mainMenu() {
    return { text: `🤖 LeadFinder — Zdalne Centrum Dowodzenia\n${statusText()}\n\nWybierz akcję:`, reply_markup: { inline_keyboard: [
      [{ text: '🔍 Zdalne Skanowanie', callback_data: 'MENU_SCAN' }],
      [{ text: '🚀 Masowa Wysyłka SMS (Bulk Send)', callback_data: 'MENU_BULK' }],
      [{ text: '📊 Status Kolejki & Statystyki', callback_data: 'MENU_STATUS' }],
      [{ text: '⏸️/▶️ Pauza / Wznów Wysyłkę', callback_data: 'TOGGLE_BULK_PAUSE' }],
    ] } };
  }
  const chunk = (arr, n) => arr.reduce((rows, x, i) => (i % n ? rows[rows.length - 1].push(x) : rows.push([x]), rows), []);

  // ---------- Zdalne skanowanie ----------
  async function remoteScan(source, query, region) {
    if (busy) { await notify('sendMessage', { chat_id: state.remote.chatId, text: '⏳ Inne skanowanie lub wysyłka właśnie trwa — spróbuj za chwilę.' }); return; }
    state.remote.windowScanId = null; state.remote.speedApproval = null; save();
    logRemote(`Zlecono z telefonu: skan ${SOURCE_LABELS[source] || source} • ${query} • ${region}`);
    // Telefon jako pilot TV: pełny skan (30–50 wyników) wykonuje interfejs na ekranie Maca.
    if (d.remoteCommand?.({ action: 'scan', source, query, region })) {
      await notify('sendMessage', { chat_id: state.remote.chatId, text: `⏳ Skanowanie uruchomione na ekranie Maca: ${SOURCE_LABELS[source] || source} — ${query} (${region}). Pełny skan — dam znać, gdy się zakończy.` });
      return;
    }
    busy = true; save();
    await notify('sendMessage', { chat_id: state.remote.chatId, text: `⏳ Rozpoczynam zdalne skanowanie na Macu: ${SOURCE_LABELS[source] || source} — ${query} (${region})…` });
    let conn;
    try {
      conn = d.openHistory();
      if (!conn) throw new Error('Brak dostępu do historii Wiadomości — skan wstrzymany.');
      const rows = await d.scan({ source, queryOrPkd: query, voivodeship: region, dailyTargetLimit: 50 });
      const verified = [];
      for (const row of rows) {
        if (!d.validPhone(row.telefon)) continue;
        if (source !== 'OLX' && !row.strona && await d.hasWebsite(row)) continue;
        verified.push(row);
      }
      const leads = eligible(verified, d.leads(), d.blocked(), p => d.history(conn, p), 50)
        .map(l => ({ ...l, id: randomUUID() }));
      if (!leads.length) {
        await notify('sendMessage', { chat_id: state.remote.chatId, text: '🔎 Skanowanie zakończone, ale nie znaleziono nowych, czystych numerów komórkowych.' });
        logRemote(`Skan ${query} (${region}): 0 nowych leadów`);
        return;
      }
      state.remote.pendingScan = { source, query, region, createdAt: new Date().toISOString(), leads };
      save();
      const c = { NO_WEBSITE: 0, EXPIRED_OR_ERROR: 0, NO_SSL: 0, OLX_NO_WEBSITE: 0 };
      for (const l of leads) c[l.website_issue_type] = (c[l.website_issue_type] || 0) + 1;
      await notify('sendMessage', { chat_id: state.remote.chatId, text: `✅ Skanowanie zakończone! Znaleziono ${leads.length} czystych numerów komórkowych (Brak strony: ${c.NO_WEBSITE || 0}, Wygasła/Błąd: ${c.EXPIRED_OR_ERROR || 0}, Brak SSL: ${c.NO_SSL || 0}, OLX: ${c.OLX_NO_WEBSITE || 0}).`, reply_markup: { inline_keyboard: [
        [{ text: `🚀 Dodaj wszystkie (${leads.length}) i Wyślij Bulk SMS`, callback_data: 'REMOTE_ADD_AND_SEND' }],
        [{ text: `📥 Tylko zapisz wszystkie (${leads.length}) do bazy`, callback_data: 'REMOTE_ADD_ONLY' }],
        [{ text: '❌ Odrzuć wyniki', callback_data: 'REMOTE_DISCARD' }],
      ] } });
      logRemote(`Skan ${query} (${region}): znaleziono ${leads.length} leadów — czeka na decyzję`);
    } catch (e) {
      state.error = e.message; save();
      await notify('sendMessage', { chat_id: state.remote.chatId, text: `⚠️ Skanowanie przerwane: ${e.message}` });
      logRemote(`Skan ${query} (${region}) przerwany: ${e.message}`);
    } finally { d.closeHistory(conn); busy = false; save(); }
  }

  // ---------- Zdalny Bulk Send ----------
  async function remoteAdd(send, speed = normalizeSpeed()) {
    const pending = state.remote.pendingScan;
    if (!pending) { await notify('sendMessage', { chat_id: state.remote.chatId, text: 'Brak wyników skanowania oczekujących na decyzję. Użyj /skan lub MENU_SCAN.' }); return; }
    state.remote.pendingScan = null; save();
    const leads = pending.leads.map(l => ({ ...l, ...d.message(l) }));
    d.insert(leads);
    logRemote(`Zapisano ${leads.length} leadów ze zdalnego skanu (${pending.query})`);
    if (!send) { await notify('sendMessage', { chat_id: state.remote.chatId, text: `📥 Zapisano ${leads.length} leadów do bazy. Wysyłkę uruchomisz komendą /wyslij.` }); return; }
    if (d.isSending()) { await notify('sendMessage', { chat_id: state.remote.chatId, text: '⚠️ Inna kolejka SMS już działa — leady zapisano, wysyłkę uruchom po jej zakończeniu.' }); return; }
    await notify('sendMessage', { chat_id: state.remote.chatId, text: `🚀 Masowa wysyłka SMS uruchomiona! W kolejce: ${leads.length} wiadomości (tempo: ${speed.minDelayMs / 1000}–${speed.maxDelayMs / 1000}s). Powiadomię Cię po zakończeniu lub gdy ktoś odpisze!` });
    logRemote(`Uruchomiono z telefonu Bulk SMS: ${leads.length} wiadomości`);
    const blocker = d.block();
    try {
      const results = await d.send(leads.map(l => ({ id: l.id, phone: l.telefon, body: l.sms_exact_text, templateId: l.website_issue_type, signature: l.sms_combination_signature })), speed);
      const sent = results.filter(r => r.ok).length;
      await notify('sendMessage', { chat_id: state.remote.chatId, text: `🏁 Kolejka Bulk SMS zakończona! Wysłano pomyślnie: ${sent} wiadomości.` });
      logRemote(`Kolejka Bulk SMS zakończona: wysłano ${sent}/${leads.length}`);
    } catch (e) {
      state.error = e.message; save();
      await notify('sendMessage', { chat_id: state.remote.chatId, text: `⚠️ Kolejka przerwana: ${e.message}` });
    } finally { d.unblock(blocker); }
  }

  // Speed approval is bound to one scan/batch; stale buttons cannot send newer results.
  async function requestSpeed(chatId, batchId) {
    const target = batchId ? 'batch' : state.remote.pendingScan ? 'background' : state.remote.windowScanId ? 'window' : null;
    if (!target) { await notify('sendMessage', {chat_id: chatId, text: 'Brak wyników oczekujących na wysyłkę. Najpierw uruchom skan.'}); return; }
    const id = batchId || (target === 'window' ? state.remote.windowScanId : (state.remote.pendingScan.id ||= randomUUID()));
    state.remote.speedApproval = { id, target }; save();
    await notify('sendMessage', { chat_id: chatId, text: 'Wybierz tempo i zatwierdź wysyłkę tej paczki (szacunek dla 100 SMS):', reply_markup: {inline_keyboard: [
      [{text: '🚀 Wyślij TURBO (~4 min)', callback_data: `SPEED:turbo:${id}`}],
      [{text: '⚡ Wyślij SZYBKO (~12 min)', callback_data: `SPEED:fast:${id}`}],
    ]}});
  }

  // ---------- Drzewo komend ----------
  async function handleCommand(chatId, text) {
    if (!ownChat(chatId)) return; // komendy tylko od właściciela
    const t = String(text || '').trim();
    const cmd = t.split(/\s+/)[0].toLowerCase();
    if (cmd === '/start' || cmd === '/menu') {
      logRemote('Z telefonu: /menu — wysłano główne menu');
      const m = mainMenu();
      await notify('sendMessage', { chat_id: chatId, text: m.text, reply_markup: m.reply_markup });
    } else if (cmd === '/status') {
      logRemote('Z telefonu: /status');
      await notify('sendMessage', { chat_id: chatId, text: statusText() });
    } else if (cmd === '/pauza') {
      const q = d.bulkStatus ? d.bulkStatus() : null;
      if (q?.paused) { d.resumeBulk?.(); logRemote('Z telefonu: /pauza — wznowiono wysyłkę'); await notify('sendMessage', { chat_id: chatId, text: '▶️ Wysyłka wznowiona.' }); }
      else { d.pauseBulk?.(); logRemote('Z telefonu: /pauza — wstrzymano wysyłkę'); await notify('sendMessage', { chat_id: chatId, text: '⏸️ Wysyłka wstrzymana. Ponowne /pauza wznawia.' }); }
    } else if (cmd === '/wyslij') {
      await requestSpeed(chatId);
    } else if (cmd === '/skan') {
      const parsed = parseSkanCommand(t);
      if (!parsed) { await notify('sendMessage', { chat_id: chatId, text: 'Użycie: /skan <olx|maps|ceidg> <nisza> <województwo>\nNp. /skan olx fotograf slubny malopolskie' }); return; }
      remoteScan(parsed.source, parsed.query, parsed.region).catch(e => { state.error = e.message; save(); });
    } else {
      await notify('sendMessage', { chat_id: chatId, text: 'Nieznana komenda. Dostępne: /menu, /skan, /wyslij, /status, /pauza' });
    }
  }

  async function handleCallback(chatId, data) {
    if (!ownChat(chatId)) return;
    if (data.startsWith('SPEED:')) {
      const [, mode, id] = data.split(':');
      const approval = state.remote.speedApproval;
      if (!['turbo','fast'].includes(mode) || !approval || approval.id !== id) return;
      if (approval.target === 'background' && state.remote.pendingScan?.id !== id) return;
      if (approval.target === 'window' && state.remote.windowScanId !== id) return;
      const speed = normalizeSpeed({speedMode: mode});
      state.remote.speedApproval = null; save();
      if (approval.target === 'batch') { action(id, 'approve', speed).catch(e => {state.error=e.message;save();}); return; }
      if (approval.target === 'window') {
        state.remote.windowScanId = null; save();
        if (d.remoteCommand?.({ action: 'addAndSend', speed })) {
          await notify('sendMessage', {chat_id: chatId, text: 'Tempo wybrane — wyniki zapisuję na ekranie Maca. Zatwierdź wysyłkę przyciskiem Bulk SMS na Macu.'});
        }
        return;
      }
      remoteAdd(true, speed).catch(e => {state.error=e.message;save();});
    } else if (data === 'MENU_SCAN') {
      await notify('sendMessage', { chat_id: chatId, text: '🔍 Wybierz źródło skanowania:', reply_markup: { inline_keyboard: [
        [{ text: '🗺️ Google Maps', callback_data: 'SCAN_SRC:GOOGLE_MAPS' }],
        [{ text: '🏢 Nowe firmy CEIDG', callback_data: 'SCAN_SRC:CEIDG' }],
        [{ text: '🟣 Ogłoszenia OLX', callback_data: 'SCAN_SRC:OLX' }],
      ] } });
    } else if (data.startsWith('SCAN_SRC:')) {
      const source = data.slice(9);
      state.remote.scanDraft = { source }; save();
      await notify('sendMessage', { chat_id: chatId, text: `${SOURCE_LABELS[source]} — wybierz kategorię niszy:`, reply_markup: { inline_keyboard: chunk(NICHE_CATEGORIES.map(c => ({ text: `${c.icon} ${c.label}`, callback_data: `SCAN_CAT:${c.id}` })), 1) } });
    } else if (data.startsWith('SCAN_CAT:')) {
      const cat = NICHE_CATEGORIES.find(c => c.id === data.slice(9));
      if (!cat) { await notify('sendMessage', { chat_id: chatId, text: 'Nieznana kategoria — zacznij od /menu.' }); return; }
      const source = state.remote.scanDraft?.source;
      await notify('sendMessage', { chat_id: chatId, text: `${cat.icon} ${cat.label} — wybierz niszę:`, reply_markup: { inline_keyboard: chunk(cat.niches.map(n => ({ text: n.label, callback_data: `SCAN_NICHE:${n.id}` })), 1) } });
      if (!source) logRemote('Kreator: wybrano kategorię bez źródła — czekam na niszę');
    } else if (data.startsWith('SCAN_NICHE:')) {
      const niche = findNiche(data.slice(11));
      const source = state.remote.scanDraft?.source;
      if (!niche || !source) { await notify('sendMessage', { chat_id: chatId, text: 'Kreator stracił kontekst — zacznij od /menu.' }); return; }
      const query = nicheValueFor(niche, source);
      state.remote.scanDraft = { source, query, nicheLabel: niche.label }; save();
      await notify('sendMessage', { chat_id: chatId, text: `Nisza: ${niche.label}\nWybierz województwo:`, reply_markup: { inline_keyboard: chunk(REGIONS.map(r => ({ text: r, callback_data: `SCAN_REGION:${r}` })), 2) } });
    } else if (data.startsWith('SCAN_REGION:')) {
      const region = data.slice(12);
      const draft = { ...(state.remote.scanDraft || {}), region };
      state.remote.scanDraft = null; save();
      if (!draft.source || !draft.query) { await notify('sendMessage', { chat_id: chatId, text: 'Kreator stracił kontekst — zacznij od /menu.' }); return; }
      remoteScan(draft.source, draft.query, region).catch(e => { state.error = e.message; save(); });
    } else if (data === 'MENU_BULK') {
      const n = state.remote.pendingScan?.leads.length || 0;
      await notify('sendMessage', { chat_id: chatId, text: n ? `🚀 Masowa wysyłka — nierozpatrzony skan: ${n} leadów.` : `🚀 Masowa wysyłka\n${statusText()}\n\nNajpierw zeskanuj leady (MENU_SCAN lub /skan).`, reply_markup: n ? { inline_keyboard: [
        [{ text: `🚀 Dodaj wszystkie (${n}) i Wyślij Bulk SMS`, callback_data: 'REMOTE_ADD_AND_SEND' }],
        [{ text: `📥 Tylko zapisz (${n}) do bazy`, callback_data: 'REMOTE_ADD_ONLY' }],
        [{ text: '❌ Odrzuć wyniki', callback_data: 'REMOTE_DISCARD' }],
      ] } : undefined });
    } else if (data === 'MENU_STATUS') {
      logRemote('Z telefonu: status kolejki');
      await notify('sendMessage', { chat_id: chatId, text: statusText() });
    } else if (data === 'TOGGLE_BULK_PAUSE') {
      const q = d.bulkStatus ? d.bulkStatus() : null;
      if (q?.paused) { d.resumeBulk?.(); logRemote('Z telefonu: wznowiono wysyłkę'); await notify('sendMessage', { chat_id: chatId, text: '▶️ Wysyłka wznowiona.' }); }
      else { d.pauseBulk?.(); logRemote('Z telefonu: wstrzymano wysyłkę'); await notify('sendMessage', { chat_id: chatId, text: '⏸️ Wysyłka wstrzymana.' }); }
    } else if (data === 'REMOTE_ADD_AND_SEND') {
      await requestSpeed(chatId);
    } else if (data === 'REMOTE_ADD_ONLY') {
      logRemote('Z telefonu: zapisano wyniki skanu do bazy');
      if (d.remoteCommand?.({ action: 'addOnly' })) { await notify('sendMessage', { chat_id: chatId, text: '📥 Przekazano do ekranu Maca — zapisuję wyniki do bazy.' }); return; }
      remoteAdd(false).catch(e => { state.error = e.message; save(); });
    } else if (data === 'REMOTE_DISCARD') {
      const n = state.remote.pendingScan?.leads.length || 0;
      state.remote.pendingScan = null; state.remote.windowScanId = null; state.remote.speedApproval = null; save();
      logRemote(`Z telefonu: odrzucono ${n} wyników skanu`);
      d.remoteCommand?.({ action: 'discard' });
      await notify('sendMessage', { chat_id: chatId, text: `❌ Odrzucono ${n} wyników skanowania.` });
    }
  }

  async function report(batch) {
    const counts = {};
    for (const l of batch.leads) counts[l.website_issue_type] = (counts[l.website_issue_type] || 0) + 1;
    return telegram('sendMessage', { chat_id: state.remote.chatId, text:`LeadFinder • ${batch.source}\n${batch.leads.length} leadów oczekuje na akceptację.\n${Object.entries(counts).map(([k,v]) => `${k}: ${v}`).join('\n')}`, reply_markup:{inline_keyboard:[[{text:`✅ Wyślij teraz (${batch.leads.length} ${batch.channel_type==='EMAIL'?'E-mail':'SMS'})`, callback_data:`approve:${batch.id}`}],[{text:'⏰ Wyślij o 09:30',callback_data:`schedule:${batch.id}`}],[{text:'❌ Wyczyść poczekalnię',callback_data:`reject:${batch.id}`}]]} });
  }
  async function run(day, manual = false) {
    if (busy) throw new Error('Skanowanie już trwa.');
    const plan = state.weeklySchedule.find(p => p.day === day);
    if (!plan?.queryOrPkd || !plan.voivodeship) throw new Error('Uzupełnij frazę i województwo dla tego dnia.');
    const runKey = `${new Date().toLocaleDateString('en-CA')}:${day}`;
    if (!manual && state.runs[runKey]) return;
    busy = true; state.runs[runKey] = 'running'; save();
    const blocker = d.block();
    let conn;
    try {
      if(plan.channel_type==='EMAIL') {
        if(!plan.emailConsent) throw new Error('Potwierdź uprawnienie do kontaktu e-mail w planie dnia.');
        const result=await d.email.harvest({niche:plan.queryOrPkd,area:plan.voivodeship,voivodeship:plan.voivodeship,pkd:plan.source==='CEIDG'?plan.queryOrPkd:'',portals:plan.source==='CEIDG'?['ceidg']:['directories','osint'],limit:plan.dailyTargetLimit});
        const staged=new Set(state.batches.filter(b=>b.channel_type==='EMAIL'&&['pending','scheduled'].includes(b.status)).flatMap(b=>b.leads.map(l=>l.email)));
        const leads=result.leads.filter(l=>l.website_issue_type!=='UNKNOWN'&&!staged.has(l.email));
        if(leads.length){const batch={id:randomUUID(),channel_type:'EMAIL',emailConsent:true,createdAt:new Date().toISOString(),source:plan.source,status:'pending',leads:leads.map(l=>({...l,...d.email.build(l)}))};state.batches.push(batch);save();if(state.remote.encryptedToken)await report(batch);}
        if(result.warnings.length)state.error=result.warnings.join(' / ');
        state.runs[runKey]='done';return snapshot();
      }
      conn = d.openHistory();
      if (!conn) throw new Error('Poczekalnia wymaga Pełnego dostępu do dysku: nie można sprawdzić historii Wiadomości.');
      const rows = await d.scan(plan);
      const verified = [];
      for (const row of rows) {
        if (!d.validPhone(row.telefon)) continue;
        if (!row.strona && await d.hasWebsite(row)) continue;
        verified.push(row);
      }
      const leads = eligible(verified, [...d.leads(), ...state.batches.flatMap(b => b.status === 'pending' || b.status === 'scheduled' ? b.leads.map(l => ({...l, sms_reserved_at: b.createdAt})) : [])], d.blocked(), p => d.history(conn,p), plan.dailyTargetLimit);
      if (leads.length) {
        const batch = {id:randomUUID(), createdAt:new Date().toISOString(), source:plan.source, status:'pending', leads:leads.map(l => ({...l, id:randomUUID(), ...d.message(l)}))};
        state.batches.push(batch); save();
        if (state.remote.encryptedToken) { try { await report(batch); } catch(e) {state.error = e.message;} }
      }
      state.runs[runKey] = 'done';
    } catch(e) {state.runs[runKey]='failed'; state.error=e.message; throw e;}
    finally {d.closeHistory(conn); d.unblock(blocker); busy=false; save();}
    return snapshot();
  }
  async function action(id, command, speed) {
    const batch = state.batches.find(b => b.id === id);
    if (!batch || !['pending','scheduled'].includes(batch.status)) throw new Error('Ta paczka nie oczekuje już na decyzję.');
    if (command === 'reject') {batch.status='rejected'; batch.leads=[]; save(); return snapshot();}
    if (command === 'schedule') {
      const at=new Date(); at.setHours(9,30,0,0); if(at<=new Date()) at.setDate(at.getDate()+1);
      batch.status='scheduled'; batch.sendAt=at.toISOString(); save(); return snapshot();
    }
    if (command !== 'approve') throw new Error('Nieznana decyzja.');
    if(batch.channel_type==='EMAIL') {
      if(d.email.status().running)throw new Error('Kolejka e-mail już działa.');
      batch.status='sending';save();const blocker=d.block();
      try {
        d.email.insert(batch.leads);
        const records=d.email.list();const selected=batch.leads.map(l=>records.find(r=>r.email===l.email)).filter(Boolean);
        const prepared=Object.fromEntries(selected.map(l=>[l.id,batch.leads.find(r=>r.email===l.email)]));
        batch.results=await d.email.sendBulk(selected.map(l=>l.id),batch.emailConsent,prepared);batch.status=batch.results.some(r=>!r.ok&&!r.skipped)?'failed':'sent';
      }catch(e){batch.status='failed';state.error=e.message;}finally{d.unblock(blocker);save();}
      return snapshot();
    }
    if (d.isSending()) throw new Error('Inna kolejka SMS już działa.');
    const conn = d.openHistory();
    if (!conn) throw new Error('Brak dostępu do historii Wiadomości — wysyłka zablokowana.');
    let rows;
    try {rows=eligible(batch.leads, d.leads(), d.blocked(), p => d.history(conn,p), batch.leads.length);} finally {d.closeHistory(conn);}
    batch.status='sending'; save();
    d.insert(rows);
    const blocker=d.block();
    try { batch.results=await d.send(rows.map(l => ({id:l.id, phone:l.telefon, body:l.sms_exact_text, templateId:l.website_issue_type, signature:l.sms_combination_signature})), speed); batch.status=batch.results.some(r=>!r.ok&&!r.skipped)?'failed':'sent'; }
    catch(e) {batch.status='failed';state.error=e.message;}
    finally {d.unblock(blocker); save();}
    return snapshot();
  }
  async function poll() {
    if(polling) return; polling=true;
    try {
      try { if(state.remote.encryptedToken) {
        const updates=await telegram('getUpdates',{offset:state.telegramOffset, timeout:0, allowed_updates:['callback_query','message']});
        for(const u of updates) {
          state.telegramOffset=u.update_id+1; save();
          const c=u.callback_query;
          if(c) {
            const chatId=c.message?.chat?.id;
            if(!ownChat(chatId) || String(c.from?.id)!==String(state.remote.chatId)) continue;
            const data=String(c.data||'');
            await telegram('answerCallbackQuery',{callback_query_id:c.id,text:'Decyzja odebrana'});
            if(['approve','schedule','reject'].includes(data.split(':')[0])) {
              const [cmd,id]=data.split(':');
              // Do not block polling for a long-running SMS queue.
              if (cmd === 'approve' && state.batches.find(b => b.id === id)?.channel_type !== 'EMAIL') requestSpeed(chatId, id).catch(e=>{state.error=e.message;save();});
              else action(id,cmd).catch(e=>{state.error=e.message;save();});
            } else {
              handleCallback(chatId,data).catch(e=>{state.error=e.message;save();});
            }
            continue;
          }
          const m=u.message;
          if(m?.text) handleCommand(m.chat?.id,m.text).catch(e=>{state.error=e.message;save();});
        }
      } } catch(e) {state.error=e.message;save();}
      const events=d.remoteEvents(state.remote.selfPhone, state.commandCursor, state.replyCursor);
      state.commandCursor=events.commandCursor; state.replyCursor=events.replyCursor; save();
      if(events.approve) { const b=state.batches.find(b=>b.status==='pending'&&b.channel_type!=='EMAIL'); if(b) action(b.id,'approve').catch(e=>{state.error=e.message;save();}); }
      if(state.remote.encryptedToken) for(const r of events.replies) await telegram('sendMessage',{chat_id:state.remote.chatId,text:`💬 ${r.name}\n${r.phone}\n${r.text || '[Odpowiedź bez tekstu / załącznik]'}`});
    } catch(e) {state.error=e.message;save();} finally {polling=false;}
  }
  function start() {
    // Prime cursors before accepting new self-commands, never execute old history.
    const e=d.remoteEvents(state.remote.selfPhone,null,null);state.commandCursor=e.commandCursor;if(state.replyCursor===null)state.replyCursor=e.replyCursor;save();
    const tick=()=>{
      const now=new Date(), day=DAYS[now.getDay()], time=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      if(state.weeklySchedule.some(p=>p.day===day&&p.enabled&&p.scanTime===time)) run(day).catch(()=>{});
      for(const b of state.batches) if(b.status==='scheduled'&&Date.parse(b.sendAt)<=Date.now()) action(b.id,'approve').catch(e=>{state.error=e.message;save();});
    };
    tick(); const a=setInterval(tick,60000), b=setInterval(poll,10000); return ()=>{clearInterval(a);clearInterval(b);};
  }
  function configure(value) {
    if(value.weeklySchedule) {
      if(!Array.isArray(value.weeklySchedule)||value.weeklySchedule.length!==7) throw new Error('Plan musi zawierać 7 dni.');
      state.weeklySchedule=value.weeklySchedule.map(p=>{
        if(!DAYS.includes(p.day)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.scanTime)||!['GOOGLE_MAPS','CEIDG','OLX'].includes(p.source)||!Number.isInteger(p.dailyTargetLimit)||p.dailyTargetLimit<1||p.dailyTargetLimit>200) throw new Error('Niepoprawny dzień lub limit (1–200).');
        if(p.channel_type && !['SMS','EMAIL'].includes(p.channel_type))throw new Error('Niepoprawny kanał.');
        return {...p,enabled:!!p.enabled};
      });
      if(new Set(state.weeklySchedule.map(p=>p.day)).size!==7) throw new Error('Dni nie mogą się powtarzać.');
    }
    if(value.remote) {
      const {chatId,selfPhone,telegramBotToken}=value.remote;
      if(chatId!==undefined && chatId && !/^\d+$/.test(chatId)) throw new Error('Użyj prywatnego czatu Telegram (numeryczny Chat ID).');
      state.remote={...state.remote,chatId:chatId??state.remote.chatId,selfPhone:selfPhone??state.remote.selfPhone};
      if(telegramBotToken) state.remote.encryptedToken=d.encrypt(telegramBotToken);
      const e=d.remoteEvents(state.remote.selfPhone,null,null); state.commandCursor=e.commandCursor;
    }
    state.error=null;save();return snapshot();
  }
  // Raport zwrotny z ekranu Maca na telefon (po skanie/wysyłce sterowanej pilotem).
  async function remoteReport(payload) {
    const text = String(payload?.text || 'Akcja na ekranie Maca zakończona.');
    if (payload?.withButtons) { state.remote.windowScanId = randomUUID(); state.remote.speedApproval = null; save(); }
    logRemote(`Ekran Maca: ${text}`);
    if (!state.remote.encryptedToken || !state.remote.chatId) return null;
    return notify('sendMessage', { chat_id: state.remote.chatId, text, reply_markup: payload?.withButtons ? { inline_keyboard: [
      [{ text: '🚀 Dodaj wszystkie i Wyślij Bulk SMS', callback_data: 'REMOTE_ADD_AND_SEND' }],
      [{ text: '📥 Tylko zapisz wszystkie do bazy', callback_data: 'REMOTE_ADD_ONLY' }],
      [{ text: '❌ Odrzuć wyniki', callback_data: 'REMOTE_DISCARD' }],
    ] } : undefined });
  }
  return {snapshot,configure,run,action,report,start,remoteScan,remoteAdd,remoteReport,handleCommand,handleCallback,test:()=>telegram('getMe',{}), testReport:()=>report(state.batches.find(b=>b.status==='pending') || {id:'test',source:'Test połączenia',leads:[]})};
}
module.exports={createAutopilot,eligible,parseSkanCommand};
