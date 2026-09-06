#!/usr/bin/env sh
set -eu

action="${1:-start}"
timeout_seconds="${PROFILEPILOT_START_TIMEOUT:-180}"
script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
project_root="$(dirname -- "$script_dir")"

compose() {
  docker compose "$@"
}

assert_pinned_official_images() {
  images="$(compose config --images)"

  for image in $images; do
    if ! printf '%s\n' "$image" | grep -Eq \
      '^(ghcr\.io/humble-builder/profile-pilot-(backend|frontend)|mongo)@sha256:[0-9a-f]{64}$'; then
      echo "Official startup requires an approved digest-pinned image: $image" >&2
      return 1
    fi
  done
}

wait_for_healthy_service() {
  service="$1"
  elapsed=0

  while [ "$elapsed" -lt "$timeout_seconds" ]; do
    container_id="$(compose ps -q "$service")"
    if [ -n "$container_id" ]; then
      health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
      case "$health" in
        healthy|running)
          echo "$service is $health"
          return 0
          ;;
        unhealthy|exited|dead)
          compose logs --tail 100 "$service"
          echo "$service entered state: $health" >&2
          return 1
          ;;
      esac
    fi

    sleep 2
    elapsed=$((elapsed + 2))
  done

  compose logs --tail 100 "$service"
  echo "Timed out waiting for $service to become healthy" >&2
  return 1
}

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker CLI was not found. Install and start Docker first." >&2
  exit 1
fi

cd "$project_root"

case "$action" in
  start)
    compose config --quiet
    assert_pinned_official_images
    compose pull
    compose up -d
    wait_for_healthy_service backend
    wait_for_healthy_service frontend
    published_address="$(compose port frontend 3000)"
    echo "ProfilePilot is ready at http://$published_address"
    ;;
  restart)
    compose config --quiet
    assert_pinned_official_images
    compose pull
    compose up -d --force-recreate backend frontend
    wait_for_healthy_service backend
    wait_for_healthy_service frontend
    echo "ProfilePilot restarted with the latest configuration."
    ;;
  status)
    compose ps
    ;;
  logs)
    compose logs --tail 200 --follow
    ;;
  stop)
    compose down
    echo "ProfilePilot stopped. MongoDB data remains in the named volume."
    ;;
  *)
    echo "Usage: $0 {start|restart|status|logs|stop}" >&2
    exit 2
    ;;
esac
