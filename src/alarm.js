import { hydrateIcons, escapeHtml as esc } from './icons.js';
const $ = id => document.getElementById(id);
let alerts = [], audio, soundTimer, soundStopTimer;
function render() {
  $('alarm-list').innerHTML = alerts.map(alert => {
    const minutes = Math.ceil((alert.startsAt - Date.now()) / 60000);
    const countdown = alert.test ? '提醒测试' : minutes > 0 ? `还有 ${minutes >= 60 ? `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}` : `${minutes} 分钟`}开始` : '已经开始';
    return `<section class="alarm-item"><p class="alarm-countdown">${esc(countdown)}</p><h1>${esc(alert.title)}</h1><p class="alarm-time">${esc(alert.date)} · ${esc(alert.start)}–${esc(alert.end)}</p></section>`;
  }).join('');
}
function stopSound() { clearInterval(soundTimer); clearTimeout(soundStopTimer); if (audio) { audio.close().catch(() => {}); audio = null; } }
async function ring() {
  stopSound();
  try {
    audio = new AudioContext(); await audio.resume();
    const beep = () => {
      if (!audio || audio.state !== 'running') return;
      for (const [delay, frequency] of [[0,660],[.22,880],[.44,660]]) {
        const tone = audio.createOscillator(), volume = audio.createGain(), at = audio.currentTime + delay;
        tone.type = 'sine'; tone.frequency.value = frequency;
        volume.gain.setValueAtTime(0, at); volume.gain.linearRampToValueAtTime(.14, at + .025); volume.gain.exponentialRampToValueAtTime(.001, at + .18);
        tone.connect(volume); volume.connect(audio.destination); tone.start(at); tone.stop(at + .2);
      }
    };
    beep(); soundTimer = setInterval(beep, 1800); soundStopTimer = setTimeout(stopSound, 15000);
  } catch { $('alarm-error').hidden = false; $('alarm-error').textContent = '提示音暂时无法播放，请检查系统声音。'; }
}
hydrateIcons();
try { alerts = await window.desktop.readAlarm(); render(); await ring(); }
catch (error) { $('alarm-error').hidden = false; $('alarm-error').textContent = error.message; }
window.desktop.onAlarm(next => { const fresh = next.some(a => !alerts.some(old => old.key === a.key)); alerts = next; render(); if (fresh) ring(); });
$('alarm-close').onclick = $('alarm-dismiss').onclick = () => { stopSound(); window.desktop.dismissAlarm(); };
$('alarm-open').onclick = () => { stopSound(); window.desktop.showMain(); window.desktop.dismissAlarm(); };
window.addEventListener('beforeunload', stopSound);
setInterval(render, 30000);
