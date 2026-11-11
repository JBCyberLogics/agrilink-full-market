#!/usr/bin/env bash
set -euo pipefail

DATA_ROOT="${AGRILINK_MONGODB_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/agrilink}"
STATE_ROOT="${AGRILINK_MONGODB_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/agrilink}"
MONGO_URI='mongodb://127.0.0.1:27017/admin?directConnection=true'
mkdir -p "$DATA_ROOT/mongodb" "$STATE_ROOT"

if timeout 3 mongosh "$MONGO_URI" --quiet --eval 'quit(db.adminCommand({ping: 1}).ok === 1 ? 0 : 1)' >/dev/null 2>&1; then
  set_name="$(mongosh "$MONGO_URI" --quiet --eval 'print(db.hello().setName || "")')"
  if [[ "$set_name" != 'agrilink-rs' ]]; then
    printf 'MongoDB is already listening on 127.0.0.1:27017 with replica set "%s"; AgriLink will not modify it.\n' "$set_name" >&2
    exit 1
  fi
else
  mongod \
    --dbpath "$DATA_ROOT/mongodb" \
    --bind_ip 127.0.0.1 \
    --port 27017 \
    --replSet agrilink-rs \
    --fork \
    --logpath "$STATE_ROOT/mongod.log" \
    --pidfilepath "$STATE_ROOT/mongod.pid"
fi

mongosh "$MONGO_URI" --quiet --eval '
  const hello = db.hello();
  if (!hello.setName) {
    rs.initiate({_id: "agrilink-rs", members: [{_id: 0, host: "127.0.0.1:27017"}]});
  } else if (hello.setName !== "agrilink-rs") {
    throw new Error("AgriLink replica-set name mismatch; no MongoDB configuration was changed.");
  }
'

for attempt in $(seq 1 30); do
  if mongosh "$MONGO_URI" --quiet --eval 'quit(db.hello().isWritablePrimary ? 0 : 1)' >/dev/null 2>&1; then
    printf 'AgriLink MongoDB is ready on 127.0.0.1:27017 (replica set agrilink-rs).\n'
    exit 0
  fi
  sleep 1
done

printf 'MongoDB started, but the replica set did not elect a primary. See %s/mongod.log.\n' "$STATE_ROOT" >&2
exit 1
