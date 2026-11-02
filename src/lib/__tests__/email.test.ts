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
