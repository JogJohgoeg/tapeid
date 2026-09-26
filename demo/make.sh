#!/bin/sh
# 合成演示：先 node demo/record.mjs 录帧，再 sh demo/make.sh → demo/tapeid-demo.gif + tapeid-demo.mp4
set -e
SUF=${1:+-$1}
cd "$(dirname "$0")/frames${1:+_$1}"
ffmpeg -loglevel error -y -f concat -safe 0 -i frames.txt \
  -vf "fps=5,scale=540:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" \
  -loop 0 ../tapeid-demo$SUF.gif
ffmpeg -loglevel error -y -f concat -safe 0 -i frames.txt \
  -vf "fps=30,scale=780:-2:flags=lanczos,format=yuv420p" -c:v libx264 -crf 20 -movflags +faststart ../tapeid-demo$SUF.mp4
cd .. && ls -la tapeid-demo$SUF.gif tapeid-demo$SUF.mp4
