import {describe,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {normalizeEmail,domainType,extractEmails,spin,dedupeEmail,createEmailEngine}=require('../../../electron/email.cjs');
describe('Separate email channel',()=>{
 it('extracts mailto, structured data and text without duplicate addresses',()=>{expect(extractEmails('<body><a href="mailto:Kontakt@Firma.pl?subject=Hi">Email</a><script type="application/ld+json">{"email":"biuro@firma.pl"}</script>Kontakt: kontakt@firma.pl</body>')).toEqual(['kontakt@firma.pl','biuro@firma.pl']);});
 it('classifies all five requested free mailbox domains',()=>{for(const d of ['gmail.com','wp.pl','onet.pl','interia.pl','o2.pl'])expect(domainType(`biuro@${d}`)).toBe('FREE_MAILBOX');expect(domainType('biuro@firma.pl')).toBe('CUSTOM_DOMAIN');});
 it('rejects invalid addresses and deduplicates normalized email, not phone',()=>{expect(normalizeEmail('bad@')).toBeNull();expect(dedupeEmail([{email:'BIURO@firma.pl',telefon:'600123456'},{email:'other@firma.pl',telefon:'600123456'}],[{email:'biuro@firma.pl'}])).toEqual([{email:'other@firma.pl',telefon:'600123456'}]);});
 it('resolves nested Spintax in subject and body and inserts firm name',()=>{const r=spin('{Pytanie|Strona dla {nazwa}} {A|B {C|D}}',{nazwa:'Firma'});expect(r.text).not.toMatch(/[{}|]/);expect(['Pytanie','Strona dla Firma'].some(s=>r.text.startsWith(s))).toBe(true);});
 it('keeps email inserts out of SMS files and removes phone data',()=>{const files:any={};const engine=createEmailEngine({file:(n:string)=>n,read:(n:string,f:any)=>files[n]||f,write:(n:string,r:any)=>files[n]=structuredClone(r),changed:()=>{},db:()=>({exec:()=>{},prepare:()=>({all:()=>[]})})});engine.insert([{nazwa:'Firma',email:'biuro@firma.pl',telefon:'600123456'}]);expect(Object.keys(files)).toEqual(['email-leads.json']);expect(engine.list()[0].channel_type).toBe('EMAIL');expect(engine.list()[0].telefon).toBeNull();});
 it('requires explicit lawful-contact confirmation before SMTP attempts',async()=>{const engine=createEmailEngine({file:(n:string)=>n,read:(_:string,f:any)=>f});await expect(engine.sendBulk(['id'],false)).rejects.toThrow('zgodę');});
});

const mail=require('../../../electron/email.cjs');
describe('reguły krajów w silniku e-mail',()=>{
 const sender={company:'Pakula Web Studio',address:'ul. Piotrkowska 1, 90-001 Lodz, Poland',from:'michal@pakulaweb.com'};
 it('stopka USA zawiera firmę, adres pocztowy, oznaczenie oferty i rezygnację',()=>{
  const f=mail.buildFooter('US',sender);
  expect(f).toContain('Pakula Web Studio');expect(f).toContain('90-001 Lodz');
  expect(f).toContain('business solicitation');expect(f).toContain('Reply "unsubscribe"');
  expect(mail.buildFooter('PL',sender)).toContain('proszę odpowiedzieć STOP');
 });
 it('okno wysyłki liczy się w strefie odbiorcy i pomija weekend',()=>{
  // Wtorek 3 listopada 2026, 16:00 UTC = 10:00 w Chicago, 08:00 w Los Angeles.
  const tue=new Date('2026-11-03T16:00:00Z');
  expect(mail.inSendWindow('US','America/Chicago',tue)).toBe(true);
  expect(mail.inSendWindow('US','America/Los_Angeles',tue)).toBe(false);
  expect(mail.inSendWindow('US','America/Chicago',new Date('2026-11-07T16:00:00Z'))).toBe(false);
  expect(mail.inSendWindow('US','Nie/Istnieje',tue)).toBe(false);
 });
 it('cytat naszej wiadomości nie udaje rezygnacji',()=>{
  const quoted='Sure, send the mockup over!\n\nOn Tue, Nov 3, 2026 at 10:02 AM Michal <m@x.com> wrote:\n> Not interested? Reply "unsubscribe" and I won\'t email you again.';
  expect(mail.stripQuoted(quoted)).toBe('Sure, send the mockup over!');
  expect(mail.isRefusal('US',quoted)).toBe(false);
  expect(mail.isRefusal('US','Please remove me from your list.')).toBe(true);
  expect(mail.isRefusal('US','How did you get my email? This is spam')).toBe(true);
  expect(mail.isRefusal('PL','Proszę nie pisać więcej')).toBe(true);
  expect(mail.isRefusal('PL','Dzień dobry, ile to kosztuje?')).toBe(false);
 });
 it('kontrola domeny nadawcy czyta MX, SPF, DMARC i DKIM',async()=>{
  const records:Record<string,string[][]>={'pakulaweb.com':[['v=spf1 include:_spf.google.com ~all']],'_dmarc.pakulaweb.com':[['v=DMARC1; p=none']],'google._domainkey.pakulaweb.com':[['v=DKIM1; k=rsa; p=ABC']]};
  const resolver={resolveMx:async()=>[{exchange:'mx',priority:1}],resolveTxt:async(n:string)=>{if(!records[n])throw new Error('ENOTFOUND');return records[n];}};
  expect(await mail.checkSenderDomain('michal@pakulaweb.com','google',resolver)).toMatchObject({domain:'pakulaweb.com',mx:true,dkim:true,ready:true});
  const bare=await mail.checkSenderDomain('nowa-domena.com','',{resolveMx:async()=>[],resolveTxt:async()=>{throw new Error('x');}});
  expect(bare).toMatchObject({mx:false,spf:null,dmarc:null,dkim:null,ready:false});
  await expect(mail.checkSenderDomain('to nie domena')).rejects.toThrow('poprawną domenę');
 });
 it('wiersz z treścią przygotowaną w Snajperze wysyła dokładnie tę treść i pamięta rynek',()=>{
  const files:any={};const engine=createEmailEngine({file:(n:string)=>n,read:(n:string,f:any)=>files[n]||f,write:(n:string,r:any)=>files[n]=structuredClone(r),changed:()=>{},templates:()=>({}),db:()=>({exec:()=>{},prepare:()=>({all:()=>[]})})});
  engine.insert([{nazwa:'Miller Roofing',email:'info@millerroofing.com',market:'US',timezone:'America/Chicago',email_prepared_subject:'Quick note\nabout the site',email_prepared_body:'Hi,\n\nBody.',email_prepared_signature:'[US]'}]);
  const row=engine.list()[0];
  expect(row.market).toBe('US');
  expect(engine.build(row)).toEqual({subject:'Quick note about the site',body:'Hi,\n\nBody.',signature:'[US]'});
 });
});
