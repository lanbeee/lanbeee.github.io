// Local, quiet feedback. Audio is lazy and only follows a recent real gesture;
// planner refreshes, imports, remote completions and background timers stay silent.
let tingAudioContext = null;
let tingFeedbackGestureAt = -Infinity;
let tingFeedbackPlayedAt = -Infinity;
for(const eventName of ['pointerdown','keydown']){
  document.addEventListener(eventName,event=>{
    if(!event.isTrusted)return;
    tingFeedbackGestureAt = performance.now();
    if(typeof sortSettings === 'undefined' || sortSettings.soundEffects === false)return;
    // Unlock inside the gesture itself: completion may wait for double-tap
    // detection, by which time Safari no longer grants audio activation.
    try{
      const Audio = window.AudioContext || window.webkitAudioContext;
      if(!Audio)return;
      tingAudioContext ||= new Audio();
      if(tingAudioContext.state === 'suspended')void tingAudioContext.resume().catch(()=>{});
    }catch(_){ /* Unsupported or blocked audio is silent. */ }
  },{capture:true,passive:true});
}
function playTingFeedback(kind = 'complete'){
  const now = performance.now();
  if(typeof sortSettings === 'undefined' || sortSettings.soundEffects === false
    || document.visibilityState !== 'visible' || now - tingFeedbackGestureAt > 1200
    || now - tingFeedbackPlayedAt < 180)return;
  const Audio = window.AudioContext || window.webkitAudioContext;
  if(!Audio)return;
  try{
    tingAudioContext ||= new Audio();
    const ctx = tingAudioContext;
    tingFeedbackPlayedAt = now;
    const play = ()=>{
      // Never queue a delayed chime after a suspended browser resumes.
      if(ctx.state !== 'running' || performance.now() - now > 500
        || sortSettings.soundEffects === false || document.visibilityState !== 'visible')return;
      const notes = kind === 'plan' ? [[523.25,0,.12]] : [[659.25,0,.22],[987.77,.075,.28]];
      for(const [frequency,delay,duration] of notes){
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = ctx.currentTime + delay;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency,start);
        gain.gain.setValueAtTime(0,start);
        gain.gain.linearRampToValueAtTime(.035,start + .008);
        gain.gain.exponentialRampToValueAtTime(.0001,start + duration);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.onended = ()=>{oscillator.disconnect();gain.disconnect();};
        oscillator.start(start);
        oscillator.stop(start + duration + .02);
      }
    };
    if(ctx.state === 'running')play();
    else void ctx.resume().then(play).catch(()=>{});
  }catch(_){ /* Sound is optional; it must never interfere with saving. */ }
}
