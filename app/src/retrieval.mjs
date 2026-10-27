const defaultRoles = ['事实库', '写作案例库', '蒸馏方法库', '规则与记忆库'];
export function retrieveKnowledge(db, query, roles = defaultRoles) {
  const allowed = new Set(roles);
  const text = String(query || '').toLowerCase();
  const words = text.match(/[a-z0-9][a-z0-9_-]+/g) || [];
  for (const segment of text.match(/[\u3400-\u9fff]+/g) || []) {
    for (let index = 0; index < segment.length - 1; index += 1) words.push(segment.slice(index, index + 2));
  }
  const terms = [...new Set(words)]; const chunks = [];
  for (const doc of db.documents) {
    if (!allowed.has(doc.type) || typeof doc.content !== 'string' || !doc.content.trim()) continue;
    doc.content.split(/\n\s*\n/).filter(part => part.trim()).forEach((paragraph, index) => {
      const content = paragraph.toLowerCase(); const title = String(doc.name || '').toLowerCase();
      const relevance = terms.reduce((sum, term) => sum + (content.includes(term) ? 2 : 0) + (title.includes(term) ? 1 : 0), 0);
      if (relevance) chunks.push({ documentId: doc.id, chunkId: `${doc.id}:paragraph:${index + 1}`, locator: `段落 ${index + 1}`, name: doc.name, type: doc.type, version: doc.version || 1, source: doc.source, url: doc.url || null, hash: doc.hash || null, relevance, excerpt: paragraph.trim().slice(0, 1600) });
    });
  }
  return chunks.sort((a,b) => b.relevance - a.relevance || a.chunkId.localeCompare(b.chunkId)).slice(0,6);
}
export function sourceSnapshot(job, db) {
  if (Array.isArray(job.sourceSnapshot)) return job.sourceSnapshot;
  if (job.sourceSnapshot) return [job.sourceSnapshot];
  return (job.sourceIds || []).map(id => db.sources.find(source => source.id === id)).filter(Boolean);
}
