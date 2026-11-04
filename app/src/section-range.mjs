export function sectionRange(text,target){
 if(!['opening','body','ending'].includes(target))throw Object.assign(new Error('invalid_section'),{statusCode:400});
 let spans=[...text.matchAll(/[^\n]+(?:\n(?!\n)[^\n]+)*/g)].map(m=>({start:m.index,end:m.index+m[0].length}));
 if(spans.length<3){spans=[...text.matchAll(/[^。！？!?]+[。！？!?]?/g)].map(m=>({start:m.index,end:m.index+m[0].length}));}
 if(!spans.length||target==='body'&&spans.length<3)throw Object.assign(new Error('section_boundaries_required'),{statusCode:400});
 const first=target==='ending'?spans.at(-1):target==='body'?spans[1]:spans[0];
 const last=target==='body'?spans.at(-2):first;
 return {start:first.start,end:last.end,text:text.slice(first.start,last.end)};
}
