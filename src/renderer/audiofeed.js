'use strict';
/* NotchMine audio feed: the system sound as the notch hears it, for every other window that moves to music
   (dock, desktop equalizer, party, live wallpaper).

   Only the notch captures system audio: one capture for the whole app. In Chromium, system audio only comes
   with a (tiny) screen capture, and on some laptops with two graphics chips starting one makes an external monitor
   drop out for a moment; with every window capturing on its own, and windows being rebuilt when a monitor comes
   back, that became a loop. main.js passes the notch's levels on ~30 times a second ('audio'). This gives each
   window an object that reads like a Web Audio AnalyserNode, so the drawing code stays as it was. */
(function () {
  const F = { freq: null, td: null, rate: 48000, size: 2048, at: 0 };
  window.notch.on('audio', f => {
    if (!f || !f.freq) return;
    F.freq = f.freq; F.td = f.td || null; F.rate = f.rate || 48000; F.size = f.size || 2048; F.at = performance.now();
  });
  const live = () => !!F.freq && performance.now() - F.at < 500;     // nothing new for half a second: silence
  const analyser = {
    get fftSize() { return F.size; },
    get frequencyBinCount() { return F.size / 2; },
    getByteFrequencyData(a) {
      if (!live()) { a.fill(0); return; }
      const n = Math.min(a.length, F.freq.length);
      for (let i = 0; i < n; i++) a[i] = F.freq[i];
      if (n < a.length) a.fill(0, n);
    },
    getByteTimeDomainData(a) {                                         // the wave, stretched to the size asked for
      if (!live() || !F.td) { a.fill(128); return; }
      const m = F.td.length;
      for (let i = 0; i < a.length; i++) a[i] = F.td[Math.floor(i * m / a.length)];
    },
  };
  window.AUDIO_FEED = { an: analyser, ctx: { get sampleRate() { return F.rate; } }, live };
})();
