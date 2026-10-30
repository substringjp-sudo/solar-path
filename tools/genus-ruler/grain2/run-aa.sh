#!/bin/bash
cd /home/user/solar-path
J=.harness/volsky-grain/out/judge/aa-grain2.json; R=.harness/volsky-grain/out/r
while true; do
  node tools/genus-ruler/grain/run-grain.js --atmos gen --max-min 60 "$J" "$R" 390 584; rc=$?
  [ $rc -eq 3 ] && continue
  echo "aa render exit $rc"; break
done
