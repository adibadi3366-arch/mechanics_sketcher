#!/bin/sh
# Joins the two demo recordings (scripts/demo-record.cjs, then
# scripts/demo-latex.cjs) into the landing page's video and poster, and a GIF
# for sharing. The app part plays at 1.5×, its first moments (the page
# loading) cut; the LaTeX part follows with a short fade.
#   scripts/demo-encode.sh <dir with app.webm and latex.webm>
set -e
dir=$1
out="$(dirname "$0")/../public/landing"
frames=$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$dir/app.webm")
offset=$(python3 -c "print(round(($frames/25 - 1.7)/1.5 - 0.5, 3))")
join="[0:v]trim=start=1.7,setpts=(PTS-STARTPTS)/1.5,fps=25,format=yuv420p[a];[1:v]trim=start=0.4,setpts=PTS-STARTPTS,fps=25,format=yuv420p[b];[a][b]xfade=transition=fade:duration=0.5:offset=$offset"
ffmpeg -v error -y -i "$dir/app.webm" -i "$dir/latex.webm" -filter_complex "$join[v]" -map "[v]" \
  -c:v libx264 -preset veryfast -crf 30 -pix_fmt yuv420p -movflags +faststart -an "$out/demo.mp4"
# WebM (VP9) too: browsers without H.264, Chromium among them, play that.
ffmpeg -v error -y -i "$dir/app.webm" -i "$dir/latex.webm" -filter_complex "$join[v]" -map "[v]" \
  -c:v libvpx-vp9 -crf 34 -b:v 0 -deadline good -cpu-used 4 -row-mt 1 -an "$out/demo.webm"
# The poster: the truss finished, before the export.
ffmpeg -v error -y -ss "$(python3 -c "print(round($offset - 4, 2))")" -i "$out/demo.mp4" -frames:v 1 "$dir/poster.png"
python3 -c "from PIL import Image; Image.open('$dir/poster.png').convert('RGB').save('$out/demo-poster.webp', quality=82, method=6)"
ffmpeg -v error -y -i "$dir/app.webm" -i "$dir/latex.webm" -filter_complex \
  "$join,fps=12,scale=960:-1:flags=lanczos,split[x][y];[x]palettegen=max_colors=128:stats_mode=diff[p];[y][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  -loop 0 "$dir/mech-sketch-demo.gif"
ls -la "$out/demo.webm" "$out/demo.mp4" "$out/demo-poster.webp" "$dir/mech-sketch-demo.gif"
