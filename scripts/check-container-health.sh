#!/bin/bash
# Flags any guardtec-* Docker container that is not running, or that has
# restarted more than 5 times, so a crash loop (like the n8n one on
# 2026-08-28 that ran ~11,550 restarts unnoticed) gets caught within
# minutes instead of only when someone happens to check manually.
#
# Install (run once on the VPS):
#   chmod +x /opt/guardtec/scripts/check-container-health.sh
#   crontab -e
#   */15 * * * * /opt/guardtec/scripts/check-container-health.sh
#
# Check anytime:
#   cat /opt/guardtec/health-status.txt

STATUS_FILE="/opt/guardtec/health-status.txt"
LOG_FILE="/opt/guardtec/health-alerts.log"
RESTART_THRESHOLD=5

problems=""

for name in $(docker ps -a --format '{{.Names}}' | grep '^guardtec-'); do
  status=$(docker inspect -f '{{.State.Status}}' "$name")
  restarts=$(docker inspect -f '{{.RestartCount}}' "$name")

  if [ "$status" != "running" ]; then
    problems="${problems}${name}: status is '${status}'\n"
  elif [ "$restarts" -gt "$RESTART_THRESHOLD" ]; then
    problems="${problems}${name}: ${restarts} restarts (threshold ${RESTART_THRESHOLD})\n"
  fi
done

if [ -n "$problems" ]; then
  echo -e "$(date '+%Y-%m-%d %H:%M:%S') — PROBLEM DETECTED\n${problems}" > "$STATUS_FILE"
  echo -e "$(date '+%Y-%m-%d %H:%M:%S')\n${problems}" >> "$LOG_FILE"
else
  echo "$(date '+%Y-%m-%d %H:%M:%S') — all containers healthy" > "$STATUS_FILE"
fi
