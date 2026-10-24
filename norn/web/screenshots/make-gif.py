"""Assemble the flow GIF from PNG frames: make-gif.py frames.json out.gif width. Needs Pillow."""
import json
import sys

from PIL import Image

frames_path, out_path, width = sys.argv[1], sys.argv[2], int(sys.argv[3])
frames = json.load(open(frames_path))
images = []
for f in frames:
    im = Image.open(f["file"]).convert("RGB")
    h = round(im.height * width / im.width)
    images.append(im.resize((width, h), Image.LANCZOS))

# One shared palette keeps the colours steady between frames; no dithering keeps text sharp.
sample = Image.new("RGB", (width, images[0].height * min(len(images), 6)))
for i, im in enumerate(images[:6]):
    sample.paste(im, (0, i * images[0].height))
palette = sample.quantize(colors=160, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
pal = [im.quantize(palette=palette, dither=Image.Dither.NONE) for im in images]
pal[0].save(out_path, save_all=True, append_images=pal[1:], duration=[f["ms"] for f in frames], loop=0, optimize=True, disposal=1)
print("gif", out_path, round(__import__("os").path.getsize(out_path) / 1e6, 2), "MB")
