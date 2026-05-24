/* Copy SVG icons into the dist tree so n8n can serve them. */
const { src, dest } = require('gulp');

function buildIcons() {
  return src('nodes/**/*.{png,svg}').pipe(dest('dist/nodes/'));
}

exports['build:icons'] = buildIcons;
