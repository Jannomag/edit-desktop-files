#!/bin/bash
set -e

echo "Updating existing translations..."
for f in po/*.po; do
    msgmerge --update "$f" po/editdesktopfiles@dannflower.pot
done