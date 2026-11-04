// RSS collector only. AI organization remains an explicit Studio action.
import {readFile,writeFile,mkdir} from 'node:fs/promises';import {join,resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),upstream=join(root,'opensource/AIHOT');
for(const line of (await readFile(join(upstream,'.env'),'utf8')).split(/\r?\n/)){const match=line.match(/^([A-Z_0-9]+)=(.*)$/);if(match)process.env[match[1]]=match[2].replace(/^['"]|['"]$/g,'');}
process.env.MODEL_CALLS_ENABLED='false';process.env.FEISHU_INTERNAL_ENABLED='false';process.env.FEISHU_CONTENT_ENABLED='false';
const {sql}=await import('../../opensource/AIHOT/packages/backend/src/db.ts');const {collectSource}=await import('../../opensource/AIHOT/packages/backend/src/sources/collect.ts');
await mkdir(join(root,'app/logs'),{recursive:true});let busy=false;
async function tick(){if(busy)return;busy=true;try{const due=await sql`select id from sources where enabled and kind='rss' and (next_fetch_at is null or next_fetch_at<=now()) order by next_fetch_at nulls first limit 18`;const results=[];for(const source of due){try{const result=await collectSource(source.id);results.push(result);console.log(JSON.stringify(result));}catch(error){results.push({sourceId:source.id,status:'failed',error:error.message});}}await writeFile(join(root,'app/logs/intelligence-collector-state.json'),JSON.stringify({pid:process.pid,updatedAt:new Date().toISOString(),results}));}catch(error){console.error('RSS collection:',error.message);}finally{busy=false;}}
await tick();setInterval(tick,60000);
