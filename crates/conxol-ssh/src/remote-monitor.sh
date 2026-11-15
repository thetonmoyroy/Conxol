sh -c '
printf "__CONXOL__hostname=%s\n" "$(hostname 2>/dev/null || true)"
printf "__CONXOL__kernel=%s\n" "$(uname -sr 2>/dev/null || true)"
if [ -r /proc/uptime ]; then
  read uptime_seconds rest < /proc/uptime
  printf "__CONXOL__uptime_seconds=%s\n" "$uptime_seconds"
fi
if [ -r /proc/loadavg ]; then
  read one two three rest < /proc/loadavg
  printf "__CONXOL__load=%s,%s,%s\n" "$one" "$two" "$three"
elif command -v sysctl >/dev/null 2>&1; then
  load_line=$(sysctl -n vm.loadavg 2>/dev/null || true)
  set -- $load_line
  printf "__CONXOL__load=%s,%s,%s\n" "$(printf %s "$1" | tr -d "{}")" "$2" "$3"
fi
if [ -r /proc/meminfo ]; then
  while read key value rest; do
    case "$key" in
      MemTotal:) printf "__CONXOL__mem_total_kib=%s\n" "$value" ;;
      MemAvailable:) printf "__CONXOL__mem_available_kib=%s\n" "$value" ;;
      Cached:) printf "__CONXOL__mem_cached_kib=%s\n" "$value" ;;
      Buffers:) printf "__CONXOL__mem_buffers_kib=%s\n" "$value" ;;
    esac
  done < /proc/meminfo
elif command -v sysctl >/dev/null 2>&1; then
  printf "__CONXOL__mem_total_bytes=%s\n" "$(sysctl -n hw.memsize 2>/dev/null || true)"
fi
if [ -r /proc/net/dev ]; then
  tr ":" " " < /proc/net/dev | while read iface rx packets rxerrors rxdropped fifo frame compressed multicast tx packets txerrors txdropped rest; do
    case "$rx" in ""|*[!0-9]*) continue ;; esac
    printf "__CONXOL__network=%s,%s,%s,%s,%s,%s,%s\n" "$iface" "$rx" "$tx" "$rxerrors" "$rxdropped" "$txerrors" "$txdropped"
  done
fi
disk_line=$(df -P / 2>/dev/null | tail -n 1 || true)
set -- $disk_line
printf "__CONXOL__disk_root_used_percent=%s\n" "$(printf %s "$5" | tr -d "%")"
df -Pk 2>/dev/null | while read -r filesystem total used available capacity mount; do
  case "$total:$used:$available" in *[!0-9:]*|"::") continue ;; esac
  printf "__CONXOL__disk=%s\t%s\t%s\t%s\t%s\t%s\n" "$filesystem" "$mount" "$total" "$used" "$available" "$(printf %s "$capacity" | tr -d "%")"
done
if command -v ps >/dev/null 2>&1; then
  printf "__CONXOL__process_count=%s\n" "$(ps -e 2>/dev/null | tail -n +2 | wc -l | tr -d " ")"
fi
'
