import { buildIssueMessage, readIssueTemplates, type WebsiteIssueType } from './issue-templates';
export const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] as const;
export type Day = typeof DAYS[number];
export type Source = 'GOOGLE_MAPS' | 'CEIDG' | 'OLX';
export type Plan = {channel_type?:'SMS'|'EMAIL';emailConsent?:boolean;day:Day;enabled:boolean;scanTime:string;source:Source;queryOrPkd:string;voivodeship:string;dailyTargetLimit:number;cities?:string[]};
export type StagedLead = {id:string;nazwa:string;telefon:string;miasto:string;website_issue_type:WebsiteIssueType;sms_exact_text:string;email?:string;subject?:string;body?:string;suggested_free_domain?:string|null};
export type Batch = {channel_type?:'SMS'|'EMAIL';id:string;createdAt:string;source:string;status:string;sendAt?:string|undefined;leads:StagedLead[]};
export type RemoteLogEntry = {at:string;text:string};
export type PendingScanInfo = {source:string;query:string;region:string;count:number};
export type PilotState = {weeklySchedule:Plan[];batches:Batch[];remote:{chatId:string;selfPhone:string;tokenConfigured?:boolean;pendingScan?:PendingScanInfo|null};remoteLog?:RemoteLogEntry[];busy?:boolean;error?:string};
export const emptyPlan = ():Plan[] => DAYS.map(day=>({day,enabled:false,scanTime:'07:00',source:'GOOGLE_MAPS',queryOrPkd:'',voivodeship:'Mazowieckie',dailyTargetLimit:50}));
export const initialState = ():PilotState => ({weeklySchedule:emptyPlan(),batches:[],remote:{chatId:'',selfPhone:''}});
export type Decision = 'approve'|'schedule'|'reject';
type Bridge = {snapshot:()=>Promise<PilotState>;configure:(v:unknown)=>Promise<PilotState>;run:(day:Day)=>Promise<PilotState>;action:(id:string,c:Decision)=>Promise<PilotState>;test:()=>Promise<unknown>;testReport:()=>Promise<unknown>;remoteReport?:(p:{text:string;withButtons:boolean})=>Promise<unknown>;onChanged:(cb:()=>void)=>()=>void};
export function pilotBridge():Bridge|undefined {return typeof window==='undefined'?undefined:(window as unknown as {leadfinder?:{autopilot?:Bridge}}).leadfinder?.autopilot;}
const KEY='leadfinder.autopilot-preview';
export function readMock():PilotState {try{return JSON.parse(localStorage.getItem(KEY)||'null')||initialState();}catch{return initialState();}}
export function writeMock(s:PilotState){localStorage.setItem(KEY,JSON.stringify(s));}
export function missionMock(s:PilotState,day:Day):PilotState {
 const p=s.weeklySchedule.find(p=>p.day===day);if(!p?.queryOrPkd)throw new Error('Uzupełnij dzisiejszą misję.');
 const used=new Set(s.batches.flatMap(b=>b.leads.map(l=>l.telefon)));
 const leads:StagedLead[]=[];
 for(let i=0;i<Math.min(5,p.dailyTargetLimit);i++){
  const phone=`+48500123${String(i).padStart(3,'0')}`;if(used.has(phone))continue;
  const type:WebsiteIssueType=p.source==='OLX'?'OLX_NO_WEBSITE':(['NO_WEBSITE','EXPIRED_OR_ERROR','NO_SSL','NO_MOBILE'] as WebsiteIssueType[])[i%4]||'NO_WEBSITE';
  const nazwa=`Firma przykładowa ${i+1}`;
  leads.push({id:crypto.randomUUID(),nazwa,telefon:phone,miasto:p.voivodeship,website_issue_type:type,sms_exact_text:buildIssueMessage(readIssueTemplates(),type,{nazwa,miasto:p.voivodeship,branza:p.queryOrPkd}).body});
 }
 return {...s,batches:leads.length?[...s.batches,{id:crypto.randomUUID(),createdAt:new Date().toISOString(),source:p.source,status:'pending',leads}]:s.batches};
}
export function decideMock(s:PilotState,id:string,c:Decision):PilotState {
 return {...s,batches:s.batches.map(b=>{if(b.id!==id||!['pending','scheduled'].includes(b.status))return b;const at=new Date();at.setHours(9,30,0,0);if(at<=new Date())at.setDate(at.getDate()+1);return {...b,status:c==='approve'?'sent':c==='schedule'?'scheduled':'rejected',sendAt:c==='schedule'?at.toISOString():undefined};})};
}
