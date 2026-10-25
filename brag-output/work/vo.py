import json, os, sys, base64, urllib.request
VOICE = sys.argv[1] if len(sys.argv) > 1 else 'cjVigY5qzO86Huf0OWal'
lines = json.load(open('vo-lines.json', encoding='utf-8'))
key = os.environ['ELEVENLABS_API_KEY']
only = set(sys.argv[2:])
for i, (name, text) in enumerate(lines):
    if only and name not in only: continue
    body = {
        'text': text,
        'model_id': 'eleven_multilingual_v2',
        'voice_settings': {'stability': 0.45, 'similarity_boost': 0.8, 'style': 0.25, 'use_speaker_boost': True},
        'previous_text': lines[i-1][1] if i > 0 else None,
        'next_text': lines[i+1][1] if i + 1 < len(lines) else None,
    }
    req = urllib.request.Request(
        f'https://api.elevenlabs.io/v1/text-to-speech/{VOICE}/with-timestamps?output_format=mp3_44100_128',
        data=json.dumps(body).encode(), headers={'xi-api-key': key, 'Content-Type': 'application/json'})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=120))
    except urllib.error.HTTPError as e:
        print(name, 'HTTP', e.code, e.read()[:300]); continue
    open(f'vo/{name}.mp3', 'wb').write(base64.b64decode(d['audio_base64']))
    json.dump(d.get('alignment'), open(f'vo/{name}.json', 'w'))
    a = d.get('alignment') or {}
    print(name, 'ok', round(a.get('character_end_times_seconds', [0])[-1], 2), 's')
