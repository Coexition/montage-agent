import { spawn, execFileSync } from 'node:child_process';

export const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
export const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

export function run(cmd, args, { quiet = true, input } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let err = '';
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => { err += d; if (!quiet) process.stderr.write(d); });
    if (input) { p.stdin.end(input); }
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve({ out, err }) : reject(new Error(`${cmd} ${args.join(' ')}\n${err.slice(-3000)}`))));
  });
}

export function ffmpeg(args, opts) {
  return run(FFMPEG, ['-hide_banner', '-y', '-loglevel', 'error', ...args], opts);
}

export function probe(file) {
  const out = execFileSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { encoding: 'utf8' });
  const j = JSON.parse(out);
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  const rate = (r) => { if (!r) return 0; const [n, d] = r.split('/').map(Number); return d ? n / d : n; };
  let width = v?.width;
  let height = v?.height;
  const rot = Number(v?.tags?.rotate || v?.side_data_list?.find((x) => x.rotation != null)?.rotation || 0);
  if (Math.abs(rot) === 90 || Math.abs(rot) === 270) [width, height] = [height, width];
  return {
    duration: Number(j.format.duration || v?.duration || a?.duration || 0),
    width, height,
    fps: rate(v?.avg_frame_rate) || rate(v?.r_frame_rate) || 30,
    hasVideo: !!v,
    hasAudio: !!a,
  };
}
