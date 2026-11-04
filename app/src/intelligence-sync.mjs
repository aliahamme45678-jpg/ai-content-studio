import {applyChineseIntelligence} from './intelligence-translation.mjs';
import {readFile} from 'node:fs/promises';import {join} from 'node:path';import postgres from 'postgres';
let refreshing=null,refreshKey=null;
export async function intelligenceDatabaseUrl(root,configured=''){
 // 显式 none/off 表示禁用数据库直连（测试用），不再回退读 .env 里的真实库
 if(/^(none|off|disabled)$/i.test(String(configured).trim()))return '';
 if(configured)return configured;
 try{const env=await readFile(join(root,'../../opensource/AIHOT/.env'),'utf8');return env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g,'')||'';}catch{return '';}
}
export async function readCollectedIntelligence(databaseUrl,{window='7d',limit=500}={}){
 const sql=postgres(databaseUrl,{max:1,connect_timeout:5,idle_timeout:2});
 try{return await sql`select a.id,a.title,a.url,a.published_at,a.discovered_at,coalesce(p.summary,a.excerpt,'') as summary,s.name as source,coalesce(p.selected and p.visibility='public',false) as selected,p.category from articles a join sources s on s.id=a.source_id left join publications p on p.article_id=a.id where s.kind='rss' and s.enabled and s.participation_mode='editorial' and coalesce(a.published_at,a.discovered_at)>=now()-(${window==='24h'?1:7}*interval '1 day') order by coalesce(a.published_at,a.discovered_at) desc limit ${limit}`;
 }finally{await sql.end({timeout:1});}
}
export async function syncIntelligence({db,baseUrl,databaseUrl,saveDb,mode,window='7d',fetcher=fetch}){
 const key=JSON.stringify([baseUrl,databaseUrl,mode||db.integration.aihot.syncMode||'all',window]);
 if(refreshing){if(key===refreshKey)return refreshing;await refreshing.catch(()=>{});return syncIntelligence({db,baseUrl,databaseUrl,saveDb,mode,window,fetcher});}
 refreshKey=key;
 refreshing=(async()=>{try{
 const selectedMode=mode||db.integration.aihot.syncMode||'all';let incoming=[],pages=0;
 if(selectedMode==='all'&&databaseUrl){const rows=await readCollectedIntelligence(databaseUrl,{window});incoming=rows.map(r=>({id:r.id,title:r.title,source:{name:r.source},publishedAt:r.published_at?.toISOString(),discoveredAt:r.discovered_at?.toISOString(),summary:r.summary,links:{original:r.url},selected:r.selected,category:r.category}));pages=1;}
 else{let cursor=null;do{const url=new URL(baseUrl+'/api/v1/items');url.search=new URLSearchParams({mode:selectedMode,window,by:'timeline',limit:'100',...(cursor?{cursor}:{})});const response=await fetcher(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('AIHOT HTTP '+response.status);const value=await response.json();if(!Array.isArray(value.items))throw Error('invalid_intelligence_response');incoming.push(...value.items);cursor=value.page?.nextCursor||null;pages++;}while(cursor&&pages<5);if(cursor)throw Error('intelligence_pagination_incomplete');}
 const now=new Date().toISOString(),old=new Map(db.sources.filter(s=>s.origin==='aihot-live').map(s=>[s.externalId,s]));
 const normalized=incoming.map(item=>{const previous=old.get(item.id)||db.sources.find(s=>s.origin==='aihot-live'&&s.url===item.links?.original);return {id:previous?.id||'aihot-'+item.id,externalId:item.id,title:item.title,source:item.source?.name||'AIHOT',publishedAt:item.publishedAt||item.discoveredAt||null,summary:item.summary||'',url:item.links?.original||item.links?.aihot||'',status:previous?.status||'未使用',origin:'aihot-live',selected:item.selected,category:item.category,syncedAt:now};});
 const kept=db.sources.filter(s=>s.origin!=='aihot-live'&&!s.id.startsWith('aihot-')||s.origin==='aihot-live'&&s.status==='已收藏'&&!normalized.some(n=>n.id===s.id));db.sources=[...normalized.map(s=>applyChineseIntelligence(s,db.intelligenceTranslations)),...kept];
 const run={mode:selectedMode,count:normalized.length,pages,syncedAt:now,endpoint:baseUrl,window};db.integration.aihot={...db.integration.aihot,connected:true,mode:'live',endpoint:baseUrl,syncMode:selectedMode,lastSyncAt:now,lastError:null,count:normalized.length,resultState:normalized.length?'connected_with_public_items':'connected_empty',syncHistory:[run,...(db.integration.aihot.syncHistory||[])].slice(0,30)};await saveDb(db);return {...run,integration:db.integration.aihot};
 }catch(error){db.integration.aihot={...db.integration.aihot,connected:false,lastError:error.message,mode:'error'};await saveDb(db);throw error;}})();
 try{return await refreshing;}finally{refreshing=null;}
}
