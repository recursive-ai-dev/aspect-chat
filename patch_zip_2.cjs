const fs = require('fs');
let code = fs.readFileSync('src/js/modules/zip.js', 'utf8');

const regex = /if \(\!nameFile \|\| \!descFile \|\| \!instrFile\) \{\n\s*throw new Error\("Invalid \.aspect file: missing essential metadata files \(Name\.md, Description\.md, or Instructions\.md\)\."\);\n\s*\}/;

const replacement = `// Removed strict validation to allow graceful degradation when files are missing or malformed`;

code = code.replace(regex, replacement);

fs.writeFileSync('src/js/modules/zip.js', code);
