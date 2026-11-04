function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
export function normalizeMaterial(row, index = 0) {
  const playCount = number(row.playCount ?? row.play_count);
  const known = row.playCountKnown !== false && row.play_count_estimated !== true && row.playCountEstimated !== true && playCount !== null && playCount > 0;
  const externalId = String(row.externalId || row.aweme_id || '');
  return { row: index + 1, externalId, title: String(row.title || row.desc || `抖音素材 ${index + 1}`),titleKnown:row.titleKnown??Boolean(row.title||row.desc),
    transcript: String(row.transcript || row.content || row.text || ''),
    author: String(row.author || row.author_name || row.nickname || ''),
    url: String(row.url || row.video_url || (externalId ? `https://www.douyin.com/video/${externalId}` : '')),
    publishedAt: row.publishedAt || row.published_at || row.publish_time || row.create_time || null,
    diggCount: number(row.diggCount ?? row.digg_count ?? row.likes),
    collectCount: number(row.collectCount ?? row.collect_count), commentCount: number(row.commentCount ?? row.comment_count),
    shareCount: number(row.shareCount ?? row.share_count), playCount: known ? playCount : null, playCountKnown: known,
    commentsState:row.commentsState||'not_requested', comments: Array.isArray(row.comments) ? row.comments : [], playUrl: row.playUrl || row.play_url || null,
    transcriptSource:row.transcriptSource||null, transcriptEditedAt:row.transcriptEditedAt||null,
    transcriptState: row.transcriptState || (row.transcript || row.content || row.text ? 'imported' : 'missing'),
    followerCount:row.followerCountKnown===false||row.collected_at&&row.followerCountKnown===undefined&&row.follower_count===0?null:number(row.followerCount??row.follower_count),durationMs:number(row.durationMs??row.duration_ms),authorId:row.authorId||row.author_id||null,secUid:row.secUid||row.sec_uid||null,
    collectedAt:row.collectedAt||row.collected_at||null,statistics:row.statistics||null,textExtra:row.textExtra||row.text_extra||[],
    mixInfo:row.mixInfo||row.mix_info||null,commerceInfo:row.commerceInfo||row.commerce_info||null,isAds:row.isAds??row.is_ads??null,isTop:row.isTop??row.is_top??false };
}
