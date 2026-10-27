export function collectionRequest(input) {
  if (!['links','profile'].includes(input.mode)) throw Object.assign(new Error('invalid_collection_mode'),{statusCode:400});
  const urls=String(input.urls||'').split(/\s+/).filter(Boolean);
  if(!urls.length || urls.length>10 || input.mode==='profile' && urls.length!==1) throw Object.assign(new Error('provide_1_to_10_video_urls_or_one_profile'),{statusCode:400});
  for(const value of urls){let url;try{url=new URL(value);}catch{throw Object.assign(new Error('invalid_douyin_url'),{statusCode:400});}
    if(url.protocol!=='https:' || !['www.douyin.com','v.douyin.com','douyin.com'].includes(url.hostname) || url.username || url.password || url.port) throw Object.assign(new Error('invalid_douyin_url'),{statusCode:400});
  }
  const filters={
    minPlayCount: Math.max(0,Number(input.minPlayCount||0)),
    minDigg: Math.max(0,Number(input.minDigg||0)),
    minCollect: Math.max(0,Number(input.minCollect||0)),
    minComment: Math.max(0,Number(input.minComment||0)),
  };
  const fields=Array.isArray(input.fields)&&input.fields.length?input.fields:['title','url','author','publishedAt','diggCount','collectCount','commentCount','shareCount','transcript'];
  const allowed=['title','url','author','publishedAt','diggCount','collectCount','commentCount','shareCount','playCount','transcript','comments'];
  if(fields.some(field=>!allowed.includes(field))) throw Object.assign(new Error('invalid_collection_field'),{statusCode:400});
  return {mode:input.mode,urls,filters,fields};
}
