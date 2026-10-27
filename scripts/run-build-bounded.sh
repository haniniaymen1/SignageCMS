#!/bin/bash
# Exécute la compilation dans l'appel courant, surveille, puis arrête proprement
# le daemon Gradle avant la fin de l'appel (le sandbox tue les processus orphelins).
DUREE_MAX=${1:-540}   # secondes de surveillance
LOG=/home/z/my-project/build3.log

rm -f "$LOG"
setsid bash /home/z/my-project/scripts/build-apk.sh > "$LOG" 2>&1 &
BUILD_PID=$!
echo "Build PID=$BUILD_PID — surveillance ${DUREE_MAX}s"

fin=0
for i in $(seq 1 $((DUREE_MAX / 10))); do
  sleep 10
  if ! kill -0 "$BUILD_PID" 2>/dev/null; then
    echo ">>> BUILD FINI après ~$((i * 10))s"
    fin=1
    break
  fi
done

if [ "$fin" = "0" ]; then
  echo ">>> Temps imparti écoulé — arrêt propre du build (cache conservé)"
fi

# Arrête client + daemon pour que l'appel se termine proprement
pkill -P "$BUILD_PID" 2>/dev/null
pkill -f "org.gradle.launcher" 2>/dev/null
pkill -f "GradleDaemon" 2>/dev/null
sleep 2
pkill -9 -f "org.gradle.launcher" 2>/dev/null
pkill -9 -f "GradleDaemon" 2>/dev/null

echo "===== DERNIÈRES LIGNES DU LOG ====="
tail -20 "$LOG"
echo "===== APK GÉNÉRÉS ====="
ls -R /home/z/my-project/download/android-player/app/build/outputs/apk/ 2>/dev/null || echo "(aucun encore)"
