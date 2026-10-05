#!/bin/zsh
studio_root="$(cd -- "$(dirname -- "$0")" && pwd)"
if [[ "$(uname -m)" == "arm64" ]]; then
  studio_app="$studio_root/release/mac-arm64/Lemonhouse Blog Studio.app"
else
  studio_app="$studio_root/release/mac/Lemonhouse Blog Studio.app"
fi
if [[ ! -d "$studio_app" ]]; then
  print '레몬하우스 실행 파일을 찾지 못했습니다. 프로그램 폴더를 통째로 보관해 주세요.'
  exit 1
fi
export LEMONHOUSE_DATA_DIR="$studio_root/.local"
exec "$studio_app/Contents/MacOS/Lemonhouse Blog Studio"
