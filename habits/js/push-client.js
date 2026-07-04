// Push notification client — browser side of the CF Worker relay.
//
// This module talks to the Worker at PUSH_WORKER_URL to schedule and cancel
// exact-time push notifications. Every function silently no-ops on failure
// (push is best-effort; the in-app banner is the reliable channel).
//
// RN port: this file becomes the native push module — the Worker stays the
// same, but subscribeToPush() uses @react-native-firebase/messaging or
// the native push API instead of PushManager.

const DEVICE_ID_KEY = 'tings_device_id';
const PUSH_SUB_KEY = 'tings_push_sub';

// PURE: push is disabled until the deployment replaces placeholder config.
function pushConfigured(){
  return Boolean(
    PUSH_WORKER_URL &&
    VAPID_PUBLIC_KEY &&
    !PUSH_WORKER_URL.includes('YOUR-ACCOUNT') &&
    !VAPID_PUBLIC_KEY.includes('YOUR_VAPID_PUBLIC_KEY')
  );
}

// PURE: get or create a stable device id stored in localStorage.
function getDeviceId(){
  try{
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if(!id){id = crypto.randomUUID();localStorage.setItem(DEVICE_ID_KEY,id);}
    return id;
  }catch(_){return 'unknown';}
}

// PURE: read the cached subscription from localStorage.
function getPushSubscription(){
  try{
    const raw = localStorage.getItem(PUSH_SUB_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch(_){return null;}
}

// PURE: store subscription in localStorage.
function setPushSubscription(sub){
  try{
    if(sub)localStorage.setItem(PUSH_SUB_KEY,JSON.stringify(sub));
    else localStorage.removeItem(PUSH_SUB_KEY);
  }catch(_){}
}

// HYBRID: subscribe to push notifications. Returns the subscription or null.
// The browser shows a system permission prompt on first call.
async function subscribeToPush(){
  try{
    if(!pushConfigured())return null;
    if(!('Notification' in window) || Notification.permission === 'denied')return null;
    if(Notification.permission === 'default'){
      const perm = await Notification.requestPermission();
      if(perm !== 'granted')return null;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly:true,
      applicationServerKey:VAPID_PUBLIC_KEY
    });
    const json = sub.toJSON();
    setPushSubscription(json);
    return json;
  }catch(_){return null;}
}

// HYBRID: unsubscribe from push notifications and tell the Worker to forget us.
async function unsubscribeFromPush(){
  if(!pushConfigured()){
    setPushSubscription(null);
    return;
  }
  try{
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if(sub)await sub.unsubscribe();
  }catch(_){}
  setPushSubscription(null);
  try{
    const deviceId = getDeviceId();
    await fetch(PUSH_WORKER_URL + '/unsubscribe',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({deviceId}),
      keepalive:true
    });
  }catch(_){}
}

// PURE: send a schedule request to the Worker.
async function schedulePush(sig,title,body,tag,fireAt){
  try{
    if(!pushConfigured())return;
    const deviceId = getDeviceId();
    const subscription = getPushSubscription();
    if(!subscription || !fireAt)return;
    await fetch(PUSH_WORKER_URL + '/schedule',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({deviceId,subscription,title,body,tag,sig,fireAt}),
      keepalive:true
    });
  }catch(_){}
}

// PURE: cancel a scheduled push for a specific sig.
async function cancelPush(sig){
  try{
    if(!pushConfigured())return;
    const deviceId = getDeviceId();
    await fetch(PUSH_WORKER_URL + '/cancel',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({deviceId,sig}),
      keepalive:true
    });
  }catch(_){}
}

// HYBRID: try to subscribe if not already subscribed. Called when reminders
// are enabled and notification permission is already granted.
async function initPush(){
  if(!pushConfigured())return;
  const sub = getPushSubscription();
  if(sub)return; // already subscribed
  await subscribeToPush();
}

// Listen for subscription changes from the SW (pushservice rotates keys).
if(navigator.serviceWorker){
  navigator.serviceWorker.addEventListener('message', event => {
    if(event.data && event.data.type === 'PUSH_SUBSCRIPTION_CHANGED' && event.data.subscription){
      setPushSubscription(event.data.subscription);
    }
  });
}
