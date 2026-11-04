import {rename} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

// Windows readers and antivirus can briefly hold the destination. Keep the old file
// intact and retry the atomic rename; never unlink it or repeat upstream model work.
export async function atomicReplace(staging,target,{move=rename,pause=delay}={}){
 for(let attempt=0;;attempt++){
  try{return await move(staging,target);}
  catch(error){if(!['EPERM','EBUSY','EACCES'].includes(error.code)||attempt>=7)throw error;await pause(Math.min(25*2**attempt,500));}
 }
}
