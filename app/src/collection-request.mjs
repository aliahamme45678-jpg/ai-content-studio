export function collectionRequest(input) {
  if (!['links','profile'].includes(input.mode)) throw Object.assign(new Error('invalid_collection_mode'),{statusCode:400});
  const urls=[...new Set(String(input.urls||'').split(/\s+/).filter(Boolean))];
  if(!urls.length || urls.length>500 || input.mode==='profile' && urls.length!==1) throw Object.assign(new Error('provide_1_to_500_video_urls_or_one_profile'),{statusCode:400});
  for(const value of urls){let url;try{url=new URL(value);}catch{throw Object.assign(new Error('invalid_douyin_url'),{statusCode:400});}
    if(url.protocol!=='https:' || !['www.douyin.com','v.douyin.com','douyin.com'].includes(url.hostname) || url.username || url.password || url.port) throw Object.assign(new Error('invalid_douyin_url'),{statusCode:400});
  }
  const keys=['PlayCount','Digg','Collect','Comment','Share'];
  const filters=Object.fromEntries(keys.flatMap(key=>[['min'+key,Number(input.filters?.['min'+key]??input['min'+key]??0)],...((input.filters?.['max'+key]??input['max'+key])!==undefined&&(input.filters?.['max'+key]??input['max'+key])!==''?[['max'+key,Number(input.filters?.['max'+key]??input['max'+key])]]:[])]));
  if(Object.values(filters).some(value=>!Number.isFinite(value)||value<0)) throw Object.assign(new Error('invalid_collection_filter'),{statusCode:400});
  const fields=Array.isArray(input.fields)&&input.fields.length?input.fields:['title','url','author','publishedAt','diggCount','collectCount','commentCount','shareCount','transcript'];
  const allowed=['title','url','author','publishedAt','diggCount','collectCount','commentCount','shareCount','playCount','transcript','comments'];
  if(fields.some(field=>!allowed.includes(field))) throw Object.assign(new Error('invalid_collection_field'),{statusCode:400});
  const maxVideos=Number(input.maxVideos??500);
  if(!Number.isInteger(maxVideos)||maxVideos<1||maxVideos>500)throw Object.assign(new Error('invalid_max_videos'),{statusCode:400});
  if(input.collectAll===true&&(input.mode!=='profile'||!['account-analysis','writing-dna'].includes(input.purpose)))throw Object.assign(new Error('all_history_requires_account_analysis_profile'),{statusCode:400});
  if(keys.some(key=>filters['max'+key]!==undefined&&filters['max'+key]<filters['min'+key]))throw Object.assign(new Error('invalid_collection_range'),{statusCode:400});
  return {mode:input.mode,urls,filters,fields:[...new Set(fields)],maxVideos,...(['account-analysis','writing-dna'].includes(input.purpose)?{purpose:input.purpose,collectAll:input.collectAll===true}:{})};
}
