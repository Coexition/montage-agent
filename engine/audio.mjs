// Construit la piste audio du montage : voix (segments gardés + vitesse), sfx, musique avec ducking.
import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg } from './lib/ffmpeg.mjs';

function atempoChain(speed) {
  // atempo accepte 0.5..2 : on chaîne si besoin
  const parts = [];
  let s = speed;
  while (s > 2) { parts.push(2); s /= 2; }
  while (s < 0.5) { parts.push(0.5); s /= 0.5; }
  parts.push(s);
  return parts.filter((x) => Math.abs(x - 1) > 1e-4).map((x) => `atempo=${x.toFixed(5)}`).join(',');
}

/**
 * info: { segments, duration, sfx: [{file, at, gain}], music: {file, gain, duck}, audio: {loudnorm} }
 * voice: chemin du wav source (ou null)
 */
export async function buildAudio(projectDir, info, voice, outFile) {
  const inputs = [];
  const filters = [];
  const mixes = [];
  const dur = info.duration;

  if (voice && fs.existsSync(voice) && info.segments.length) {
    inputs.push('-i', voice);
    const labels = [];
    info.segments.forEach((sg, i) => {
      const tempo = atempoChain(sg.speed);
      // micro fondu pour éviter les clics sur les jump-cuts
      const fd = Math.min(0.012, (sg.srcOut - sg.srcIn) / 4);
      const len = (sg.srcOut - sg.srcIn).toFixed(4);
      filters.push(`[0:a]atrim=start=${sg.srcIn.toFixed(4)}:end=${sg.srcOut.toFixed(4)},asetpts=PTS-STARTPTS,afade=t=in:d=${fd},afade=t=out:st=${(len - fd).toFixed(4)}:d=${fd}${tempo ? ',' + tempo : ''}[s${i}]`);
      labels.push(`[s${i}]`);
    });
    filters.push(`${labels.join('')}concat=n=${labels.length}:v=0:a=1,aresample=48000,apad=whole_dur=${dur.toFixed(4)}[voice]`);
  } else {
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${dur}[voice]`);
  }
  let idx = inputs.length / 2;
  const sfx = (info.sfx || []).filter((s) => {
    const ok = fs.existsSync(path.join(projectDir, s.file));
    if (!ok) console.warn(`  sfx introuvable : ${s.file}`);
    return ok;
  });
  sfx.forEach((s, i) => {
    inputs.push('-i', path.join(projectDir, s.file));
    const ms = Math.max(0, Math.round(s.at * 1000));
    filters.push(`[${idx}:a]aresample=48000,volume=${s.gain ?? 0.6},adelay=${ms}|${ms}[fx${i}]`);
    mixes.push(`[fx${i}]`);
    idx++;
  });
  let voiceLabel = '[voice]';
  if (info.music?.file && fs.existsSync(path.join(projectDir, info.music.file))) {
    inputs.push('-stream_loop', '-1', '-i', path.join(projectDir, info.music.file));
    filters.push(`[${idx}:a]aresample=48000,volume=${info.music.gain ?? 0.18},atrim=0:${dur},afade=t=out:st=${Math.max(0, dur - 1.5)}:d=1.5[mus]`);
    if (info.music.duck !== false) {
      filters.push(`[voice]asplit=2[v1][v2]`);
      filters.push(`[mus][v2]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[musd]`);
      voiceLabel = '[v1]';
      mixes.push('[musd]');
    } else mixes.push('[mus]');
    idx++;
  }
  const all = [voiceLabel, ...mixes];
  const norm = info.audio?.loudnorm === false ? '' : ',loudnorm=I=-14:TP=-1.5:LRA=11';
  filters.push(`${all.join('')}amix=inputs=${all.length}:normalize=0:duration=first,atrim=0:${dur.toFixed(4)}${norm},aresample=48000[out]`);
  const script = path.join(path.dirname(outFile), 'audio-filter.txt');
  fs.writeFileSync(script, filters.join(';\n'));
  await ffmpeg([...inputs, '-filter_complex_script', script, '-map', '[out]', '-c:a', 'aac', '-b:a', '192k', outFile]);
  return outFile;
}
