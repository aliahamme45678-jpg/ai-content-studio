import {readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {runLark} from './feishu-sync.mjs';
import {uid,hash,documentSource} from './workflow.mjs';
export async function assetCreateRoute({req,res,url,db,json,body,saveDb,dataDir},call=runLark){
 if(req.method!=='POST'||url.pathname!=='/api/studio/assets/create')return false;
 const input=await body(req);const name=String(input.name||'').trim();if(!name||name.length>100){json(res,400,{error:'asset_name_required',detail:'素材库名称不能为空'});return true;}
 let sourceKey,importUrl='',rows=[],source;
 if(input.kind==='feishu'){
  let link;try{link=new URL(input.url);}catch{}
  const base=link?.pathname.match(/\/base\/([A-Za-z0-9]+)/)?.[1];
  if(!base||link.protocol!=='https:'||!/(^|\.)(feishu\.cn|larksuite\.com)$/.test(link.hostname)||link.username||link.password){json(res,400,{error:'请填写有效的飞书多维表格链接'});return true;}
  const table=link.searchParams.get('table')||(db.integration?.feishu?.baseToken===base?db.integration.feishu.tableId:null);
  if(!table){json(res,400,{error:'feishu_table_param_missing',detail:'链接中缺少数据表，请复制包含 table 参数的飞书链接'});return true;}
  sourceKey=`feishu:${base}:${table}`;source='feishu-export';importUrl=link.href;
  await mkdir(join(dataDir,'asset-imports'),{recursive:true});let offset=0;
  for(let page=0;page<50;page++){
   const output=`asset-imports/${uid('read')}.ndjson`;
   const result=await call(['base','+record-list','--base-token',base,'--table-id',table,'--field-id','标题','--field-id','原文 / 文案','--field-id','来源链接','--field-id','作者','--format','ndjson','--output',output,'--limit','500','--offset',String(offset),'--as','user'],{cwd:dataDir});
   rows.push(...(await readFile(join(dataDir,output),'utf8')).split(/\r?\n/).filter(Boolean).map(text=>JSON.parse(text)));
   if(!result.has_more)break;
   if(!Number.isInteger(result.next_offset)||result.next_offset<=offset||page===49)throw new Error('飞书分页未完成，未创建素材库');offset=result.next_offset;
  }
 }else if(input.kind==='markdown'){
  const text=typeof input.text==='string'?input.text:'';if(!text.trim()||text.length>200000){json(res,400,{error:'invalid_markdown_file',detail:'请选择非空且不超过20万字的 Markdown 文件'});return true;}
  sourceKey=`markdown:${hash(name+'\n'+String(input.fileName||''))}`;source='markdown-import';rows=[{'标题':input.fileName||name,'原文 / 文案':text,record_id:hash(text)}];
 }else{json(res,400,{error:'invalid_source_type',detail:'请选择飞书或 Markdown 来源'});return true;}
 const usable=rows.filter(r=>String(r['原文 / 文案']||'').trim());if(!usable.length){json(res,422,{error:'source_has_no_content',detail:'来源中没有正文，未创建素材库'});return true;}
 const collection=db.knowledgeSets.find(set=>set.sourceKey===sourceKey)||{id:uid('knowledge'),name,documentIds:[],sourceKey,sourceKind:input.kind,sourceUrl:importUrl,version:0};
 let added=0,updated=0;const documents=[];
 for(const row of usable){const recordId=input.kind==='markdown'?'file':String(row.record_id||row['来源链接']||row['标题']);const fingerprint=hash(sourceKey+'\n'+recordId+'\n'+row['原文 / 文案']);let doc=db.documents.find(d=>d.importHash===fingerprint||d.importSource===sourceKey&&d.sourceRecordId===recordId||input.kind==='feishu'&&d.source==='feishu-export'&&!d.importSource&&d.content===String(row['原文 / 文案'])&&String(d.url||'')===String(row['来源链接']||''));if(doc&&(doc.importHash!==fingerprint||doc.content!==String(row['原文 / 文案']))){db.documentVersions||=[];db.documentVersions.unshift({...structuredClone(doc),documentId:doc.id,snapshotId:uid('docver'),savedAt:new Date().toISOString()});Object.assign(doc,{name:String(row['标题']||''),content:String(row['原文 / 文案']),importHash:fingerprint,version:(doc.version||1)+1});const reference=db.sources.find(s=>s.id===doc.id);if(reference)Object.assign(reference,documentSource(doc));updated++;}if(!doc){doc={id:uid('doc'),name:String(row['标题']||''),content:String(row['原文 / 文案']),author:String(row['作者']||''),url:String(row['来源链接']||''),source,type:'写作案例库',assetCreated:true,sourceRecordId:recordId,assetLibraryId:collection.id,importSource:sourceKey,importName:collection.name,importUrl,importHash:fingerprint,fileName:input.kind==='markdown'?String(input.fileName||name):undefined,chunks:Math.max(1,Math.ceil(String(row['原文 / 文案']).length/420)),version:1};documents.push(doc);added++;}Object.assign(doc,{assetDeleted:false,assetCreated:true,assetLibraryId:collection.id,importSource:sourceKey,sourceRecordId:recordId,importUrl,importHash:fingerprint,importName:collection.name});if(!collection.documentIds.includes(doc.id))collection.documentIds.push(doc.id);}
 db.documents.unshift(...documents);db.sources.unshift(...documents.map(d=>({...documentSource(d),origin:input.kind==='feishu'?'feishu-import':'markdown-import',status:'素材库'})));
 delete collection.deletedAt;collection.version++;if(!db.knowledgeSets.includes(collection))db.knowledgeSets.unshift(collection);await saveDb(db);json(res,201,{id:collection.id,name:collection.name,added,updated,count:collection.documentIds.length});return true;
}
