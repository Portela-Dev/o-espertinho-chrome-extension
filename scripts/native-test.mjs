import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['--test','test/native-browser.test.mjs','test/whatsapp-native.test.mjs'],{stdio:'inherit',windowsHide:true,env:{...process.env,TEST_NATIVE_BROWSER:'1'}});
if(result.error)throw result.error;
process.exitCode=result.status??1;
