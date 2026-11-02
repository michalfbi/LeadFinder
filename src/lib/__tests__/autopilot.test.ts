import {describe,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
const {eligible,createAutopilot}=createRequire(import.meta.url)('../../../electron/autopilot.cjs');
function harness(){
 let stored:any; const send=vi.fn(async()=>[]); const block=vi.fn(()=>1); const row={nazwa:'Firma',telefon:'+48600123456',miasto:'Warszawa'};
 const engine=createAutopilot({file:()=>'',read:(_:unknown,f:any)=>f,write:(_:unknown,s:any)=>{stored=structuredClone(s);},changed:()=>{},leads:()=>[],blocked:()=>[],openHistory:()=>({}),closeHistory:()=>{},history:()=>false,validPhone:()=>true,hasWebsite:async()=>false,scan:async()=>[row],message:()=>({sms_exact_text:'Wiadomość'}),block,unblock:()=>{},isSending:()=>false,insert:()=>{},send});
 const plan=engine.snapshot().weeklySchedule.map((p:any)=>({...p,queryOrPkd:'stolarz',enabled:true}));engine.configure({weeklySchedule:plan});
 return {engine,send,get:()=>stored};
}
describe('Autopilot safety',()=>{
 it('stages without sending until approval',async()=>{const h=harness();await h.engine.run('monday',true);expect(h.send).not.toHaveBeenCalled();expect(h.get().batches[0].status).toBe('pending');await h.engine.action(h.get().batches[0].id,'approve');expect(h.send).toHaveBeenCalledTimes(1);});
 it('never approves the same batch twice',async()=>{const h=harness();await h.engine.run('monday',true);const id=h.get().batches[0].id;await h.engine.action(id,'approve');await expect(h.engine.action(id,'approve')).rejects.toThrow();expect(h.send).toHaveBeenCalledTimes(1);});
 it('blocks previously contacted numbers and duplicate formats',()=>{const rows=[{telefon:'+48600123456'},{telefon:'600123456'},{telefon:'+48500123456'}];expect(eligible(rows,[{telefon:'500123456',sms_sent_at:'2026-10-30'}],[],()=>false,50)).toEqual([rows[0]]);});
 it('fails closed when history cannot be checked',()=>{expect(eligible([{telefon:'600123456'}],[],[],()=>null,50)).toEqual([]);});
 it('reject never sends an opening or follow-up SMS',async()=>{const h=harness();await h.engine.run('monday',true);await h.engine.action(h.get().batches[0].id,'reject');expect(h.send).not.toHaveBeenCalled();});
 it('09:30 scheduling records approval but does not immediately send',async()=>{const h=harness();await h.engine.run('monday',true);await h.engine.action(h.get().batches[0].id,'schedule');expect(h.get().batches[0].status).toBe('scheduled');expect(new Date(h.get().batches[0].sendAt).getHours()).toBe(9);expect(new Date(h.get().batches[0].sendAt).getMinutes()).toBe(30);expect(h.send).not.toHaveBeenCalled();});
 it('enforces seven unique weekdays',()=>{const h=harness();expect(()=>h.engine.configure({weeklySchedule:[]})).toThrow();expect(h.engine.snapshot().weeklySchedule).toHaveLength(7);});
 it('email mission stages exact content and uses only the email sender after approval',async()=>{
  let state:any;const sms=vi.fn(),mail=vi.fn(async()=>[{ok:true}]),records:any[]=[];
  const row={id:'email-1',email:'kontakt@firma.pl',nazwa:'Firma',channel_type:'EMAIL',website_issue_type:'NO_WEBSITE'};
  const email={harvest:async()=>({leads:[row],warnings:[]}),build:()=>({subject:'Firma',body:'Treść',signature:'wariant'}),status:()=>({running:false}),insert:(r:any[])=>records.push(...r),list:()=>records,sendBulk:mail};
  const engine=createAutopilot({file:()=>'',read:(_:unknown,f:any)=>f,write:(_:unknown,s:any)=>state=structuredClone(s),changed:()=>{},block:()=>1,unblock:()=>{},closeHistory:()=>{},email,send:sms});
  engine.configure({weeklySchedule:engine.snapshot().weeklySchedule.map((p:any)=>({...p,channel_type:'EMAIL',emailConsent:true,queryOrPkd:'stolarz'}))});
  await engine.run('monday',true);expect(mail).not.toHaveBeenCalled();expect(state.batches[0].leads[0].subject).toBe('Firma');
  await engine.action(state.batches[0].id,'approve');expect(mail).toHaveBeenCalledTimes(1);expect(sms).not.toHaveBeenCalled();expect(records[0].channel_type).toBe('EMAIL');
 });
});

const {parseSkanCommand}=createRequire(import.meta.url)('../../../electron/autopilot.cjs');
function remoteHarness(){
 let stored:any; const send=vi.fn(async(items:any[],_speed?:unknown)=>items.map(()=>({ok:true}))); const insert=vi.fn(); const scan=vi.fn(async()=>[{nazwa:'Firma',telefon:'+48600123456',miasto:'Kraków',website_issue_type:'NO_WEBSITE'}]);
 const engine=createAutopilot({file:()=>'',read:(_:unknown,f:any)=>f,write:(_:unknown,s:any)=>{stored=structuredClone(s);},changed:()=>{},leads:()=>[],blocked:()=>[],openHistory:()=>({}),closeHistory:()=>{},history:()=>false,validPhone:()=>true,hasWebsite:async()=>false,scan,message:()=>({sms_exact_text:'Wiadomość'}),block:()=>1,unblock:()=>{},isSending:()=>false,insert,send,pauseBulk:()=>{},resumeBulk:()=>{},bulkStatus:()=>({running:false,paused:false,sent:0,queued:0,total:0}),remoteEvents:()=>({commandCursor:0,replyCursor:0,approve:false,replies:[]})});
 engine.configure({remote:{chatId:'123',selfPhone:'+48600123456'}});
 return {engine,send,insert,scan,get:()=>stored};
}
const flush=()=>new Promise(r=>setTimeout(r,10));
describe('Telegram remote command center',()=>{
 it('parses /skan with source alias, multi-word niche and region',()=>{
  expect(parseSkanCommand('/skan olx fotograf slubny malopolskie')).toEqual({source:'OLX',query:'fotograf slubny',region:'Małopolskie'});
  expect(parseSkanCommand('/skan maps stolarz swietokrzyskie')).toEqual({source:'GOOGLE_MAPS',query:'stolarz',region:'Świętokrzyskie'});
  expect(parseSkanCommand('/skan olx fotograf')).toBeNull();
  expect(parseSkanCommand('/skan tiktok stolarz mazowieckie')).toBeNull();
  expect(parseSkanCommand('hello')).toBeNull();
 });
 it('ignores commands from a foreign chat',async()=>{
  const h=remoteHarness();
  await h.engine.handleCommand('999','/skan olx fotograf malopolskie'); await flush();
  expect(h.scan).not.toHaveBeenCalled(); expect(h.get().remoteLog||[]).toHaveLength(0);
 });
 it('remote scan stages results and never sends without a decision',async()=>{
  const h=remoteHarness();
  await h.engine.remoteScan('OLX','fotograf','Małopolskie');
  expect(h.get().remote.pendingScan.leads).toHaveLength(1);
  expect(h.send).not.toHaveBeenCalled(); expect(h.insert).not.toHaveBeenCalled();
  expect(h.get().remoteLog[0].text).toContain('znaleziono 1');
 });
 it('REMOTE_ADD_AND_SEND inserts and sends exactly the staged leads once',async()=>{
  const h=remoteHarness();
  await h.engine.remoteScan('OLX','fotograf','Małopolskie');
  await h.engine.handleCallback('123','REMOTE_ADD_AND_SEND'); await flush();
  expect(h.send).not.toHaveBeenCalled();
  const callback = `SPEED:fast:${h.get().remote.speedApproval.id}`;
  await h.engine.handleCallback('123',callback); await flush();
  expect(h.insert).toHaveBeenCalledTimes(1); expect(h.send).toHaveBeenCalledTimes(1);
  expect(h.send.mock.calls[0]?.[0]?.[0]?.body).toBe('Wiadomość');
  expect(h.get().remote.pendingScan).toBeNull();
  expect(h.send.mock.calls[0]?.[1]).toEqual({speedMode:'fast',minDelayMs:5000,maxDelayMs:10000});
  await h.engine.handleCallback('123',callback); await flush();
  expect(h.send).toHaveBeenCalledTimes(1);
 });
 it('turbo approval carries 1500–3000ms only for the owner and the exact staged scan',async()=>{
  const h=remoteHarness();
  await h.engine.remoteScan('OLX','fotograf','Małopolskie');
  await h.engine.handleCallback('123','REMOTE_ADD_AND_SEND');
  const callback=`SPEED:turbo:${h.get().remote.speedApproval.id}`;
  await h.engine.handleCallback('999',callback);
  expect(h.send).not.toHaveBeenCalled();
  await h.engine.handleCallback('123','SPEED:turbo:wrong-batch');
  expect(h.send).not.toHaveBeenCalled();
  await h.engine.handleCallback('123',callback); await flush();
  expect(h.send.mock.calls[0]?.[1]).toEqual({speedMode:'turbo',minDelayMs:1500,maxDelayMs:3000});
 });
 it('stale speed approval cannot send a replacement scan',async()=>{
  const h=remoteHarness();await h.engine.remoteScan('OLX','fotograf','Małopolskie');
  await h.engine.handleCallback('123','REMOTE_ADD_AND_SEND');
  const callback=`SPEED:turbo:${h.get().remote.speedApproval.id}`;
  await h.engine.remoteScan('OLX','stolarz','Mazowieckie');
  await h.engine.handleCallback('123',callback);await flush();
  expect(h.send).not.toHaveBeenCalled();
  expect(h.get().remote.pendingScan.query).toBe('stolarz');
 });
 it('REMOTE_DISCARD drops staged results without inserting or sending',async()=>{
  const h=remoteHarness();
  await h.engine.remoteScan('OLX','fotograf','Małopolskie');
  await h.engine.handleCallback('123','REMOTE_DISCARD'); await flush();
  expect(h.get().remote.pendingScan).toBeNull();
  expect(h.insert).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
 });
 it('foreign callback cannot trigger a bulk send',async()=>{
  const h=remoteHarness();
  await h.engine.remoteScan('OLX','fotograf','Małopolskie');
  await h.engine.handleCallback('999','REMOTE_ADD_AND_SEND'); await flush();
  expect(h.send).not.toHaveBeenCalled(); expect(h.get().remote.pendingScan).not.toBeNull();
 });
});
