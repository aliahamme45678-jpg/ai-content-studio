// Collection output is kept on tasks. Only explicit imports/curation belong to the library.
export function libraryDocument(doc,db={}){
 if(doc.assetDeleted||doc.demo||doc.soulProfile)return false;
 // Keep legacy references for old drafts, but show the completed import once.
 if(doc.source==='feishu-export'&&!doc.importSource&&(db.documents||[]).some(other=>other!==doc&&!other.assetDeleted&&other.assetCreated&&other.importSource?.startsWith('feishu:')&&other.content===doc.content))return false;
 if(doc.assetCreated===true)return true;
 if((db.knowledgeSets||[]).some(set=>(set.documentIds||[]).includes(doc.id)))return true;
 return doc.source!=='douyin-material-pipeline';
}
