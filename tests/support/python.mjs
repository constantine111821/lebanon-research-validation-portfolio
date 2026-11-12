import {spawnSync} from 'node:child_process';
export function pythonCommand() {
  const command=[process.env.RVW_PYTHON,process.env.PYTHON,'python3','python'].filter(Boolean).find(p=>spawnSync(p,['--version'],{encoding:'utf8'}).status===0);
  if(!command)throw Error('Python 3.10+ required on PATH, or set PYTHON/RVW_PYTHON.');
  return command;
}
