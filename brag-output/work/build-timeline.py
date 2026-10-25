# Lays out scenes on the music's beat grid around the voiceover, and writes word times for the composition.
import json, subprocess, re
FFPROBE = r'C:/Users/smash/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffprobe.exe'
SPEED = 1.05
cues = json.load(open('C:/Users/smash/.claude_personal/plugins/cache/brag/brag/0.5.0/skills/brag/assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json'))
beats = [b['time'] for b in cues['beats']]
def dur(f): return float(subprocess.check_output([FFPROBE, '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).decode().strip())
def snap_up(t): return min((b for b in beats if b >= t), default=t)
# scene id, its VO clip, lead from scene start to VO start
plan = [('s1','v01',0.8),('s2','v02',0.45),('s3','v03',0.75),('s4','v04',0.45),('s5','v05',0.35),('s6','v06',0.35),
        ('s7','v07',0.35),('s8','v08',0.35),('s9','v09',0.35),('s10','v10',0.35),('s11','v11',0.5)]
gap_after = {'v02': 0.35, 'v03': 0.9, 'v10': 0.2}
scenes, vo, words = [], [], {}
t = 0.0
for i, (sid, clip, lead) in enumerate(plan):
    start = 0.0 if i == 0 else snap_up(t)
    vstart = start + lead
    d = dur(f'vo/{clip}.wav')
    vo.append({'clip': clip, 'start': round(vstart, 3), 'dur': round(d, 3)})
    al = json.load(open(f'vo/{clip}.json'))
    chars, st, en = al['characters'], al['character_start_times_seconds'], al['character_end_times_seconds']
    ws, cur, cs = [], '', None
    for c, a, b in zip(chars, st, en):
        if c.isspace():
            if cur: ws.append([cur, cs, pe]); cur = ''
            continue
        if not cur: cs = a
        cur += c; pe = b
    if cur: ws.append([cur, cs, pe])
    words[clip] = [[re.sub(r'[^a-z0-9-]', '', w.lower()), round(vstart + a / SPEED, 3), round(vstart + b / SPEED, 3)] for w, a, b in ws]
    scenes.append({'id': sid, 'start': round(start, 3)})
    t = vstart + d + gap_after.get(clip, 0.25)
end = round(t + 3.6, 3)
for i, s in enumerate(scenes): s['end'] = scenes[i + 1]['start'] if i + 1 < len(scenes) else end
tl = {'scenes': scenes, 'vo': vo, 'words': words, 'end': end, 'fps': 30}
open('../composition/timeline.js', 'w').write('window.TL = ' + json.dumps(tl) + ';\n')
for s in scenes: print(s)
print('end', end)
