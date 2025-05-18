
#!/bin/bash
set -e
echo "Regenerating templates for translations..."
xgettext -o po/editdesktopfiles@dannflower.pot --language=JavaScript --from-code=UTF-8 $(find . -name '*.js')
echo "Updating existing translations..."
for f in po/*.po; do
    msgmerge --update "$f" po/editdesktopfiles@dannflower.pot
done