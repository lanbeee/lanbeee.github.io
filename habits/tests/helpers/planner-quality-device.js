const {execFileSync}=require('child_process');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
// Connect to the existing debug WebView; never install an APK, change the
// system clock, navigate the page, or seed personal localStorage.
async function connectQualityDevice(){
  if(typeof WebSocket!=='function')throw new Error('Device audit needs Node with global WebSocket (Node 22+).');
  const lines=execFileSync('adb',['devices'],{encoding:'utf8'}).trim().split('\n').slice(1);
  const devices=lines.filter(l=>/\tdevice$/.test(l)).map(l=>l.split('\t')[0]);
  const serial=process.env.ANDROID_SERIAL || (devices.length===1?devices[0]:null);
  if(!serial || !devices.includes(serial))throw new Error('Attach one device or set ANDROID_SERIAL. Open the Tings debug app first.');
  const adb=args=>execFileSync('adb',['-s',serial,...args],{encoding:'utf8'}).trim();
  const pid=adb(['shell','pidof','io.github.lanbeee.tings']).split(' ')[0];
  if(!pid)throw new Error('Open the Tings debug app before running the device audit.');
  const port=adb(['forward','tcp:0',`localabstract:webview_devtools_remote_${pid}`]);
  let ws;
  const cleanup=()=>{if(ws)ws.close();adb(['forward','--remove',`tcp:${port}`]);};
  try{
    const tabs=await(await fetch(`http://127.0.0.1:${port}/json`)).json();
    const tab=tabs.find(t=>t.type==='page' && t.url==='https://localhost/');
    if(!tab)throw new Error('No Tings WebView at https://localhost/; use a debug APK.');
    ws=new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    let sequence=0;const pending=new Map();
    ws.onclose=()=>{for(const p of pending.values())p.reject(new Error('Device WebView disconnected'));pending.clear();};
    ws.onmessage=event=>{const message=JSON.parse(event.data);if(!message.id)return;
      const p=pending.get(message.id);if(!p)return;pending.delete(message.id);
      message.error?p.reject(new Error(message.error.message)):p.resolve(message.result);
    };
    const evaluate=async(fn,args)=>{
      const expression=typeof fn==='string'?fn:`(${fn.toString()})(${JSON.stringify(args)})`;
      const result=await new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});
        ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));});
      if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const environment=await evaluate('({ua:navigator.userAgent,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})');
    if(environment.timezone!=='America/New_York')throw new Error('Fixtures need America/New_York; device timezone was '+environment.timezone+'. No device settings changed.');
    const files=['js/agenda-planner-worker.js','js/agenda-fast-graph.js','js/today-view-week.js','js/agenda-optimizer-ilp.js',
      'js/today-view-fits.js','js/today-view-reservations.js','js/today-view-today.js','js/data-locations.js','js/weather.js','js/agenda-optimizer.js'];
    const sources=await evaluate(async files=>{const result={};for(const file of files)result[file]=await(await fetch('/'+file)).text();return result;},files);
    const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
    const sourceMatch=Object.fromEntries(files.map(file=>[file,hash(sources[file])===hash(fs.readFileSync(path.join(__dirname,'../..',file)))]));
    return {evaluate,close:cleanup,environment:{serial,model:adb(['shell','getprop','ro.product.model']),...environment,sourceMatch}};
  }catch(error){cleanup();throw error;}
}
module.exports={connectQualityDevice};
