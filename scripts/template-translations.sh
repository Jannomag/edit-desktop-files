#!/bin/bash
set -e

echo "Regenerating template for translations..."
xgettext -o po/editdesktopfiles@dannflower.pot --language=JavaScript --from-code=UTF-8 $(find . -name '*.js')