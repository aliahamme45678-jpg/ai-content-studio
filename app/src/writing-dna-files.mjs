import {crc32} from 'node:zlib';

export const dnaFileNames={language:'语言DNA.md',structure:'文章结构模板.md',cognition:'写作视角与认知框架.md',visual:'视觉风格指南.md',prompt:'Writing-DNA.md'};
export function dnaExportFiles(run){
 const files=Object.entries(dnaFileNames).map(([key,name])=>({name,content:String(run.result?.[key]||'')}));
 for(const [i,doc] of (run.corpus||[]).entries()){
  const key=String(i+1).padStart(4,'0');
  const article=run.articles?.find(a=>a.id===doc.id);
  const label=[String(doc.date||'unknown-date').slice(0,10),article?.metadata?.article_type||'未分类',doc.title||'未命名',doc.author||'未知来源'].join(' ').replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').slice(0,120)+'-'+key;
  files.push({name:`raw/${label}.md`,content:doc.content});
  files.push({name:`_meta/${label}.json`,content:JSON.stringify({source:doc,content:undefined,...article},(k,v)=>k==='content'?undefined:v,2)});
 }
 files.push({name:'质量检查.json',content:JSON.stringify({method:run.method,quality:run.quality,validation:run.validation,statistics:run.stats},null,2)});
 files.push({name:'_meta/跨篇规则证据.json',content:JSON.stringify(run.layers||{},null,2)});
 return files;
}
// Store-only UTF-8 ZIP: no extra runtime dependency; each Markdown remains a real independent file.
export function dnaZip(files){
 const local=[],central=[];let offset=0;
 for(const file of files){const name=Buffer.from(file.name),data=Buffer.from(file.content),checksum=crc32(data);
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt32LE(checksum,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
  header.writeUInt16LE(0x21,12);local.push(header,name,data);
  const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt16LE(0x21,14);entry.writeUInt32LE(checksum,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);central.push(entry,name);offset+=header.length+name.length+data.length;
 }
 const index=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,index,end]);
}
