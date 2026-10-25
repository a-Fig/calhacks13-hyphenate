# Mixes music, voiceover and SFX to mix.wav on the composition's timeline.
import json, subprocess
FF = r'C:/Users/smash/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe'
A = 'C:/Users/smash/.claude_personal/plugins/cache/brag/brag/0.5.0/skills/brag/assets/'
tl = json.loads(open('../composition/timeline.js').read().split('=', 1)[1].strip().rstrip(';'))
def W(clip, word, n=0):
    k = 0
    for w in tl['words'][clip]:
        if w[0].startswith(word):
            if k == n: return w[1]
            k += 1
    raise SystemExit('missing ' + clip + ' ' + word)
sc = {s['id']: s['start'] for s in tl['scenes']}
END = tl['end']
sfx = [(W('v01', 'cracks'), 'impact/impactSoft_heavy_003.ogg', .55),
       (sc['s3'], 'impact/impactSoft_heavy_001.ogg', .7),
       (sc['s11'], 'impact/impactSoft_heavy_000.ogg', .5),
       (W('v04', 'jeff'), 'ui/click2.ogg', .45),
       (W('v05', 'four') - .2, 'interface/bong_001.ogg', .3), (W('v05', 'one-time') - .2, 'interface/bong_001.ogg', .3), (W('v05', 'thirteen') - .2, 'interface/bong_001.ogg', .3),
       (W('v06', 'rejects') - .1, 'impact/impactSoft_medium_004.ogg', .45)]
for sid in ['s2', 's4', 's5', 's6', 's7', 's8', 's9', 's10']:
    sfx.append((sc[sid], 'impact/impactSoft_medium_001.ogg', .28))
inputs = ['-i', A + 'music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3']
for v in tl['vo']: inputs += ['-i', f"vo/{v['clip']}.wav"]
for t, f, g in sfx: inputs += ['-i', A + 'sfx/' + f]
nv, ns = len(tl['vo']), len(sfx)
ws = [f"clip(min((t-{v['start']-0.35:.3f})/0.35,({v['start']+v['dur']+0.6:.3f}-t)/0.6),0,1)" for v in tl['vo']]
duck = ws[0]
for w in ws[1:]: duck = f"max({duck},{w})"
fc = [f"[0:a]atrim=0:{END},asetpts=PTS-STARTPTS,volume=0.42,volume='1-0.72*{duck}':eval=frame,afade=t=out:st={END-2.6}:d=2.6,aformat=sample_rates=48000:channel_layouts=stereo[m]"]
for i, v in enumerate(tl['vo']):
    ms = int(v['start'] * 1000); fc.append(f"[{1+i}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay={ms}|{ms}[v{i}]")
fc.append(''.join(f'[v{i}]' for i in range(nv)) + f"amix=inputs={nv}:normalize=0,apad,atrim=0:{END},volume=1.15,asplit[vo][vsc]")
fc.append("[m]anull[md];[vsc]anullsink")
for j, (t, f, g) in enumerate(sfx):
    ms = int(max(0, t) * 1000); fc.append(f"[{1+nv+j}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume={g},adelay={ms}|{ms}[s{j}]")
fc.append(''.join(f'[s{j}]' for j in range(ns)) + f"amix=inputs={ns}:normalize=0,apad,atrim=0:{END}[sx]")
fc.append('[vo]atrim=0:' + str(END) + '[out];' + ';'.join(x + 'anullsink' for x in ['[vo]', '[md]', '[sx]'] if x != '[vo]'))
cmd = [FF, '-y', '-loglevel', 'error'] + inputs + ['-filter_complex', ';'.join(fc), '-map', '[out]', '-ar', '48000', 'stem-vo.wav']
subprocess.check_call(cmd); print('mix.wav ok', END)
