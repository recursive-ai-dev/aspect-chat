const fs = require('fs');
let code = fs.readFileSync('src/js/modules/zip.js', 'utf8');

const regex = /const name = \(await nameFile\.async\("string"\)\)\.trim\(\);\n\s*const desc = \(await descFile\.async\("string"\)\)\.trim\(\);\n\s*const instr = \(await instrFile\.async\("string"\)\)\.trim\(\);/;

const replacement = `const name = nameFile ? (await nameFile.async("string")).trim() : "Imported Aspect";
                const desc = descFile ? (await descFile.async("string")).trim() : "";
                const instr = instrFile ? (await instrFile.async("string")).trim() : "";`;

code = code.replace(regex, replacement);

fs.writeFileSync('src/js/modules/zip.js', code);
