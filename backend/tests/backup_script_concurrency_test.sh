#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
temporary_dir=$(mktemp -d)
cleanup() {
  rm -rf "$temporary_dir"
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$temporary_dir/mock-bin"
cat > "$temporary_dir/mock-bin/pg_dump" <<'MOCK'
#!/bin/sh
set -eu
output=
for argument do
  case "$argument" in
    --file=*) output=${argument#--file=} ;;
  esac
done
[ -n "$output" ]
sleep 1
printf 'mock postgres dump\n' > "$output"
MOCK
chmod +x "$temporary_dir/mock-bin/pg_dump"

set +e
DATABASE_URL=postgresql://example.invalid/db PATH="$temporary_dir/mock-bin:$PATH" \
  sh "$repo_root/backend/scripts/backup.sh" "$temporary_dir/backup.dump" >"$temporary_dir/one.log" 2>&1 &
first_pid=$!
DATABASE_URL=postgresql://example.invalid/db PATH="$temporary_dir/mock-bin:$PATH" \
  sh "$repo_root/backend/scripts/backup.sh" "$temporary_dir/backup.dump" >"$temporary_dir/two.log" 2>&1 &
second_pid=$!
wait "$first_pid"
first_status=$?
wait "$second_pid"
second_status=$?
set -e

if ! { [ "$first_status" -eq 0 ] && [ "$second_status" -ne 0 ]; } \
   && ! { [ "$second_status" -eq 0 ] && [ "$first_status" -ne 0 ]; }; then
  cat "$temporary_dir/one.log" "$temporary_dir/two.log" >&2
  echo "Expected exactly one concurrent backup writer to win." >&2
  exit 1
fi
[ -s "$temporary_dir/backup.dump" ]
if find "$temporary_dir" -name 'backup.dump.tmp.*' -print | grep -q .; then
  echo "Temporary backup files were not cleaned up." >&2
  exit 1
fi
echo "PASS: concurrent backup attempts use isolated temp files and never overwrite the final artifact"
