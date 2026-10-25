# ElevenLabs sound generation: python gen.py <name> <seconds> <loop0|1> "<prompt>"
# Reads $ELEVENLABS_API_KEY and never prints it.
import json, os, sys, urllib.request
name, secs, loop, prompt = sys.argv[1], float(sys.argv[2]), sys.argv[3] == '1', sys.argv[4]
body = {'text': prompt, 'duration_seconds': secs, 'prompt_influence': 0.5, 'model_id': 'eleven_text_to_sound_v2'}
if loop: body['loop'] = True
req = urllib.request.Request('https://api.elevenlabs.io/v1/sound-generation', data=json.dumps(body).encode(),
    headers={'xi-api-key': os.environ['ELEVENLABS_API_KEY'], 'Content-Type': 'application/json', 'Accept': 'audio/mpeg'})
try:
    data = urllib.request.urlopen(req, timeout=180).read()
except urllib.error.HTTPError as e:
    print(name, 'HTTP', e.code, e.read()[:300].decode('utf-8', 'replace')); sys.exit(1)
except Exception as e:
    print(name, 'FAILED', type(e).__name__, e); sys.exit(1)
out = os.path.join(os.path.dirname(__file__), 'gen', name + '.mp3')
open(out, 'wb').write(data); print(name, len(data), 'bytes')
